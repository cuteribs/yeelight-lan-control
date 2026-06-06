const dgram = require("node:dgram");
const {
  DISCOVERY_ADDRESS,
  DISCOVERY_PORT,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  buildDiscoveryRequest,
  parseDiscoveryResponse
} = require("./protocol");

function discoverDevices(options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const devices = new Map();
    const socket = dgram.createSocket("udp4");
    let settled = false;
    let timer = null;

    function finish(error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.close();

      if (error) {
        reject(error);
        return;
      }

      resolve(Array.from(devices.values()));
    }

    socket.on("message", (message) => {
      const device = parseDiscoveryResponse(message);
      if (!device) {
        return;
      }

      devices.set(device.id, device);
    });

    socket.once("error", (error) => {
      finish(new Error(`Yeelight discovery failed: ${error.message}`));
    });

    socket.bind(0, () => {
      socket.send(
        buildDiscoveryRequest(),
        DISCOVERY_PORT,
        DISCOVERY_ADDRESS,
        (error) => {
          if (error) {
            finish(new Error(`Yeelight discovery send failed: ${error.message}`));
          }
        }
      );
    });

    timer = setTimeout(() => {
      finish();
    }, timeoutMs);
  });
}

module.exports = {
  discoverDevices
};
