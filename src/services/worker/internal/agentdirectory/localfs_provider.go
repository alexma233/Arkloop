package agentdirectory

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// LocalFSProvider 从本地文件系统读取 AWD 文件，用于 Desktop localshell。
type LocalFSProvider struct {
	homeDirFunc func() string
	seeded      bool
}

func NewLocalFSProvider(homeDirFunc func() string) *LocalFSProvider {
	return &LocalFSProvider{homeDirFunc: homeDirFunc}
}

func (p *LocalFSProvider) Load(_ context.Context, _ string) (*Content, error) {
	base := p.homeDirFunc()
	_ = os.MkdirAll(base, 0o755)

	if !p.seeded {
		if _, err := SeedWorkspace(base); err != nil {
			// Seeding failure is non-fatal; the workspace can still be used without templates.
		}
		p.seeded = true
	}

	content := &Content{WorkDirPath: base}

	files := map[string]*string{
		"SOUL.md":      &content.Soul,
		"AGENTS.md":    &content.Instructions,
		"MEMORY.md":    &content.Memory,
		"USER.md":      &content.User,
		"BOOTSTRAP.md": &content.Bootstrap,
		"IDENTITY.md":  &content.Identity,
		"TOOLS.md":     &content.Tools,
		"HEARTBEAT.md": &content.Heartbeat,
	}
	for name, ptr := range files {
		data, err := os.ReadFile(filepath.Join(base, name))
		if err != nil {
			continue
		}
		*ptr = string(data)
	}
	content.ExtraFiles = loadExtraMarkdownFiles(base, files)
	content.BootstrapPending = content.Bootstrap != ""
	return content, nil
}

func loadExtraMarkdownFiles(base string, canonical map[string]*string) []FileContent {
	extras := []FileContent{}
	entries, err := os.ReadDir(base)
	if err != nil {
		return extras
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() {
			continue
		}
		if !strings.EqualFold(filepath.Ext(name), ".md") {
			continue
		}
		if _, ok := canonical[name]; ok {
			continue
		}
		data, err := os.ReadFile(filepath.Join(base, name))
		if err != nil {
			continue
		}
		extras = append(extras, FileContent{Path: name, Content: string(data)})
	}
	sort.Slice(extras, func(i, j int) bool { return extras[i].Path < extras[j].Path })
	return extras
}
