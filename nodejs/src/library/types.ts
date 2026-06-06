export const YEELIGHT_METHODS = [
  "get_prop",
  "set_ct_abx",
  "set_rgb",
  "set_hsv",
  "set_bright",
  "set_power",
  "toggle",
  "set_default",
  "start_cf",
  "stop_cf",
  "set_scene",
  "cron_add",
  "cron_get",
  "cron_del",
  "set_adjust",
  "set_music",
  "set_name",
  "bg_set_rgb",
  "bg_set_hsv",
  "bg_set_ct_abx",
  "bg_start_cf",
  "bg_stop_cf",
  "bg_set_scene",
  "bg_set_default",
  "bg_set_power",
  "bg_set_bright",
  "bg_set_adjust",
  "bg_toggle",
  "dev_toggle",
  "adjust_bright",
  "adjust_ct",
  "adjust_color",
  "bg_adjust_bright",
  "bg_adjust_ct",
  "bg_adjust_color",
  "udp_sess_new",
  "udp_sess_keep_alive",
  "udp_chroma_sess_new"
] as const;

export type YeelightMethod = (typeof YEELIGHT_METHODS)[number];
export type YeelightEffect = "sudden" | "smooth";
export type YeelightPower = "on" | "off";
export type YeelightPowerMode = 0 | 1 | 2 | 3 | 4 | 5;
export type YeelightCronType = 0;
export type YeelightFlowAction = 0 | 1 | 2;
export type YeelightFlowMode = 1 | 2 | 7;
export type YeelightAdjustAction = "increase" | "decrease" | "circle";
export type YeelightAdjustProperty = "bright" | "ct" | "color";
export type YeelightModel = "mono" | "color" | "stripe" | "ceiling" | "bslamp" | string;

export const YEELIGHT_PROPERTY_NAMES = [
  "power",
  "bright",
  "ct",
  "rgb",
  "hue",
  "sat",
  "color_mode",
  "flowing",
  "delayoff",
  "flow_params",
  "music_on",
  "name",
  "bg_power",
  "bg_flowing",
  "bg_flow_params",
  "bg_ct",
  "bg_lmode",
  "bg_bright",
  "bg_rgb",
  "bg_hue",
  "bg_sat",
  "nl_br",
  "active_mode"
] as const;

export type YeelightPropertyName = (typeof YEELIGHT_PROPERTY_NAMES)[number];

export const LIVE_STATUS_PROPERTIES = [
  "power",
  "bright",
  "ct",
  "color_mode",
  "rgb",
  "hue",
  "sat",
  "name"
] as const;

export type LiveStatusProperty = (typeof LIVE_STATUS_PROPERTIES)[number];

export interface YeelightDiscoveryOptions {
  timeoutMs?: number;
}

export interface YeelightCommandOptions {
  timeoutMs?: number;
}

export interface YeelightTransitionOptions extends YeelightCommandOptions {
  duration?: number;
  effect?: YeelightEffect;
}

export interface YeelightProgressFlowOptions {
  maxBrightness?: number;
  minBrightness?: number;
  pauseDuration?: number;
  stepDuration?: number;
  steps?: number;
}

export interface YeelightProgressStartOptions extends YeelightCommandOptions, YeelightProgressFlowOptions {
  action?: YeelightFlowAction;
  count?: number;
}

export interface YeelightDiscoveredDevice {
  id: string;
  host: string;
  port: number;
  model: YeelightModel;
  firmwareVersion: string;
  name: string;
  power: string;
  brightness: string;
  colorMode: string;
  colorTemperature: string;
  rgb: string;
  hue: string;
  saturation: string;
  support: string[];
  location: string;
}

export interface YeelightControlConnectionOptions {
  host: string;
  port?: number;
  support?: readonly string[];
  timeoutMs?: number;
}

export type YeelightPropertyValues<TProperty extends string = string> = Record<TProperty, string | null>;

export interface YeelightNotification {
  method: "props";
  params: Partial<Record<YeelightPropertyName, string>>;
}

export interface YeelightFlowTuple {
  duration: number;
  mode: YeelightFlowMode;
  value: number;
  brightness: number;
}

export type YeelightScene =
  | { class: "color"; rgbValue: number; brightness: number }
  | { class: "hsv"; hue: number; saturation: number; brightness: number }
  | { class: "ct"; ctValue: number; brightness: number }
  | { class: "cf"; count: number; action: YeelightFlowAction; flowExpression: string | readonly YeelightFlowTuple[] }
  | { class: "auto_delay_off"; brightness: number; minutes: number };

