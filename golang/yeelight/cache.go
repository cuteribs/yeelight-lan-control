package yeelight

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const cacheFileName = ".yeelight-cli-cache.json"

type discoveryCacheFile struct {
	CachedAt int64              `json:"cachedAt"`
	Devices  []DiscoveredDevice `json:"devices"`
}

func GetCachePath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return cacheFileName
	}
	return filepath.Join(home, cacheFileName)
}

func ReadDiscoveryCache(ttlMS int) ([]DiscoveredDevice, bool, error) {
	if ttlMS <= 0 {
		ttlMS = DefaultCacheTTL
	}

	raw, err := os.ReadFile(GetCachePath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, err
	}

	var parsed discoveryCacheFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, false, fmt.Errorf("Discovery cache at %s is not valid JSON.", GetCachePath())
	}

	if time.Now().UnixMilli()-parsed.CachedAt > int64(ttlMS) {
		return nil, false, nil
	}

	return parsed.Devices, true, nil
}

func WriteDiscoveryCache(devices []DiscoveredDevice) error {
	payload := discoveryCacheFile{
		CachedAt: time.Now().UnixMilli(),
		Devices:  devices,
	}
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(GetCachePath(), raw, 0o644)
}
