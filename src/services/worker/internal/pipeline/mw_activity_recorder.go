package pipeline

import (
	"context"
	"strings"

	"arkloop/services/shared/runkind"
	"arkloop/services/worker/internal/llm"
	"arkloop/services/worker/internal/routing"

	"github.com/google/uuid"
)

func IsActivityRecorderRun(rc *RunContext) bool {
	return isActivityRecorderRun(rc)
}

func isActivityRecorderRun(rc *RunContext) bool {
	if rc == nil {
		return false
	}
	if s, ok := stringField(rc.InputJSON, "run_kind"); ok && strings.EqualFold(s, runkind.ActivityRecorder) {
		return true
	}
	if s, ok := stringField(rc.JobPayload, "run_kind"); ok && strings.EqualFold(s, runkind.ActivityRecorder) {
		return true
	}
	return false
}

func NewActivityRecorderPrepareMiddleware(pool CompactPersistDB, auxGateway llm.Gateway, emitDebugEvents bool, configLoader *routing.ConfigLoader) RunMiddleware {
	return func(ctx context.Context, rc *RunContext, next RunHandler) error {
		if rc == nil || !isActivityRecorderRun(rc) {
			return next(ctx, rc)
		}

		if pool != nil && configLoader != nil {
			if resolution, ok := resolveEntitlementRoute(ctx, pool, rc.Run.AccountID, "spawn.profile.tool", auxGateway, emitDebugEvents, rc.LlmMaxResponseBytes, configLoader, rc.RoutingByokEnabled); ok {
				rc.Gateway = resolution.Gateway
				rc.SelectedRoute = resolution.Selected
			}
		}

		content := strings.TrimSpace(stringValue(rc.JobPayload["instruction"]))
		if content == "" {
			content = "执行 activity recorder 后台扫描。加载可用的数据源 skill 和 MCP 工具，读取近期桌面活动，只把具有长期价值的事实、偏好、项目上下文或重要事件写入 memory_write。不要写 Notebook，不要输出用户可见说明。"
		}
		rc.Messages = append(rc.Messages, llm.Message{
			Role:    "user",
			Content: []llm.ContentPart{{Type: "text", Text: content}},
		})
		rc.ThreadMessageIDs = append(rc.ThreadMessageIDs, uuid.Nil)

		return next(ctx, rc)
	}
}
