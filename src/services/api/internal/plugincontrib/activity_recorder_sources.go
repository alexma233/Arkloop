package plugincontrib

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const activityRecorderPluginID = "arkloop.plugins.activity-recorder"
const activityRecordSyncStaleAfter = time.Hour

func prepareActivityRecorderSources(ctx context.Context, pluginID string, settings, runtimeState map[string]any) {
	if pluginID != activityRecorderPluginID {
		return
	}
	stopLegacyContextInitialSync(runtimeState)
	activityRecordEnabled := settingBoolDefault(settings, "enable_activity_record", true)
	if activityRecordEnabled {
		prepareActivityRecord(runtimeState)
	}
	if settingBool(settings, "enable_screentime") {
		checkScreenTimeAccess(runtimeState)
	}
	_ = ctx
}

func prepareActivityRecord(runtimeState map[string]any) {
	prefix := "activity_record."
	home, err := os.UserHomeDir()
	if err != nil {
		runtimeState[prefix+"error"] = err.Error()
		return
	}
	dataDir := filepath.Join(home, ".Arkloop", "activity-record")
	dbPath := filepath.Join(dataDir, "activity.db")
	runtimeState[prefix+"data_dir"] = dataDir
	runtimeState[prefix+"db_path"] = dbPath
	if records, err := sqliteCount(dbPath, "SELECT COUNT(*) FROM activity_events"); err == nil {
		runtimeState[prefix+"db_records"] = records
		clearActivityRecordSyncIfStopped(runtimeState)
		if records == 0 {
			startActivityRecordSync(runtimeState, dataDir)
			return
		}
		if latestUnix, err := sqliteCount(dbPath, "SELECT COALESCE(MAX(unixepoch(occurred_at)), 0) FROM activity_events"); err == nil && latestUnix > 0 {
			latest := time.Unix(int64(latestUnix), 0).UTC()
			runtimeState[prefix+"db_latest_at"] = latest.Format(time.RFC3339)
			stale := time.Since(latest) > activityRecordSyncStaleAfter
			runtimeState[prefix+"stale"] = stale
			if stale {
				startActivityRecordSync(runtimeState, dataDir)
			}
		}
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		runtimeState[prefix+"db_error"] = err.Error()
	}
	runtimeState[prefix+"db_records"] = 0
	startActivityRecordSync(runtimeState, dataDir)
}

func clearActivityRecordSyncIfStopped(runtimeState map[string]any) {
	key := "activity_record.sync"
	if pid := daemonPID(runtimeState, key); processRunning(pid) {
		runtimeState[key+".status"] = "running"
		return
	}
	removeDaemonPID(runtimeState, key)
	delete(runtimeState, key+".pid")
	if stringFromPluginMap(runtimeState, key+".status") == "running" {
		runtimeState[key+".status"] = "stopped"
	}
}

func startActivityRecordSync(runtimeState map[string]any, dataDir string) {
	key := "activity_record.sync"
	prefix := key + "."
	delete(runtimeState, prefix+"error")
	if pid := daemonPID(runtimeState, key); processRunning(pid) {
		runtimeState[prefix+"status"] = "running"
		return
	}
	removeDaemonPID(runtimeState, key)
	command, err := activityRecordCommand()
	if err != nil {
		runtimeState[prefix+"status"] = "error"
		runtimeState[prefix+"error"] = err.Error()
		return
	}
	logPath := filepath.Join(dataDir, "logs", "sync.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		runtimeState[prefix+"status"] = "error"
		runtimeState[prefix+"error"] = err.Error()
		return
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		runtimeState[prefix+"status"] = "error"
		runtimeState[prefix+"error"] = err.Error()
		return
	}
	cmd := exec.CommandContext(detachedContext(context.Background()), command, "sync", "--data-dir", dataDir)
	configureDaemonCommand(cmd)
	cmd.Env = os.Environ()
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		runtimeState[prefix+"status"] = "error"
		runtimeState[prefix+"error"] = err.Error()
		return
	}
	_ = logFile.Close()
	writeDaemonPID(runtimeState, key, cmd.Process.Pid)
	runtimeState[prefix+"pid"] = cmd.Process.Pid
	runtimeState[prefix+"log_path"] = logPath
	runtimeState[prefix+"started_at"] = time.Now().UTC().Format(time.RFC3339)
	runtimeState[prefix+"status"] = "running"
	go func() {
		_ = cmd.Wait()
	}()
}

