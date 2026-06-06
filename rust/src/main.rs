use std::collections::BTreeMap;
use std::env;
use std::process;

use serde::Serialize;
use serde_json::{Value, json};
use yeelight_cli::{
    DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_CONTROL_PORT, DEFAULT_DISCOVERY_TIMEOUT_MS,
    DEFAULT_DURATION_MS, DEFAULT_EFFECT, RawCommandResponse, YeelightClient,
    YeelightCommandOptions, YeelightDiscoveredDevice, YeelightDiscoveryOptions,
    YeelightTransitionOptions, discover_devices, format_device_label, format_device_summary,
    format_rgb_hex, get_cache_path, parse_exec_params_value, parse_exec_tokens,
    parse_host_value, read_discovery_cache, to_rgb_value, validate_rgb_component,
    write_discovery_cache,
};

#[derive(Clone, Debug)]
enum OptionValue {
    Bool,
    String(String),
}

#[derive(Clone, Debug)]
struct ParsedArguments {
    options: BTreeMap<String, OptionValue>,
    positionals: Vec<String>,
}

#[derive(Clone, Debug)]
struct ResolvedTarget {
    client: YeelightClient,
    device: YeelightDiscoveredDevice,
    duration: u64,
    effect: String,
    json: bool,
    timeout_ms: u64,
}

#[derive(Clone, Debug)]
struct DeviceSelector {
    host: Option<String>,
    id: Option<String>,
    name: Option<String>,
    port: u16,
}

fn main() {
    match run() {
        Ok(code) => process::exit(code),
        Err(error) => {
            eprintln!("{}", error);
            process::exit(1);
        }
    }
}

fn run() -> Result<i32, String> {
    let parsed = parse_arguments(env::args().skip(1).collect());
    let command = parsed
        .positionals
        .first()
        .map(String::as_str)
        .unwrap_or("help");

    match command {
        "help" | "--help" => {
            print_help();
            Ok(0)
        }
        "discover" => {
            handle_discover(&parsed.options)?;
            Ok(0)
        }
        "status" => {
            handle_status(&parsed.options)?;
            Ok(0)
        }
        "on" => {
            handle_power("on", &parsed.options)?;
            Ok(0)
        }
        "off" => {
            handle_power("off", &parsed.options)?;
            Ok(0)
        }
        "bright" => {
            handle_brightness(&parsed)?;
            Ok(0)
        }
        "ct" => {
            handle_color_temperature(&parsed)?;
            Ok(0)
        }
        "rgb" => {
            handle_rgb(&parsed)?;
            Ok(0)
        }
        "exec" => handle_exec(&parsed),
        "probe" => {
            handle_probe(&parsed.options)?;
            Ok(0)
        }
        other => Err(format!(
            "Unknown command \"{other}\". Run \"cargo run -- help\" for usage."
        )),
    }
}

fn parse_arguments(argv: Vec<String>) -> ParsedArguments {
    let mut positionals = Vec::new();
    let mut options = BTreeMap::new();
    let mut index = 0;

    while index < argv.len() {
        let token = &argv[index];
        if !token.starts_with("--") {
            positionals.push(token.clone());
            index += 1;
            continue;
        }

        let key = token.trim_start_matches("--").to_owned();
        if let Some(next) = argv.get(index + 1) {
            if !next.starts_with("--") {
                options.insert(key, OptionValue::String(next.clone()));
                index += 2;
                continue;
            }
        }

        options.insert(key, OptionValue::Bool);
        index += 1;
    }

    ParsedArguments { options, positionals }
}

fn handle_discover(options: &BTreeMap<String, OptionValue>) -> Result<(), String> {
    let timeout_ms = parse_timeout(options, DEFAULT_DISCOVERY_TIMEOUT_MS)?;
    let devices = discover_devices(YeelightDiscoveryOptions {
        timeout_ms: Some(timeout_ms),
    })
    .map_err(|error| error.to_string())?;

    if devices.is_empty() {
        return Err("No Yeelight devices found. Ensure LAN control is enabled in the Yeelight app and the bulb is on the same network.".to_owned());
    }

    write_discovery_cache(&devices).map_err(|error| error.to_string())?;

    if option_flag(options, "json") {
        print_json(&devices)?;
        return Ok(());
    }

    println!("Found {} device(s):", devices.len());
    for device in devices {
        println!("{}", format_device_summary(&device));
    }
    Ok(())
}

