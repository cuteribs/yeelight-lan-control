use std::collections::BTreeMap;

use base64::Engine;
use serde_json::{Value, json};

use crate::error::{Result, YeelightError};
use crate::types::{
    FlowExpression, LIVE_STATUS_PROPERTIES, YEELIGHT_METHODS, YeelightDiscoveredDevice,
    YeelightFlowTuple, YeelightNotification, YeelightPropertyValues, YeelightScene,
};

pub const DISCOVERY_ADDRESS: &str = "239.255.255.250";
pub const DISCOVERY_PORT: u16 = 1982;
pub const DEFAULT_DISCOVERY_TIMEOUT_MS: u64 = 3000;
pub const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 3000;
pub const DEFAULT_EFFECT: &str = "sudden";
pub const DEFAULT_DURATION_MS: u64 = 30;
pub const DEFAULT_CONTROL_PORT: u16 = 55443;
pub const DEFAULT_CACHE_TTL_MS: u64 = 10 * 60 * 1000;

pub fn is_yeelight_method(value: &str) -> bool {
    YEELIGHT_METHODS.contains(&value)
}

pub fn build_discovery_request() -> Vec<u8> {
    [
        "M-SEARCH * HTTP/1.1",
        &format!("HOST: {DISCOVERY_ADDRESS}:{DISCOVERY_PORT}"),
        "MAN: \"ssdp:discover\"",
        "MX: 2",
        "ST: wifi_bulb",
        "",
        "",
    ]
    .join("\r\n")
    .into_bytes()
}

pub fn parse_discovery_headers(headers: &BTreeMap<String, String>) -> Option<YeelightDiscoveredDevice> {
    let normalized: BTreeMap<String, String> = headers
        .iter()
        .map(|(key, value)| (key.to_ascii_lowercase(), value.trim().to_owned()))
        .collect();

    let location = normalized.get("location")?;
    let remainder = location.strip_prefix("yeelight://")?;
    let (host, port_text) = remainder.rsplit_once(':')?;
    if host.is_empty() {
        return None;
    }

    let port = port_text.parse::<u16>().ok()?;
    let support = normalized
        .get("support")
        .map(|items| {
            items
                .split_whitespace()
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Some(YeelightDiscoveredDevice {
        id: normalized
            .get("id")
            .cloned()
            .unwrap_or_else(|| format!("{host}:{port}")),
        host: host.to_owned(),
        port,
        model: normalized.get("model").cloned().unwrap_or_default(),
        firmware_version: normalized.get("fw_ver").cloned().unwrap_or_default(),
        name: decode_device_name(normalized.get("name").map(String::as_str).unwrap_or("")),
        power: normalized.get("power").cloned().unwrap_or_default(),
        brightness: normalized.get("bright").cloned().unwrap_or_default(),
        color_mode: normalized.get("color_mode").cloned().unwrap_or_default(),
        color_temperature: normalized.get("ct").cloned().unwrap_or_default(),
        rgb: normalized.get("rgb").cloned().unwrap_or_default(),
        hue: normalized.get("hue").cloned().unwrap_or_default(),
        saturation: normalized.get("sat").cloned().unwrap_or_default(),
        support,
        location: location.clone(),
    })
}

pub fn parse_discovery_response(message: impl AsRef<[u8]>) -> Option<YeelightDiscoveredDevice> {
    let raw = String::from_utf8_lossy(message.as_ref());
    let mut headers = BTreeMap::new();
    let mut last_key: Option<String> = None;

    for line in raw
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .filter(|line| !line.trim().is_empty())
    {
        if let Some(separator_index) = line.find(':') {
            let key = line[..separator_index].trim().to_ascii_lowercase();
            let value = line[separator_index + 1..].trim().to_owned();
            headers.insert(key.clone(), value);
            last_key = Some(key);
            continue;
        }

        if let Some(key) = &last_key {
            if let Some(existing) = headers.get_mut(key) {
                *existing = format!("{} {}", existing, line.trim()).trim().to_owned();
            }
        }
    }

    parse_discovery_headers(&headers)
}

pub fn decode_device_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if !trimmed
        .bytes()
        .all(|byte| matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'+' | b'/' | b'='))
        || trimmed.len() % 4 != 0
    {
        return trimmed.to_owned();
    }

    let decoded = match base64::engine::general_purpose::STANDARD.decode(trimmed) {
        Ok(bytes) => bytes,
        Err(_) => return trimmed.to_owned(),
    };

    let decoded = match String::from_utf8(decoded) {
        Ok(value) => value,
        Err(_) => return trimmed.to_owned(),
    };

    if decoded.chars().any(|character| matches!(character as u32, 0x00..=0x08 | 0x0E..=0x1F)) {
        return trimmed.to_owned();
    }

    let normalized_input = trimmed.trim_end_matches('=');
    let normalized_output = base64::engine::general_purpose::STANDARD
        .encode(decoded.as_bytes())
        .trim_end_matches('=')
        .to_owned();
    if normalized_input == normalized_output {
        decoded
    } else {
        trimmed.to_owned()
    }
}

