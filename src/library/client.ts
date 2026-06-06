import net from "node:net";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_CONTROL_PORT,
  DEFAULT_DURATION_MS,
  DEFAULT_EFFECT,
  LIVE_STATUS_PROPERTIES,
  buildFlowExpression,
  normalizeStatus,
  serializeScene,
  splitSocketBuffer,
  validateAdjustAction,
  validateAdjustProperty,
  validateBrightness,
  validateColorTemperature,
  validateCronType,
  validateDuration,
  validateEffect,
  validateFlowAction,
  validateFlowCount,
  validateHue,
  validateMusicStart,
  validateName,
  validatePercentage,
  validatePositiveInteger,
  validatePowerMode,
  validateRgbValue,
  validateSaturation
} from "./protocol";
import { discoverDevices } from "./discovery";
import type {
  LiveStatusProperty,
  YeelightAdjustAction,
  YeelightAdjustProperty,
  YeelightCommandOptions,
  YeelightCommandParamsMap,
  YeelightCommandResultMap,
  YeelightControlConnectionOptions,
  YeelightCronEntry,
  YeelightCronType,
  YeelightDiscoveredDevice,
  YeelightEffect,
  YeelightFlowAction,
  YeelightFlowTuple,
  YeelightMethod,
  YeelightPower,
  YeelightPowerMode,
  YeelightPropertyValues,
  YeelightRawCommandResponse,
  YeelightScene,
  YeelightTransitionOptions
} from "./types";

export class YeelightClient {
  private static nextRequestId = 1;

  readonly host: string;
  readonly port: number;
  readonly support: readonly string[];
  readonly timeoutMs: number;

  constructor(options: YeelightControlConnectionOptions) {
    this.host = options.host;
    this.port = options.port ?? DEFAULT_CONTROL_PORT;
    this.support = options.support ?? [];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  }

  static fromDevice(device: YeelightDiscoveredDevice, options: Omit<YeelightControlConnectionOptions, "host" | "port" | "support"> = {}): YeelightClient {
    return new YeelightClient({
      host: device.host,
      port: device.port,
      support: device.support,
      timeoutMs: options.timeoutMs
    });
  }

  static async discover(options: { timeoutMs?: number } = {}): Promise<YeelightDiscoveredDevice[]> {
    return discoverDevices(options);
  }

  async sendCommand<TMethod extends YeelightMethod>(
    method: TMethod,
    params: YeelightCommandParamsMap[TMethod],
    options: YeelightCommandOptions = {}
  ): Promise<YeelightCommandResultMap[TMethod]> {
    this.ensureSupported(method);
    const response = await this.sendRequest(method, params, options);

    if ("error" in response) {
      const code = response.error.code ?? "unknown";
      const message = response.error.message ?? "Unknown bulb error";
      throw new Error(`Yeelight command failed (${code}): ${message}`);
    }

    return response.result as YeelightCommandResultMap[TMethod];
  }

  async sendRawCommand(method: string, params: unknown[], options?: YeelightCommandOptions): Promise<YeelightRawCommandResponse> {
    return this.sendRequest(method, params, options);
  }

  private async sendRequest(method: string, params: readonly unknown[], options: YeelightCommandOptions = {}): Promise<YeelightRawCommandResponse> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const requestId = YeelightClient.nextRequestId++;

