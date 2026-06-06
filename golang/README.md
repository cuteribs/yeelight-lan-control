# Yeelight CLI for Go

Go port of the Bun/TypeScript Yeelight LAN control project. It includes a reusable standard-library-only package and a CLI for discovering bulbs, reading status, and sending the same common commands as the Node.js and Rust versions.

## Before You Start

Enable LAN control for the bulb in the Yeelight mobile app first. If LAN control is off, discovery and commands will fail.

## Requirements

- Go 1.25+
- A Yeelight bulb on the same local network
- No third-party Go packages are required

## Usage

Run the CLI directly:

```bash
go run . -- <command> [options]
```

Build the CLI:

```bash
go build
```

Run the tests:

```bash
go test ./...
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
Commands other than discover and help require exactly one selector: --id, --name, or --host.

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
go run . -- discover
go run . -- status --id 0x0000000012345678
go run . -- on --id 0x0000000012345678
go run . -- bright 40 --name Bedroom
go run . -- ct 3500 --host 192.168.1.23:55443 --effect smooth --duration 500
go run . -- rgb ff0000 --id 0x0000000012345678
go run . -- rgb 255 0 0 --name Bedroom --effect smooth --duration 500
go run . -- exec toggle --id 0x0000000012345678
go run . -- exec set_power on smooth 500 --host 192.168.1.23:55443
go run . -- exec set_scene --params "[\"color\",65280,70]" --id 0x0000000012345678
go run . -- probe --name Bedroom
```

## Go Package

```go
import yeelight "yeelight-cli-go/yeelight"

devices, err := yeelight.DiscoverDevices(yeelight.DiscoveryOptions{TimeoutMS: 5000})
if err != nil {
    return err
}

client := yeelight.NewClientFromDevice(devices[0], 5000)

_, err = client.SetPower("on", yeelight.TransitionOptions{
    TimeoutMS: 5000,
    Duration:  300,
    Effect:    "smooth",
})
if err != nil {
    return err
}

_, err = client.SetRGB(0xff6600, yeelight.TransitionOptions{
    TimeoutMS: 5000,
    Duration:  500,
    Effect:    "smooth",
})
if err != nil {
    return err
}
```

The package includes:

- discovery parsing and interface-bound multicast search implemented with the standard library
- a TCP Yeelight client with the same main-light and background-light command families as the other ports
- protocol helpers for flow expressions, scene serialization, RGB validation, and status normalization

## Notes

- Discovery responses are cached in `~/.yeelight-cli-cache.json`.
- Discovery sends multicast search packets from each active IPv4 interface and collects direct responses on the bound UDP sockets.
- `status` performs a live `get_prop` call instead of reading stale discovery state.
- Only the Go standard library is used.
