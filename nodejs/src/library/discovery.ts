import dgram from "node:dgram";
import os from "node:os";
import {
  buildDiscoveryRequest,
  parseDiscoveryResponse,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DISCOVERY_ADDRESS,
  DISCOVERY_PORT
} from "./protocol";
import type { YeelightDiscoveredDevice, YeelightDiscoveryOptions } from "./types";

export function listDiscoveryInterfaces(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const interfaceAddresses of Object.values(interfaces)) {
    for (const address of interfaceAddresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        addresses.push(address.address);
      }
    }
  }

  return addresses;
}

export async function discoverDevices(options: YeelightDiscoveryOptions = {}): Promise<YeelightDiscoveredDevice[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const interfaceAddresses = listDiscoveryInterfaces();

  if (interfaceAddresses.length === 0) {
    throw new Error("Yeelight discovery failed: no active IPv4 network interfaces were found.");
  }

  return new Promise<YeelightDiscoveredDevice[]>((resolve, reject) => {
    const devices = new Map<string, YeelightDiscoveredDevice>();
    const sockets: dgram.Socket[] = [];
    const resendTimers: NodeJS.Timeout[] = [];
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(overallTimer);

      for (const resendTimer of resendTimers) {
        clearTimeout(resendTimer);
      }
      for (const socket of sockets) {
        try {
          socket.close();
        } catch {
          // Ignore close errors during shutdown.
        }
      }

      if (error) {
        reject(error);
        return;
      }

      resolve(Array.from(devices.values()));
    };

    const sendSearch = (socket: dgram.Socket): void => {
      socket.send(buildDiscoveryRequest(), DISCOVERY_PORT, DISCOVERY_ADDRESS, (error) => {
        if (error) {
          finish(new Error(`Yeelight discovery send failed: ${error.message}`));
        }
      });
    };

    const onMessage = (message: Buffer): void => {
      const device = parseDiscoveryResponse(message);
      if (!device) {
        return;
      }

      devices.set(device.id, device);
    };

    for (const interfaceAddress of interfaceAddresses) {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      sockets.push(socket);

      socket.on("message", onMessage);
      socket.once("error", (error) => {
        finish(new Error(`Yeelight discovery failed on ${interfaceAddress}: ${error.message}`));
      });

      socket.bind(DISCOVERY_PORT, interfaceAddress, () => {
        try {
          socket.addMembership(DISCOVERY_ADDRESS, interfaceAddress);
          socket.setMulticastTTL(12);
        } catch (error) {
          finish(new Error(`Yeelight discovery setup failed on ${interfaceAddress}: ${(error as Error).message}`));
          return;
        }

        sendSearch(socket);
        resendTimers.push(
          setTimeout(() => {
            if (!settled) {
              sendSearch(socket);
            }
          }, Math.min(1000, timeoutMs))
        );
      });
    }

    const overallTimer = setTimeout(() => {
      finish();
    }, timeoutMs);
  });
}