pub fn build_command(method: &str, params: &[Value], id: u64) -> String {
    format!("{}\r\n", json!({ "id": id, "method": method, "params": params }))
}

pub fn split_socket_buffer(pending: &str, chunk: &str) -> (Vec<String>, String) {
    let combined = format!("{pending}{chunk}");
    let mut parts: Vec<&str> = combined.split("\r\n").collect();
    let next_pending = parts.pop().unwrap_or_default().to_owned();
    let lines = parts
        .into_iter()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    (lines, next_pending)
}

pub fn normalize_status(properties: &[&str], result: &[String]) -> YeelightPropertyValues {
    properties
        .iter()
        .enumerate()
        .map(|(index, property)| ((*property).to_owned(), result.get(index).cloned()))
        .collect()
}

pub fn parse_notification_message(message: &str) -> Result<Option<YeelightNotification>> {
    let parsed: Value = serde_json::from_str(message)?;
    let Value::Object(root) = parsed else {
        return Ok(None);
    };

    let Some(method) = root.get("method").and_then(Value::as_str) else {
        return Ok(None);
    };
    if method != "props" {
        return Ok(None);
    }

    let Some(Value::Object(params)) = root.get("params") else {
        return Ok(None);
    };

    let params = params
        .iter()
        .map(|(key, value)| (key.clone(), value_as_string(value)))
        .collect();

    Ok(Some(YeelightNotification {
        method: "props".to_owned(),
        params,
    }))
}

pub fn build_flow_expression(tuples: &[YeelightFlowTuple]) -> Result<String> {
    if tuples.is_empty() {
        return Err(YeelightError::from("At least one flow tuple is required."));
    }

    let mut parts = Vec::with_capacity(tuples.len());
    for tuple in tuples {
        validate_flow_tuple(tuple)?;
        parts.push(format!(
            "{},{},{},{}",
            tuple.duration, tuple.mode, tuple.value, tuple.brightness
        ));
    }
    Ok(parts.join(","))
}

