export class ApiError extends Error {
  status: number;
  requestId: string | null;
  detail: unknown;

  constructor(message: string, status: number, requestId: string | null, detail: unknown) {
    super(message);
    this.status = status;
    this.requestId = requestId;
    this.detail = detail;
  }
}

export interface ApiResult<T> {
  data: T;
  requestId: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const requestId = response.headers.get("X-Request-ID");
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const detail = (payload as { detail?: unknown }).detail ?? payload;
    const msg = typeof detail === "string" ? detail : `API-feil (${response.status})`;
    throw new ApiError(msg, response.status, requestId, detail);
  }

  return { data: payload as T, requestId };
}

export function apiGet<T>(path: string): Promise<ApiResult<T>> {
  return request<T>(path);
}

export function apiPatch<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function apiPost<T>(path: string, body: unknown = null): Promise<ApiResult<T>> {
  return request<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : null,
  });
}