fn handle_status(options: &BTreeMap<String, OptionValue>) -> Result<(), String> {
    let resolved = resolve_target(options)?;
    let status = resolved
        .client
        .get_status(Some(YeelightCommandOptions {
            timeout_ms: Some(resolved.timeout_ms),
        }))
        .map_err(|error| error.to_string())?;

    let payload = json!({
        "device": resolved.device,
        "status": status,
    });

    if resolved.json {
        print_json(&payload)?;
        return Ok(());
    }

    println!("Status for {}", format_device_label(&resolved.device));
    for (key, value) in status {
        println!("  {}: {}", key, value.unwrap_or_else(|| "null".to_owned()));
    }
    Ok(())
}

fn handle_power(state: &str, options: &BTreeMap<String, OptionValue>) -> Result<(), String> {
    let resolved = resolve_target(options)?;
    resolved
        .client
        .set_power(
            state,
            YeelightTransitionOptions {
                timeout_ms: Some(resolved.timeout_ms),
                duration: Some(resolved.duration),
                effect: Some(resolved.effect.clone()),
            },
        )
        .map_err(|error| error.to_string())?;

    let payload = json!({
        "device": resolved.device,
        "power": state,
    });

    if resolved.json {
        print_json(&payload)?;
    } else {
        println!("Set power {} for {}.", state, format_device_label(&resolved.device));
    }
    Ok(())
}

fn handle_brightness(parsed: &ParsedArguments) -> Result<(), String> {
    let value = parsed
        .positionals
        .get(1)
        .ok_or_else(|| "Brightness value is required. Example: cargo run -- bright 40 --id 0x...".to_owned())?;
    let brightness = parse_integer(value, "Brightness")?;
    let brightness_u8 = u8::try_from(brightness).map_err(|_| "Brightness must be an integer between 1 and 100.".to_owned())?;
    let resolved = resolve_target(&parsed.options)?;
    resolved
        .client
        .set_brightness(
            brightness_u8,
            YeelightTransitionOptions {
                timeout_ms: Some(resolved.timeout_ms),
                duration: Some(resolved.duration),
                effect: Some(resolved.effect.clone()),
            },
        )
        .map_err(|error| error.to_string())?;

    let payload = json!({
        "brightness": brightness_u8,
        "device": resolved.device,
    });

    if resolved.json {
        print_json(&payload)?;
    } else {
        println!(
            "Set brightness to {} for {}.",
            brightness_u8,
            format_device_label(&resolved.device)
        );
    }
    Ok(())
}

fn handle_color_temperature(parsed: &ParsedArguments) -> Result<(), String> {
    let value = parsed
        .positionals
        .get(1)
        .ok_or_else(|| "Color temperature value is required. Example: cargo run -- ct 3500 --id 0x...".to_owned())?;
    let color_temperature = parse_integer(value, "Color temperature")?;
    let ct_u16 = u16::try_from(color_temperature)
        .map_err(|_| "Color temperature must be an integer between 1700 and 6500 Kelvin.".to_owned())?;
    let resolved = resolve_target(&parsed.options)?;
    resolved
        .client
        .set_color_temperature(
            ct_u16,
            YeelightTransitionOptions {
                timeout_ms: Some(resolved.timeout_ms),
                duration: Some(resolved.duration),
                effect: Some(resolved.effect.clone()),
            },
        )
        .map_err(|error| error.to_string())?;

    let payload = json!({
        "colorTemperature": ct_u16,
        "device": resolved.device,
    });

    if resolved.json {
        print_json(&payload)?;
    } else {
        println!(
            "Set color temperature to {}K for {}.",
            ct_u16,
            format_device_label(&resolved.device)
        );
    }
    Ok(())
}

fn handle_rgb(parsed: &ParsedArguments) -> Result<(), String> {
    let rgb_value = parse_rgb_value(&parsed.positionals)?;
    let resolved = resolve_target(&parsed.options)?;
    resolved
        .client
        .set_rgb(
            rgb_value,
            YeelightTransitionOptions {
                timeout_ms: Some(resolved.timeout_ms),
                duration: Some(resolved.duration),
                effect: Some(resolved.effect.clone()),
            },
        )
        .map_err(|error| error.to_string())?;

    let payload = json!({
        "device": resolved.device,
        "rgb": rgb_value,
        "hex": format_rgb_hex(rgb_value).map_err(|error| error.to_string())?,
    });

    if resolved.json {
        print_json(&payload)?;
    } else {
        println!(
            "Set RGB color to {} for {}.",
            format_rgb_hex(rgb_value).map_err(|error| error.to_string())?,
            format_device_label(&resolved.device)
        );
    }
    Ok(())
}

