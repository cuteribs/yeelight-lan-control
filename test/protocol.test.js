const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCommand,
  decodeDeviceName,
  normalizeStatus,
  parseDiscoveryResponse,
  splitSocketBuffer
} = require("../src/yeelight/protocol");

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
  assert.ok(device);
  assert.equal(device.id, "0x0000000012345678");
  assert.equal(device.host, "192.168.1.5");
  assert.equal(device.port, 55443);
  assert.deepEqual(device.support, ["get_prop", "set_power", "set_bright", "set_ct_abx"]);
  assert.equal(device.name, "Bedroom");
});

test("splitSocketBuffer preserves incomplete trailing JSON", () => {
  const first = splitSocketBuffer("", '{"id":1,"result":["ok"]}\r\n{"id":2');
  assert.deepEqual(first.lines, ['{"id":1,"result":["ok"]}']);
  assert.equal(first.pending, '{"id":2');

  const second = splitSocketBuffer(first.pending, ',"result":["ok"]}\r\n');
  assert.deepEqual(second.lines, ['{"id":2,"result":["ok"]}']);
  assert.equal(second.pending, "");
});

test("buildCommand appends the Yeelight line delimiter", () => {
  assert.equal(
    buildCommand("set_power", ["on", "sudden", 30], 7),
    '{"id":7,"method":"set_power","params":["on","sudden",30]}\r\n'
  );
});

test("normalizeStatus maps get_prop results to property names", () => {
  assert.deepEqual(
    normalizeStatus(["power", "bright", "ct"], ["on", "50", "3500"]),
    { power: "on", bright: "50", ct: "3500" }
  );
});

test("decodeDeviceName leaves plain text unchanged", () => {
  assert.equal(decodeDeviceName("Kitchen"), "Kitchen");
});