pub fn serialize_scene(scene: &YeelightScene) -> Result<Vec<Value>> {
    match scene {
        YeelightScene::Color {
            rgb_value,
            brightness,
        } => {
            validate_rgb_value(*rgb_value)?;
            validate_brightness(*brightness)?;
            Ok(vec![json!("color"), json!(rgb_value), json!(brightness)])
        }
        YeelightScene::Hsv {
            hue,
            saturation,
            brightness,
        } => {
            validate_hue(*hue)?;
            validate_saturation(*saturation)?;
            validate_brightness(*brightness)?;
            Ok(vec![json!("hsv"), json!(hue), json!(saturation), json!(brightness)])
        }
        YeelightScene::Ct {
            ct_value,
            brightness,
        } => {
            validate_color_temperature(*ct_value)?;
            validate_brightness(*brightness)?;
            Ok(vec![json!("ct"), json!(ct_value), json!(brightness)])
        }
        YeelightScene::Cf {
            count,
            action,
            flow_expression,
        } => {
            validate_flow_count(*count)?;
            validate_flow_action(*action)?;
            let flow = match flow_expression {
                FlowExpression::Serialized(value) => value.clone(),
                FlowExpression::Tuples(tuples) => build_flow_expression(tuples)?,
            };
            Ok(vec![json!("cf"), json!(count), json!(action), json!(flow)])
        }
        YeelightScene::AutoDelayOff {
            brightness,
            minutes,
        } => {
            validate_brightness(*brightness)?;
            validate_positive_integer(*minutes, "Auto-delay minutes")?;
            Ok(vec![json!("auto_delay_off"), json!(brightness), json!(minutes)])
        }
    }
}

pub fn validate_effect(effect: &str) -> Result<()> {
    match effect {
        "sudden" | "smooth" => Ok(()),
        _ => Err(YeelightError::from("Effect must be \"sudden\" or \"smooth\".")),
    }
}

pub fn validate_duration(duration: u64, minimum: u64) -> Result<()> {
    if duration < minimum {
        return Err(YeelightError::from(format!(
            "Duration must be an integer greater than or equal to {minimum} milliseconds."
        )));
    }
    Ok(())
}

pub fn validate_brightness(brightness: u8) -> Result<()> {
    if !(1..=100).contains(&brightness) {
        return Err(YeelightError::from("Brightness must be an integer between 1 and 100."));
    }
    Ok(())
}

pub fn validate_color_temperature(color_temperature: u16) -> Result<()> {
    if !(1700..=6500).contains(&color_temperature) {
        return Err(YeelightError::from(
            "Color temperature must be an integer between 1700 and 6500 Kelvin.",
        ));
    }
    Ok(())
}

pub fn validate_rgb_value(rgb_value: u32) -> Result<()> {
    if rgb_value > 0x00ff_ffff {
        return Err(YeelightError::from(
            "RGB color must be an integer between 0 and 16777215.",
        ));
    }
    Ok(())
}

pub fn validate_rgb_component(component: u16, label: &str) -> Result<()> {
    if component > 255 {
        return Err(YeelightError::from(format!(
            "{label} must be an integer between 0 and 255."
        )));
    }
    Ok(())
}

pub fn validate_hue(hue: u16) -> Result<()> {
    if hue > 359 {
        return Err(YeelightError::from("Hue must be an integer between 0 and 359."));
    }
    Ok(())
}

pub fn validate_saturation(saturation: u8) -> Result<()> {
    if saturation > 100 {
        return Err(YeelightError::from(
            "Saturation must be an integer between 0 and 100.",
        ));
    }
    Ok(())
}

pub fn validate_power_mode(mode: u8) -> Result<()> {
    if mode > 5 {
        return Err(YeelightError::from(
            "Power mode must be an integer between 0 and 5.",
        ));
    }
    Ok(())
}

pub fn validate_percentage(percentage: i16) -> Result<()> {
    if !(-100..=100).contains(&percentage) {
        return Err(YeelightError::from(
            "Percentage must be an integer between -100 and 100.",
        ));
    }
    Ok(())
}

pub fn validate_name(name: &str) -> Result<()> {
    if name.trim().is_empty() {
        return Err(YeelightError::from("Device name must not be empty."));
    }
    if name.len() > 64 {
        return Err(YeelightError::from("Device name must be 64 bytes or fewer."));
    }
    Ok(())
}

pub fn validate_cron_type(value: u8) -> Result<()> {
    if value != 0 {
        return Err(YeelightError::from(
            "Cron type must be 0 according to the Yeelight spec.",
        ));
    }
    Ok(())
}

