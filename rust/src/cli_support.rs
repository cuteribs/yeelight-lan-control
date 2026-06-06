use serde_json::{Number, Value};

use crate::error::{Result, YeelightError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostValue {
    pub host: String,
    pub port: u16,
}

pub fn parse_exec_params_value(value: &str) -> Result<Vec<Value>> {
    let parsed: Value = serde_json::from_str(value).map_err(|error| {
        YeelightError::from(format!("Exec params must be a valid JSON array: {error}"))
    })?;

    match parsed {
        Value::Array(items) => Ok(items),
        _ => Err(YeelightError::from("Exec params must be a JSON array.")),
    }
}

pub fn parse_exec_token(token: &str) -> Value {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Value::String(String::new());
    }

    let looks_json_like = trimmed == "true"
        || trimmed == "false"
        || trimmed == "null"
        || is_json_number(trimmed)
        || trimmed.starts_with('[')
        || trimmed.starts_with('{')
        || trimmed.starts_with('"');

    if looks_json_like {
        if let Ok(parsed) = serde_json::from_str(trimmed) {
            return parsed;
        }
    }

    Value::String(trimmed.to_owned())
}

pub fn parse_exec_tokens(tokens: &[String]) -> Vec<Value> {
    tokens.iter().map(|token| parse_exec_token(token)).collect()
}

pub fn parse_host_value(value: &str, default_port: u16) -> Result<HostValue> {
    let trimmed = value.trim();
    let mut parts = trimmed.split(':');
    let host = parts.next().unwrap_or_default().trim();
    let port_text = parts.next();

    if host.is_empty() || parts.next().is_some() {
        return Err(YeelightError::from(
            "Host must be in the form \"<ip>\" or \"<ip>:<port>\".",
        ));
    }

    let port = match port_text {
        None => default_port,
        Some(raw_port) => raw_port.parse::<u16>().map_err(|_| {
            YeelightError::from("Host port must be an integer between 1 and 65535.")
        })?,
    };

    if port == 0 {
        return Err(YeelightError::from(
            "Host port must be an integer between 1 and 65535.",
        ));
    }

    Ok(HostValue {
        host: host.to_owned(),
        port,
    })
}

fn is_json_number(value: &str) -> bool {
    serde_json::from_str::<Number>(value).is_ok()
}
