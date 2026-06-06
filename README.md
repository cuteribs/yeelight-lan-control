# Yeelight CLI

Small Node.js CLI for discovering and controlling a Yeelight bulb over the local network.

## Before you start

**Enable LAN control for the bulb in the Yeelight mobile app first.** If LAN control is off, discovery and commands will fail.

## Requirements

- Node.js 18+
- A Yeelight bulb on the same local network

## Usage

Run directly with npm:

```bash
npm start -- <command> [options]
```

Or after linking the package globally:

```bash
npm link
yeelight <command> [options]
```

## Commands

```text
discover                 Discover bulbs on the LAN
status                   Read live bulb properties with get_prop
on                       Turn the bulb on
off                      Turn the bulb off
bright <1-100>           Set absolute brightness
ct <2700-6500>           Set color temperature when supported
help                     Show help
```

## Common options

```text
--id <deviceId>          Target a discovered bulb by Yeelight device id
--name <label>           Target a discovered bulb by decoded name
--host <ip>              Target a bulb directly by IP
--port <number>          TCP port when using --host (default: 55443)
--timeout <ms>           Discovery or command timeout override
--refresh                Force fresh discovery instead of cached results
--json                   Print JSON output
--effect <sudden|smooth> Transition effect for write commands
--duration <ms>          Transition duration for write commands
```

## Examples

```bash
npm start -- discover
npm start -- status
npm start -- on --id 0x0000000012345678
npm start -- bright 40 --name Bedroom
npm start -- ct 3500 --host 192.168.1.23 --effect smooth --duration 500
```

## Notes

- Discovery responses are cached in `~/.yeelight-cli-cache.json` to keep follow-up commands fast.
- The CLI gates commands against the bulb's advertised `support` list when that data is available.
- `status` uses a live `get_prop` request instead of relying on possibly stale discovery properties.
