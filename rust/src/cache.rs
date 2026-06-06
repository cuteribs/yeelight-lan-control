use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{Result, YeelightError};
use crate::protocol::DEFAULT_CACHE_TTL_MS;
use crate::types::YeelightDiscoveredDevice;

const CACHE_FILE_NAME: &str = ".yeelight-cli-cache.json";

#[derive(Debug, Serialize, Deserialize)]
struct DiscoveryCacheFile {
    cached_at: u64,
    devices: Vec<YeelightDiscoveredDevice>,
}

pub fn get_cache_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(CACHE_FILE_NAME)
}

pub fn read_discovery_cache(ttl_ms: Option<u64>) -> Result<Option<Vec<YeelightDiscoveredDevice>>> {
    let ttl_ms = ttl_ms.unwrap_or(DEFAULT_CACHE_TTL_MS);
    let path = get_cache_path();
    let raw = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };

    let parsed: DiscoveryCacheFile = serde_json::from_str(&raw).map_err(|_| {
        YeelightError::from(format!("Discovery cache at {} is not valid JSON.", path.display()))
    })?;

    if now_millis().saturating_sub(parsed.cached_at) > ttl_ms {
        return Ok(None);
    }

    Ok(Some(parsed.devices))
}

pub fn write_discovery_cache(devices: &[YeelightDiscoveredDevice]) -> Result<()> {
    let payload = DiscoveryCacheFile {
        cached_at: now_millis(),
        devices: devices.to_vec(),
    };
    fs::write(get_cache_path(), serde_json::to_string_pretty(&payload)?)?;
    Ok(())
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
