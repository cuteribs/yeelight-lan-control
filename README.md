# Yeelight CLI

Small Bun-first TypeScript project for discovering and controlling a Yeelight bulb over the local network.

The repo also ships a **TypeScript library** in `dist/` for integrating Yeelight discovery and control into other Node.js projects.

## Before you start

**Enable LAN control for the bulb in the Yeelight mobile app first.** If LAN control is off, discovery and commands will fail.

## Requirements

- Bun 1.3+
- A Yeelight bulb on the same local network

## Usage

Run directly with Bun:

```bash
bun run start -- <command> [options]
```

Or after linking the package globally with Bun:

```bash
bun link
yeelight <command> [options]
```

Build the TypeScript library:

```bash
bun install
bun run build
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

## Common options

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
bun run start -- discover
bun run start -- status --id 0x0000000012345678
bun run start -- on --id 0x0000000012345678
bun run start -- bright 40 --name Bedroom
bun run start -- ct 3500 --host 192.168.1.23:55443 --effect smooth --duration 500
bun run start -- rgb ff0000 --id 0x0000000012345678
bun run start -- rgb 255 0 0 --name Bedroom --effect smooth --duration 500
bun run start -- exec toggle --id 0x0000000012345678
bun run start -- exec set_power on smooth 500 --host 192.168.1.23:55443
bun run start -- exec set_scene --params "[\"color\",65280,70]" --id 0x0000000012345678
bun run start -- probe --name Bedroom
```

## Yeelight protocol reference

Two extracted reference files are included at the repo root:

- `Yeelight.md` - English summary of the Yeelight LAN control method table and detailed method notes
- `Yeelight.zh.md` - Chinese translation of the same reference

Both documents are derived from `Yeelight_Inter-Operation_Spec.pdf` in the session artifacts, without external web sources.

## TypeScript library

The project source is now TypeScript-first. The reusable library lives in `src/library/`, the Bun CLI lives in `src/cli.ts`, and the built package is emitted to `dist/`.

```ts
import { YeelightClient, buildFlowExpression, discoverDevices } from "yeelight-cli";

const devices = await discoverDevices({ timeoutMs: 5000 });
const client = YeelightClient.fromDevice(devices[0]);

await client.setPower("on", { effect: "smooth", duration: 300 });
await client.setRgb(0xff6600, { effect: "smooth", duration: 500 });

const sceneFlow = buildFlowExpression([
  { duration: 1000, mode: 2, value: 2700, brightness: 100 },
  { duration: 1000, mode: 1, value: 0xff0000, brightness: 20 }
]);

await client.startColorFlow(0, 1, sceneFlow);
```

The TypeScript library wraps the command table from the Yeelight inter-operation spec, including:

- discovery parsing and interface-bound multicast discovery
- typed command sending through `YeelightClient.sendCommand(...)`
- helper methods for main light, background light, scenes, color flow, cron, adjust, name, and music mode

The PDF spec does **not** document parameter shapes for `udp_sess_new`, `udp_sess_keep_alive`, or `udp_chroma_sess_new`, so the library exposes those as raw `unknown[]` parameter methods for further development.

## Notes

- Discovery responses are cached in `~/.yeelight-cli-cache.json` to keep follow-up commands fast.
- Discovery binds multicast sockets on each active IPv4 interface and listens for both direct search replies and Yeelight multicast `NOTIFY` announcements, matching the working demo app more closely.
- The CLI gates commands against the bulb's advertised `support` list when that data is available.
- `status` uses a live `get_prop` request instead of relying on possibly stale discovery properties.
- Tests run with `bun test`.
