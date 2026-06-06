use std::collections::BTreeMap;

use serde_json::json;
use yeelight_cli::{
    build_command, decode_device_name, normalize_status, parse_discovery_headers,
    parse_discovery_response, split_socket_buffer, to_rgb_value, validate_rgb_component,
    validate_rgb_value,
};

#[test]
fn parse_discovery_response_extracts_location_and_supported_methods() {
    let raw = [
        "HTTP/1.1 200 OK",
        "id: 0x0000000012345678",
        "Location: yeelight://192.168.1.5:55443",
        "model: color",
        "support: get_prop set_power set_bright set_ct_abx",
        "name: QmVkcm9vbQ==",
        "power: on",
        "bright: 75",
        "",
        "",
    ]
    .join("\r\n");

    let device = parse_discovery_response(raw.as_bytes()).expect("device");
    assert_eq!(device.id, "0x0000000012345678");
    assert_eq!(device.host, "192.168.1.5");
    assert_eq!(device.port, 55443);
    assert_eq!(
        device.support,
        vec!["get_prop", "set_power", "set_bright", "set_ct_abx"]
    );
    assert_eq!(device.name, "Bedroom");
}

#[test]
fn parse_discovery_response_accepts_yeelight_notify_packets() {
    let raw = [
        "NOTIFY * HTTP/1.1",
        "Host: 239.255.255.250:1982",
        "Location: yeelight://192.168.1.9:55443",
        "id: 0x0000000099999999",
        "model: mono",
        "support: get_prop set_power",
        "",
        "",
    ]
    .join("\r\n");

    let device = parse_discovery_response(raw.as_bytes()).expect("device");
    assert_eq!(device.host, "192.168.1.9");
    assert_eq!(device.port, 55443);
    assert_eq!(device.id, "0x0000000099999999");
}

#[test]
fn parse_discovery_headers_accepts_uppercase_ssdp_header_objects() {
    let headers = BTreeMap::from([
        ("ID".to_owned(), "0x00000000abcdef01".to_owned()),
        (
            "LOCATION".to_owned(),
            "yeelight://192.168.1.23:55443".to_owned(),
        ),
        ("MODEL".to_owned(), "mono".to_owned()),
        (
            "SUPPORT".to_owned(),
            "get_prop set_power set_bright".to_owned(),
        ),
        ("NAME".to_owned(), "S2l0Y2hlbg==".to_owned()),
        ("POWER".to_owned(), "off".to_owned()),
        ("BRIGHT".to_owned(), "20".to_owned()),
    ]);

    let device = parse_discovery_headers(&headers).expect("device");
    assert_eq!(device.id, "0x00000000abcdef01");
    assert_eq!(device.host, "192.168.1.23");
    assert_eq!(device.port, 55443);
    assert_eq!(device.support, vec!["get_prop", "set_power", "set_bright"]);
    assert_eq!(device.name, "Kitchen");
}

#[test]
fn parse_discovery_response_joins_wrapped_support_headers() {
    let raw = [
        "HTTP/1.1 200 OK",
        "Location: yeelight://192.168.6.193:55443",
        "id: 0x0000000019f583f7",
        "support: get_prop set_power",
        " set_ct_abx adjust_ct set_rgb",
        "",
        "",
    ]
    .join("\r\n");

    let device = parse_discovery_response(raw.as_bytes()).expect("device");
    assert_eq!(
        device.support,
        vec!["get_prop", "set_power", "set_ct_abx", "adjust_ct", "set_rgb"]
    );
}

#[test]
fn split_socket_buffer_preserves_incomplete_trailing_json() {
    let (lines, pending) = split_socket_buffer("", "{\"id\":1,\"result\":[\"ok\"]}\r\n{\"id\":2");
    assert_eq!(lines, vec!["{\"id\":1,\"result\":[\"ok\"]}"]);
    assert_eq!(pending, "{\"id\":2");

    let (lines, pending) = split_socket_buffer(&pending, ",\"result\":[\"ok\"]}\r\n");
    assert_eq!(lines, vec!["{\"id\":2,\"result\":[\"ok\"]}"]);
    assert_eq!(pending, "");
}

#[test]
fn build_command_appends_the_yeelight_line_delimiter() {
    assert_eq!(
        build_command("set_power", &[json!("on"), json!("sudden"), json!(30)], 7),
        "{\"id\":7,\"method\":\"set_power\",\"params\":[\"on\",\"sudden\",30]}\r\n"
    );
}

#[test]
fn normalize_status_maps_get_prop_results_to_property_names() {
    let result = normalize_status(
        &["power", "bright", "ct"],
        &["on".to_owned(), "50".to_owned(), "3500".to_owned()],
    );
    assert_eq!(
        result,
        BTreeMap::from([
            ("bright".to_owned(), Some("50".to_owned())),
            ("ct".to_owned(), Some("3500".to_owned())),
            ("power".to_owned(), Some("on".to_owned())),
        ])
    );
}

#[test]
fn decode_device_name_leaves_plain_text_unchanged() {
    assert_eq!(decode_device_name("Kitchen"), "Kitchen");
}

#[test]
fn validate_rgb_value_accepts_packed_rgb_integers() {
    validate_rgb_value(0xff0000).expect("valid rgb");
}

#[test]
fn validate_rgb_value_rejects_values_outside_24_bit_rgb_range() {
    assert_eq!(
        validate_rgb_value(0x0100_0000).unwrap_err().to_string(),
        "RGB color must be an integer between 0 and 16777215."
    );
}

#[test]
fn validate_rgb_component_enforces_0_255_component_range() {
    validate_rgb_component(255, "Red").expect("valid component");
    assert_eq!(
        validate_rgb_component(256, "Red").unwrap_err().to_string(),
        "Red must be an integer between 0 and 255."
    );
}

#[test]
fn to_rgb_value_packs_components() {
    assert_eq!(to_rgb_value(255, 102, 0).unwrap(), 0xff6600);
}