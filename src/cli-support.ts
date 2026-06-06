export function parseExecParamsValue(value: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Exec params must be a valid JSON array: ${detail}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Exec params must be a JSON array.");
  }

  return parsed;
}

export function parseExecToken(token: string): unknown {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed === "null" ||
    /^[+-]?\d+(\.\d+)?$/.test(trimmed) ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith('"')
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

export function parseExecTokens(tokens: readonly string[]): unknown[] {
  return tokens.map((token) => parseExecToken(token));
}

export function parseHostValue(value: string, defaultPort: number): { host: string; port: number } {
  const trimmed = value.trim();
  const match = /^([^:]+)(?::(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error('Host must be in the form "<ip>" or "<ip>:<port>".');
  }

  const host = match[1];
  const portText = match[2];
  if (!host) {
    throw new Error('Host must be in the form "<ip>" or "<ip>:<port>".');
  }

  const port = portText === undefined ? defaultPort : Number.parseInt(portText, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Host port must be an integer between 1 and 65535.");
  }

  return { host, port };
}
