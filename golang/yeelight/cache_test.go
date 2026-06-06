package yeelight

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestWriteAndReadDiscoveryCacheRoundTrip(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	devices := []DiscoveredDevice{{
		ID:       "0x0000000012345678",
		Host:     "192.168.1.5",
		Port:     55443,
		Model:    "color",
		Name:     "Bedroom",
		Support:  []string{"get_prop", "set_power"},
		Location: "yeelight://192.168.1.5:55443",
	}}

	if err := WriteDiscoveryCache(devices); err != nil {
		t.Fatalf("write cache failed: %v", err)
	}

	parsed, ok, err := ReadDiscoveryCache(DefaultCacheTTL)
	if err != nil {
		t.Fatalf("read cache failed: %v", err)
	}
	if !ok {
		t.Fatal("expected cache hit")
	}
	if len(parsed) != 1 || parsed[0].ID != devices[0].ID || parsed[0].Host != devices[0].Host {
		t.Fatalf("unexpected cached devices: %#v", parsed)
	}
}

func TestReadDiscoveryCacheReturnsMissForStaleFile(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	raw := `{"cachedAt":1,"devices":[{"id":"a","host":"192.168.1.5","port":55443,"model":"","firmwareVersion":"","name":"","power":"","brightness":"","colorMode":"","colorTemperature":"","rgb":"","hue":"","saturation":"","support":[],"location":"yeelight://192.168.1.5:55443"}]}`
	if err := os.WriteFile(GetCachePath(), []byte(raw), 0o644); err != nil {
		t.Fatalf("write stale cache failed: %v", err)
	}

	parsed, ok, err := ReadDiscoveryCache(1)
	if err != nil {
		t.Fatalf("read cache failed: %v", err)
	}
	if ok {
		t.Fatalf("expected cache miss, got %#v", parsed)
	}
}

func TestReadDiscoveryCacheRejectsInvalidJSON(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	if err := os.WriteFile(GetCachePath(), []byte("not-json"), 0o644); err != nil {
		t.Fatalf("write invalid cache failed: %v", err)
	}

	_, _, err := ReadDiscoveryCache(DefaultCacheTTL)
	if err == nil || !strings.Contains(err.Error(), "is not valid JSON") {
		t.Fatalf("expected invalid json error, got %v", err)
	}
}

func TestReadDiscoveryCacheUsesDefaultTTLWhenZero(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	payload := []byte(fmt.Sprintf(`{"cachedAt":%d,"devices":[]}`, time.Now().Add(-time.Minute).UnixMilli()))
	if err := os.WriteFile(GetCachePath(), payload, 0o644); err != nil {
		t.Fatalf("write cache failed: %v", err)
	}

	_, ok, err := ReadDiscoveryCache(0)
	if err != nil {
		t.Fatalf("read cache failed: %v", err)
	}
	if !ok {
		t.Fatal("expected cache hit with default TTL")
	}
}
