# Yeelight CLI for Rust

Rust port of the Bun/TypeScript Yeelight LAN control project. It includes a reusable library plus a CLI for discovering bulbs, reading status, and sending the same common commands as the Node.js version.

## Before You Start

Enable LAN control for the bulb in the Yeelight mobile app first. If LAN control is off, discovery and commands will fail.

## Requirements

- Rust 1.92+
- A Yeelight bulb on the same local network

## Usage

Run the CLI directly with Cargo:

```bash
cargo run -- <command> [options]
```

Build the library and binary:

```bash
cargo build
```

Run the test suite:

```bash
cargo test
```

Install the CLI locally:

```bash
cargo install --path .
yeelight <command> [options]
```

## Commands

```text
discover                 Discover bulbs on the LAN
status                   Read live bulb properties with get_prop (requires a selector)
on                       Turn the bulb on (requires a selector)
off                      Turn the bulb off (requires a selector)
bright <1-100>           Set absolute brightness (requires a selector)
ct <1700-6500>           Set color temperature when supported (requires a selector)
rgb <hex|r g b>          Set RGB color when supported (requires a selector)
exec <method> [params]   Execute a raw Yeelight command and print the response (requires a selector)
probe                    List the selected device's advertised Yeelight methods (requires a selector)
help                     Show help
```

## Common Options

```text
Commands other than `discover` and `help` require exactly one selector: `--id`, `--name`, or `--host`.

--id <deviceId>          Target a discovered bulb by Yeelight device id
--name <label>           Target a discovered bulb by decoded name
--host <ip[:port]>       Target a bulb directly by IP, optionally with port
--timeout <ms>           Discovery or command timeout override
--refresh                Force fresh discovery instead of cached results
--json                   Print JSON output
--params <json-array>    Use a JSON array for exec parameters
--effect <sudden|smooth> Transition effect for write commands
--duration <ms>          Transition duration for write commands
```

## Examples

```bash
cargo run -- discover
cargo run -- status --id 0x0000000012345678
cargo run -- on --id 0x0000000012345678
cargo run -- bright 40 --name Bedroom
cargo run -- ct 3500 --host 192.168.1.23:55443 --effect smooth --duration 500
cargo run -- rgb ff0000 --id 0x0000000012345678
cargo run -- rgb 255 0 0 --name Bedroom --effect smooth --duration 500
cargo run -- exec toggle --id 0x0000000012345678
cargo run -- exec set_power on smooth 500 --host 192.168.1.23:55443
cargo run -- exec set_scene --params "[\"color\",65280,70]" --id 0x0000000012345678
cargo run -- probe --name Bedroom
```

## Rust Library

```rust
use yeelight_cli::{
    FlowExpression, YeelightClient, YeelightDiscoveryOptions, YeelightFlowTuple,
    YeelightTransitionOptions, discover_devices,
};

let devices = discover_devices(YeelightDiscoveryOptions {
    timeout_ms: Some(5_000),
})?;
let client = YeelightClient::from_device(devices[0].clone(), Some(5_000));

client.set_power(
    "on",
    YeelightTransitionOptions {
        effect: Some("smooth".to_owned()),
        duration: Some(300),
        timeout_ms: Some(5_000),
    },
)?;

client.set_rgb(
    0xff6600,
    YeelightTransitionOptions {
        effect: Some("smooth".to_owned()),
        duration: Some(500),
        timeout_ms: Some(5_000),
    },
)?;

client.start_color_flow(
    0,
    1,
    FlowExpression::Tuples(vec![
        YeelightFlowTuple { duration: 1000, mode: 2, value: 2700, brightness: 100 },
        YeelightFlowTuple { duration: 1000, mode: 1, value: 0xff0000, brightness: 20 },
    ]),
    None,
)?;
```

The library includes:

- discovery parsing and interface-bound multicast discovery
- a TCP Yeelight client with helper methods for the same main-light and background-light command families as the Node.js version
- protocol helpers for flow expressions, scene serialization, RGB validation, and status normalization

## Notes

- Discovery responses are cached in `~/.yeelight-cli-cache.json`.
- Discovery binds multicast sockets on each active IPv4 interface and listens for direct responses plus multicast announcements when the local network permits it.
- `status` performs a live `get_prop` call instead of reading stale discovery state.
- Tests run with `cargo test`.
