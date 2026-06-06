use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::discovery::discover_devices;
use crate::error::{Result, YeelightError};
use crate::protocol::{
    DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_CONTROL_PORT, DEFAULT_DURATION_MS, DEFAULT_EFFECT,
    build_command, build_flow_expression, normalize_status, serialize_scene,
    split_socket_buffer, validate_adjust_action, validate_adjust_property,
    validate_brightness, validate_color_temperature, validate_cron_type, validate_duration,
    validate_effect, validate_flow_action, validate_flow_count, validate_hue,
    validate_music_start, validate_name, validate_percentage, validate_power_mode,
    validate_rgb_value, validate_saturation,
};
use crate::types::{
    FlowExpression, LIVE_STATUS_PROPERTIES, RawCommandResponse, YeelightCommandOptions,
    YeelightControlConnectionOptions, YeelightCronEntry, YeelightDiscoveredDevice,
    YeelightDiscoveryOptions, YeelightPropertyValues, YeelightScene,
    YeelightTransitionOptions,
};

static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
pub struct YeelightClient {
    pub host: String,
    pub port: u16,
    pub support: Vec<String>,
    pub timeout_ms: u64,
}

impl YeelightClient {
    pub fn new(options: YeelightControlConnectionOptions) -> Self {
        Self {
            host: options.host,
            port: options.port.unwrap_or(DEFAULT_CONTROL_PORT),
            support: options.support,
            timeout_ms: options.timeout_ms.unwrap_or(DEFAULT_COMMAND_TIMEOUT_MS),
        }
    }

    pub fn from_device(device: YeelightDiscoveredDevice, timeout_ms: Option<u64>) -> Self {
        Self::new(YeelightControlConnectionOptions {
            host: device.host,
            port: Some(device.port),
            support: device.support,
            timeout_ms,
        })
    }

    pub fn discover(options: YeelightDiscoveryOptions) -> Result<Vec<YeelightDiscoveredDevice>> {
        discover_devices(options)
    }

    pub fn send_command(&self, method: &str, params: Vec<Value>, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.ensure_supported(method)?;
        match self.send_request(method, params, options.and_then(|value| value.timeout_ms))? {
            RawCommandResponse::Result { result, .. } => Ok(result),
            RawCommandResponse::Error { error, .. } => Err(YeelightError::from(format!(
                "Yeelight command failed ({}): {}",
                error.code, error.message
            ))),
        }
    }

    pub fn send_raw_command(&self, method: &str, params: Vec<Value>, options: Option<YeelightCommandOptions>) -> Result<RawCommandResponse> {
        self.send_request(method, params, options.and_then(|value| value.timeout_ms))
    }

    pub fn get_properties(&self, properties: &[&str], options: Option<YeelightCommandOptions>) -> Result<Vec<String>> {
        if properties.is_empty() {
            return Err(YeelightError::from("At least one property is required."));
        }
        let result = self.send_command(
            "get_prop",
            properties.iter().map(|property| json!(property)).collect(),
            options,
        )?;

        let Value::Array(items) = result else {
            return Err(YeelightError::from("The bulb returned an unexpected get_prop payload."));
        };

        Ok(items.into_iter().map(value_to_string).collect())
    }

    pub fn get_status(&self, options: Option<YeelightCommandOptions>) -> Result<YeelightPropertyValues> {
        let result = self.get_properties(LIVE_STATUS_PROPERTIES, options)?;
        Ok(normalize_status(LIVE_STATUS_PROPERTIES, &result))
    }

    pub fn set_power(&self, power: &str, options: YeelightTransitionOptions) -> Result<Value> {
        self.send_power_command("set_power", power, options, None)
    }

    pub fn set_power_with_mode(&self, power: &str, options: YeelightTransitionOptions, mode: u8) -> Result<Value> {
        self.send_power_command("set_power", power, options, Some(mode))
    }

    pub fn toggle(&self, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("toggle", vec![], options)
    }

    pub fn set_default(&self, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("set_default", vec![], options)
    }

    pub fn set_brightness(&self, brightness: u8, options: YeelightTransitionOptions) -> Result<Value> {
        validate_brightness(brightness)?;
        self.send_numeric_transition_command("set_bright", u64::from(brightness), options)
    }

