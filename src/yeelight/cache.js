const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DEFAULT_CACHE_TTL_MS } = require("./protocol");

const CACHE_PATH = path.join(os.homedir(), ".yeelight-cli-cache.json");

async function readDiscoveryCache(options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  let raw;

  try {
    raw = await fs.readFile(CACHE_PATH, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
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

async function writeDiscoveryCache(devices) {
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

function getCachePath() {
  return CACHE_PATH;
}

module.exports = {
  getCachePath,
  readDiscoveryCache,
  writeDiscoveryCache
};
