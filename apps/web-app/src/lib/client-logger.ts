export type ClientLogLevel = "info" | "warn" | "error";

export interface ClientLogEntry {
  id: string;
  time: string;
  level: ClientLogLevel;
  message: string;
  requestId?: string | null;
  details?: unknown;
}

const MAX_ENTRIES = 300;
const entries: ClientLogEntry[] = [];
const listeners = new Set<(entry: ClientLogEntry) => void>();

const SECRET_KEY_PARTS = ["token", "secret", "password", "authorization", "api_key", "apikey", "x-api-key"];

function maskValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (/bearer\s+[A-Za-z0-9._-]+/i.test(value)) {
      return "[redacted]";
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(maskValue);
  }

  if (value && typeof value === "object") {
    const typed = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    Object.entries(typed).forEach(([key, entryValue]) => {
      const lowered = key.toLowerCase();
      if (SECRET_KEY_PARTS.some((part) => lowered.includes(part))) {
        next[key] = "[redacted]";
      } else {
        next[key] = maskValue(entryValue);
      }
    });
    return next;
  }

  return value;
}

export function logToClient(
  level: ClientLogLevel,
  message: string,
  requestId: string | null = null,
  details: unknown = undefined,
): void {
  const entry: ClientLogEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: new Date().toLocaleTimeString("nb-NO", { hour12: false }),
    level,
    message,
    requestId,
    details: details !== undefined ? maskValue(details) : undefined,
  };

  entries.push(entry);
  while (entries.length > MAX_ENTRIES) {
    entries.shift();
  }

  listeners.forEach((listener) => listener(entry));
}

export function subscribeClientLogs(listener: (entry: ClientLogEntry) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getClientLogs(): ClientLogEntry[] {
  return [...entries];
}