fn handle_exec(parsed: &ParsedArguments) -> Result<i32, String> {
    let (method, params) = parse_exec_input(parsed)?;
    let resolved = resolve_target(&parsed.options)?;
    let response = resolved
        .client
        .send_raw_command(
            &method,
            params.clone(),
            Some(YeelightCommandOptions {
                timeout_ms: Some(resolved.timeout_ms),
            }),
        )
        .map_err(|error| error.to_string())?;

    let payload = json!({
        "device": resolved.device,
        "method": method,
        "params": params,
        "response": response,
    });
    print_json(&payload)?;

    Ok(match response {
        RawCommandResponse::Error { .. } => 1,
        RawCommandResponse::Result { .. } => 0,
    })
}

fn handle_probe(options: &BTreeMap<String, OptionValue>) -> Result<(), String> {
    let device = resolve_probe_device(options)?;
    let mut supported = device.support.clone();
    supported.sort();
    let unsupported_known: Vec<&str> = yeelight_cli::YEELIGHT_METHODS
        .iter()
        .copied()
        .filter(|method| !supported.iter().any(|item| item == method))
        .collect();
    let advertised_unknown: Vec<&str> = supported
        .iter()
        .map(String::as_str)
        .filter(|method| !yeelight_cli::YEELIGHT_METHODS.contains(method))
        .collect();

    let payload = json!({
        "advertisedUnknown": advertised_unknown,
        "device": device,
        "supported": supported,
        "unsupportedKnown": unsupported_known,
    });

    if option_flag(options, "json") {
        print_json(&payload)?;
        return Ok(());
    }

    println!(
        "Supported methods for {} ({}):",
        format_device_label(&device),
        device.support.len()
    );
    for method in &supported {
        println!("  {}", method);
    }

    if !advertised_unknown.is_empty() {
        println!();
        println!("Advertised methods not recognized by this library:");
        for method in &advertised_unknown {
            println!("  {}", method);
        }
    }

    println!();
    println!(
        "Known Yeelight methods not advertised by this device ({}):",
        unsupported_known.len()
    );
    for method in unsupported_known {
        println!("  {}", method);
    }
    Ok(())
}

fn resolve_target(options: &BTreeMap<String, OptionValue>) -> Result<ResolvedTarget, String> {
    let timeout_ms = parse_timeout(options, DEFAULT_COMMAND_TIMEOUT_MS)?;
    let duration = option_string(options, "duration")
        .map(|value| parse_integer(value, "Duration"))
        .transpose()?
        .unwrap_or(DEFAULT_DURATION_MS as i64);
    let duration = u64::try_from(duration).map_err(|_| "Duration must be an integer greater than or equal to 30 milliseconds.".to_owned())?;
    let effect = option_string(options, "effect")
        .unwrap_or(DEFAULT_EFFECT)
        .to_owned();
    let json = option_flag(options, "json");
    let selector = parse_device_selector(options)?;

    if let Some(host) = selector.host.clone() {
        let device = if option_flag(options, "refresh") {
            create_direct_host_device(&host, selector.port)
        } else {
            read_discovery_cache(None)
                .map_err(|error| error.to_string())?
                .unwrap_or_default()
                .into_iter()
                .find(|device| device.host == host && device.port == selector.port)
                .unwrap_or_else(|| create_direct_host_device(&host, selector.port))
        };

        return Ok(ResolvedTarget {
            client: YeelightClient::from_device(device.clone(), Some(timeout_ms)),
            device,
            duration,
            effect,
            json,
            timeout_ms,
        });
    }

    let devices = get_known_devices(options)?;
    let matches: Vec<YeelightDiscoveredDevice> = devices
        .into_iter()
        .filter(|device| match (&selector.id, &selector.name) {
            (Some(id), _) => &device.id == id,
            (_, Some(name)) => &device.name == name,
            _ => false,
        })
        .collect();

    if matches.is_empty() {
        return Err("No discovered Yeelight device matched the provided selector.".to_owned());
    }
    if matches.len() > 1 {
        let choices = matches
            .iter()
            .map(|device| format!("- {} [id={}]", format_device_label(device), device.id))
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!(
            "Multiple bulbs matched. Re-run with --id, --name, or --host to choose one:\n{}",
            choices
        ));
    }

    let device = matches.into_iter().next().expect("single device match");
    Ok(ResolvedTarget {
        client: YeelightClient::from_device(device.clone(), Some(timeout_ms)),
        device,
        duration,
        effect,
        json,
        timeout_ms,
    })
}