    return new Promise<YeelightRawCommandResponse>((resolve, reject) => {
      const socket = net.createConnection({
        host: this.host,
        port: this.port
      });
      let pending = "";
      let settled = false;

      const finish = (error?: Error, value?: YeelightRawCommandResponse): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        socket.destroy();

        if (error) {
          reject(error);
          return;
        }

        resolve(value as YeelightRawCommandResponse);
      };

      socket.setEncoding("utf8");

      socket.once("connect", () => {
        socket.write(`${JSON.stringify({ id: requestId, method, params })}\r\n`);
      });

      socket.on("data", (chunk: string) => {
        const processed = splitSocketBuffer(pending, chunk);
        pending = processed.pending;

        for (const line of processed.lines) {
          let payload: { id?: number; result?: unknown; error?: { code?: number; message?: string }; method?: string };
          try {
            payload = JSON.parse(line) as typeof payload;
          } catch {
            finish(new Error(`The bulb returned invalid JSON: ${line}`));
            return;
          }

          if (payload.method === "props") {
            continue;
          }

          if (payload.id !== requestId) {
            continue;
          }

          if (payload.error) {
            finish(undefined, {
              error: {
                code: payload.error.code ?? -1,
                message: payload.error.message ?? "Unknown bulb error"
              },
              id: requestId
            });
            return;
          }

          finish(undefined, {
            id: requestId,
            result: payload.result
          });
          return;
        }
      });

      socket.once("end", () => {
        if (!settled) {
          finish(new Error("The bulb closed the TCP connection before sending a response."));
        }
      });

      socket.once("error", (error) => {
        finish(new Error(`Unable to reach ${this.host}:${this.port}: ${error.message}`));
      });

      const timer = setTimeout(() => {
        finish(new Error(`Timed out waiting for a response from ${this.host}:${this.port} after ${timeoutMs}ms.`));
      }, timeoutMs);
    });
  }

  async getProperties<TProperty extends string>(properties: readonly [TProperty, ...TProperty[]], options?: YeelightCommandOptions): Promise<string[]> {
    return this.sendCommand("get_prop", properties as readonly [string, ...string[]], options);
  }

  async getStatus(options?: YeelightCommandOptions): Promise<YeelightPropertyValues<LiveStatusProperty>> {
    const result = await this.getProperties(LIVE_STATUS_PROPERTIES, options);
    return normalizeStatus(LIVE_STATUS_PROPERTIES, result);
  }

  async setPower(
    power: YeelightPower,
    options: YeelightTransitionOptions & { mode?: YeelightPowerMode } = {}
  ): Promise<YeelightCommandResultMap["set_power"]> {
    const params = this.withPowerTransitionParams(power, options, options.mode);
    if (options.mode !== undefined) {
      validatePowerMode(options.mode);
    }
    return this.sendCommand("set_power", params, options);
  }

  async toggle(options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["toggle"]> {
    return this.sendCommand("toggle", [], options);
  }

  async setDefault(options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["set_default"]> {
    return this.sendCommand("set_default", [], options);
  }

  async setBrightness(brightness: number, options: YeelightTransitionOptions = {}): Promise<YeelightCommandResultMap["set_bright"]> {
    validateBrightness(brightness);
    return this.sendCommand("set_bright", this.withNumericTransitionParams(brightness, options), options);
  }

  async setColorTemperature(
    colorTemperature: number,
    options: YeelightTransitionOptions = {}
  ): Promise<YeelightCommandResultMap["set_ct_abx"]> {
    validateColorTemperature(colorTemperature);
    return this.sendCommand("set_ct_abx", this.withNumericTransitionParams(colorTemperature, options), options);
  }

  async setRgb(rgbValue: number, options: YeelightTransitionOptions = {}): Promise<YeelightCommandResultMap["set_rgb"]> {
    validateRgbValue(rgbValue);
    return this.sendCommand("set_rgb", this.withNumericTransitionParams(rgbValue, options), options);
  }

  async setHsv(
    hue: number,
    saturation: number,
    options: YeelightTransitionOptions = {}
  ): Promise<YeelightCommandResultMap["set_hsv"]> {
    validateHue(hue);
    validateSaturation(saturation);
    const effect = options.effect ?? DEFAULT_EFFECT;
    const duration = options.duration ?? DEFAULT_DURATION_MS;
    validateEffect(effect);
    validateDuration(duration);
    return this.sendCommand("set_hsv", [hue, saturation, effect, duration], options);
  }

  async startColorFlow(
    count: number,
    action: YeelightFlowAction,
    flowExpression: string | readonly YeelightFlowTuple[],
    options?: YeelightCommandOptions
  ): Promise<YeelightCommandResultMap["start_cf"]> {
    validateFlowCount(count);
    validateFlowAction(action);
    const serialized = typeof flowExpression === "string" ? flowExpression : buildFlowExpression(flowExpression);
    return this.sendCommand("start_cf", [count, action, serialized], options);
  }

  async stopColorFlow(options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["stop_cf"]> {
    return this.sendCommand("stop_cf", [], options);
  }

  async setScene(scene: YeelightScene, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["set_scene"]> {
    return this.sendCommand("set_scene", serializeScene(scene), options);
  }

  async cronAdd(type: YeelightCronType, minutes: number, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["cron_add"]> {
    validateCronType(type);
    validatePositiveInteger(minutes, "Cron minutes");
    return this.sendCommand("cron_add", [type, minutes], options);
  }

  async cronGet(type: YeelightCronType, options?: YeelightCommandOptions): Promise<YeelightCronEntry[]> {
    validateCronType(type);
    return this.sendCommand("cron_get", [type], options);
  }

  async cronDelete(type: YeelightCronType, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["cron_del"]> {
    validateCronType(type);
    return this.sendCommand("cron_del", [type], options);
  }

  async setAdjust(
    action: YeelightAdjustAction,
    property: YeelightAdjustProperty,
    options?: YeelightCommandOptions
  ): Promise<YeelightCommandResultMap["set_adjust"]> {
    validateAdjustAction(action);
    validateAdjustProperty(property);
    if (property === "color" && action !== "circle") {
      throw new Error('When adjusting "color", action must be "circle" according to the Yeelight spec.');
    }
    return this.sendCommand("set_adjust", [action, property], options);
  }

  async setMusicOff(options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["set_music"]> {
    return this.sendCommand("set_music", [0], options);
  }

  async setMusicOn(host: string, port: number, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["set_music"]> {
    validateMusicStart(host, port);
    return this.sendCommand("set_music", [1, host, port], options);
  }

  async setName(name: string, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["set_name"]> {
    validateName(name);
    return this.sendCommand("set_name", [name], options);
  }

  async bgSetRgb(rgbValue: number, options: YeelightTransitionOptions = {}): Promise<YeelightCommandResultMap["bg_set_rgb"]> {
    validateRgbValue(rgbValue);
    return this.sendCommand("bg_set_rgb", this.withNumericTransitionParams(rgbValue, options), options);
  }

  async bgSetHsv(
    hue: number,
    saturation: number,
    options: YeelightTransitionOptions = {}
  ): Promise<YeelightCommandResultMap["bg_set_hsv"]> {
    validateHue(hue);
    validateSaturation(saturation);
    const effect = options.effect ?? DEFAULT_EFFECT;
    const duration = options.duration ?? DEFAULT_DURATION_MS;
    validateEffect(effect);
    validateDuration(duration);
    return this.sendCommand("bg_set_hsv", [hue, saturation, effect, duration], options);
  }

  async bgSetColorTemperature(
    colorTemperature: number,
    options: YeelightTransitionOptions = {}
  ): Promise<YeelightCommandResultMap["bg_set_ct_abx"]> {
    validateColorTemperature(colorTemperature);
    return this.sendCommand("bg_set_ct_abx", this.withNumericTransitionParams(colorTemperature, options), options);
  }

  async bgStartColorFlow(
    count: number,
    action: YeelightFlowAction,
    flowExpression: string | readonly YeelightFlowTuple[],
    options?: YeelightCommandOptions
  ): Promise<YeelightCommandResultMap["bg_start_cf"]> {
    validateFlowCount(count);
    validateFlowAction(action);
    const serialized = typeof flowExpression === "string" ? flowExpression : buildFlowExpression(flowExpression);
    return this.sendCommand("bg_start_cf", [count, action, serialized], options);
  }

  async bgStopColorFlow(options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["bg_stop_cf"]> {
    return this.sendCommand("bg_stop_cf", [], options);
  }

  async bgSetScene(scene: YeelightScene, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["bg_set_scene"]> {
    return this.sendCommand("bg_set_scene", serializeScene(scene), options);
  }

  async bgSetDefault(options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["bg_set_default"]> {
    return this.sendCommand("bg_set_default", [], options);
  }

  async bgSetPower(
    power: YeelightPower,
    options: YeelightTransitionOptions & { mode?: YeelightPowerMode } = {}
  ): Promise<YeelightCommandResultMap["bg_set_power"]> {
    const params = this.withPowerTransitionParams(power, options, options.mode);
    if (options.mode !== undefined) {
      validatePowerMode(options.mode);
    }
    return this.sendCommand("bg_set_power", params, options);
  }

  async bgSetBrightness(brightness: number, options: YeelightTransitionOptions = {}): Promise<YeelightCommandResultMap["bg_set_bright"]> {
    validateBrightness(brightness);
    return this.sendCommand("bg_set_bright", this.withNumericTransitionParams(brightness, options), options);
  }

  async bgSetAdjust(
    action: YeelightAdjustAction,
    property: YeelightAdjustProperty,
    options?: YeelightCommandOptions
  ): Promise<YeelightCommandResultMap["bg_set_adjust"]> {
    validateAdjustAction(action);
    validateAdjustProperty(property);
    if (property === "color" && action !== "circle") {
      throw new Error('When adjusting "color", action must be "circle" according to the Yeelight spec.');
    }
    return this.sendCommand("bg_set_adjust", [action, property], options);
  }

  async bgToggle(options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["bg_toggle"]> {
    return this.sendCommand("bg_toggle", [], options);
  }

  async devToggle(options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["dev_toggle"]> {
    return this.sendCommand("dev_toggle", [], options);
  }

  async adjustBrightness(percentage: number, duration: number, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["adjust_bright"]> {
    validatePercentage(percentage);
    validateDuration(duration);
    return this.sendCommand("adjust_bright", [percentage, duration], options);
  }

  async adjustColorTemperature(percentage: number, duration: number, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["adjust_ct"]> {
    validatePercentage(percentage);
    validateDuration(duration);
    return this.sendCommand("adjust_ct", [percentage, duration], options);
  }

  async adjustColor(percentage: number, duration: number, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["adjust_color"]> {
    validatePercentage(percentage);
    validateDuration(duration);
    return this.sendCommand("adjust_color", [percentage, duration], options);
  }

  async bgAdjustBrightness(percentage: number, duration: number, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["bg_adjust_bright"]> {
    validatePercentage(percentage);
    validateDuration(duration);
    return this.sendCommand("bg_adjust_bright", [percentage, duration], options);
  }

  async bgAdjustColorTemperature(percentage: number, duration: number, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["bg_adjust_ct"]> {
    validatePercentage(percentage);
    validateDuration(duration);
    return this.sendCommand("bg_adjust_ct", [percentage, duration], options);
  }

  async bgAdjustColor(percentage: number, duration: number, options?: YeelightCommandOptions): Promise<YeelightCommandResultMap["bg_adjust_color"]> {
    validatePercentage(percentage);
    validateDuration(duration);
    return this.sendCommand("bg_adjust_color", [percentage, duration], options);
  }

  async udpSessionNew(params: unknown[], options?: YeelightCommandOptions): Promise<unknown> {
    return this.sendCommand("udp_sess_new", params, options);
  }

  async udpSessionKeepAlive(params: unknown[], options?: YeelightCommandOptions): Promise<unknown> {
    return this.sendCommand("udp_sess_keep_alive", params, options);
  }

  async udpChromaSessionNew(params: unknown[], options?: YeelightCommandOptions): Promise<unknown> {
    return this.sendCommand("udp_chroma_sess_new", params, options);
  }

  private ensureSupported(method: string): void {
    if (this.support.length === 0) {
      return;
    }

    if (!this.support.includes(method)) {
      throw new Error(`The bulb does not advertise support for ${method}. Supported methods: ${this.support.join(", ")}`);
    }
  }

  private withNumericTransitionParams(
    firstValue: number,
    options: YeelightTransitionOptions
  ): [number, YeelightEffect, number] {
    const effect = options.effect ?? DEFAULT_EFFECT;
    const duration = options.duration ?? DEFAULT_DURATION_MS;
    validateEffect(effect);
    validateDuration(duration);
    return [firstValue, effect, duration];
  }

  private withPowerTransitionParams(
    power: YeelightPower,
    options: YeelightTransitionOptions,
    mode?: YeelightPowerMode
  ): YeelightCommandParamsMap["set_power"] {
    const effect = options.effect ?? DEFAULT_EFFECT;
    const duration = options.duration ?? DEFAULT_DURATION_MS;
    validateEffect(effect);
    validateDuration(duration);
    return mode === undefined ? [power, effect, duration] : [power, effect, duration, mode];
  }
}
