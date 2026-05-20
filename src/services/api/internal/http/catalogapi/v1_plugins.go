package catalogapi

import (
	"context"
	"encoding/json"
	nethttp "net/http"
	"strings"
	"time"

	"arkloop/services/api/internal/audit"
	"arkloop/services/api/internal/auth"
	"arkloop/services/api/internal/data"
	httpkit "arkloop/services/api/internal/http/httpkit"
	"arkloop/services/api/internal/observability"
	"arkloop/services/api/internal/plugincontrib"
	sharedenvironmentref "arkloop/services/shared/environmentref"
)

type pluginInstallRequest struct {
	Manifest     json.RawMessage `json:"manifest"`
	ManifestPath string          `json:"manifest_path"`
	SourceKind   string          `json:"source_kind"`
	SourceURI    string          `json:"source_uri"`
}

type pluginEnablementRequest struct {
	WorkspaceRef string         `json:"workspace_ref"`
	Enabled      bool           `json:"enabled"`
	Settings     map[string]any `json:"settings"`
}

type pluginSettingsRequest struct {
	WorkspaceRef string         `json:"workspace_ref"`
	Settings     map[string]any `json:"settings"`
}

type pluginPackageResponse struct {
	ID          string          `json:"id"`
	PackageID   string          `json:"package_id"`
	Version     string          `json:"version"`
	DisplayName string          `json:"display_name"`
	Description *string         `json:"description,omitempty"`
	Manifest    json.RawMessage `json:"manifest"`
	SourceKind  string          `json:"source_kind"`
	SourceURI   *string         `json:"source_uri,omitempty"`
	IsActive    bool            `json:"is_active"`
	CreatedAt   string          `json:"created_at"`
	UpdatedAt   string          `json:"updated_at"`
}

type pluginEnablementResponse struct {
	ID              string          `json:"id"`
	AccountID       string          `json:"account_id"`
	PackageID       string          `json:"package_id"`
	PluginID        string          `json:"plugin_id"`
	PluginVersion   string          `json:"plugin_version"`
	ProfileRef      string          `json:"profile_ref"`
	WorkspaceRef    string          `json:"workspace_ref"`
	Enabled         bool            `json:"enabled"`
	EnabledByUserID string          `json:"enabled_by_user_id"`
	Settings        json.RawMessage `json:"settings"`
	CreatedAt       string          `json:"created_at"`
	UpdatedAt       string          `json:"updated_at"`
}

type pluginRuntimeStateResponse struct {
	AccountID     string          `json:"account_id,omitempty"`
	PackageID     string          `json:"package_id,omitempty"`
	PluginID      string          `json:"plugin_id,omitempty"`
	PluginVersion string          `json:"plugin_version,omitempty"`
	ProfileRef    string          `json:"profile_ref,omitempty"`
	WorkspaceRef  string          `json:"workspace_ref,omitempty"`
	Status        string          `json:"status"`
	StatusJSON    json.RawMessage `json:"status_json,omitempty"`
	UpdatedAt     string          `json:"updated_at,omitempty"`
}

type activityRecorderBuilderRunResponse struct {
	Triggered bool   `json:"triggered"`
	NextRunAt string `json:"next_run_at"`
	Running   bool   `json:"running"`
	RunID     string `json:"run_id,omitempty"`
}

func formatActivityRecorderBuilderTimestamp(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04:05.999999999")
}

