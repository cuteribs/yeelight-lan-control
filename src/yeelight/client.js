const net = require("node:net");
const {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_DURATION_MS,
  DEFAULT_EFFECT,
  LIVE_STATUS_PROPERTIES,
  buildCommand,
  normalizeStatus,
  splitSocketBuffer,
  validateBrightness,
  validateColorTemperature,
  validateDuration,
  validateEffect
} = require("./protocol");

let nextRequestId = 1;

function ensureSupported(device, method) {
  if (!Array.isArray(device.support) || device.support.length === 0) {
    return;
  }

  if (!device.support.includes(method)) {
    throw new Error(
      `The bulb does not advertise support for ${method}. Supported methods: ${device.support.join(", ")}`
    );
  }
}

function sendCommand(device, method, params, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const requestId = nextRequestId++;

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: device.host,
      port: device.port
    });
    let pending = "";
    let settled = false;
    let timer = null;

    function finish(error, value) {
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

      resolve(value);
    }

    socket.setEncoding("utf8");

    socket.once("connect", () => {
      socket.write(buildCommand(method, params, requestId));
    });

    socket.on("data", (chunk) => {
      const processed = splitSocketBuffer(pending, chunk);
      pending = processed.pending;

      for (const line of processed.lines) {
        let payload;
        try {
          payload = JSON.parse(line);
        } catch (error) {
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
          const code = payload.error.code ?? "unknown";
          const message = payload.error.message ?? "Unknown bulb error";
          finish(new Error(`Yeelight command failed (${code}): ${message}`));
          return;
        }

        finish(null, payload.result);
        return;
      }
    });

    socket.once("end", () => {
      if (!settled) {
        finish(new Error("The bulb closed the TCP connection before sending a response."));
      }
    });

    socket.once("error", (error) => {
      finish(new Error(`Unable to reach ${device.host}:${device.port}: ${error.message}`));
    });

    timer = setTimeout(() => {
      finish(
        new Error(
          `Timed out waiting for a response from ${device.host}:${device.port} after ${timeoutMs}ms.`
        )
      );
    }, timeoutMs);
  });
}

async function getStatus(device, options = {}) {
  const result = await sendCommand(device, "get_prop", LIVE_STATUS_PROPERTIES, options);
  return normalizeStatus(LIVE_STATUS_PROPERTIES, result);
}

async function setPower(device, state, options = {}) {
  ensureSupported(device, "set_power");
  validateEffect(options.effect ?? DEFAULT_EFFECT);
  validateDuration(options.duration ?? DEFAULT_DURATION_MS);

  return sendCommand(
    device,
    "set_power",
    [state, options.effect ?? DEFAULT_EFFECT, options.duration ?? DEFAULT_DURATION_MS],
    options
  );
}

async function setBrightness(device, brightness, options = {}) {
  ensureSupported(device, "set_bright");
  validateBrightness(brightness);
  validateEffect(options.effect ?? DEFAULT_EFFECT);
  validateDuration(options.duration ?? DEFAULT_DURATION_MS);

  return sendCommand(
    device,
    "set_bright",
    [brightness, options.effect ?? DEFAULT_EFFECT, options.duration ?? DEFAULT_DURATION_MS],
    options
  );
}

async function setColorTemperature(device, colorTemperature, options = {}) {
  ensureSupported(device, "set_ct_abx");
  validateColorTemperature(colorTemperature);
  validateEffect(options.effect ?? DEFAULT_EFFECT);
  validateDuration(options.duration ?? DEFAULT_DURATION_MS);

  return sendCommand(
    device,
    "set_ct_abx",
    [colorTemperature, options.effect ?? DEFAULT_EFFECT, options.duration ?? DEFAULT_DURATION_MS],
    options
  );
}

module.exports = {
  getStatus,
  sendCommand,
  setBrightness,
  setColorTemperature,
  setPower
};
