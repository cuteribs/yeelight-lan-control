use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const YEELIGHT_METHODS: &[&str] = &[
    "get_prop",
    "set_ct_abx",
    "set_rgb",
    "set_hsv",
    "set_bright",
    "set_power",
    "toggle",
    "set_default",
    "start_cf",
    "stop_cf",
    "set_scene",
    "cron_add",
    "cron_get",
    "cron_del",
    "set_adjust",
    "set_music",
    "set_name",
    "bg_set_rgb",
    "bg_set_hsv",
    "bg_set_ct_abx",
    "bg_start_cf",
    "bg_stop_cf",
    "bg_set_scene",
    "bg_set_default",
    "bg_set_power",
    "bg_set_bright",
    "bg_set_adjust",
    "bg_toggle",
    "dev_toggle",
    "adjust_bright",
    "adjust_ct",
    "adjust_color",
    "bg_adjust_bright",
    "bg_adjust_ct",
    "bg_adjust_color",
    "udp_sess_new",
    "udp_sess_keep_alive",
    "udp_chroma_sess_new",
];

pub const YEELIGHT_PROPERTY_NAMES: &[&str] = &[
    "power",
    "bright",
    "ct",
    "rgb",
    "hue",
    "sat",
    "color_mode",
    "flowing",
    "delayoff",
    "flow_params",
    "music_on",
    "name",
    "bg_power",
    "bg_flowing",
    "bg_flow_params",
    "bg_ct",
    "bg_lmode",
    "bg_bright",
    "bg_rgb",
    "bg_hue",
    "bg_sat",
    "nl_br",
    "active_mode",
];

pub const LIVE_STATUS_PROPERTIES: &[&str] = &[
    "power",
    "bright",
    "ct",
    "color_mode",
    "rgb",
    "hue",
    "sat",
    "name",
];

pub type YeelightAdjustAction = String;
pub type YeelightPower = String;
pub type YeelightPropertyValues = BTreeMap<String, Option<String>>;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct YeelightDiscoveryOptions {
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct YeelightCommandOptions {
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct YeelightTransitionOptions {
    pub timeout_ms: Option<u64>,
    pub duration: Option<u64>,
    pub effect: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct YeelightControlConnectionOptions {
    pub host: String,
    pub port: Option<u16>,
    pub support: Vec<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct YeelightDiscoveredDevice {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub model: String,
    #[serde(rename = "firmwareVersion")]
    pub firmware_version: String,
    pub name: String,
    pub power: String,
    #[serde(rename = "brightness")]
    pub brightness: String,
    #[serde(rename = "colorMode")]
    pub color_mode: String,
    #[serde(rename = "colorTemperature")]
    pub color_temperature: String,
    pub rgb: String,
    pub hue: String,
    pub saturation: String,
    pub support: Vec<String>,
    pub location: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct YeelightNotification {
    pub method: String,
    pub params: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct YeelightErrorPayload {
    pub code: i64,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RawCommandResponse {
    Result { id: u64, result: Value },
    Error { id: u64, error: YeelightErrorPayload },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct YeelightFlowTuple {
    pub duration: u64,
    pub mode: u8,
    pub value: u32,
    pub brightness: i16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FlowExpression {
    Serialized(String),
    Tuples(Vec<YeelightFlowTuple>),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum YeelightScene {
    Color {
        rgb_value: u32,
        brightness: u8,
    },
    Hsv {
        hue: u16,
        saturation: u8,
        brightness: u8,
    },
    Ct {
        ct_value: u16,
        brightness: u8,
    },
    Cf {
        count: u64,
        action: u8,
        flow_expression: FlowExpression,
    },
    AutoDelayOff {
        brightness: u8,
        minutes: u64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct YeelightCronEntry {
    #[serde(rename = "type")]
    pub r#type: u64,
    pub delay: u64,
    pub mix: u64,
}