    pub fn set_color_temperature(&self, color_temperature: u16, options: YeelightTransitionOptions) -> Result<Value> {
        validate_color_temperature(color_temperature)?;
        self.send_numeric_transition_command("set_ct_abx", u64::from(color_temperature), options)
    }

    pub fn set_rgb(&self, rgb_value: u32, options: YeelightTransitionOptions) -> Result<Value> {
        validate_rgb_value(rgb_value)?;
        self.send_numeric_transition_command("set_rgb", u64::from(rgb_value), options)
    }

    pub fn set_hsv(&self, hue: u16, saturation: u8, options: YeelightTransitionOptions) -> Result<Value> {
        validate_hue(hue)?;
        validate_saturation(saturation)?;
        let (effect, duration, timeout_ms) = transition_parts(&options)?;
        self.send_command(
            "set_hsv",
            vec![json!(hue), json!(saturation), json!(effect), json!(duration)],
            Some(YeelightCommandOptions { timeout_ms }),
        )
    }

    pub fn start_color_flow(&self, count: u64, action: u8, flow_expression: FlowExpression, options: Option<YeelightCommandOptions>) -> Result<Value> {
        validate_flow_count(count)?;
        validate_flow_action(action)?;
        let serialized = match flow_expression {
            FlowExpression::Serialized(value) => value,
            FlowExpression::Tuples(tuples) => build_flow_expression(&tuples)?,
        };
        self.send_command(
            "start_cf",
            vec![json!(count), json!(action), json!(serialized)],
            options,
        )
    }

    pub fn stop_color_flow(&self, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("stop_cf", vec![], options)
    }

    pub fn set_scene(&self, scene: &YeelightScene, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("set_scene", serialize_scene(scene)?, options)
    }

    pub fn cron_add(&self, cron_type: u8, minutes: u64, options: Option<YeelightCommandOptions>) -> Result<Value> {
        validate_cron_type(cron_type)?;
        self.send_command("cron_add", vec![json!(cron_type), json!(minutes)], options)
    }

    pub fn cron_get(&self, cron_type: u8, options: Option<YeelightCommandOptions>) -> Result<Vec<YeelightCronEntry>> {
        validate_cron_type(cron_type)?;
        let value = self.send_command("cron_get", vec![json!(cron_type)], options)?;
        serde_json::from_value(value).map_err(Into::into)
    }

    pub fn cron_delete(&self, cron_type: u8, options: Option<YeelightCommandOptions>) -> Result<Value> {
        validate_cron_type(cron_type)?;
        self.send_command("cron_del", vec![json!(cron_type)], options)
    }

    pub fn set_adjust(&self, action: &str, property: &str, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_adjust_command("set_adjust", action, property, options)
    }

    pub fn set_music_off(&self, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("set_music", vec![json!(0)], options)
    }

    pub fn set_music_on(&self, host: &str, port: u16, options: Option<YeelightCommandOptions>) -> Result<Value> {
        validate_music_start(host, port)?;
        self.send_command("set_music", vec![json!(1), json!(host), json!(port)], options)
    }

    pub fn set_name(&self, name: &str, options: Option<YeelightCommandOptions>) -> Result<Value> {
        validate_name(name)?;
        self.send_command("set_name", vec![json!(name)], options)
    }

    pub fn bg_set_rgb(&self, rgb_value: u32, options: YeelightTransitionOptions) -> Result<Value> {
        validate_rgb_value(rgb_value)?;
        self.send_numeric_transition_command("bg_set_rgb", u64::from(rgb_value), options)
    }

    pub fn bg_set_hsv(&self, hue: u16, saturation: u8, options: YeelightTransitionOptions) -> Result<Value> {
        validate_hue(hue)?;
        validate_saturation(saturation)?;
        let (effect, duration, timeout_ms) = transition_parts(&options)?;
        self.send_command(
            "bg_set_hsv",
            vec![json!(hue), json!(saturation), json!(effect), json!(duration)],
            Some(YeelightCommandOptions { timeout_ms }),
        )
    }

    pub fn bg_set_color_temperature(&self, color_temperature: u16, options: YeelightTransitionOptions) -> Result<Value> {
        validate_color_temperature(color_temperature)?;
        self.send_numeric_transition_command("bg_set_ct_abx", u64::from(color_temperature), options)
    }

