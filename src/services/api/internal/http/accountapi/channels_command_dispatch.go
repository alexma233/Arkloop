package accountapi

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"arkloop/services/api/internal/data"
	"arkloop/services/api/internal/entitlement"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ChannelCommandDeps groups repository dependencies for DispatchChannelCommand.
type ChannelCommandDeps struct {
	ChannelIdentitiesRepo    *data.ChannelIdentitiesRepository
	ChannelDMThreadsRepo     *data.ChannelDMThreadsRepository
	ChannelGroupThreadsRepo  *data.ChannelGroupThreadsRepository
	PersonasRepo             *data.PersonasRepository
	RunEventRepo             *data.RunEventRepository
	ChannelBindCodesRepo     *data.ChannelBindCodesRepository
	ChannelIdentityLinksRepo *data.ChannelIdentityLinksRepository
	ThreadRepo               *data.ThreadRepository
}

// PreferenceResult carries structured data from /model and /think commands.
// Channels with rich UI (Telegram) use AvailableModels to build inline keyboards.
// Channels with plain text (WeChat) ignore it and just use the text reply.
type PreferenceResult struct {
	AvailableModels []ModelOption
	AllowUserScoped bool
	ThinkingMode    string // current mode for /think keyboard, "off"/"minimal"/"low"/"medium"/"high"/"max"
}

// ModelOption represents a single model choice in the preference UI.
type ModelOption struct {
	Model      string
	IsSelected bool
}

// PersonaResult carries structured data from /persona command.
type PersonaResult struct {
	Personas []PersonaOption
}

// PersonaOption represents a single persona choice in the persona UI.
type PersonaOption struct {
	ID          string
	DisplayName string
	IsSelected  bool
}

// ChannelCommandResolver provides channel-specific operations needed by DispatchChannelCommand.
type ChannelCommandResolver struct {
	// ResolveThreadID resolves the thread ID for this channel.
	// Takes personaID + projectID, returns threadID.
	ResolveThreadID func(ctx context.Context, tx pgx.Tx, personaID, projectID uuid.UUID, isPrivate bool, platformChatID string) (uuid.UUID, error)

	// ResolveHeartbeatIdentity resolves the identity used for heartbeat config.
	// For group chats, this should be the group identity. For private chats, use the user identity.
	// If nil and in a group chat, the user identity is used as-is.
	ResolveHeartbeatIdentity func(ctx context.Context, tx pgx.Tx) (*data.ChannelIdentity, error)

	// IsGroupAdmin checks if the sender is a group admin (for /new /stop in groups).
	// nil = skip admin check.
	IsGroupAdmin func(ctx context.Context) bool

	// ResolveStartPayload extracts the /start deep link payload (e.g., "bind_xxx").
	// Return "" for channels without deep link support.
	ResolveStartPayload func() string

	// BindCode extracts the bind code from /bind command arguments.
	// Return "" if no bind code present.
	BindCode func() string
}

