use serde_json::json;
use yeelight_cli::{HostValue, parse_exec_params_value, parse_exec_token, parse_exec_tokens, parse_host_value};

#[test]
fn parse_exec_token_keeps_plain_strings_as_strings() {
    assert_eq!(parse_exec_token("set_power"), json!("set_power"));
    assert_eq!(parse_exec_token("on"), json!("on"));
}

#[test]
fn parse_exec_token_parses_json_like_literals() {
    assert_eq!(parse_exec_token("500"), json!(500));
    assert_eq!(parse_exec_token("-20"), json!(-20));
    assert_eq!(parse_exec_token("true"), json!(true));
    assert_eq!(parse_exec_token(r#"{"level":1}"#), json!({ "level": 1 }));
    assert_eq!(parse_exec_token(r#"["power","bright"]"#), json!(["power", "bright"]));
}

#[test]
fn parse_exec_tokens_parses_mixed_positional_params() {
    let tokens = vec!["on".to_owned(), "smooth".to_owned(), "500".to_owned()];
    assert_eq!(parse_exec_tokens(&tokens), vec![json!("on"), json!("smooth"), json!(500)]);
}

#[test]
fn parse_exec_params_value_requires_a_json_array() {
    assert_eq!(
        parse_exec_params_value(r#"["color",65280,70]"#).unwrap(),
        vec![json!("color"), json!(65280), json!(70)]
    );
    assert_eq!(
        parse_exec_params_value(r#"{"method":"toggle"}"#)
            .unwrap_err()
            .to_string(),
        "Exec params must be a JSON array."
    );
}

#[test]
fn parse_host_value_accepts_host_with_optional_port() {
    assert_eq!(
        parse_host_value("192.168.1.23", 55443).unwrap(),
        HostValue {
            host: "192.168.1.23".to_owned(),
            port: 55443,
        }
    );
    assert_eq!(
        parse_host_value("192.168.1.23:12345", 55443).unwrap(),
        HostValue {
            host: "192.168.1.23".to_owned(),
            port: 12345,
        }
    );
}

#[test]
fn parse_host_value_rejects_invalid_host_forms() {
    assert_eq!(
        parse_host_value("192.168.1.23:abc", 55443)
            .unwrap_err()
            .to_string(),
        "Host port must be an integer between 1 and 65535."
    );
    assert_eq!(
        parse_host_value("192.168.1.23:70000", 55443)
            .unwrap_err()
            .to_string(),
        "Host port must be an integer between 1 and 65535."
    );
}
