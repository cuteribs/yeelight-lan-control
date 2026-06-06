const DISCOVERY_ADDRESS = "239.255.255.250";
const DISCOVERY_PORT = 1982;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 3000;
const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
const DEFAULT_EFFECT = "sudden";
const DEFAULT_DURATION_MS = 30;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CONTROL_PORT = 55443;
const LIVE_STATUS_PROPERTIES = [
  "power",
  "bright",
  "ct",
  "color_mode",
  "rgb",
  "hue",
  "sat",
  "name"
];

function buildDiscoveryRequest() {
  return Buffer.from(
    [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${DISCOVERY_ADDRESS}:${DISCOVERY_PORT}`,
      'MAN: "ssdp:discover"',
      "ST: wifi_bulb",
      "",
      ""
    ].join("\r\n"),
    "utf8"
  );
}

function parseDiscoveryResponse(message) {
  const lines = message.toString("utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length || !/^HTTP\/1\.1 200 OK$/i.test(lines[0])) {
    return null;
  }

  const headers = {};
  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    headers[key] = value;
  }

  if (!headers.location) {
    return null;
  }

  const locationMatch = /^yeelight:\/\/([^:]+):(\d+)$/i.exec(headers.location);
  if (!locationMatch) {
    return null;
  }

  const host = locationMatch[1];
  const port = Number.parseInt(locationMatch[2], 10);
  const support = (headers.support || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    id: headers.id || `${host}:${port}`,
    host,
    port,
    model: headers.model || "",
    firmwareVersion: headers.fw_ver || "",
    name: decodeDeviceName(headers.name || ""),
    power: headers.power || "",
    brightness: headers.bright || "",
    colorMode: headers.color_mode || "",
    colorTemperature: headers.ct || "",
    rgb: headers.rgb || "",
    hue: headers.hue || "",
    saturation: headers.sat || "",
    support,
    location: headers.location
  };
}

function decodeDeviceName(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed) || trimmed.length % 4 !== 0) {
    return trimmed;
  }

  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  if (!decoded || /[\u0000-\u0008\u000E-\u001F]/.test(decoded)) {
    return trimmed;
  }

  const normalizedInput = trimmed.replace(/=+$/, "");
  const normalizedOutput = Buffer.from(decoded, "utf8")
    .toString("base64")
    .replace(/=+$/, "");

  return normalizedInput === normalizedOutput ? decoded : trimmed;
}

function splitSocketBuffer(pending, chunk) {
  const combined = `${pending}${chunk}`;
  const parts = combined.split("\r\n");
  const nextPending = parts.pop() || "";
  const lines = parts.map((line) => line.trim()).filter(Boolean);
  return { lines, pending: nextPending };
}

function buildCommand(method, params, id) {
  return `${JSON.stringify({ id, method, params })}\r\n`;
}

function normalizeStatus(properties, result) {
  return properties.reduce((accumulator, propertyName, index) => {
    accumulator[propertyName] = result[index] ?? null;
    return accumulator;
  }, {});
}

function validateEffect(effect) {
  if (effect !== "sudden" && effect !== "smooth") {
    throw new Error('Effect must be "sudden" or "smooth".');
  }
}

function validateDuration(duration) {
  if (!Number.isInteger(duration) || duration < 30) {
    throw new Error("Duration must be an integer greater than or equal to 30 milliseconds.");
  }
}

function validateBrightness(brightness) {
  if (!Number.isInteger(brightness) || brightness < 1 || brightness > 100) {
    throw new Error("Brightness must be an integer between 1 and 100.");
  }
}

function validateColorTemperature(colorTemperature) {
  if (
    !Number.isInteger(colorTemperature) ||
    colorTemperature < 2700 ||
    colorTemperature > 6500
  ) {
    throw new Error("Color temperature must be an integer between 2700 and 6500 Kelvin.");
  }
}

function formatDeviceLabel(device) {
  const title = device.name || device.id || `${device.host}:${device.port}`;
  return `${title} (${device.host}:${device.port})`;
}

function formatDeviceSummary(device) {
  const support = device.support?.length ? device.support.join(", ") : "unknown";
  const name = device.name || "(unnamed)";
  return [
    `${name} - ${device.id}`,
    `  host: ${device.host}:${device.port}`,
    `  model: ${device.model || "unknown"}`,
    `  power: ${device.power || "unknown"}`,
    `  brightness: ${device.brightness || "unknown"}`,
    `  support: ${support}`
  ].join("\n");
}

module.exports = {
  DISCOVERY_ADDRESS,
  DISCOVERY_PORT,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_CONTROL_PORT,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_DURATION_MS,
  DEFAULT_EFFECT,
  LIVE_STATUS_PROPERTIES,
  buildCommand,
  buildDiscoveryRequest,
  decodeDeviceName,
  formatDeviceLabel,
  formatDeviceSummary,
  normalizeStatus,
  parseDiscoveryResponse,
  splitSocketBuffer,
  validateBrightness,
  validateColorTemperature,
  validateDuration,
  validateEffect
};
