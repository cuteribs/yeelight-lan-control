import { expect, test } from "bun:test";
import {
  buildCommand,
  decodeDeviceName,
  normalizeStatus,
  parseDiscoveryHeaders,
  parseDiscoveryResponse,
  splitSocketBuffer,
  validateRgbComponent,
  validateRgbValue
} from "../src/library/protocol";

test("parseDiscoveryResponse extracts location and supported methods", () => {
  const raw = Buffer.from(
    [
      "HTTP/1.1 200 OK",
      "id: 0x0000000012345678",
      "Location: yeelight://192.168.1.5:55443",
      "model: color",
      "support: get_prop set_power set_bright set_ct_abx",
      "name: QmVkcm9vbQ==",
      "power: on",
      "bright: 75",
      "",
      ""
    ].join("\r\n"),
    "utf8"
  );

  const device = parseDiscoveryResponse(raw);
  expect(device).not.toBeNull();
  expect(device?.id).toBe("0x0000000012345678");
  expect(device?.host).toBe("192.168.1.5");
  expect(device?.port).toBe(55443);
  expect(device?.support).toEqual(["get_prop", "set_power", "set_bright", "set_ct_abx"]);
  expect(device?.name).toBe("Bedroom");
});

test("parseDiscoveryResponse accepts Yeelight NOTIFY packets", () => {
  const raw = Buffer.from(
    [
      "NOTIFY * HTTP/1.1",
      "Host: 239.255.255.250:1982",
      "Location: yeelight://192.168.1.9:55443",
      "id: 0x0000000099999999",
      "model: mono",
      "support: get_prop set_power",
      "",
      ""
    ].join("\r\n"),
    "utf8"
  );

  const device = parseDiscoveryResponse(raw);
  expect(device).not.toBeNull();
  expect(device?.host).toBe("192.168.1.9");
  expect(device?.port).toBe(55443);
  expect(device?.id).toBe("0x0000000099999999");
});

test("parseDiscoveryHeaders accepts uppercase SSDP header objects", () => {
  const device = parseDiscoveryHeaders({
    ID: "0x00000000abcdef01",
    LOCATION: "yeelight://192.168.1.23:55443",
    MODEL: "mono",
    SUPPORT: "get_prop set_power set_bright",
    NAME: "S2l0Y2hlbg==",
    POWER: "off",
    BRIGHT: "20"
  });

  expect(device).not.toBeNull();
  expect(device?.id).toBe("0x00000000abcdef01");
  expect(device?.host).toBe("192.168.1.23");
  expect(device?.port).toBe(55443);
  expect(device?.support).toEqual(["get_prop", "set_power", "set_bright"]);
  expect(device?.name).toBe("Kitchen");
});

test("parseDiscoveryResponse joins wrapped support headers", () => {
  const raw = Buffer.from(
    [
      "HTTP/1.1 200 OK",
      "Location: yeelight://192.168.6.193:55443",
      "id: 0x0000000019f583f7",
      "support: get_prop set_power",
      " set_ct_abx adjust_ct set_rgb",
      "",
      ""
    ].join("\r\n"),
    "utf8"
  );

  const device = parseDiscoveryResponse(raw);
  expect(device).not.toBeNull();
  expect(device?.support).toEqual(["get_prop", "set_power", "set_ct_abx", "adjust_ct", "set_rgb"]);
});

test("splitSocketBuffer preserves incomplete trailing JSON", () => {
  const first = splitSocketBuffer("", '{"id":1,"result":["ok"]}\r\n{"id":2');
  expect(first.lines).toEqual(['{"id":1,"result":["ok"]}']);
  expect(first.pending).toBe('{"id":2');

  const second = splitSocketBuffer(first.pending, ',"result":["ok"]}\r\n');
  expect(second.lines).toEqual(['{"id":2,"result":["ok"]}']);
  expect(second.pending).toBe("");
});

test("buildCommand appends the Yeelight line delimiter", () => {
  expect(buildCommand("set_power", ["on", "sudden", 30], 7)).toBe(
    '{"id":7,"method":"set_power","params":["on","sudden",30]}\r\n'
  );
});

test("normalizeStatus maps get_prop results to property names", () => {
  expect(normalizeStatus(["power", "bright", "ct"], ["on", "50", "3500"])).toEqual({
    power: "on",
    bright: "50",
    ct: "3500"
  });
});

test("decodeDeviceName leaves plain text unchanged", () => {
  expect(decodeDeviceName("Kitchen")).toBe("Kitchen");
});

test("validateRgbValue accepts packed RGB integers", () => {
  expect(() => validateRgbValue(0xff0000)).not.toThrow();
});

test("validateRgbValue rejects values outside 24-bit RGB range", () => {
  expect(() => validateRgbValue(0x1000000)).toThrow();
});

test("validateRgbComponent enforces 0-255 component range", () => {
  expect(() => validateRgbComponent(255, "Red")).not.toThrow();
  expect(() => validateRgbComponent(256, "Red")).toThrow();
});
