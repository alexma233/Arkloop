package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"arkloop/services/worker/internal/data"
	"arkloop/services/worker/internal/llm"
	"arkloop/services/worker/internal/routing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type entitlementRouteResolution struct {
	Selected *routing.SelectedProviderRoute
	Gateway  llm.Gateway
}

// resolveEntitlementRoute 根据 entitlement key 查询账户级 override，
// 解析对应的 provider route 并构建 gateway。
func resolveEntitlementRoute(
	ctx context.Context,
	pool CompactPersistDB,
	accountID uuid.UUID,
	entitlementKey string,
	auxGateway llm.Gateway,
	emitDebugEvents bool,
	llmMaxResponseBytes int,
	configLoader *routing.ConfigLoader,
	byokEnabled bool,
) (*entitlementRouteResolution, bool) {
	var selector string
	err := pool.QueryRow(ctx,
		`SELECT value FROM account_entitlement_overrides
		  WHERE account_id = $1 AND key = $2
		    AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
		  LIMIT 1`,
		accountID, entitlementKey,
	).Scan(&selector)
	selector = strings.TrimSpace(selector)
	if err != nil || selector == "" || configLoader == nil {
		return nil, false
	}

	aid := accountID
	routingCfg, err := configLoader.Load(ctx, &aid)
	if err != nil {
		slog.Warn("entitlement_route: load routing config failed", "key", entitlementKey, "err", err.Error())
		return nil, false
	}

	selected, err := resolveSelectedRouteBySelector(routingCfg, selector, map[string]any{}, byokEnabled)
	if err != nil || selected == nil {
		credName, modelName, exact := splitModelSelector(selector)
		if exact {
			if baseRoute, cred, ok := routingCfg.GetHighestPriorityRouteByCredentialName(credName, map[string]any{}); ok {
				selected = &routing.SelectedProviderRoute{
					Route:      baseRoute,
					Credential: cred,
				}
				selected.Route.Model = modelName
			}
		}
		if selected == nil {
			return nil, false
		}
	}

	gw, err := gatewayFromSelectedRoute(*selected, auxGateway, emitDebugEvents, llmMaxResponseBytes)
	if err != nil {
		slog.Warn("entitlement_route: build gateway failed", "key", entitlementKey, "selector", selector, "err", err.Error())
		return nil, false
	}
	return &entitlementRouteResolution{
		Selected: selected,
		Gateway:  gw,
	}, true
}

// resolveVisionRoute 解析图像理解模型路由，优先级：
// 1. persona.ImageModel (provider^model selector)
// 2. spawn.profile.vision entitlement override
// 失败时不兜底，返回 false。
func resolveVisionRoute(
	ctx context.Context,
	pool CompactPersistDB,
	accountID uuid.UUID,
	personaImageModel *string,
	auxGateway llm.Gateway,
	emitDebugEvents bool,
	llmMaxResponseBytes int,
	configLoader *routing.ConfigLoader,
	byokEnabled bool,
) (*entitlementRouteResolution, bool) {
	// persona.ImageModel 优先
	if personaImageModel != nil {
		selector := strings.TrimSpace(*personaImageModel)
		if selector != "" && configLoader != nil {
			aid := accountID
			routingCfg, err := configLoader.Load(ctx, &aid)
			if err != nil {
				slog.Warn("vision_route: load routing config for persona.image_model failed", "err", err.Error())
			} else {
				selected, err := resolveSelectedRouteBySelector(routingCfg, selector, map[string]any{}, byokEnabled)
				if err != nil {
					slog.Warn("vision_route: persona.image_model resolve failed", "selector", selector, "err", err.Error())
				} else if selected != nil {
					gw, err := gatewayFromSelectedRoute(*selected, auxGateway, emitDebugEvents, llmMaxResponseBytes)
					if err != nil {
						slog.Warn("vision_route: persona.image_model build gateway failed", "err", err.Error())
					} else {
						return &entitlementRouteResolution{
							Selected: selected,
							Gateway:  gw,
						}, true
					}
				}
			}
		}
	}

	// fallback: spawn.profile.vision entitlement
	return resolveEntitlementRoute(ctx, pool, accountID,
		"spawn.profile.vision",
		auxGateway, emitDebugEvents, llmMaxResponseBytes,
		configLoader, byokEnabled)
}

// messageContainsImage 检测 messages 中是否包含 image part。
func messageContainsImage(messages []llm.Message) bool {
	for _, msg := range messages {
		for _, part := range msg.Content {
			if part.Kind() == "image" {
				return true
			}
		}
	}
	return false
}

// routeSupportsVision 检测 selected route 是否支持 image input。
func routeSupportsVision(selected *routing.SelectedProviderRoute) bool {
	if selected == nil {
		return false
	}
	caps, ok := routing.SelectedRouteCatalogModelCapabilities(selected)
	if ok && caps.SupportsInputModality("image") {
		return true
	}
	return routing.IsKnownVisionModel(selected.Route.Model)
}

// swapRunContextRoute 将 RunContext 的 gateway/selectedRoute/contextWindow 切换到新 route。
func swapRunContextRoute(rc *RunContext, resolution *entitlementRouteResolution) {
	rc.Gateway = resolution.Gateway
	rc.SelectedRoute = resolution.Selected
	rc.ContextWindowTokens = routing.RouteContextWindowTokens(resolution.Selected.Route)
	if rc.Temperature == nil {
		rc.Temperature = routing.RouteDefaultTemperature(resolution.Selected.Route)
	}
}

func failVisionRouteUnavailable(ctx context.Context, rc *RunContext, eventsRepo CompactRunEventAppender) error {
	const (
		errorClass = llm.ErrorClassRoutingNotFound
		code       = "routing.vision_model_unavailable"
		message    = "vision model is not configured for image understanding"
	)
	details := map[string]any{}
	if rc.SelectedRoute != nil {
		details["selected_model"] = rc.SelectedRoute.Route.Model
		details["selected_route_id"] = rc.SelectedRoute.Route.ID
	}
	if eventsRepo == nil || rc == nil || rc.DB == nil || rc.RunStatusDB == nil {
		return fmt.Errorf("%s: %s", code, message)
	}

	if rc.ReleaseSlot != nil {
		defer rc.ReleaseSlot()
	}

	failed := rc.Emitter.Emit("run.failed", map[string]any{
		"error_class": errorClass,
		"code":        code,
		"message":     message,
		"details":     details,
	}, nil, StringPtr(errorClass))

	tx, err := rc.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := eventsRepo.AppendRunEvent(ctx, tx, rc.Run.ID, failed); err != nil {
		return err
	}
	if err := rc.RunStatusDB.UpdateRunTerminalStatus(ctx, tx, rc.Run.ID, data.TerminalStatusUpdate{Status: "failed"}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	publishRunEventFromRC(ctx, rc)
	return nil
}

// publishRunEventFromRC 通知 run event channel。
func publishRunEventFromRC(ctx context.Context, rc *RunContext) {
	if rc == nil {
		return
	}
	channel := fmt.Sprintf("run_events:%s", rc.Run.ID.String())
	if rc.EventBus != nil {
		_ = rc.EventBus.Publish(ctx, channel, "")
	} else if rc.Pool != nil {
		_, _ = rc.Pool.Exec(ctx, "SELECT pg_notify($1, '')", channel)
	}
	if rc.BroadcastRDB != nil {
		redisChannel := fmt.Sprintf("arkloop:sse:run_events:%s", rc.Run.ID.String())
		_, _ = rc.BroadcastRDB.Publish(ctx, redisChannel, "").Result()
	}
}
