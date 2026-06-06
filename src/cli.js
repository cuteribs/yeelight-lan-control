#!/usr/bin/env node

const {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_CONTROL_PORT,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_DURATION_MS,
  DEFAULT_EFFECT,
  formatDeviceLabel,
  formatDeviceSummary
} = require("./yeelight/protocol");
const { discoverDevices } = require("./yeelight/discovery");
const { getCachePath, readDiscoveryCache, writeDiscoveryCache } = require("./yeelight/cache");
const { getStatus, setBrightness, setColorTemperature, setPower } = require("./yeelight/client");

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const command = parsed.positionals[0] || "help";

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
    default:
      throw new Error(`Unknown command "${command}". Run "npm start -- help" for usage.`);
  }
}

function parseArguments(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

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

  return { positionals, options };
}

function parseInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }

  return parsed;
}

function parseTimeout(options, fallback) {
  if (options.timeout === undefined) {
    return fallback;
  }

  const timeout = parseInteger(options.timeout, "Timeout");
  if (timeout < 1) {
    throw new Error("Timeout must be greater than zero.");
  }

  return timeout;
}

function parseCommandOptions(options, fallbackTimeout) {
  const timeoutMs = parseTimeout(options, fallbackTimeout);
  const effect = options.effect ?? DEFAULT_EFFECT;
  const duration = options.duration === undefined ? DEFAULT_DURATION_MS : parseInteger(options.duration, "Duration");
  const json = Boolean(options.json);

  return {
    duration,
    effect,
    json,
    timeoutMs
  };
}

async function handleDiscover(options) {
  const timeoutMs = parseTimeout(options, DEFAULT_DISCOVERY_TIMEOUT_MS);
  const devices = await discoverDevices({ timeoutMs });

  if (devices.length === 0) {
    throw new Error(
      "No Yeelight devices found. Ensure LAN control is enabled in the Yeelight app and the bulb is on the same network."
    );
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

async function handleStatus(options) {
  const resolved = await resolveTarget(options);
  const status = await getStatus(resolved.device, { timeoutMs: resolved.timeoutMs });

  const payload = {
    device: resolved.device,
    status
  };

  if (resolved.json) {
    printJson(payload);
    return;
  }

  console.log(`Status for ${formatDeviceLabel(resolved.device)}`);
  for (const [key, value] of Object.entries(status)) {
    console.log(`  ${key}: ${value}`);
  }
}

async function handlePower(state, options) {
  const resolved = await resolveTarget(options);
  await setPower(resolved.device, state, {
    duration: resolved.duration,
    effect: resolved.effect,
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

async function handleBrightness(parsed) {
  const value = parsed.positionals[1];
  if (value === undefined) {
    throw new Error('Brightness value is required. Example: npm start -- bright 40');
  }

  const brightness = parseInteger(value, "Brightness");
  const resolved = await resolveTarget(parsed.options);
  await setBrightness(resolved.device, brightness, {
    duration: resolved.duration,
    effect: resolved.effect,
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

async function handleColorTemperature(parsed) {
  const value = parsed.positionals[1];
  if (value === undefined) {
    throw new Error('Color temperature value is required. Example: npm start -- ct 3500');
  }

  const colorTemperature = parseInteger(value, "Color temperature");
  const resolved = await resolveTarget(parsed.options);
  await setColorTemperature(resolved.device, colorTemperature, {
    duration: resolved.duration,
    effect: resolved.effect,
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

  console.log(
    `Set color temperature to ${colorTemperature}K for ${formatDeviceLabel(resolved.device)}.`
  );
}

async function resolveTarget(options) {
  const commandOptions = parseCommandOptions(options, DEFAULT_COMMAND_TIMEOUT_MS);
  const selector = {
    host: options.host,
    id: options.id,
    name: options.name,
    port: options.port === undefined ? DEFAULT_CONTROL_PORT : parseInteger(options.port, "Port")
  };

  if (selector.host) {
    const cachedDevices = options.refresh ? [] : (await readDiscoveryCache()) || [];
    const cachedMatch = cachedDevices.find(
      (device) => device.host === selector.host && Number(device.port) === selector.port
    );

    return {
      ...commandOptions,
      device:
        cachedMatch || {
          host: selector.host,
          id: selector.host,
          model: "",
          name: "",
          port: selector.port,
          support: []
        }
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
    throw new Error(
      `Multiple bulbs matched. Re-run with --id, --name, or --host to choose one:\n${choices}`
    );
  }

  return {
    ...commandOptions,
    device: matches[0]
  };
}

async function getKnownDevices(options) {
  if (!options.refresh) {
    const cachedDevices = await readDiscoveryCache();
    if (cachedDevices && cachedDevices.length > 0) {
      return cachedDevices;
    }
  }

  const timeoutMs = parseTimeout(options, DEFAULT_DISCOVERY_TIMEOUT_MS);
  const discoveredDevices = await discoverDevices({ timeoutMs });

  if (discoveredDevices.length === 0) {
    throw new Error(
      "No Yeelight devices found. Ensure LAN control is enabled in the Yeelight app and the bulb is on the same network."
    );
  }

  await writeDiscoveryCache(discoveredDevices);
  return discoveredDevices;
}

function printHelp() {
  console.log(
    [
      "Yeelight CLI",
      "",
      "Usage:",
      "  npm start -- <command> [options]",
      "",
      "Commands:",
      "  discover                 Discover bulbs on the LAN",
      "  status                   Read live bulb properties",
      "  on                       Turn the bulb on",
      "  off                      Turn the bulb off",
      "  bright <1-100>           Set brightness",
      "  ct <2700-6500>           Set color temperature",
      "  help                     Show this help",
      "",
      "Common options:",
      "  --id <deviceId>          Target a discovered bulb by device id",
      "  --name <label>           Target a discovered bulb by decoded name",
      "  --host <ip>              Target a bulb directly by IP",
      "  --port <number>          TCP port with --host (default: 55443)",
      "  --timeout <ms>           Timeout override",
      "  --refresh                Force fresh discovery instead of cache",
      "  --json                   Print JSON output",
      "  --effect <mode>          sudden or smooth",
      "  --duration <ms>          Duration for write commands (default: 30)",
      "",
      `Discovery cache: ${getCachePath()}`
    ].join("\n")
  );
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