export type YeelightSceneParams =
  | ["color", number, number]
  | ["hsv", number, number, number]
  | ["ct", number, number]
  | ["cf", number, number, string]
  | ["auto_delay_off", number, number];

export interface YeelightCronEntry {
  type: number;
  delay: number;
  mix: number;
}

export interface YeelightError {
  code: number;
  message: string;
}

export type YeelightOkResult = ["ok"];
export type YeelightRawCommandResponse = { id: number; result: unknown } | { id: number; error: YeelightError };

export interface YeelightCommandParamsMap {
  get_prop: readonly [string, ...string[]];
  set_ct_abx: [number, YeelightEffect, number];
  set_rgb: [number, YeelightEffect, number];
  set_hsv: [number, number, YeelightEffect, number];
  set_bright: [number, YeelightEffect, number];
  set_power: [YeelightPower, YeelightEffect, number] | [YeelightPower, YeelightEffect, number, YeelightPowerMode];
  toggle: [];
  set_default: [];
  start_cf: [number, YeelightFlowAction, string];
  stop_cf: [];
  set_scene: YeelightSceneParams;
  cron_add: [YeelightCronType, number];
  cron_get: [YeelightCronType];
  cron_del: [YeelightCronType];
  set_adjust: [YeelightAdjustAction, YeelightAdjustProperty];
  set_music: [0] | [1, string, number];
  set_name: [string];
  bg_set_rgb: [number, YeelightEffect, number];
  bg_set_hsv: [number, number, YeelightEffect, number];
  bg_set_ct_abx: [number, YeelightEffect, number];
  bg_start_cf: [number, YeelightFlowAction, string];
  bg_stop_cf: [];
  bg_set_scene: YeelightSceneParams;
  bg_set_default: [];
  bg_set_power: [YeelightPower, YeelightEffect, number] | [YeelightPower, YeelightEffect, number, YeelightPowerMode];
  bg_set_bright: [number, YeelightEffect, number];
  bg_set_adjust: [YeelightAdjustAction, YeelightAdjustProperty];
  bg_toggle: [];
  dev_toggle: [];
  adjust_bright: [number, number];
  adjust_ct: [number, number];
  adjust_color: [number, number];
  bg_adjust_bright: [number, number];
  bg_adjust_ct: [number, number];
  bg_adjust_color: [number, number];
  udp_sess_new: unknown[];
  udp_sess_keep_alive: unknown[];
  udp_chroma_sess_new: unknown[];
}

export interface YeelightCommandResultMap {
  get_prop: string[];
  set_ct_abx: YeelightOkResult;
  set_rgb: YeelightOkResult;
  set_hsv: YeelightOkResult;
  set_bright: YeelightOkResult;
  set_power: YeelightOkResult;
  toggle: YeelightOkResult;
  set_default: YeelightOkResult;
  start_cf: YeelightOkResult;
  stop_cf: YeelightOkResult;
  set_scene: YeelightOkResult;
  cron_add: YeelightOkResult;
  cron_get: YeelightCronEntry[];
  cron_del: YeelightOkResult;
  set_adjust: YeelightOkResult;
  set_music: YeelightOkResult;
  set_name: YeelightOkResult;
  bg_set_rgb: YeelightOkResult;
  bg_set_hsv: YeelightOkResult;
  bg_set_ct_abx: YeelightOkResult;
  bg_start_cf: YeelightOkResult;
  bg_stop_cf: YeelightOkResult;
  bg_set_scene: YeelightOkResult;
  bg_set_default: YeelightOkResult;
  bg_set_power: YeelightOkResult;
  bg_set_bright: YeelightOkResult;
  bg_set_adjust: YeelightOkResult;
  bg_toggle: YeelightOkResult;
  dev_toggle: YeelightOkResult;
  adjust_bright: YeelightOkResult;
  adjust_ct: YeelightOkResult;
  adjust_color: YeelightOkResult;
  bg_adjust_bright: YeelightOkResult;
  bg_adjust_ct: YeelightOkResult;
  bg_adjust_color: YeelightOkResult;
  udp_sess_new: unknown;
  udp_sess_keep_alive: unknown;
  udp_chroma_sess_new: unknown;
}

export type YeelightCommandRequest<TMethod extends YeelightMethod> = {
  id: number;
  method: TMethod;
  params: YeelightCommandParamsMap[TMethod];
};

export type YeelightCommandResponse<TMethod extends YeelightMethod> =
  | { id: number; result: YeelightCommandResultMap[TMethod] }
  | { id: number; error: YeelightError };