    pub fn bg_start_color_flow(&self, count: u64, action: u8, flow_expression: FlowExpression, options: Option<YeelightCommandOptions>) -> Result<Value> {
        validate_flow_count(count)?;
        validate_flow_action(action)?;
        let serialized = match flow_expression {
            FlowExpression::Serialized(value) => value,
            FlowExpression::Tuples(tuples) => build_flow_expression(&tuples)?,
        };
        self.send_command(
            "bg_start_cf",
            vec![json!(count), json!(action), json!(serialized)],
            options,
        )
    }

    pub fn bg_stop_color_flow(&self, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("bg_stop_cf", vec![], options)
    }

    pub fn bg_set_scene(&self, scene: &YeelightScene, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("bg_set_scene", serialize_scene(scene)?, options)
    }

    pub fn bg_set_default(&self, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("bg_set_default", vec![], options)
    }

    pub fn bg_set_power(&self, power: &str, options: YeelightTransitionOptions) -> Result<Value> {
        self.send_power_command("bg_set_power", power, options, None)
    }

    pub fn bg_set_power_with_mode(&self, power: &str, options: YeelightTransitionOptions, mode: u8) -> Result<Value> {
        self.send_power_command("bg_set_power", power, options, Some(mode))
    }

    pub fn bg_set_brightness(&self, brightness: u8, options: YeelightTransitionOptions) -> Result<Value> {
        validate_brightness(brightness)?;
        self.send_numeric_transition_command("bg_set_bright", u64::from(brightness), options)
    }

    pub fn bg_set_adjust(&self, action: &str, property: &str, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_adjust_command("bg_set_adjust", action, property, options)
    }

    pub fn bg_toggle(&self, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("bg_toggle", vec![], options)
    }

    pub fn dev_toggle(&self, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("dev_toggle", vec![], options)
    }

    pub fn adjust_brightness(&self, percentage: i16, duration: u64, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_adjust_percentage_command("adjust_bright", percentage, duration, options)
    }

    pub fn adjust_color_temperature(&self, percentage: i16, duration: u64, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_adjust_percentage_command("adjust_ct", percentage, duration, options)
    }

    pub fn adjust_color(&self, percentage: i16, duration: u64, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_adjust_percentage_command("adjust_color", percentage, duration, options)
    }

    pub fn bg_adjust_brightness(&self, percentage: i16, duration: u64, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_adjust_percentage_command("bg_adjust_bright", percentage, duration, options)
    }

    pub fn bg_adjust_color_temperature(&self, percentage: i16, duration: u64, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_adjust_percentage_command("bg_adjust_ct", percentage, duration, options)
    }

    pub fn bg_adjust_color(&self, percentage: i16, duration: u64, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_adjust_percentage_command("bg_adjust_color", percentage, duration, options)
    }

    pub fn udp_session_new(&self, params: Vec<Value>, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("udp_sess_new", params, options)
    }

    pub fn udp_session_keep_alive(&self, params: Vec<Value>, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("udp_sess_keep_alive", params, options)
    }

    pub fn udp_chroma_session_new(&self, params: Vec<Value>, options: Option<YeelightCommandOptions>) -> Result<Value> {
        self.send_command("udp_chroma_sess_new", params, options)
    }

    fn send_request(&self, method: &str, params: Vec<Value>, timeout_override: Option<u64>) -> Result<RawCommandResponse> {
        let request_id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let timeout_ms = timeout_override.unwrap_or(self.timeout_ms);
        let address = (self.host.as_str(), self.port)
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| YeelightError::from(format!("Unable to resolve {}:{}.", self.host, self.port)))?;