fn get_known_devices(options: &BTreeMap<String, OptionValue>) -> Result<Vec<YeelightDiscoveredDevice>, String> {
    if !option_flag(options, "refresh") {
        if let Some(cached) = read_discovery_cache(None).map_err(|error| error.to_string())? {
            if !cached.is_empty() {
                return Ok(cached);
            }
        }
    }

    let timeout_ms = parse_timeout(options, DEFAULT_DISCOVERY_TIMEOUT_MS)?;
    let devices = discover_devices(YeelightDiscoveryOptions {
        timeout_ms: Some(timeout_ms),
    })
    .map_err(|error| error.to_string())?;
    if devices.is_empty() {
        return Err("No Yeelight devices found. Ensure LAN control is enabled in the Yeelight app and the bulb is on the same network.".to_owned());
    }

    write_discovery_cache(&devices).map_err(|error| error.to_string())?;
    Ok(devices)
}

fn resolve_probe_device(options: &BTreeMap<String, OptionValue>) -> Result<YeelightDiscoveredDevice, String> {
    let resolved = resolve_target(options)?;
    if !resolved.device.support.is_empty() {
        return Ok(resolved.device);
    }

    get_known_devices(options)?
        .into_iter()
        .find(|device| device.host == resolved.device.host && device.port == resolved.device.port)
        .ok_or_else(|| {
            "Unable to determine the supported method list for the selected device. Run discover first or use --refresh.".to_owned()
        })
}

fn parse_device_selector(options: &BTreeMap<String, OptionValue>) -> Result<DeviceSelector, String> {
    if options.contains_key("port") {
        return Err("Use --host <ip[:port]> instead of --port.".to_owned());
    }

    let host = option_string(options, "host").map(ToOwned::to_owned);
    let id = option_string(options, "id").map(ToOwned::to_owned);
    let name = option_string(options, "name").map(ToOwned::to_owned);
    let count = usize::from(host.is_some()) + usize::from(id.is_some()) + usize::from(name.is_some());

    if count == 0 {
        return Err("This command requires a device selector. Use exactly one of --id, --name, or --host <ip[:port]>.".to_owned());
    }
    if count > 1 {
        return Err("Use only one device selector: --id, --name, or --host <ip[:port]>.".to_owned());
    }

    if let Some(host_value) = host {
        let parsed = parse_host_value(&host_value, DEFAULT_CONTROL_PORT).map_err(|error| error.to_string())?;
        return Ok(DeviceSelector {
            host: Some(parsed.host),
            id: None,
            name: None,
            port: parsed.port,
        });
    }

    Ok(DeviceSelector {
        host: None,
        id,
        name,
        port: DEFAULT_CONTROL_PORT,
    })
}

fn parse_rgb_value(positionals: &[String]) -> Result<u32, String> {
    let values = &positionals[1..];
    if values.len() == 1 {
        let normalized = values[0]
            .trim()
            .trim_start_matches('#')
            .trim_start_matches("0x")
            .trim_start_matches("0X");
        if normalized.len() != 6 || !normalized.chars().all(|character| character.is_ascii_hexdigit()) {
            return Err("RGB color must be \"#RRGGBB\", \"RRGGBB\", \"0xRRGGBB\", or three integers like \"255 0 0\".".to_owned());
        }
        return u32::from_str_radix(normalized, 16).map_err(|error| error.to_string());
    }

    if values.len() == 3 {
        let red = u16::try_from(parse_integer(&values[0], "Red")?).map_err(|_| "Red must be an integer between 0 and 255.".to_owned())?;
        let green = u16::try_from(parse_integer(&values[1], "Green")?).map_err(|_| "Green must be an integer between 0 and 255.".to_owned())?;
        let blue = u16::try_from(parse_integer(&values[2], "Blue")?).map_err(|_| "Blue must be an integer between 0 and 255.".to_owned())?;
        validate_rgb_component(red, "Red").map_err(|error| error.to_string())?;
        validate_rgb_component(green, "Green").map_err(|error| error.to_string())?;
        validate_rgb_component(blue, "Blue").map_err(|error| error.to_string())?;
        return to_rgb_value(red, green, blue).map_err(|error| error.to_string());
    }

    Err("RGB color is required. Example: cargo run -- rgb ff0000 --id 0x... or cargo run -- rgb 255 0 0 --name Bedroom".to_owned())
}