func activityRecordCommand() (string, error) {
	if command := strings.TrimSpace(os.Getenv("ARKLOOP_ACTIVITY_RECORD_BIN")); command != "" {
		return command, nil
	}
	executable, _ := os.Executable()
	candidates := []string{}
	if executable != "" {
		dir := filepath.Dir(executable)
		name := "activity-record"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		candidates = append(candidates,
			filepath.Join(dir, name),
			filepath.Join(filepath.Dir(filepath.Dir(dir)), "activity-record", "bin", name),
		)
	}
	cwd, err := os.Getwd()
	if err == nil {
		name := "activity-record"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		candidates = append(candidates,
			filepath.Join(cwd, "src", "services", "activity-record", "bin", name),
			filepath.Join(cwd, "..", "activity-record", "bin", name),
		)
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	for _, dir := range candidateDirs(candidates) {
		if match := firstActivityRecordBinary(dir); match != "" {
			return match, nil
		}
	}
	return "", fmt.Errorf("activity-record binary not found")
}

func candidateDirs(paths []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, path := range paths {
		dir := filepath.Dir(path)
		if dir == "." || dir == "" || seen[dir] {
			continue
		}
		seen[dir] = true
		out = append(out, dir)
	}
	return out
}

func firstActivityRecordBinary(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if runtime.GOOS == "windows" {
			if strings.HasPrefix(name, "activity-record-") && strings.HasSuffix(name, ".exe") {
				return filepath.Join(dir, name)
			}
			continue
		}
		if strings.HasPrefix(name, "activity-record-") {
			return filepath.Join(dir, name)
		}
	}
	return ""
}

func settingBool(settings map[string]any, key string) bool {
	return settingBoolDefault(settings, key, false)
}

func settingBoolDefault(settings map[string]any, key string, defaultValue bool) bool {
	value, ok := settings[key]
	if !ok {
		return defaultValue
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "true"
	default:
		return fmt.Sprint(typed) == "true"
	}
}

func stopLegacyContextInitialSync(runtimeState map[string]any) {
	key := "aicontext.initial_sync"
	if pid := daemonPID(runtimeState, key); processRunning(pid) {
		_ = killDaemonProcess(pid)
	}
	removeDaemonPID(runtimeState, key)
	runtimeState[key+".status"] = "disabled"
	runtimeState[key+".stopped_at"] = time.Now().UTC().Format(time.RFC3339)
}

func checkScreenTimeAccess(runtimeState map[string]any) {
	prefix := "screentime.permissions."
	runtimeState[prefix+"checked_at"] = time.Now().UTC().Format(time.RFC3339)
	delete(runtimeState, prefix+"error")
	if runtime.GOOS != "darwin" {
		runtimeState[prefix+"full_disk_access"] = true
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		runtimeState[prefix+"full_disk_access"] = false
		runtimeState[prefix+"error"] = err.Error()
		return
	}
	path := filepath.Join(home, "Library", "Application Support", "Knowledge", "knowledgeC.db")
	runtimeState[prefix+"db_path"] = path
	if _, err := os.Stat(path); err != nil {
		runtimeState[prefix+"full_disk_access"] = false
		runtimeState[prefix+"error"] = err.Error()
		return
	}
	_, err = sqliteCount(path, "SELECT COUNT(*) FROM ZOBJECT")
	if err != nil {
		runtimeState[prefix+"full_disk_access"] = false
		runtimeState[prefix+"error"] = err.Error()
		return
	}
	runtimeState[prefix+"full_disk_access"] = true
}

func sqliteCount(path, query string) (int, error) {
	if _, err := os.Stat(path); err != nil {
		return 0, err
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro&immutable=1")
	if err != nil {
		return 0, err
	}
	defer db.Close()
	var count int
	if err := db.QueryRow(query).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}