        let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(timeout_ms)).map_err(|error| {
            YeelightError::from(format!("Unable to reach {}:{}: {}", self.host, self.port, error))
        })?;
        stream.set_write_timeout(Some(Duration::from_millis(timeout_ms)))?;
        stream.set_read_timeout(Some(Duration::from_millis(timeout_ms.min(250).max(50))))?;
        stream.write_all(build_command(method, &params, request_id).as_bytes())?;

        let started_at = Instant::now();
        let mut pending = String::new();
        let mut buffer = [0_u8; 4096];

        loop {
            if started_at.elapsed() >= Duration::from_millis(timeout_ms) {
                return Err(YeelightError::from(format!(
                    "Timed out waiting for a response from {}:{} after {}ms.",
                    self.host, self.port, timeout_ms
                )));
            }

            match stream.read(&mut buffer) {
                Ok(0) => {
                    return Err(YeelightError::from(
                        "The bulb closed the TCP connection before sending a response.",
                    ));
                }
                Ok(size) => {
                    let chunk = String::from_utf8_lossy(&buffer[..size]);
                    let (lines, next_pending) = split_socket_buffer(&pending, &chunk);
                    pending = next_pending;

                    for line in lines {
                        let payload: Value = serde_json::from_str(&line).map_err(|_| {
                            YeelightError::from(format!("The bulb returned invalid JSON: {line}"))
                        })?;

                        if payload.get("method").and_then(Value::as_str) == Some("props") {
                            continue;
                        }

                        if payload.get("id").and_then(Value::as_u64) != Some(request_id) {
                            continue;
                        }

                        if let Some(error) = payload.get("error") {
                            let code = error.get("code").and_then(Value::as_i64).unwrap_or(-1);
                            let message = error
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("Unknown bulb error")
                                .to_owned();
                            return Ok(RawCommandResponse::Error {
                                id: request_id,
                                error: crate::types::YeelightErrorPayload { code, message },
                            });
                        }

                        return Ok(RawCommandResponse::Result {
                            id: request_id,
                            result: payload.get("result").cloned().unwrap_or(Value::Null),
                        });
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    continue;
                }
                Err(error) => {
                    return Err(YeelightError::from(format!(
                        "Unable to reach {}:{}: {}",
                        self.host, self.port, error
                    )));
                }
            }
        }
    }

    fn ensure_supported(&self, method: &str) -> Result<()> {
        if self.support.is_empty() || self.support.iter().any(|supported| supported == method) {
            return Ok(());
        }
        Err(YeelightError::from(format!(
            "The bulb does not advertise support for {method}. Supported methods: {}",
            self.support.join(", ")
        )))
    }

    fn send_numeric_transition_command(&self, method: &str, value: u64, options: YeelightTransitionOptions) -> Result<Value> {
        let (effect, duration, timeout_ms) = transition_parts(&options)?;
        self.send_command(
            method,
            vec![json!(value), json!(effect), json!(duration)],
            Some(YeelightCommandOptions { timeout_ms }),
        )
    }

    fn send_power_command(&self, method: &str, power: &str, options: YeelightTransitionOptions, mode: Option<u8>) -> Result<Value> {
        if power != "on" && power != "off" {
            return Err(YeelightError::from("Power must be \"on\" or \"off\"."));
        }
        let (effect, duration, timeout_ms) = transition_parts(&options)?;
        let mut params = vec![json!(power), json!(effect), json!(duration)];
        if let Some(mode) = mode {
            validate_power_mode(mode)?;
            params.push(json!(mode));
        }
        self.send_command(method, params, Some(YeelightCommandOptions { timeout_ms }))
    }

    fn send_adjust_command(&self, method: &str, action: &str, property: &str, options: Option<YeelightCommandOptions>) -> Result<Value> {
        validate_adjust_action(action)?;
        validate_adjust_property(property)?;
        if property == "color" && action != "circle" {
            return Err(YeelightError::from(
                "When adjusting \"color\", action must be \"circle\" according to the Yeelight spec.",
            ));
        }
        self.send_command(method, vec![json!(action), json!(property)], options)
    }

    fn send_adjust_percentage_command(&self, method: &str, percentage: i16, duration: u64, options: Option<YeelightCommandOptions>) -> Result<Value> {
        validate_percentage(percentage)?;
        validate_duration(duration, DEFAULT_DURATION_MS)?;
        self.send_command(method, vec![json!(percentage), json!(duration)], options)
    }
}

fn transition_parts(options: &YeelightTransitionOptions) -> Result<(String, u64, Option<u64>)> {
    let effect = options
        .effect
        .clone()
        .unwrap_or_else(|| DEFAULT_EFFECT.to_owned());
    let duration = options.duration.unwrap_or(DEFAULT_DURATION_MS);
    validate_effect(&effect)?;
    validate_duration(duration, DEFAULT_DURATION_MS)?;
    Ok((effect, duration, options.timeout_ms))
}

fn value_to_string(value: Value) -> String {
    match value {
        Value::String(inner) => inner,
        Value::Null => "null".to_owned(),
        Value::Bool(inner) => inner.to_string(),
        Value::Number(inner) => inner.to_string(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}
