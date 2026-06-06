import { expect, test } from "bun:test";
import { parseExecParamsValue, parseExecToken, parseExecTokens, parseHostValue } from "../src/cli-support";

test("parseExecToken keeps plain strings as strings", () => {
  expect(parseExecToken("set_power")).toBe("set_power");
  expect(parseExecToken("on")).toBe("on");
});

test("parseExecToken parses JSON-like literals", () => {
  expect(parseExecToken("500")).toBe(500);
  expect(parseExecToken("-20")).toBe(-20);
  expect(parseExecToken("true")).toBe(true);
  expect(parseExecToken('{"level":1}')).toEqual({ level: 1 });
  expect(parseExecToken('["power","bright"]')).toEqual(["power", "bright"]);
});

test("parseExecTokens parses mixed positional params", () => {
  expect(parseExecTokens(["on", "smooth", "500"])).toEqual(["on", "smooth", 500]);
});

test("parseExecParamsValue requires a JSON array", () => {
  expect(parseExecParamsValue('["color",65280,70]')).toEqual(["color", 65280, 70]);
  expect(() => parseExecParamsValue('{"method":"toggle"}')).toThrow("Exec params must be a JSON array.");
});

test("parseHostValue accepts host with optional port", () => {
  expect(parseHostValue("192.168.1.23", 55443)).toEqual({ host: "192.168.1.23", port: 55443 });
  expect(parseHostValue("192.168.1.23:12345", 55443)).toEqual({ host: "192.168.1.23", port: 12345 });
});

test("parseHostValue rejects invalid host forms", () => {
  expect(() => parseHostValue("192.168.1.23:abc", 55443)).toThrow('Host must be in the form "<ip>" or "<ip>:<port>".');
  expect(() => parseHostValue("192.168.1.23:70000", 55443)).toThrow("Host port must be an integer between 1 and 65535.");
});
