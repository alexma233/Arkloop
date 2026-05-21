//go:build darwin || linux || windows

package window

import (
	"fmt"
	"testing"
)

func TestActiveWindowReturnsData(t *testing.T) {
	info, err := activeWindow()
	if err != nil {
		t.Fatalf("activeWindow() error: %v", err)
	}
	fmt.Printf("activeWindow: app=%q title=%q pid=%d\n", info.App, info.WindowTitle, info.PID)
	if info.App == "" {
		t.Fatal("activeWindow() returned empty app name")
	}
}

func TestIdleSecondsReturnsPositive(t *testing.T) {
	idle, err := idleSeconds()
	if err != nil {
		t.Fatalf("idleSeconds() error: %v", err)
	}
	fmt.Printf("idleSeconds: %.2f\n", idle)
	if idle < 0 {
		t.Fatal("idleSeconds() returned negative value")
	}
}
