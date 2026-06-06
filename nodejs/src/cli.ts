#!/usr/bin/env bun

import { parseExecParamsValue, parseExecTokens, parseHostValue } from "./cli-support";
import { getCachePath, readDiscoveryCache, writeDiscoveryCache } from "./cache";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_CONTROL_PORT,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_DURATION_MS,
  DEFAULT_EFFECT,
  YEELIGHT_METHODS,
  YeelightClient,
  discoverDevices,
  formatDeviceLabel,
  formatDeviceSummary,
  formatRgbHex,
  toRgbValue,
  validateRgbComponent
} from "./library";
import type {
  YeelightCommandOptions,
  YeelightDiscoveredDevice,
  YeelightEffect,
  YeelightPower,
  YeelightPropertyValues
} from "./library";

type CliOptions = Record<string, string | boolean>;

interface ParsedArguments {
  options: CliOptions;
  positionals: string[];
}

interface ResolvedTarget extends Required<Pick<CommandOptions, "duration" | "effect" | "json" | "timeoutMs">> {
  client: YeelightClient;
  device: YeelightDiscoveredDevice;
}

interface CommandOptions extends YeelightCommandOptions {
  duration?: number;
  effect?: YeelightEffect;
  json?: boolean;
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2));
  const command = parsed.positionals[0] ?? "help";

  switch (command) {
    case "help":
    case "--help":
      printHelp();
      return;
    case "discover":
      await handleDiscover(parsed.options);
      return;
    case "status":
      await handleStatus(parsed.options);
      return;
    case "on":
      await handlePower("on", parsed.options);
      return;
    case "off":
      await handlePower("off", parsed.options);
      return;
    case "bright":
      await handleBrightness(parsed);
      return;
    case "ct":
      await handleColorTemperature(parsed);
      return;
    case "rgb":
      await handleRgb(parsed);
      return;
    case "exec":
      await handleExec(parsed);
      return;
    case "probe":
      await handleProbe(parsed.options);
      return;
    default:
      throw new Error(`Unknown command "${command}". Run "bun run start -- help" for usage.`);
  }
}

function parseArguments(argv: string[]): ParsedArguments {
  const positionals: string[] = [];
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
      continue;
    }

    options[key] = true;
  }

  return { options, positionals };
}

