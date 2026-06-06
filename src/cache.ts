import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CACHE_TTL_MS } from "./library/protocol";
import type { YeelightDiscoveredDevice } from "./library/types";

const CACHE_PATH = path.join(os.homedir(), ".yeelight-cli-cache.json");

interface DiscoveryCacheFile {
  cachedAt: number;
  devices: YeelightDiscoveredDevice[];
}

export async function readDiscoveryCache(options: { ttlMs?: number } = {}): Promise<YeelightDiscoveredDevice[] | null> {
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  let raw: string;

  try {
    raw = await fs.readFile(CACHE_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }

  let parsed: DiscoveryCacheFile;
  try {
    parsed = JSON.parse(raw) as DiscoveryCacheFile;
  } catch {
    throw new Error(`Discovery cache at ${CACHE_PATH} is not valid JSON.`);
  }

  if (!parsed || !Array.isArray(parsed.devices) || typeof parsed.cachedAt !== "number") {
    throw new Error(`Discovery cache at ${CACHE_PATH} has an unexpected shape.`);
  }

  if (Date.now() - parsed.cachedAt > ttlMs) {
    return null;
  }

  return parsed.devices;
}

export async function writeDiscoveryCache(devices: readonly YeelightDiscoveredDevice[]): Promise<void> {
  const payload = JSON.stringify(
    {
      cachedAt: Date.now(),
      devices
    },
    null,
    2
  );

  await fs.writeFile(CACHE_PATH, payload, "utf8");
}

export function getCachePath(): string {
  return CACHE_PATH;
}