// DispatchChannelCommand handles command dispatch for all text-based IM channels.
// It detects the command from commandText, resolves projectID/threadID, and dispatches
// to the appropriate handler.
//
// The caller is responsible for:
//   - Starting and committing the transaction
//   - Sending the reply via channel-specific mechanism
//   - Any channel-specific text preprocessing (e.g., stripLeadingMention)
func DispatchChannelCommand(
	ctx context.Context,
	tx pgx.Tx,
	ch data.Channel,
	persona data.Persona,
	identity data.ChannelIdentity,
	commandText string,
	isPrivate bool,
	platformChatID string,
	defaultModel string,
	entSvc *entitlement.Service,
	resolver ChannelCommandResolver,
	deps ChannelCommandDeps,
	channelLabel string,
) (handled bool, replyText string, prefResult *PreferenceResult, personaResult *PersonaResult, cancelRunID uuid.UUID, err error) {
	cmd, ok := slashCommandBase(strings.TrimSpace(commandText), "")
	if !ok {
		return false, "", nil, nil, uuid.Nil, nil
	}

	// Resolve projectID
	threadProjectID := derefUUID(persona.ProjectID)
	if threadProjectID == uuid.Nil {
		ownerUserID := uuid.Nil
		if ch.OwnerUserID != nil {
			ownerUserID = *ch.OwnerUserID
		}
		if ownerUserID == uuid.Nil && identity.UserID != nil {
			ownerUserID = *identity.UserID
		}
		if ownerUserID != uuid.Nil {
			if pid, err := deps.PersonasRepo.GetOrCreateDefaultProjectIDByOwner(ctx, ch.AccountID, ownerUserID); err == nil {
				threadProjectID = pid
			}
		}
	}

	// resolveThreadID is a helper for commands that need a thread
	resolveThreadID := func() (uuid.UUID, error) {
		if threadProjectID == uuid.Nil {
			return uuid.Nil, fmt.Errorf("cannot resolve project for persona %s", persona.ID)
		}
		if resolver.ResolveThreadID == nil {
			return uuid.Nil, fmt.Errorf("thread resolution not configured")
		}
		return resolver.ResolveThreadID(ctx, tx, persona.ID, threadProjectID, isPrivate, platformChatID)
	}

	switch {
	case cmd == "/model" || strings.HasPrefix(cmd, "/think"):
		threadID, err := resolveThreadID()
		if err != nil {
			return true, "", nil, nil, uuid.Nil, err
		}
		replyText, prefResult, err = handlePreferenceCommand(ctx, tx, ch.AccountID, threadID, strings.TrimSpace(commandText), entSvc)
		return true, replyText, prefResult, nil, uuid.Nil, err

	case strings.HasPrefix(cmd, "/heartbeat"):
		threadID, err := resolveThreadID()
		if err != nil {
			return true, "", nil, nil, uuid.Nil, err
		}
		heartbeatIdentity := identity
		if !isPrivate && resolver.ResolveHeartbeatIdentity != nil {
			gi, err := resolver.ResolveHeartbeatIdentity(ctx, tx)
			if err != nil {
				return true, "", nil, nil, uuid.Nil, err
			}
			if gi != nil {
				heartbeatIdentity = *gi
			}
		}
		replyText, err = handleTelegramHeartbeatCommand(
			ctx, tx,
			ch.ID, ch.AccountID, ch.PersonaID,
			defaultModel,
			threadID,
			heartbeatIdentity,
			strings.TrimSpace(commandText),
			deps.ChannelIdentitiesRepo,
			deps.PersonasRepo,
			entSvc,
		)
		return true, replyText, nil, nil, uuid.Nil, err

	case cmd == "/new":
		if ch.PersonaID == nil || *ch.PersonaID == uuid.Nil {
			return true, "当前会话未配置 persona。", nil, nil, uuid.Nil, nil
		}
		if !isPrivate && resolver.IsGroupAdmin != nil && !resolver.IsGroupAdmin(ctx) {
			return true, "无权限。", nil, nil, uuid.Nil, nil
		}
		if isPrivate {
			if deps.ChannelDMThreadsRepo != nil {
				if err := deps.ChannelDMThreadsRepo.WithTx(tx).DeleteByBinding(ctx, ch.ID, identity.ID, *ch.PersonaID, ""); err != nil {
					slog.WarnContext(ctx, "channel_command_new_delete_dm_failed", "error", err, "channel_id", ch.ID, "identity_id", identity.ID)
					return true, "操作失败。", nil, nil, uuid.Nil, nil
				}
			}
		} else {
			if deps.ChannelGroupThreadsRepo != nil {
				if err := deps.ChannelGroupThreadsRepo.WithTx(tx).DeleteByBinding(ctx, ch.ID, platformChatID, *ch.PersonaID); err != nil {
					slog.WarnContext(ctx, "channel_command_new_delete_group_failed", "error", err, "channel_id", ch.ID, "platform_chat_id", platformChatID)
					return true, "操作失败。", nil, nil, uuid.Nil, nil
				}
			}
		}
		return true, "已开启新会话。", nil, nil, uuid.Nil, nil

	case cmd == "/stop":
		if ch.PersonaID == nil || *ch.PersonaID == uuid.Nil {
			return true, "当前没有运行中的任务。", nil, nil, uuid.Nil, nil
		}
		if !isPrivate && resolver.IsGroupAdmin != nil && !resolver.IsGroupAdmin(ctx) {
			return true, "无权限。", nil, nil, uuid.Nil, nil
		}
		threadID, err := resolveThreadID()
		if err != nil {
			return true, "当前没有运行中的任务。", nil, nil, uuid.Nil, err
		}
		activeRun, _ := deps.RunEventRepo.WithTx(tx).GetActiveRootRunForThread(ctx, threadID)
		if activeRun == nil {
			return true, "当前没有运行中的任务。", nil, nil, uuid.Nil, nil
		}
		if _, err := deps.RunEventRepo.WithTx(tx).RequestCancel(ctx, activeRun.ID, identity.UserID, "", 0, nil); err != nil {
			return true, "", nil, nil, uuid.Nil, err
		}
		return true, "已请求停止当前任务。", nil, nil, activeRun.ID, nil

	case cmd == "/help":
		helpText := "/start — 查看连接状态\n/bind <code> — 绑定你的账号\n/new — 开启新会话\n/reset — 重置会话\n/stop — 停止当前任务\n/status — 查看当前状态\n/model [name] — View or switch model\n/think [level] — View or set thinking intensity\n/models — 列出所有可用模型\n/persona — 切换当前 persona\n/heartbeat on/off — 设置心跳\n/help — 显示此帮助"
		return true, helpText, nil, nil, uuid.Nil, nil

	case cmd == "/start":
		if resolver.ResolveStartPayload != nil {
			payload := resolver.ResolveStartPayload()
			if strings.HasPrefix(payload, "bind_") {
				code := strings.TrimPrefix(payload, "bind_")
				replyText, err := bindChannelIdentity(ctx, tx, &ch, identity, code, channelLabel, deps.ChannelBindCodesRepo, deps.ChannelIdentitiesRepo, deps.ChannelIdentityLinksRepo, deps.ChannelDMThreadsRepo, deps.ThreadRepo)
				return true, replyText, nil, nil, uuid.Nil, err
			}
		}
		return true, "已连接 Arkloop\n\n使用 /bind <code> 绑定账号\n私聊直接发消息开始对话，/new 开启新会话\n群内 @bot 触发对话，管理员可用 /new 重置会话", nil, nil, uuid.Nil, nil

	case cmd == "/bind":
		code := ""
		if resolver.BindCode != nil {
			code = resolver.BindCode()
		}
		if code == "" {
			return true, "用法：/bind <code>", nil, nil, uuid.Nil, nil
		}
		replyText, err := bindChannelIdentity(ctx, tx, &ch, identity, code, channelLabel, deps.ChannelBindCodesRepo, deps.ChannelIdentitiesRepo, deps.ChannelIdentityLinksRepo, deps.ChannelDMThreadsRepo, deps.ThreadRepo)
		return true, replyText, nil, nil, uuid.Nil, err

	case cmd == "/reset":
		if ch.PersonaID == nil || *ch.PersonaID == uuid.Nil {
			return true, "当前会话未配置 persona。", nil, nil, uuid.Nil, nil
		}
		if !isPrivate && resolver.IsGroupAdmin != nil && !resolver.IsGroupAdmin(ctx) {
			return true, "无权限。", nil, nil, uuid.Nil, nil
		}
		if isPrivate {
			if deps.ChannelDMThreadsRepo != nil {
				if err := deps.ChannelDMThreadsRepo.WithTx(tx).DeleteByBinding(ctx, ch.ID, identity.ID, *ch.PersonaID, ""); err != nil {
					slog.WarnContext(ctx, "channel_command_reset_delete_dm_failed", "error", err, "channel_id", ch.ID)
					return true, "操作失败。", nil, nil, uuid.Nil, nil
				}
			}
		} else {
			if deps.ChannelGroupThreadsRepo != nil {
				if err := deps.ChannelGroupThreadsRepo.WithTx(tx).DeleteByBinding(ctx, ch.ID, platformChatID, *ch.PersonaID); err != nil {
					slog.WarnContext(ctx, "channel_command_reset_delete_group_failed", "error", err, "channel_id", ch.ID)
					return true, "操作失败。", nil, nil, uuid.Nil, nil
				}
			}
		}
		return true, "已重置会话。", nil, nil, uuid.Nil, nil

	case cmd == "/status":
		threadID, resolveErr := resolveThreadID()
		preferredModel := ""
		reasoningMode := ""
		if resolveErr == nil && threadID != uuid.Nil {
			var err error
			preferredModel, reasoningMode, _, err = getInboundThreadModelPreference(ctx, tx, threadID)
			if err != nil {
				return true, "", nil, nil, uuid.Nil, err
			}
		}
		modelDisplay := "跟随频道"
		if strings.TrimSpace(preferredModel) != "" {
			modelDisplay = preferredModel
		}
		thinkDisplay := reasoningMode
		if thinkDisplay == "" {
			thinkDisplay = "off"
		}
		var sb strings.Builder
		_, _ = fmt.Fprintf(&sb, "模型：%s\n思考：%s", modelDisplay, thinkDisplay)
		if resolveErr == nil && threadID != uuid.Nil {
			activeRun, _ := deps.RunEventRepo.WithTx(tx).GetActiveRootRunForThread(ctx, threadID)
			if activeRun != nil {
				sb.WriteString("\n状态：运行中")
			} else {
				sb.WriteString("\n状态：空闲")
			}
		}
		return true, sb.String(), nil, nil, uuid.Nil, nil

	case cmd == "/models":
		allowUserScoped, err := resolveByokEnabled(ctx, entSvc, ch.AccountID)
		if err != nil {
			return true, "", nil, nil, uuid.Nil, err
		}
		candidates, err := loadModelSelectorCandidates(ctx, tx, ch.AccountID)
		if err != nil {
			return true, "", nil, nil, uuid.Nil, err
		}
		threadID, err := resolveThreadID()
		preferredModel := ""
		if err == nil && threadID != uuid.Nil {
			preferredModel, _, _, _ = getInboundThreadModelPreference(ctx, tx, threadID)
		}
		var modelOpts []ModelOption
		for _, c := range candidates {
			if !c.accountScoped && !allowUserScoped {
				continue
			}
			modelOpts = append(modelOpts, ModelOption{
				Model:      c.model,
				IsSelected: strings.EqualFold(strings.TrimSpace(c.model), strings.TrimSpace(preferredModel)),
			})
		}
		if len(modelOpts) == 0 {
			return true, "暂无可用模型。", nil, nil, uuid.Nil, nil
		}
		header := "Choose model.\nCurrent: follow channel default"
		if strings.TrimSpace(preferredModel) != "" {
			header = "Choose model.\nCurrent: " + preferredModel
		}
		return true, header, &PreferenceResult{AvailableModels: modelOpts, AllowUserScoped: allowUserScoped}, nil, uuid.Nil, nil

	case cmd == "/persona":
		if ch.PersonaID == nil || *ch.PersonaID == uuid.Nil {
			return true, "当前会话未配置 persona。", nil, nil, uuid.Nil, nil
		}
		if !isPrivate {
			if identity.UserID == nil {
				return true, "无权限。", nil, nil, uuid.Nil, nil
			}
			if resolver.IsGroupAdmin != nil && !resolver.IsGroupAdmin(ctx) {
				return true, "无权限。", nil, nil, uuid.Nil, nil
			}
		}
		currentPersona, err := deps.PersonasRepo.GetByIDForAccount(ctx, ch.AccountID, *ch.PersonaID)
		if err != nil {
			return true, "", nil, nil, uuid.Nil, err
		}
		if currentPersona == nil || currentPersona.ProjectID == nil {
			return true, "当前会话未配置 persona。", nil, nil, uuid.Nil, nil
		}
		personas, err := deps.PersonasRepo.ListActiveByProject(ctx, *currentPersona.ProjectID)
		if err != nil {
			return true, "", nil, nil, uuid.Nil, err
		}
		var opts []PersonaOption
		for _, p := range personas {
			if !p.UserSelectable {
				continue
			}
			opts = append(opts, PersonaOption{
				ID:          p.ID.String(),
				DisplayName: p.DisplayName,
				IsSelected:  ch.PersonaID != nil && p.ID == *ch.PersonaID,
			})
		}
		if len(opts) == 0 {
			return true, "没有可切换的 persona。", nil, nil, uuid.Nil, nil
		}
		var sb strings.Builder
		sb.WriteString("Choose persona.\nCurrent: " + currentPersona.DisplayName)
		for _, p := range opts {
			mark := ""
			if p.IsSelected {
				mark = " ✓"
			}
			sb.WriteString(fmt.Sprintf("\n- %s%s", p.DisplayName, mark))
		}
		return true, sb.String(), nil, &PersonaResult{Personas: opts}, uuid.Nil, nil

	default:
		return false, "", nil, nil, uuid.Nil, nil
	}
}
