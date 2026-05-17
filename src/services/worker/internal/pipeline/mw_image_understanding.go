package pipeline

import (
	"context"
	"log/slog"

	"arkloop/services/worker/internal/llm"
	"arkloop/services/worker/internal/routing"
)

type ImageUnderstandingConfig struct {
	AuxGateway          llm.Gateway
	EmitDebugEvents     bool
	RoutingConfigLoader *routing.ConfigLoader
	EventsRepo          CompactRunEventAppender
}

// NewImageUnderstandingMiddleware 检测消息中是否包含图片，若当前路由不支持视觉则切换到 vision 路由。
func NewImageUnderstandingMiddleware(cfg ImageUnderstandingConfig) RunMiddleware {
	return func(ctx context.Context, rc *RunContext, next RunHandler) error {
		if rc == nil || !messageContainsImage(rc.Messages) {
			return next(ctx, rc)
		}

		if routeSupportsVision(rc.SelectedRoute) {
			return next(ctx, rc)
		}

		resolution, ok := resolveVisionRoute(ctx, rc.DB, rc.Run.AccountID,
			rc.AgentConfig.ImageModel,
			cfg.AuxGateway, cfg.EmitDebugEvents, rc.LlmMaxResponseBytes,
			cfg.RoutingConfigLoader, rc.RoutingByokEnabled)
		if !ok {
			slog.WarnContext(ctx, "image_understanding: vision route unavailable",
				"current_model", modelFromSelectedRoute(rc.SelectedRoute))
			return failVisionRouteUnavailable(ctx, rc, cfg.EventsRepo)
		}

		slog.InfoContext(ctx, "image_understanding: switching to vision route",
			"from_model", modelFromSelectedRoute(rc.SelectedRoute),
			"to_model", resolution.Selected.Route.Model)
		swapRunContextRoute(rc, resolution)

		return next(ctx, rc)
	}
}

func modelFromSelectedRoute(selected *routing.SelectedProviderRoute) string {
	if selected == nil {
		return ""
	}
	return selected.Route.Model
}
