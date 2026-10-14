import { logToClient } from "@/lib/client-logger";

export interface ApiResponse<T> {
  data: T;
  requestId: string | null;
  response: Response;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type QueryValue = string | number | boolean | null | undefined;

interface ApiRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  dedupe?: boolean;
  cache?: boolean;
  cacheTtlMs?: number;
  notifyAuthFailure?: boolean;
}

interface ErrorPayload {
  detail?: unknown;
  request_id?: string | null;
  message?: string;
}

export class ApiError extends Error {
  public status: number;
  public detail: unknown;
  public requestId: string | null;
  public cause?: Error;

  constructor(params: { message: string; status: number; requestId?: string | null; detail?: unknown; cause?: Error }) {
    super(params.message);
    this.name = "ApiError";
    this.status = params.status;
    this.requestId = params.requestId ?? null;
    this.detail = params.detail;
    this.cause = params.cause;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 320;
const DEFAULT_CACHE_TTL_MS = 30_000;
const RETRIABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const SLOW_REQUEST_WARN_MS = 1_200;
const ADMIN_ACCESS_UNCONFIGURED_DETAIL = "Admin-innlogging er ikke konfigurert i backend";
export const AUTH_REJECTED_EVENT = "flyvendebonder:auth-rejected";

const inFlightMap = new Map<string, Promise<ApiResponse<unknown>>>();
const cacheMap = new Map<string, { expiresAt: number; payload: ApiResponse<unknown> }>();
let cacheGeneration = 0;

function buildQueryString(query?: Record<string, QueryValue>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    params.set(key, String(value));
  });
  return params.toString();
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const queryString = buildQueryString(query);
  if (!queryString) return path;
  const delimiter = path.includes("?") ? "&" : "?";
  return `${path}${delimiter}${queryString}`;
}

function makeCacheKey(path: string, options: ApiRequestOptions): string {
  const method = options.method ?? "GET";
  const query = options.query == null ? "" : JSON.stringify(options.query);
  const body = options.body == null ? "" : JSON.stringify(options.body);
  return `${method}:${path}:${query}:${body}`;
}

function delayMs(attempt: number, base: number): number {
  return base * 2 ** attempt + Math.round(Math.random() * 120);
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json") || contentType.includes("application/problem+json");
}

async function parseResponse<T>(response: Response): Promise<T | null> {
  try {
    if (response.status === 204) {
      return null;
    }
    if (!isJsonResponse(response)) {
      const text = await response.text();
      return (text as unknown as T) ?? null;
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}

function normalizeErrorDetail(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const body = payload as ErrorPayload;
  if (body.detail !== undefined) return body.detail;
  if (body.message !== undefined && typeof body.message === "string") return body.message;
  return payload;
}

function getRequestIdFromBody(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const requestId = (payload as ErrorPayload).request_id;
  return typeof requestId === "string" ? requestId : null;
}

function buildErrorMessage(detail: unknown, responseStatus: number): string {
  if (typeof detail === "string" && detail.trim().length > 0) {
    return detail;
  }

  if (Array.isArray(detail)) {
    for (const item of detail) {
      if (!item || typeof item !== "object") continue;
      const msg = (item as { msg?: unknown }).msg;
      if (typeof msg !== "string" || msg.trim().length === 0) continue;
      const locValue = (item as { loc?: unknown }).loc;
      if (Array.isArray(locValue) && locValue.length > 0) {
        const loc = locValue
          .map((part) => String(part))
          .filter((part) => part.length > 0)
          .join(".");
        if (loc.length > 0) {
          return `${loc}: ${msg}`;
        }
      }
      return msg;
    }
  }

  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return `Request feilet med status ${responseStatus}`;
}

async function parseApiError(response: Response, parsedPayload?: unknown): Promise<ApiError> {
  const payload = parsedPayload === undefined ? await parseResponse<unknown>(response) : parsedPayload;
  const requestIdFromHeader = response.headers.get("X-Request-ID");
  const requestId = getRequestIdFromBody(payload) ?? requestIdFromHeader;
  const detail = normalizeErrorDetail(payload);
  const detailString = buildErrorMessage(detail, response.status);
  return new ApiError({
    message: detailString,
    status: response.status,
    requestId: requestId ?? null,
    detail,
  });
}

function combineSignal(
  providedSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void; didTimeout: () => boolean } {
  let timedOut = false;
  if (!providedSignal) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Request timeout", "AbortError"));
    }, timeoutMs);
    return {
      signal: controller.signal,
      cleanup: () => {
        window.clearTimeout(timeoutId);
        if (!controller.signal.aborted) {
          controller.abort();
        }
      },
      didTimeout: () => timedOut,
    };
  }

  const merged = new AbortController();
  const forwardAbort = () => {
    merged.abort(providedSignal.reason);
  };
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    merged.abort(new DOMException("Request timeout", "AbortError"));
  }, timeoutMs);

  providedSignal.addEventListener("abort", forwardAbort, { once: true });
  if (providedSignal.aborted) {
    forwardAbort();
  }

  return {
    signal: merged.signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      providedSignal.removeEventListener("abort", forwardAbort);
      if (!merged.signal.aborted) {
        merged.abort();
      }
    },
    didTimeout: () => timedOut,
  };
}

function sanitizeRequestBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  return JSON.stringify(body);
}

function summarizeUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function clearApiCache(): void {
  cacheGeneration += 1;
  cacheMap.clear();
  inFlightMap.clear();
}

function notifyAuthRejected(status: number): void {
  clearApiCache();
  window.dispatchEvent(new CustomEvent(AUTH_REJECTED_EVENT, { detail: { status } }));
}

function responseRejectsAuthentication(responseStatus: number, detail: unknown): boolean {
  return (
    responseStatus === 401 ||
    responseStatus === 403 ||
    (responseStatus === 503 && detail === ADMIN_ACCESS_UNCONFIGURED_DETAIL)
  );
}

export function requestJson<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const shouldCache = method === "GET" && options.cache !== false;
  const shouldDedupe = method === "GET" && options.dedupe !== false && !options.signal;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  const url = buildUrl(path, options.query);
  const cacheKey = makeCacheKey(url, options);
  const now = Date.now();

  if (shouldCache) {
    const cached = cacheMap.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.payload as ApiResponse<T>);
    }
  }

  if (shouldDedupe) {
    const inflight = inFlightMap.get(cacheKey);
    if (inflight) {
      return inflight as Promise<ApiResponse<T>>;
    }
  }

  const requestGeneration = cacheGeneration;
  const performRequest = async (): Promise<ApiResponse<T>> => {
    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt <= maxRetries) {
      const { signal, cleanup, didTimeout } = combineSignal(options.signal, timeoutMs);
      const attemptStartedAt = performance.now();
      try {
        const response = await fetch(url, {
          method,
          body: method === "GET" ? undefined : sanitizeRequestBody(options.body),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(options.headers || {}),
          },
          credentials: options.credentials ?? "same-origin",
          cache: shouldCache ? "default" : "no-store",
          signal,
        });

        const requestId = response.headers.get("X-Request-ID");
        const parsed = await parseResponse<T>(response);
        const durationMs = Math.round(performance.now() - attemptStartedAt);

        if (response.ok) {
          if (durationMs >= SLOW_REQUEST_WARN_MS) {
            logToClient("warn", `Treg API-respons: ${method} ${summarizeUrl(url)}`, requestId, {
              durationMs,
              status: response.status,
              retryAttempt: attempt,
            });
          }
          const envelope: ApiResponse<T> = {
            data: parsed as T,
            requestId,
            response,
          };
          if (shouldCache && parsed !== null && requestGeneration === cacheGeneration) {
            cacheMap.set(cacheKey, {
              expiresAt: Date.now() + cacheTtlMs,
              payload: envelope as ApiResponse<unknown>,
            });
          }
          return envelope;
        }

        const apiError = await parseApiError(response, parsed);
        if (requestGeneration === cacheGeneration && options.notifyAuthFailure !== false && responseRejectsAuthentication(response.status, apiError.detail)) {
          notifyAuthRejected(response.status);
        }
        if (RETRIABLE_STATUS.has(response.status) && attempt < maxRetries) {
          logToClient("warn", `API retry: ${method} ${summarizeUrl(url)}`, apiError.requestId, {
            durationMs,
            status: response.status,
            retryAttempt: attempt + 1,
            maxRetries,
          });
          lastError = apiError;
          cleanup();
          await new Promise((resolve) => window.setTimeout(resolve, delayMs(attempt, retryDelayMs)));
          attempt += 1;
          continue;
        }

        throw apiError;
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          const timeoutAbort = didTimeout();
          const durationMs = Math.round(performance.now() - attemptStartedAt);
          const abortError = new ApiError({
            message: timeoutAbort ? "Request timeout" : "Request avbrutt",
            status: timeoutAbort ? 408 : 0,
            requestId: null,
            detail: error.message,
          });
          if (timeoutAbort && attempt < maxRetries) {
            logToClient("warn", `API timeout, prøver igjen: ${method} ${summarizeUrl(url)}`, null, {
              durationMs,
              timeoutMs,
              retryAttempt: attempt + 1,
              maxRetries,
            });
            lastError = abortError;
            cleanup();
            await new Promise((resolve) => window.setTimeout(resolve, delayMs(attempt, retryDelayMs)));
            attempt += 1;
            continue;
          }
          if (timeoutAbort) {
            logToClient("error", `API timeout: ${method} ${summarizeUrl(url)}`, null, {
              durationMs,
              timeoutMs,
              retryAttempt: attempt,
            });
          }
          throw abortError;
        }

        const fallback = error instanceof Error ? error : new Error(String(error));
        const durationMs = Math.round(performance.now() - attemptStartedAt);
        if (attempt < maxRetries) {
          logToClient("warn", `Nettverksfeil, prøver igjen: ${method} ${summarizeUrl(url)}`, null, {
            durationMs,
            retryAttempt: attempt + 1,
            maxRetries,
            message: fallback.message,
          });
          lastError = fallback;
          cleanup();
          await new Promise((resolve) => window.setTimeout(resolve, delayMs(attempt, retryDelayMs)));
          attempt += 1;
          continue;
        }

        logToClient("error", `Nettverksfeil: ${method} ${summarizeUrl(url)}`, null, {
          durationMs,
          message: fallback.message,
        });
        throw new ApiError({
          message: fallback.message || "Nettverksfeil",
          status: 0,
          requestId: null,
          detail: fallback.message,
          cause: fallback,
        });
      } finally {
        cleanup();
      }
    }

    if (lastError instanceof ApiError) {
      throw lastError;
    }
    throw new ApiError({
      message: "Request feilet",
      status: 0,
      requestId: null,
      detail: "Ukjent feil",
    });
  };

  const promise = performRequest();
  if (shouldDedupe) {
    inFlightMap.set(cacheKey, promise as Promise<ApiResponse<unknown>>);
    void promise.then(
      () => {
        if (inFlightMap.get(cacheKey) === promise) inFlightMap.delete(cacheKey);
      },
      () => {
        if (inFlightMap.get(cacheKey) === promise) inFlightMap.delete(cacheKey);
      },
    );
  }

  return promise;
}

export function apiGet<T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}): Promise<ApiResponse<T>> {
  return requestJson<T>(path, { ...options, method: "GET" });
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, "method" | "body"> = {},
): Promise<ApiResponse<T>> {
  return requestJson<T>(path, {
    retries: 0,
    ...options,
    method: "POST",
    body,
    dedupe: false,
    cache: false,
  });
}

export function apiPut<T>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, "method" | "body"> = {},
): Promise<ApiResponse<T>> {
  return requestJson<T>(path, {
    retries: 0,
    ...options,
    method: "PUT",
    body,
    dedupe: false,
    cache: false,
  });
}

export function apiPatch<T>(
  path: string,
  body?: unknown,
  options: Omit<ApiRequestOptions, "method" | "body"> = {},
): Promise<ApiResponse<T>> {
  return requestJson<T>(path, {
    retries: 0,
    ...options,
    method: "PATCH",
    body,
    dedupe: false,
    cache: false,
  });
}

export function apiDelete<T>(
  path: string,
  options: Omit<ApiRequestOptions, "method" | "body"> = {},
): Promise<ApiResponse<T>> {
  return requestJson<T>(path, {
    retries: 0,
    ...options,
    method: "DELETE",
    dedupe: false,
    cache: false,
  });
}
