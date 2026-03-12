import { getClientLogs, logToClient, type ClientLogEntry } from "@/lib/client-logger";

type DiagnosticLevel = "info" | "warn" | "error";
type DiagnosticKind = "navigation" | "longtask" | "resource";

export interface BrowserDiagnosticEntry {
  id: string;
  time: string;
  level: DiagnosticLevel;
  kind: DiagnosticKind;
  message: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

interface FlyvDebugApi {
  getClientLogs: () => ClientLogEntry[];
  getDiagnostics: () => BrowserDiagnosticEntry[];
  clearDiagnostics: () => void;
  getSnapshot: () => {
    clientLogs: ClientLogEntry[];
    diagnostics: BrowserDiagnosticEntry[];
  };
}

const MAX_DIAGNOSTIC_ENTRIES = 200;
const LONG_TASK_WARN_MS = 120;
const SLOW_RESOURCE_WARN_MS = 1_500;

const diagnostics: BrowserDiagnosticEntry[] = [];
let initialized = false;

declare global {
  interface Window {
    __flyvDebug?: FlyvDebugApi;
  }

  interface PerformanceEntry {
    initiatorType?: string;
    transferSize?: number;
    encodedBodySize?: number;
    decodedBodySize?: number;
    renderBlockingStatus?: string;
  }
}

function pushDiagnostic(entry: Omit<BrowserDiagnosticEntry, "id" | "time">): void {
  diagnostics.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: new Date().toLocaleTimeString("nb-NO", { hour12: false }),
    ...entry,
  });

  while (diagnostics.length > MAX_DIAGNOSTIC_ENTRIES) {
    diagnostics.shift();
  }
}

function truncateName(name: string): string {
  if (name.length <= 160) return name;
  return `${name.slice(0, 157)}...`;
}

function captureNavigationEntry(): void {
  const navigationEntry = performance.getEntriesByType("navigation")[0];
  if (!navigationEntry) return;

  pushDiagnostic({
    level: "info",
    kind: "navigation",
    message: "Navigasjon fullført",
    durationMs: Math.round(navigationEntry.duration),
    details: {
      type: "type" in navigationEntry ? String((navigationEntry as PerformanceNavigationTiming).type) : null,
      domContentLoadedMs:
        "domContentLoadedEventEnd" in navigationEntry
          ? Math.round((navigationEntry as PerformanceNavigationTiming).domContentLoadedEventEnd)
          : null,
      loadEventEndMs:
        "loadEventEnd" in navigationEntry ? Math.round((navigationEntry as PerformanceNavigationTiming).loadEventEnd) : null,
    },
  });
}

function observePerformanceEntryTypes(entryType: string, onEntry: (entry: PerformanceEntry) => void): void {
  if (!("PerformanceObserver" in window)) return;

  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  if (!supported.includes(entryType)) return;

  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => onEntry(entry));
  });

  observer.observe({ type: entryType, buffered: true });
}

function observeLongTasks(): void {
  observePerformanceEntryTypes("longtask", (entry) => {
    const durationMs = Math.round(entry.duration);
    if (durationMs < LONG_TASK_WARN_MS) return;

    pushDiagnostic({
      level: "warn",
      kind: "longtask",
      message: "Lang UI-task oppdaget",
      durationMs,
      details: {
        name: entry.name || "longtask",
        startTimeMs: Math.round(entry.startTime),
      },
    });

    logToClient("warn", "Lang UI-task oppdaget", null, {
      durationMs,
      name: entry.name || "longtask",
      startTimeMs: Math.round(entry.startTime),
    });
  });
}

function observeSlowResources(): void {
  observePerformanceEntryTypes("resource", (entry) => {
    const durationMs = Math.round(entry.duration);
    if (durationMs < SLOW_RESOURCE_WARN_MS) return;

    const initiatorType = entry.initiatorType || "resource";
    if (initiatorType === "fetch" || initiatorType === "xmlhttprequest") return;

    const name = truncateName(entry.name);
    const details = {
      initiatorType,
      name,
      startTimeMs: Math.round(entry.startTime),
      transferSize: typeof entry.transferSize === "number" ? entry.transferSize : null,
      renderBlockingStatus: entry.renderBlockingStatus ?? null,
    };

    pushDiagnostic({
      level: "warn",
      kind: "resource",
      message: "Treg ressurslast",
      durationMs,
      details,
    });

    logToClient("warn", "Treg ressurslast", null, {
      durationMs,
      ...details,
    });
  });
}

export function setupBrowserDiagnostics(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.__flyvDebug = {
    getClientLogs: () => getClientLogs(),
    getDiagnostics: () => [...diagnostics],
    clearDiagnostics: () => {
      diagnostics.splice(0, diagnostics.length);
    },
    getSnapshot: () => ({
      clientLogs: getClientLogs(),
      diagnostics: [...diagnostics],
    }),
  };

  if (document.readyState === "complete") {
    captureNavigationEntry();
  } else {
    window.addEventListener("load", () => {
      captureNavigationEntry();
    });
  }

  observeLongTasks();
  observeSlowResources();
}