function parseInteger(value: string | boolean | undefined, label: string): number {
  if (typeof value !== "string") {
    throw new Error(`${label} must be an integer.`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }

  return parsed;
}

function parseTimeout(options: CliOptions, fallback: number): number {
  if (options.timeout === undefined) {
    return fallback;
  }

  const timeout = parseInteger(options.timeout, "Timeout");
  if (timeout < 1) {
    throw new Error("Timeout must be greater than zero.");
  }

  return timeout;
}

function parseCommandOptions(options: CliOptions, fallbackTimeout: number): Required<Pick<CommandOptions, "duration" | "effect" | "json" | "timeoutMs">> {
  const timeoutMs = parseTimeout(options, fallbackTimeout);
  const effect = (options.effect ?? DEFAULT_EFFECT) as YeelightEffect;
  const duration = options.duration === undefined ? DEFAULT_DURATION_MS : parseInteger(options.duration, "Duration");
  const json = Boolean(options.json);

  return {
    duration,
    effect,
    json,
    timeoutMs
  };
}

function parseRgbValue(positionals: string[]): number {
  const values = positionals.slice(1);

  if (values.length === 1) {
    const value = values[0];
    if (value === undefined) {
      throw new Error('RGB color is required. Example: bun run start -- rgb ff0000 or bun run start -- rgb 255 0 0');
    }

    const normalized = value.trim().replace(/^#|^0x/i, "");
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
      throw new Error('RGB color must be "#RRGGBB", "RRGGBB", "0xRRGGBB", or three integers like "255 0 0".');
    }

    return Number.parseInt(normalized, 16);
  }

  if (values.length === 3) {
    const red = parseInteger(values[0], "Red");
    const green = parseInteger(values[1], "Green");
    const blue = parseInteger(values[2], "Blue");
    validateRgbComponent(red, "Red");
    validateRgbComponent(green, "Green");
    validateRgbComponent(blue, "Blue");
    return toRgbValue(red, green, blue);
  }

  throw new Error('RGB color is required. Example: bun run start -- rgb ff0000 or bun run start -- rgb 255 0 0');
}

function parseExecInput(parsed: ParsedArguments): { method: string; params: unknown[] } {
  const method = parsed.positionals[1];
  if (!method) {
    throw new Error('A Yeelight method is required. Example: bun run start -- exec set_power on smooth 500');
  }

  if (typeof parsed.options.params === "string") {
    if (parsed.positionals.length > 2) {
      throw new Error("Use either positional exec params or --params <json-array>, not both.");
    }

    return {
      method,
      params: parseExecParamsValue(parsed.options.params)
    };
  }

  return {
    method,
    params: parseExecTokens(parsed.positionals.slice(2))
  };
}

function parseDeviceSelector(options: CliOptions): {
  host?: string;
  id?: string;
  name?: string;
  port: number;
} {
  if (options.port !== undefined) {
    throw new Error('Use --host <ip[:port]> instead of --port.');
  }

  const hostValue = typeof options.host === "string" ? options.host : undefined;
  const id = typeof options.id === "string" ? options.id : undefined;
  const name = typeof options.name === "string" ? options.name : undefined;
  const selectorCount = Number(Boolean(hostValue)) + Number(Boolean(id)) + Number(Boolean(name));

  if (selectorCount === 0) {
    throw new Error('This command requires a device selector. Use exactly one of --id, --name, or --host <ip[:port]>.');
  }

  if (selectorCount > 1) {
    throw new Error('Use only one device selector: --id, --name, or --host <ip[:port]>.');
  }

  if (hostValue) {
    const parsedHost = parseHostValue(hostValue, DEFAULT_CONTROL_PORT);
    return {
      host: parsedHost.host,
      port: parsedHost.port
    };
  }

  return {
    id,
    name,
    port: DEFAULT_CONTROL_PORT
  };
}

function createDirectHostDevice(host: string, port: number): YeelightDiscoveredDevice {
  return {
    id: host,
    host,
    port,
    model: "",
    firmwareVersion: "",
    name: "",
    power: "",
    brightness: "",
    colorMode: "",
    colorTemperature: "",
    rgb: "",
    hue: "",
    saturation: "",
    support: [],
    location: `yeelight://${host}:${port}`
  };
}

async function handleDiscover(options: CliOptions): Promise<void> {
  const timeoutMs = parseTimeout(options, DEFAULT_DISCOVERY_TIMEOUT_MS);
  const devices = await discoverDevices({ timeoutMs });

  if (devices.length === 0) {
    throw new Error("No Yeelight devices found. Ensure LAN control is enabled in the Yeelight app and the bulb is on the same network.");
  }

  await writeDiscoveryCache(devices);

  if (options.json) {
    printJson(devices);
    return;
  }

  console.log(`Found ${devices.length} device(s):`);
  for (const device of devices) {
    console.log(formatDeviceSummary(device));
  }
}

async function handleStatus(options: CliOptions): Promise<void> {
  const resolved = await resolveTarget(options);
  const status = await resolved.client.getStatus({ timeoutMs: resolved.timeoutMs });
  const payload = {
    device: resolved.device,
    status
  };

  if (resolved.json) {
    printJson(payload);
    return;
  }

  printStatus(resolved.device, status);
}

async function handlePower(state: YeelightPower, options: CliOptions): Promise<void> {
  const resolved = await resolveTarget(options);
  await resolved.client.setPower(state, {
    effect: resolved.effect,
    duration: resolved.duration,
    timeoutMs: resolved.timeoutMs
  });

  const payload = {
    device: resolved.device,
    power: state
  };

  if (resolved.json) {
    printJson(payload);
    return;
  }

  console.log(`Set power ${state} for ${formatDeviceLabel(resolved.device)}.`);
}

async function handleBrightness(parsed: ParsedArguments): Promise<void> {
  const value = parsed.positionals[1];
  if (value === undefined) {
    throw new Error("Brightness value is required. Example: bun run start -- bright 40");
  }

  const brightness = parseInteger(value, "Brightness");
  const resolved = await resolveTarget(parsed.options);
  await resolved.client.setBrightness(brightness, {
    effect: resolved.effect,
    duration: resolved.duration,
    timeoutMs: resolved.timeoutMs
  });

  const payload = {
    brightness,
    device: resolved.device
  };

  if (resolved.json) {
    printJson(payload);
    return;
  }

  console.log(`Set brightness to ${brightness} for ${formatDeviceLabel(resolved.device)}.`);
}

async function handleColorTemperature(parsed: ParsedArguments): Promise<void> {
  const value = parsed.positionals[1];
  if (value === undefined) {
    throw new Error("Color temperature value is required. Example: bun run start -- ct 3500");
  }

  const colorTemperature = parseInteger(value, "Color temperature");
  const resolved = await resolveTarget(parsed.options);
  await resolved.client.setColorTemperature(colorTemperature, {
    effect: resolved.effect,
    duration: resolved.duration,
    timeoutMs: resolved.timeoutMs
  });

  const payload = {
    colorTemperature,
    device: resolved.device
  };

  if (resolved.json) {
    printJson(payload);
    return;
  }

  console.log(`Set color temperature to ${colorTemperature}K for ${formatDeviceLabel(resolved.device)}.`);
}

async function handleRgb(parsed: ParsedArguments): Promise<void> {
  const rgbValue = parseRgbValue(parsed.positionals);
  const resolved = await resolveTarget(parsed.options);
  await resolved.client.setRgb(rgbValue, {
    effect: resolved.effect,
    duration: resolved.duration,
    timeoutMs: resolved.timeoutMs
  });

  const payload = {
    device: resolved.device,
    rgb: rgbValue,
    hex: formatRgbHex(rgbValue)
  };

  if (resolved.json) {
    printJson(payload);
    return;
  }

  console.log(`Set RGB color to ${formatRgbHex(rgbValue)} for ${formatDeviceLabel(resolved.device)}.`);
}

async function handleExec(parsed: ParsedArguments): Promise<void> {
  const { method, params } = parseExecInput(parsed);
  const resolved = await resolveTarget(parsed.options);
  const response = await resolved.client.sendRawCommand(method, params, {
    timeoutMs: resolved.timeoutMs
  });

  printJson({
    device: resolved.device,
    method,
    params,
    response
  });

  if ("error" in response) {
    process.exitCode = 1;
  }
}

async function handleProbe(options: CliOptions): Promise<void> {
  const device = await resolveProbeDevice(options);
  const supported = [...device.support].sort((left, right) => left.localeCompare(right));
  const unsupportedKnown = YEELIGHT_METHODS.filter((method) => !supported.includes(method));
  const advertisedUnknown = supported.filter((method) => !YEELIGHT_METHODS.includes(method as (typeof YEELIGHT_METHODS)[number]));

  const payload = {
    advertisedUnknown,
    device,
    supported,
    unsupportedKnown
  };

  if (Boolean(options.json)) {
    printJson(payload);
    return;
  }

  console.log(`Supported methods for ${formatDeviceLabel(device)} (${supported.length}):`);
  for (const method of supported) {
    console.log(`  ${method}`);
  }

  if (advertisedUnknown.length > 0) {
    console.log("");
    console.log("Advertised methods not recognized by this library:");
    for (const method of advertisedUnknown) {
      console.log(`  ${method}`);
    }
  }

  console.log("");
  console.log(`Known Yeelight methods not advertised by this device (${unsupportedKnown.length}):`);
  for (const method of unsupportedKnown) {
    console.log(`  ${method}`);
  }
}

async function resolveTarget(options: CliOptions): Promise<ResolvedTarget> {
  const commandOptions = parseCommandOptions(options, DEFAULT_COMMAND_TIMEOUT_MS);
  const selector = parseDeviceSelector(options);

  if (selector.host) {
    const cachedDevices = options.refresh ? [] : (await readDiscoveryCache()) ?? [];
    const cachedMatch = cachedDevices.find(
      (device) => device.host === selector.host && Number(device.port) === selector.port
    );
    const device = cachedMatch ?? createDirectHostDevice(selector.host, selector.port);

    return {
      ...commandOptions,
      client: YeelightClient.fromDevice(device, { timeoutMs: commandOptions.timeoutMs }),
      device
    };
  }

  const devices = await getKnownDevices(options);
  const matches = devices.filter((device) => {
    if (selector.id && device.id !== selector.id) {
      return false;
    }
    if (selector.name && device.name !== selector.name) {
      return false;
    }
    return true;
  });

  if (matches.length === 0) {
    throw new Error("No discovered Yeelight device matched the provided selector.");
  }

  if (matches.length > 1) {
    const choices = matches.map((device) => `- ${formatDeviceLabel(device)} [id=${device.id}]`).join("\n");
    throw new Error(`Multiple bulbs matched. Re-run with --id, --name, or --host to choose one:\n${choices}`);
  }

  const match = matches[0];
  if (!match) {
    throw new Error("No discovered Yeelight device matched the provided selector.");
  }

  return {
    ...commandOptions,
    client: YeelightClient.fromDevice(match, { timeoutMs: commandOptions.timeoutMs }),
    device: match
  };
}

async function getKnownDevices(options: CliOptions): Promise<YeelightDiscoveredDevice[]> {
  if (!options.refresh) {
    const cachedDevices = await readDiscoveryCache();
    if (cachedDevices && cachedDevices.length > 0) {
      return cachedDevices;
    }
  }

  const timeoutMs = parseTimeout(options, DEFAULT_DISCOVERY_TIMEOUT_MS);
  const discoveredDevices = await discoverDevices({ timeoutMs });
  if (discoveredDevices.length === 0) {
    throw new Error("No Yeelight devices found. Ensure LAN control is enabled in the Yeelight app and the bulb is on the same network.");
  }

  await writeDiscoveryCache(discoveredDevices);
  return discoveredDevices;
}

async function resolveProbeDevice(options: CliOptions): Promise<YeelightDiscoveredDevice> {
  const resolved = await resolveTarget(options);
  if (resolved.device.support.length > 0) {
    return resolved.device;
  }

  const devices = await getKnownDevices(options);
  const matched = devices.find((device) => device.host === resolved.device.host && device.port === resolved.device.port);
  if (matched) {
    return matched;
  }

  throw new Error("Unable to determine the supported method list for the selected device. Run discover first or use --refresh.");
}

function printStatus(device: YeelightDiscoveredDevice, status: YeelightPropertyValues<string>): void {
  console.log(`Status for ${formatDeviceLabel(device)}`);
  for (const [key, value] of Object.entries(status)) {
    console.log(`  ${key}: ${value}`);
  }
}

function printHelp(): void {
  console.log(
    [
      "Yeelight CLI",
      "",
      "Usage:",
      "  bun run start -- <command> [options]",
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
      "  bun run start -- exec toggle --id 0x0000000012345678",
      '  bun run start -- exec set_power on smooth 500 --host 192.168.1.23:55443',
      '  bun run start -- exec get_prop power bright --name Bedroom',
      '  bun run start -- exec set_scene --params [\"color\",65280,70] --id 0x0000000012345678',
      "  bun run start -- probe --host 192.168.1.23:55443",
      "",
      `Discovery cache: ${getCachePath()}`
    ].join("\n")
  );
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
