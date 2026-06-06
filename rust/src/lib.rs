pub mod cache;
pub mod client;
pub mod cli_support;
pub mod discovery;
pub mod error;
pub mod protocol;
pub mod types;

pub use cache::{get_cache_path, read_discovery_cache, write_discovery_cache};
pub use client::YeelightClient;
pub use cli_support::{HostValue, parse_exec_params_value, parse_exec_token, parse_exec_tokens, parse_host_value};
pub use discovery::{discover_devices, list_discovery_interfaces};
pub use error::{Result, YeelightError};
pub use protocol::{
    DEFAULT_CACHE_TTL_MS, DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_CONTROL_PORT, DEFAULT_DISCOVERY_TIMEOUT_MS,
    DEFAULT_DURATION_MS, DEFAULT_EFFECT, DISCOVERY_ADDRESS, DISCOVERY_PORT,
    build_command, build_discovery_request, build_flow_expression, decode_device_name,
    format_device_label, format_device_summary, format_rgb_hex, is_yeelight_method,
    live_status_properties, normalize_status, parse_discovery_headers, parse_discovery_response,
    parse_notification_message, serialize_scene, split_socket_buffer, to_rgb_value,
    validate_adjust_action, validate_adjust_property, validate_brightness,
    validate_color_temperature, validate_cron_type, validate_duration, validate_effect,
    validate_flow_action, validate_flow_count, validate_flow_tuple, validate_hue,
    validate_music_start, validate_name, validate_percentage, validate_positive_integer,
    validate_power_mode, validate_rgb_component, validate_rgb_value, validate_saturation,
};
pub use types::{
    FlowExpression, LIVE_STATUS_PROPERTIES, RawCommandResponse, YEELIGHT_METHODS,
    YEELIGHT_PROPERTY_NAMES, YeelightAdjustAction, YeelightCommandOptions,
    YeelightControlConnectionOptions, YeelightCronEntry, YeelightDiscoveredDevice,
    YeelightDiscoveryOptions, YeelightFlowTuple, YeelightNotification, YeelightPower,
    YeelightPropertyValues, YeelightScene, YeelightTransitionOptions,
};