func augmentActivityRecorderBuilderStatus(ctx context.Context, pool data.DB, actor *httpkit.Actor, state *data.PluginRuntimeState) {
	if pool == nil || actor == nil || state == nil || state.PluginID != "arkloop.plugins.activity-recorder" {
		return
	}
	var runningRunID, runningStatus, lastRunID, lastRunStatus, nextRunAt string
	var lastFinishStatus, lastFinishReason, lastSourcesChecked, lastSourcesUnavailable, lastFinishedAt string
	var intervalMin, lastMemoryWriteCount int
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(s.running_run_id, ''),
		       COALESCE(r.status, ''),
		       COALESCE(s.last_run_id, ''),
		       s.last_run_status,
		       s.next_run_at,
		       s.interval_min,
		       s.last_finish_status,
		       s.last_finish_reason,
		       s.last_sources_checked,
		       s.last_sources_unavailable,
		       s.last_memory_write_count,
		       COALESCE(s.last_finished_at, '')
		  FROM activity_recorder_builder_state s
		  LEFT JOIN runs r ON r.id = s.running_run_id
		 WHERE s.account_id = $1
		   AND s.user_id = $2
		   AND s.profile_ref = $3
		   AND s.workspace_ref = $4
		 LIMIT 1`,
		actor.AccountID.String(),
		actor.UserID.String(),
		state.ProfileRef,
		state.WorkspaceRef,
	).Scan(
		&runningRunID,
		&runningStatus,
		&lastRunID,
		&lastRunStatus,
		&nextRunAt,
		&intervalMin,
		&lastFinishStatus,
		&lastFinishReason,
		&lastSourcesChecked,
		&lastSourcesUnavailable,
		&lastMemoryWriteCount,
		&lastFinishedAt,
	)
	if err != nil {
		return
	}
	statusMap := map[string]any{}
	if len(state.StatusJSON) > 0 {
		_ = json.Unmarshal(state.StatusJSON, &statusMap)
	}
	statusMap["activity_recorder.builder.running"] = runningRunID != "" && runningStatus == "running"
	statusMap["activity_recorder.builder.running_run_id"] = runningRunID
	statusMap["activity_recorder.builder.last_run_id"] = lastRunID
	statusMap["activity_recorder.builder.last_run_status"] = lastRunStatus
	statusMap["activity_recorder.builder.next_run_at"] = nextRunAt
	statusMap["activity_recorder.builder.interval_min"] = intervalMin
	statusMap["activity_recorder.builder.last_finish_status"] = lastFinishStatus
	statusMap["activity_recorder.builder.last_finish_reason"] = lastFinishReason
	statusMap["activity_recorder.builder.last_sources_checked"] = decodeActivityRecorderStringArray(lastSourcesChecked)
	statusMap["activity_recorder.builder.last_sources_unavailable"] = decodeActivityRecorderStringArray(lastSourcesUnavailable)
	statusMap["activity_recorder.builder.last_memory_write_count"] = lastMemoryWriteCount
	statusMap["activity_recorder.builder.last_finished_at"] = lastFinishedAt
	if raw, err := json.Marshal(statusMap); err == nil {
		state.StatusJSON = raw
	}
}

func decodeActivityRecorderStringArray(raw string) []string {
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	return out
}

func pluginsEntry(
	authService *auth.Service,
	membershipRepo *data.AccountMembershipRepository,
	apiKeysRepo *data.APIKeysRepository,
	auditWriter *audit.Writer,
	packagesRepo *data.PluginPackagesRepository,
	installer *plugincontrib.Installer,
	pool data.DB,
) nethttp.HandlerFunc {
	return func(w nethttp.ResponseWriter, r *nethttp.Request) {
		traceID := observability.TraceIDFromContext(r.Context())
		if packagesRepo == nil || installer == nil {
			httpkit.WriteError(w, nethttp.StatusServiceUnavailable, "plugins.not_configured", "plugins not configured", traceID, nil)
			return
		}
		actor, ok := httpkit.ResolveActor(w, r, traceID, authService, membershipRepo, apiKeysRepo, auditWriter)
		if !ok {
			return
		}
		switch r.Method {
		case nethttp.MethodGet:
			if !httpkit.RequirePerm(actor, auth.PermDataPersonasRead, w, traceID) {
				return
			}
			items, err := packagesRepo.ListActive(r.Context(), actor.AccountID)
			if err != nil {
				httpkit.WriteError(w, nethttp.StatusInternalServerError, "internal.error", "internal error", traceID, nil)
				return
			}
			httpkit.WriteJSON(w, traceID, nethttp.StatusOK, map[string]any{"items": toPluginPackageResponses(items)})
		case nethttp.MethodPost:
			if !httpkit.RequirePerm(actor, auth.PermDataPersonasManage, w, traceID) {
				return
			}
			var req pluginInstallRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.invalid_request", "invalid JSON body", traceID, nil)
				return
			}
			item, err := installer.Install(r.Context(), plugincontrib.InstallRequest{
				AccountID:    actor.AccountID,
				UserID:       actor.UserID,
				ManifestJSON: req.Manifest,
				ManifestPath: req.ManifestPath,
				SourceKind:   req.SourceKind,
				SourceURI:    req.SourceURI,
			})
			if err != nil {
				httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.invalid_manifest", err.Error(), traceID, nil)
				return
			}
			notifyMCPChanged(r.Context(), pool, actor.AccountID)
			httpkit.WriteJSON(w, traceID, nethttp.StatusCreated, toPluginPackageResponse(item))
		default:
			writeMethodNotAllowedJSON(w, traceID)
		}
	}
}

func pluginEntry(
	authService *auth.Service,
	membershipRepo *data.AccountMembershipRepository,
	apiKeysRepo *data.APIKeysRepository,
	auditWriter *audit.Writer,
	packagesRepo *data.PluginPackagesRepository,
	runtimeRepo *data.PluginRuntimeStateRepository,
	installer *plugincontrib.Installer,
	enabler *plugincontrib.Enabler,
	pool data.DB,
) nethttp.HandlerFunc {
	return func(w nethttp.ResponseWriter, r *nethttp.Request) {
		traceID := observability.TraceIDFromContext(r.Context())
		if packagesRepo == nil || installer == nil || enabler == nil {
			httpkit.WriteError(w, nethttp.StatusServiceUnavailable, "plugins.not_configured", "plugins not configured", traceID, nil)
			return
		}
		actor, ok := httpkit.ResolveActor(w, r, traceID, authService, membershipRepo, apiKeysRepo, auditWriter)
		if !ok {
			return
		}
		pluginID, action := parsePluginPath(r.URL.Path)
		if pluginID == "" {
			httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.invalid_path", "invalid plugin path", traceID, nil)
			return
		}
		switch action {
		case "":
			handlePluginPackage(w, r, traceID, actor, packagesRepo, installer, pool, pluginID)
		case "enablements":
			handlePluginEnablement(w, r, traceID, actor, enabler, pool, pluginID)
		case "settings":
			handlePluginSettings(w, r, traceID, actor, enabler, pool, pluginID)
		case "runtime/status":
			handlePluginRuntimeStatus(w, r, traceID, actor, enabler, pool, pluginID)
		case "runtime/install":
			handlePluginRuntimeInstall(w, r, traceID, actor, enabler, pool, pluginID)
		case "runtime/check":
			handlePluginRuntimeCheck(w, r, traceID, actor, enabler, pool, pluginID)
		case "activity-recorder/run":
			handleActivityRecorderBuilderRun(w, r, traceID, actor, pool, pluginID)
		default:
			httpkit.WriteNotFound(w, r)
		}
		_ = runtimeRepo
	}
}

func handlePluginPackage(w nethttp.ResponseWriter, r *nethttp.Request, traceID string, actor *httpkit.Actor, packagesRepo *data.PluginPackagesRepository, installer *plugincontrib.Installer, pool data.DB, pluginID string) {
	switch r.Method {
	case nethttp.MethodGet:
		if !httpkit.RequirePerm(actor, auth.PermDataPersonasRead, w, traceID) {
			return
		}
		item, err := packagesRepo.GetLatestActive(r.Context(), actor.AccountID, pluginID)
		if err != nil {
			httpkit.WriteError(w, nethttp.StatusInternalServerError, "internal.error", "internal error", traceID, nil)
			return
		}
		if item == nil {
			httpkit.WriteError(w, nethttp.StatusNotFound, "plugins.not_found", "plugin not found", traceID, nil)
			return
		}
		httpkit.WriteJSON(w, traceID, nethttp.StatusOK, toPluginPackageResponse(*item))
	case nethttp.MethodDelete:
		if !httpkit.RequirePerm(actor, auth.PermDataPersonasManage, w, traceID) {
			return
		}
		if err := installer.Uninstall(r.Context(), actor.AccountID, pluginID); err != nil {
			httpkit.WriteError(w, nethttp.StatusInternalServerError, "internal.error", "internal error", traceID, nil)
			return
		}
		notifyMCPChanged(r.Context(), pool, actor.AccountID)
		w.WriteHeader(nethttp.StatusNoContent)
	default:
		writeMethodNotAllowedJSON(w, traceID)
	}
}

func handlePluginEnablement(w nethttp.ResponseWriter, r *nethttp.Request, traceID string, actor *httpkit.Actor, enabler *plugincontrib.Enabler, pool data.DB, pluginID string) {
	switch r.Method {
	case nethttp.MethodGet:
		if !httpkit.RequirePerm(actor, auth.PermDataPersonasRead, w, traceID) {
			return
		}
		item, err := enabler.GetEnablement(r.Context(), plugincontrib.EnableRequest{
			AccountID:    actor.AccountID,
			UserID:       actor.UserID,
			PluginID:     pluginID,
			ProfileRef:   sharedenvironmentref.BuildProfileRef(actor.AccountID, &actor.UserID),
			WorkspaceRef: strings.TrimSpace(r.URL.Query().Get("workspace_ref")),
		})
		if err != nil {
			httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.enablement_failed", err.Error(), traceID, nil)
			return
		}
		if item == nil {
			httpkit.WriteError(w, nethttp.StatusNotFound, "plugins.enablement_not_found", "plugin enablement not found", traceID, nil)
			return
		}
		httpkit.WriteJSON(w, traceID, nethttp.StatusOK, toPluginEnablementResponse(*item))
	case nethttp.MethodPut:
		if !httpkit.RequirePerm(actor, auth.PermDataPersonasManage, w, traceID) {
			return
		}
		var req pluginEnablementRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.invalid_request", "invalid JSON body", traceID, nil)
			return
		}
		item, err := enabler.SetEnabled(r.Context(), plugincontrib.EnableRequest{
			AccountID:    actor.AccountID,
			UserID:       actor.UserID,
			PluginID:     pluginID,
			ProfileRef:   sharedenvironmentref.BuildProfileRef(actor.AccountID, &actor.UserID),
			WorkspaceRef: req.WorkspaceRef,
			Enabled:      req.Enabled,
			Settings:     req.Settings,
		})
		if err != nil {
			httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.enable_failed", err.Error(), traceID, nil)
			return
		}
		notifyMCPChanged(r.Context(), pool, actor.AccountID)
		httpkit.WriteJSON(w, traceID, nethttp.StatusOK, toPluginEnablementResponse(item))
	default:
		writeMethodNotAllowedJSON(w, traceID)
	}
}

func handlePluginSettings(w nethttp.ResponseWriter, r *nethttp.Request, traceID string, actor *httpkit.Actor, enabler *plugincontrib.Enabler, pool data.DB, pluginID string) {
	if r.Method != nethttp.MethodPatch {
		writeMethodNotAllowedJSON(w, traceID)
		return
	}
	if !httpkit.RequirePerm(actor, auth.PermDataPersonasManage, w, traceID) {
		return
	}
	var req pluginSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.invalid_request", "invalid JSON body", traceID, nil)
		return
	}
	item, err := enabler.UpdateSettings(r.Context(), plugincontrib.EnableRequest{
		AccountID:    actor.AccountID,
		UserID:       actor.UserID,
		PluginID:     pluginID,
		ProfileRef:   sharedenvironmentref.BuildProfileRef(actor.AccountID, &actor.UserID),
		WorkspaceRef: req.WorkspaceRef,
		Settings:     req.Settings,
	})
	if err != nil {
		httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.settings_failed", err.Error(), traceID, nil)
		return
	}
	notifyMCPChanged(r.Context(), pool, actor.AccountID)
	httpkit.WriteJSON(w, traceID, nethttp.StatusOK, toPluginEnablementResponse(item))
}

func handlePluginRuntimeInstall(w nethttp.ResponseWriter, r *nethttp.Request, traceID string, actor *httpkit.Actor, enabler *plugincontrib.Enabler, pool data.DB, pluginID string) {
	if r.Method != nethttp.MethodPost {
		writeMethodNotAllowedJSON(w, traceID)
		return
	}
	if !httpkit.RequirePerm(actor, auth.PermDataPersonasManage, w, traceID) {
		return
	}
	var req pluginSettingsRequest
	if r.Body != nil && r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.invalid_request", "invalid JSON body", traceID, nil)
			return
		}
	}
	state, err := enabler.InstallRuntime(r.Context(), plugincontrib.EnableRequest{
		AccountID:    actor.AccountID,
		UserID:       actor.UserID,
		PluginID:     pluginID,
		ProfileRef:   sharedenvironmentref.BuildProfileRef(actor.AccountID, &actor.UserID),
		WorkspaceRef: req.WorkspaceRef,
	})
	if err != nil {
		httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.runtime_install_failed", err.Error(), traceID, nil)
		return
	}
	notifyMCPChanged(r.Context(), pool, actor.AccountID)
	httpkit.WriteJSON(w, traceID, nethttp.StatusOK, toPluginRuntimeStateResponse(&state))
}

func handlePluginRuntimeStatus(w nethttp.ResponseWriter, r *nethttp.Request, traceID string, actor *httpkit.Actor, enabler *plugincontrib.Enabler, pool data.DB, pluginID string) {
	if r.Method != nethttp.MethodGet {
		writeMethodNotAllowedJSON(w, traceID)
		return
	}
	if !httpkit.RequirePerm(actor, auth.PermDataPersonasRead, w, traceID) {
		return
	}
	profileRef := sharedenvironmentref.BuildProfileRef(actor.AccountID, &actor.UserID)
	workspaceRef := strings.TrimSpace(r.URL.Query().Get("workspace_ref"))
	status, err := enabler.RuntimeStatus(r.Context(), actor.AccountID, actor.UserID, pluginID, profileRef, workspaceRef)
	if err != nil {
		httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.runtime_status_failed", err.Error(), traceID, nil)
		return
	}
	if status == nil {
		httpkit.WriteJSON(w, traceID, nethttp.StatusOK, pluginRuntimeStateResponse{Status: "not_installed"})
		return
	}
	augmentActivityRecorderBuilderStatus(r.Context(), pool, actor, status)
	httpkit.WriteJSON(w, traceID, nethttp.StatusOK, toPluginRuntimeStateResponse(status))
}

func handlePluginRuntimeCheck(w nethttp.ResponseWriter, r *nethttp.Request, traceID string, actor *httpkit.Actor, enabler *plugincontrib.Enabler, pool data.DB, pluginID string) {
	if r.Method != nethttp.MethodPost {
		writeMethodNotAllowedJSON(w, traceID)
		return
	}
	if !httpkit.RequirePerm(actor, auth.PermDataPersonasRead, w, traceID) {
		return
	}
	var req pluginSettingsRequest
	if r.Body != nil && r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.invalid_request", "invalid JSON body", traceID, nil)
			return
		}
	}
	state, err := enabler.CheckRuntime(r.Context(), plugincontrib.EnableRequest{
		AccountID:    actor.AccountID,
		UserID:       actor.UserID,
		PluginID:     pluginID,
		ProfileRef:   sharedenvironmentref.BuildProfileRef(actor.AccountID, &actor.UserID),
		WorkspaceRef: req.WorkspaceRef,
	})
	if err != nil {
		httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.runtime_check_failed", err.Error(), traceID, nil)
		return
	}
	augmentActivityRecorderBuilderStatus(r.Context(), pool, actor, &state)
	httpkit.WriteJSON(w, traceID, nethttp.StatusOK, toPluginRuntimeStateResponse(&state))
}

func handleActivityRecorderBuilderRun(w nethttp.ResponseWriter, r *nethttp.Request, traceID string, actor *httpkit.Actor, pool data.DB, pluginID string) {
	if r.Method != nethttp.MethodPost {
		writeMethodNotAllowedJSON(w, traceID)
		return
	}
	if pluginID != "arkloop.plugins.activity-recorder" {
		httpkit.WriteNotFound(w, r)
		return
	}
	if pool == nil {
		httpkit.WriteError(w, nethttp.StatusServiceUnavailable, "plugins.not_configured", "plugins not configured", traceID, nil)
		return
	}
	if !httpkit.RequirePerm(actor, auth.PermDataPersonasManage, w, traceID) {
		return
	}
	var req pluginSettingsRequest
	if r.Body != nil && r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httpkit.WriteError(w, nethttp.StatusBadRequest, "plugins.invalid_request", "invalid JSON body", traceID, nil)
			return
		}
	}

	profileRef := sharedenvironmentref.BuildProfileRef(actor.AccountID, &actor.UserID)
	workspaceRef := strings.TrimSpace(req.WorkspaceRef)
	now := time.Now().UTC()
	nowText := formatActivityRecorderBuilderTimestamp(now)

	var activeRunID string
	if err := pool.QueryRow(r.Context(), `
		SELECT COALESCE((
		    SELECT s.running_run_id
		      FROM activity_recorder_builder_state s
		      JOIN runs r ON r.id = s.running_run_id
		     WHERE s.account_id = $1
		       AND s.user_id = $2
		       AND s.profile_ref = $3
		       AND ($4 = '' OR s.workspace_ref = $4)
		       AND r.status = 'running'
		     ORDER BY s.updated_at DESC
		     LIMIT 1
		), '')`,
		actor.AccountID.String(),
		actor.UserID.String(),
		profileRef,
		workspaceRef,
	).Scan(&activeRunID); err != nil {
		httpkit.WriteError(w, nethttp.StatusInternalServerError, "internal.error", "internal error", traceID, nil)
		return
	}
	if activeRunID != "" {
		httpkit.WriteJSON(w, traceID, nethttp.StatusOK, activityRecorderBuilderRunResponse{Triggered: false, Running: true, RunID: activeRunID, NextRunAt: now.Format(time.RFC3339)})
		return
	}

	tag, err := pool.Exec(r.Context(), `
		INSERT INTO activity_recorder_builder_state
		    (account_id, user_id, profile_ref, workspace_ref, enabled, interval_min, next_run_at, last_run_status, last_error, last_finish_status, last_finish_reason, last_sources_checked, last_sources_unavailable, last_memory_write_count, last_finished_at, created_at, updated_at)
		SELECT pe.account_id,
		       pe.enabled_by_user_id,
		       pe.profile_ref,
		       pe.workspace_ref,
		       1,
		       300,
		       $1,
		       '',
		       '',
		       '',
		       '',
		       '[]',
		       '[]',
		       0,
		       NULL,
		       $1,
		       $1
		  FROM plugin_enablements pe
		  JOIN plugin_runtime_state prs
		    ON prs.account_id = pe.account_id
		   AND prs.package_id = pe.package_id
		   AND prs.profile_ref = pe.profile_ref
		   AND prs.workspace_ref = pe.workspace_ref
		 WHERE pe.account_id = $2
		   AND pe.enabled_by_user_id = $3
		   AND pe.profile_ref = $4
		   AND pe.plugin_id = $5
		   AND pe.desired_enabled = 1
		   AND prs.status = 'installed'
		   AND ($6 = '' OR pe.workspace_ref = $6)
		 ORDER BY pe.updated_at DESC
		 LIMIT 1
		ON CONFLICT (account_id, user_id, profile_ref, workspace_ref) DO UPDATE
		    SET enabled = 1,
		        next_run_at = CASE
		            WHEN NOT EXISTS (
		                SELECT 1 FROM runs
		                 WHERE runs.id = activity_recorder_builder_state.running_run_id
		                   AND runs.status = 'running'
		            ) THEN excluded.next_run_at
		            ELSE activity_recorder_builder_state.next_run_at
		        END,
		        running_run_id = CASE
		            WHEN EXISTS (
		                SELECT 1 FROM runs
		                 WHERE runs.id = activity_recorder_builder_state.running_run_id
		                   AND runs.status = 'running'
		            ) THEN activity_recorder_builder_state.running_run_id
		            ELSE NULL
		        END,
		        running_started_at = CASE
		            WHEN EXISTS (
		                SELECT 1 FROM runs
		                 WHERE runs.id = activity_recorder_builder_state.running_run_id
		                   AND runs.status = 'running'
		            ) THEN activity_recorder_builder_state.running_started_at
		            ELSE NULL
		        END,
		        last_run_status = '',
		        last_error = '',
		        last_finish_status = '',
		        last_finish_reason = '',
		        last_sources_checked = '[]',
		        last_sources_unavailable = '[]',
		        last_memory_write_count = 0,
		        last_finished_at = NULL,
		        updated_at = excluded.updated_at`,
		nowText,
		actor.AccountID.String(),
		actor.UserID.String(),
		profileRef,
		pluginID,
		workspaceRef,
	)
	if err != nil {
		httpkit.WriteError(w, nethttp.StatusInternalServerError, "internal.error", "internal error", traceID, nil)
		return
	}
	if tag.RowsAffected() == 0 {
		httpkit.WriteError(w, nethttp.StatusBadRequest, "activity_recorder.not_ready", "activity recorder is not enabled or installed", traceID, nil)
		return
	}
	httpkit.WriteJSON(w, traceID, nethttp.StatusOK, activityRecorderBuilderRunResponse{Triggered: true, Running: false, NextRunAt: now.Format(time.RFC3339)})
}

func parsePluginPath(path string) (string, string) {
	tail := strings.Trim(strings.TrimPrefix(path, "/v1/plugins/"), "/")
	if tail == "" {
		return "", ""
	}
	parts := strings.Split(tail, "/")
	if len(parts) == 1 {
		return strings.TrimSpace(parts[0]), ""
	}
	return strings.TrimSpace(parts[0]), strings.Join(parts[1:], "/")
}

func toPluginPackageResponses(items []data.PluginPackage) []pluginPackageResponse {
	out := make([]pluginPackageResponse, 0, len(items))
	for _, item := range items {
		out = append(out, toPluginPackageResponse(item))
	}
	return out
}

func toPluginPackageResponse(item data.PluginPackage) pluginPackageResponse {
	return pluginPackageResponse{
		ID:          item.PluginID,
		PackageID:   item.ID.String(),
		Version:     item.Version,
		DisplayName: item.DisplayName,
		Description: item.Description,
		Manifest:    item.ManifestJSON,
		SourceKind:  item.SourceKind,
		SourceURI:   item.SourceURI,
		IsActive:    item.IsActive,
		CreatedAt:   item.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   item.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func toPluginEnablementResponse(item data.PluginEnablement) pluginEnablementResponse {
	return pluginEnablementResponse{
		ID:              item.ID.String(),
		AccountID:       item.AccountID.String(),
		PackageID:       item.PackageID.String(),
		PluginID:        item.PluginID,
		PluginVersion:   item.PluginVersion,
		ProfileRef:      item.ProfileRef,
		WorkspaceRef:    item.WorkspaceRef,
		Enabled:         item.Enabled,
		EnabledByUserID: item.EnabledByUserID.String(),
		Settings:        item.SettingsJSON,
		CreatedAt:       item.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       item.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func toPluginRuntimeStateResponse(item *data.PluginRuntimeState) pluginRuntimeStateResponse {
	if item == nil {
		return pluginRuntimeStateResponse{Status: "not_installed"}
	}
	return pluginRuntimeStateResponse{
		AccountID:     item.AccountID.String(),
		PackageID:     item.PackageID.String(),
		PluginID:      item.PluginID,
		PluginVersion: item.PluginVersion,
		ProfileRef:    item.ProfileRef,
		WorkspaceRef:  item.WorkspaceRef,
		Status:        item.Status,
		StatusJSON:    item.StatusJSON,
		UpdatedAt:     item.UpdatedAt.UTC().Format(time.RFC3339),
	}
}
