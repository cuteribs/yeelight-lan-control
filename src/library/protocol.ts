import { Buffer } from "node:buffer";
import {
  LIVE_STATUS_PROPERTIES,
  YEELIGHT_METHODS,
  type LiveStatusProperty,
  type YeelightAdjustAction,
  type YeelightAdjustProperty,
  type YeelightCommandParamsMap,
  type YeelightDiscoveredDevice,
  type YeelightEffect,
  type YeelightFlowAction,
  type YeelightFlowTuple,
  type YeelightMethod,
  type YeelightNotification,
  type YeelightProgressFlowOptions,
  type YeelightPowerMode,
  type YeelightPropertyValues,
  type YeelightScene,
  type YeelightSceneParams
} from "./types";

export const DISCOVERY_ADDRESS = "239.255.255.250";
export const DISCOVERY_PORT = 1982;
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 3000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
export const DEFAULT_EFFECT: YeelightEffect = "sudden";
export const DEFAULT_DURATION_MS = 30;
export const DEFAULT_CONTROL_PORT = 55443;
export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

const METHOD_SET = new Set<string>(YEELIGHT_METHODS);

export function isYeelightMethod(value: string): value is YeelightMethod {
  return METHOD_SET.has(value);
}

export function buildDiscoveryRequest(): Buffer {
  return Buffer.from(
    [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${DISCOVERY_ADDRESS}:${DISCOVERY_PORT}`,
      'MAN: "ssdp:discover"',
      "MX: 2",
      "ST: wifi_bulb",
      "",
      ""
    ].join("\r\n"),
    "utf8"
  );
}

export function parseDiscoveryHeaders(headers: Record<string, string>): YeelightDiscoveredDevice | null {
  const normalizedHeaders = Object.entries(headers || {}).reduce<Record<string, string>>(
    (accumulator, [key, value]) => {
      accumulator[String(key).toLowerCase()] = String(value).trim();
      return accumulator;
    },
    {}
  );

  if (!normalizedHeaders.location) {
    return null;
  }

  const locationMatch = /^yeelight:\/\/([^:]+):(\d+)$/i.exec(normalizedHeaders.location);
  if (!locationMatch) {
    return null;
  }

  const host = locationMatch[1];
  const portText = locationMatch[2];
  if (!host || !portText) {
    return null;
  }

  const port = Number.parseInt(portText, 10);
  const support = (normalizedHeaders.support || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    id: normalizedHeaders.id || `${host}:${port}`,
    host,
    port,
    model: normalizedHeaders.model || "",
    firmwareVersion: normalizedHeaders.fw_ver || "",
    name: decodeDeviceName(normalizedHeaders.name || ""),
    power: normalizedHeaders.power || "",
    brightness: normalizedHeaders.bright || "",
    colorMode: normalizedHeaders.color_mode || "",
    colorTemperature: normalizedHeaders.ct || "",
    rgb: normalizedHeaders.rgb || "",
    hue: normalizedHeaders.hue || "",
    saturation: normalizedHeaders.sat || "",
    support,
    location: normalizedHeaders.location
  };
}

export function parseDiscoveryResponse(message: Buffer | string): YeelightDiscoveredDevice | null {
  const lines = String(message)
    .split(/\r?\n/)
    .filter(Boolean);
  if (!lines.length) {
    return null;
  }

  const headers: Record<string, string> = {};
  let lastKey: string | null = null;

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      if (lastKey && line.trim()) {
        headers[lastKey] = `${headers[lastKey]} ${line.trim()}`.trim();
      }
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    headers[key] = value;
    lastKey = key;
  }

  return parseDiscoveryHeaders(headers);
}

export function decodeDeviceName(value: string): string {
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
  const normalizedOutput = Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "");
  return normalizedInput === normalizedOutput ? decoded : trimmed;
}

export function buildCommand<TMethod extends YeelightMethod>(
  method: TMethod,
  params: YeelightCommandParamsMap[TMethod],
  id: number
): string {
  return `${JSON.stringify({ id, method, params })}\r\n`;
}

export function splitSocketBuffer(pending: string, chunk: string): { lines: string[]; pending: string } {
  const combined = `${pending}${chunk}`;
  const parts = combined.split("\r\n");
  const nextPending = parts.pop() || "";
  const lines = parts.map((line) => line.trim()).filter(Boolean);
  return { lines, pending: nextPending };
}

export function normalizeStatus<TProperty extends string>(
  properties: readonly TProperty[],
  result: readonly string[]
): YeelightPropertyValues<TProperty> {
  return properties.reduce<YeelightPropertyValues<TProperty>>((accumulator, propertyName, index) => {
    accumulator[propertyName] = result[index] ?? null;
    return accumulator;
  }, {} as YeelightPropertyValues<TProperty>);
}

export function parseNotificationMessage(message: string): YeelightNotification | null {
  const parsed = JSON.parse(message) as Partial<YeelightNotification>;
  if (parsed.method !== "props" || typeof parsed.params !== "object" || !parsed.params) {
    return null;
  }

  const normalizedParams = Object.entries(parsed.params).reduce<YeelightNotification["params"]>(
    (accumulator, [key, value]) => {
      accumulator[key as keyof YeelightNotification["params"]] = String(value);
      return accumulator;
    },
    {}
  );

  return {
    method: "props",
    params: normalizedParams
  };
}

export function buildFlowExpression(tuples: readonly YeelightFlowTuple[]): string {
  if (tuples.length === 0) {
    throw new Error("At least one flow tuple is required.");
  }

  return tuples
    .map((tuple) => {
      validateFlowTuple(tuple);
      return [tuple.duration, tuple.mode, tuple.value, tuple.brightness].join(",");
    })
    .join(",");
}

export function buildProgressFlowTuples(
  rgbValue: number,
  options: YeelightProgressFlowOptions = {}
): YeelightFlowTuple[] {
  validateRgbValue(rgbValue);

  const stepDuration = options.stepDuration ?? 180;
  const pauseDuration = options.pauseDuration ?? 260;
  const minBrightness = options.minBrightness ?? 12;
  const maxBrightness = options.maxBrightness ?? 100;
  const steps = options.steps ?? 5;

  validateDuration(stepDuration, 50);
  validateDuration(pauseDuration, 50);
  validateBrightness(minBrightness);
  validateBrightness(maxBrightness);

  if (!Number.isInteger(steps) || steps < 2) {
    throw new Error("Progress flow steps must be an integer greater than or equal to 2.");
  }

  if (minBrightness >= maxBrightness) {
    throw new Error("Progress flow minBrightness must be lower than maxBrightness.");
  }

  const tuples: YeelightFlowTuple[] = [];
  const brightnessRange = maxBrightness - minBrightness;

  for (let index = 0; index < steps; index += 1) {
    const brightness =
      index === steps - 1
        ? maxBrightness
        : Math.round(minBrightness + (brightnessRange * index) / (steps - 1));

    tuples.push({
      duration: stepDuration,
      mode: 1,
      value: rgbValue,
      brightness
    });
  }

  tuples.push({
    duration: pauseDuration,
    mode: 7,
    value: 0,
    brightness: 0
  });

  return tuples;
}

export function buildProgressFlowExpression(
  rgbValue: number,
  options: YeelightProgressFlowOptions = {}
): string {
  return buildFlowExpression(buildProgressFlowTuples(rgbValue, options));
}

export function serializeScene(scene: YeelightScene): YeelightSceneParams {
  switch (scene.class) {
    case "color":
      validateRgbValue(scene.rgbValue);
      validateBrightness(scene.brightness);
      return ["color", scene.rgbValue, scene.brightness];
    case "hsv":
      validateHue(scene.hue);
      validateSaturation(scene.saturation);
      validateBrightness(scene.brightness);
      return ["hsv", scene.hue, scene.saturation, scene.brightness];
    case "ct":
      validateColorTemperature(scene.ctValue);
      validateBrightness(scene.brightness);
      return ["ct", scene.ctValue, scene.brightness];
    case "cf":
      validateFlowCount(scene.count);
      validateFlowAction(scene.action);
      return [
        "cf",
        scene.count,
        scene.action,
        typeof scene.flowExpression === "string"
          ? scene.flowExpression
          : buildFlowExpression(scene.flowExpression)
      ];
    case "auto_delay_off":
      validateBrightness(scene.brightness);
      validatePositiveInteger(scene.minutes, "Auto-delay minutes");
      return ["auto_delay_off", scene.brightness, scene.minutes];
  }
}

export function validateEffect(effect: string): asserts effect is YeelightEffect {
  if (effect !== "sudden" && effect !== "smooth") {
    throw new Error('Effect must be "sudden" or "smooth".');
  }
}

export function validateDuration(duration: number, minimum = 30): void {
  if (!Number.isInteger(duration) || duration < minimum) {
    throw new Error(`Duration must be an integer greater than or equal to ${minimum} milliseconds.`);
  }
}

export function validateBrightness(brightness: number): void {
  if (!Number.isInteger(brightness) || brightness < 1 || brightness > 100) {
    throw new Error("Brightness must be an integer between 1 and 100.");
  }
}

export function validateColorTemperature(colorTemperature: number): void {
  if (!Number.isInteger(colorTemperature) || colorTemperature < 1700 || colorTemperature > 6500) {
    throw new Error("Color temperature must be an integer between 1700 and 6500 Kelvin.");
  }
}

export function validateRgbValue(rgbValue: number): void {
  if (!Number.isInteger(rgbValue) || rgbValue < 0 || rgbValue > 0xffffff) {
    throw new Error("RGB color must be an integer between 0 and 16777215.");
  }
}

export function validateRgbComponent(component: number, label: string): void {
  if (!Number.isInteger(component) || component < 0 || component > 255) {
    throw new Error(`${label} must be an integer between 0 and 255.`);
  }
}

export function validateHue(hue: number): void {
  if (!Number.isInteger(hue) || hue < 0 || hue > 359) {
    throw new Error("Hue must be an integer between 0 and 359.");
  }
}

export function validateSaturation(saturation: number): void {
  if (!Number.isInteger(saturation) || saturation < 0 || saturation > 100) {
    throw new Error("Saturation must be an integer between 0 and 100.");
  }
}

export function validatePowerMode(mode: number): asserts mode is YeelightPowerMode {
  if (!Number.isInteger(mode) || mode < 0 || mode > 5) {
    throw new Error("Power mode must be an integer between 0 and 5.");
  }
}

export function validatePercentage(percentage: number, label = "Percentage"): void {
  if (!Number.isInteger(percentage) || percentage < -100 || percentage > 100) {
    throw new Error(`${label} must be an integer between -100 and 100.`);
  }
}

export function validateName(name: string): void {
  if (!name.trim()) {
    throw new Error("Device name must not be empty.");
  }
  if (Buffer.byteLength(name, "utf8") > 64) {
    throw new Error("Device name must be 64 bytes or fewer.");
  }
}

export function validateCronType(type: number): void {
  if (type !== 0) {
    throw new Error("Cron type must be 0 according to the Yeelight spec.");
  }
}

export function validateAdjustAction(action: string): asserts action is YeelightAdjustAction {
  if (action !== "increase" && action !== "decrease" && action !== "circle") {
    throw new Error('Adjust action must be "increase", "decrease", or "circle".');
  }
}

export function validateAdjustProperty(property: string): asserts property is YeelightAdjustProperty {
  if (property !== "bright" && property !== "ct" && property !== "color") {
    throw new Error('Adjust property must be "bright", "ct", or "color".');
  }
}

export function validateFlowAction(action: number): asserts action is YeelightFlowAction {
  if (!Number.isInteger(action) || action < 0 || action > 2) {
    throw new Error("Flow action must be 0, 1, or 2.");
  }
}

export function validateFlowCount(count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("Flow count must be an integer greater than or equal to 0.");
  }
}

export function validateFlowTuple(tuple: YeelightFlowTuple): void {
  validateDuration(tuple.duration, 50);
  if (tuple.mode !== 1 && tuple.mode !== 2 && tuple.mode !== 7) {
    throw new Error("Flow tuple mode must be 1 (rgb), 2 (ct), or 7 (sleep).");
  }

  if (tuple.mode === 1) {
    validateRgbValue(tuple.value);
  } else if (tuple.mode === 2) {
    validateColorTemperature(tuple.value);
  }

  if (tuple.mode !== 7 && tuple.brightness !== -1) {
    validateBrightness(tuple.brightness);
  }
}

export function validateMusicStart(host: string, port: number): void {
  if (!host.trim()) {
    throw new Error("Music mode host must not be empty.");
  }
  validatePositiveInteger(port, "Music mode port");
}

export function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

export function formatDeviceLabel(device: Pick<YeelightDiscoveredDevice, "name" | "id" | "host" | "port">): string {
  const title = device.name || device.id || `${device.host}:${device.port}`;
  return `${title} (${device.host}:${device.port})`;
}

export function formatDeviceSummary(device: YeelightDiscoveredDevice): string {
  const support = device.support.length ? device.support.join(", ") : "unknown";
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

export function toRgbValue(red: number, green: number, blue: number): number {
  validateRgbComponent(red, "Red");
  validateRgbComponent(green, "Green");
  validateRgbComponent(blue, "Blue");
  return (red << 16) | (green << 8) | blue;
}

export function formatRgbHex(rgbValue: number): string {
  validateRgbValue(rgbValue);
  return `#${rgbValue.toString(16).padStart(6, "0").toUpperCase()}`;
}

export { LIVE_STATUS_PROPERTIES };
export type { LiveStatusProperty };