fn parse_exec_input(parsed: &ParsedArguments) -> Result<(String, Vec<Value>), String> {
    let method = parsed
        .positionals
        .get(1)
        .cloned()
        .ok_or_else(|| "A Yeelight method is required. Example: cargo run -- exec set_power on smooth 500 --id 0x...".to_owned())?;

    if let Some(params_value) = option_string(&parsed.options, "params") {
        if parsed.positionals.len() > 2 {
            return Err("Use either positional exec params or --params <json-array>, not both.".to_owned());
        }
        let params = parse_exec_params_value(params_value).map_err(|error| error.to_string())?;
        return Ok((method, params));
    }

    Ok((
        method,
        parse_exec_tokens(&parsed.positionals.iter().skip(2).cloned().collect::<Vec<_>>()),
    ))
}

fn create_direct_host_device(host: &str, port: u16) -> YeelightDiscoveredDevice {
    YeelightDiscoveredDevice {
        id: host.to_owned(),
        host: host.to_owned(),
        port,
        model: String::new(),
        firmware_version: String::new(),
        name: String::new(),
        power: String::new(),
        brightness: String::new(),
        color_mode: String::new(),
        color_temperature: String::new(),
        rgb: String::new(),
        hue: String::new(),
        saturation: String::new(),
        support: Vec::new(),
        location: format!("yeelight://{}:{}", host, port),
    }
}

fn parse_timeout(options: &BTreeMap<String, OptionValue>, fallback: u64) -> Result<u64, String> {
    match option_string(options, "timeout") {
        None => Ok(fallback),
        Some(value) => {
            let timeout = parse_integer(value, "Timeout")?;
            if timeout < 1 {
                return Err("Timeout must be greater than zero.".to_owned());
            }
            u64::try_from(timeout).map_err(|_| "Timeout must be greater than zero.".to_owned())
        }
    }
}

fn parse_integer(value: &str, label: &str) -> Result<i64, String> {
    value
        .parse::<i64>()
        .map_err(|_| format!("{} must be an integer.", label))
}

fn option_string<'a>(options: &'a BTreeMap<String, OptionValue>, key: &str) -> Option<&'a str> {
    match options.get(key) {
        Some(OptionValue::String(value)) => Some(value.as_str()),
        _ => None,
    }
}

fn option_flag(options: &BTreeMap<String, OptionValue>, key: &str) -> bool {
    options.contains_key(key)
}

fn print_help() {
    println!(
        "{}",
        [
            "Yeelight CLI",
            "",
            "Usage:",
            "  cargo run -- <command> [options]",
            "",
            "Commands:",
            "  discover                 Discover bulbs on the LAN",
            "  status                   Read live bulb properties (requires a selector)",
            "  on                       Turn the bulb on (requires a selector)",
            "  off                      Turn the bulb off (requires a selector)",
            "  bright <1-100>           Set brightness (requires a selector)",
            "  ct <1700-6500>           Set color temperature (requires a selector)",
            "  rgb <hex|r g b>          Set RGB color (requires a selector)",
            "  exec <method> [params]   Execute a raw command (requires a selector)",
            "  probe                    List supported methods (requires a selector)",
            "  help                     Show this help",
            "",
            "Common options:",
            "  --id <deviceId>          Target a discovered bulb by device id",
            "  --name <label>           Target a discovered bulb by decoded name",
            "  --host <ip[:port]>       Target a bulb directly by IP, optionally with port",
            "  --timeout <ms>           Timeout override",
            "  --refresh                Force fresh discovery instead of cache",
            "  --json                   Print JSON output",
            "  --params <json-array>    Use a JSON array for exec parameters",
            "  --effect <mode>          sudden or smooth",
            "  --duration <ms>          Duration for write commands (default: 30)",
            "",
            "Exec examples:",
            "  cargo run -- exec toggle --id 0x0000000012345678",
            "  cargo run -- exec set_power on smooth 500 --host 192.168.1.23:55443",
            "  cargo run -- exec get_prop power bright --name Bedroom",
            "  cargo run -- exec set_scene --params [\"color\",65280,70] --id 0x0000000012345678",
            "  cargo run -- probe --host 192.168.1.23:55443",
            "",
            &format!("Discovery cache: {}", get_cache_path().display()),
        ]
        .join("\n")
    );
}

fn print_json<T: Serialize>(value: &T) -> Result<(), String> {
    let rendered = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    println!("{}", rendered);
    Ok(())
}