pub fn validate_adjust_action(action: &str) -> Result<()> {
    match action {
        "increase" | "decrease" | "circle" => Ok(()),
        _ => Err(YeelightError::from(
            "Adjust action must be \"increase\", \"decrease\", or \"circle\".",
        )),
    }
}

pub fn validate_adjust_property(property: &str) -> Result<()> {
    match property {
        "bright" | "ct" | "color" => Ok(()),
        _ => Err(YeelightError::from(
            "Adjust property must be \"bright\", \"ct\", or \"color\".",
        )),
    }
}

pub fn validate_flow_action(action: u8) -> Result<()> {
    if action > 2 {
        return Err(YeelightError::from("Flow action must be 0, 1, or 2."));
    }
    Ok(())
}

pub fn validate_flow_count(_count: u64) -> Result<()> {
    Ok(())
}

pub fn validate_flow_tuple(tuple: &YeelightFlowTuple) -> Result<()> {
    validate_duration(tuple.duration, 50)?;
    match tuple.mode {
        1 => validate_rgb_value(tuple.value)?,
        2 => validate_color_temperature(tuple.value as u16)?,
        7 => {}
        _ => {
            return Err(YeelightError::from(
                "Flow tuple mode must be 1 (rgb), 2 (ct), or 7 (sleep).",
            ));
        }
    }

    if tuple.mode != 7 && tuple.brightness != -1 {
        if !(1..=100).contains(&tuple.brightness) {
            return Err(YeelightError::from("Brightness must be an integer between 1 and 100."));
        }
    }
    Ok(())
}

pub fn validate_music_start(host: &str, port: u16) -> Result<()> {
    if host.trim().is_empty() {
        return Err(YeelightError::from("Music mode host must not be empty."));
    }
    validate_positive_integer(u64::from(port), "Music mode port")
}

pub fn validate_positive_integer(value: u64, label: &str) -> Result<()> {
    if value == 0 {
        return Err(YeelightError::from(format!("{label} must be a positive integer.")));
    }
    Ok(())
}

pub fn format_device_label(device: &YeelightDiscoveredDevice) -> String {
    let title = if !device.name.is_empty() {
        device.name.clone()
    } else if !device.id.is_empty() {
        device.id.clone()
    } else {
        format!("{}:{}", device.host, device.port)
    };
    format!("{title} ({}:{})", device.host, device.port)
}

pub fn format_device_summary(device: &YeelightDiscoveredDevice) -> String {
    let support = if device.support.is_empty() {
        "unknown".to_owned()
    } else {
        device.support.join(", ")
    };
    let name = if device.name.is_empty() {
        "(unnamed)"
    } else {
        device.name.as_str()
    };

    [
        format!("{name} - {}", device.id),
        format!("  host: {}:{}", device.host, device.port),
        format!("  model: {}", if device.model.is_empty() { "unknown" } else { &device.model }),
        format!("  power: {}", if device.power.is_empty() { "unknown" } else { &device.power }),
        format!(
            "  brightness: {}",
            if device.brightness.is_empty() { "unknown" } else { &device.brightness }
        ),
        format!("  support: {support}"),
    ]
    .join("\n")
}

pub fn to_rgb_value(red: u16, green: u16, blue: u16) -> Result<u32> {
    validate_rgb_component(red, "Red")?;
    validate_rgb_component(green, "Green")?;
    validate_rgb_component(blue, "Blue")?;
    Ok(((red as u32) << 16) | ((green as u32) << 8) | blue as u32)
}

pub fn format_rgb_hex(rgb_value: u32) -> Result<String> {
    validate_rgb_value(rgb_value)?;
    Ok(format!("#{rgb_value:06X}"))
}

pub fn live_status_properties() -> &'static [&'static str] {
    LIVE_STATUS_PROPERTIES
}

fn value_as_string(value: &Value) -> String {
    match value {
        Value::String(inner) => inner.clone(),
        Value::Null => "null".to_owned(),
        Value::Bool(inner) => inner.to_string(),
        Value::Number(inner) => inner.to_string(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}
