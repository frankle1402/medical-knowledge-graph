/**
 * Unified API client (Agent-D).
 *
 * Responsibilities:
 *   - Auto-inject `Authorization: Bearer <token>` from tokenStorage
 *   - Translate 401 → clear token + redirect to /login
 *   - Translate 4xx/5xx → typed `ApiError`
 *   - Wrap JSON request/response bodies
 *
 * Agent-E will reuse this client (do not duplicate).
 */
import { ApiError } from './error';
import { tokenStorage } from './token';

const DEFAULT_BASE_URL = '';

let baseUrl: string =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || DEFAULT_BASE_URL;

let onUnauthorized: (() => void) | null = null;

export function configureApiClient(opts: {
  baseUrl?: string;
  onUnauthorized?: (() => void) | null;
}): void {
  if (opts.baseUrl !== undefined) baseUrl = opts.baseUrl;
  if (opts.onUnauthorized !== undefined) onUnauthorized = opts.onUnauthorized;
}

function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!baseUrl) return path;
  // Avoid double slashes when joining
  return baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`);
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip automatic auth injection (e.g. /login). */
  skipAuth?: boolean;
}

function appendQuery(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

async function parseError(res: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }
  let message = `${res.status} ${res.statusText}`;
  let code: string | undefined;
  if (payload && typeof payload === 'object') {
    const p = payload as { error?: { message?: string; code?: string }; message?: string };
    if (p.error?.message) message = p.error.message;
    else if (p.message) message = p.message;
    if (p.error?.code) code = p.error.code;
  }
  return new ApiError(message, res.status, code, payload);
}

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = appendQuery(buildUrl(path), opts.query);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }
  if (!opts.skipAuth) {
    const token = tokenStorage.get();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchInit: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
  };
  if (opts.signal) {
    fetchInit.signal = opts.signal;
  }
  if (opts.body !== undefined) {
    fetchInit.body = opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, fetchInit);
  } catch (err) {
    throw ApiError.fromUnknown(err);
  }

  if (res.status === 401) {
    tokenStorage.clear();
    if (onUnauthorized) onUnauthorized();
    throw await parseError(res);
  }
  if (!res.ok) {
    throw await parseError(res);
  }
  if (res.status === 204) return undefined as T;

  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    return (await res.json()) as T;
  }
  // Fallback to text
  return (await res.text()) as unknown as T;
}

export const apiClient = {
  configure: configureApiClient,
  request,
  get: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};
