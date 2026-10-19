export interface ApiError {
  code: string;
  message: string;
  status?: number;
  [k: string]: unknown;
}

export function isApiError(e: unknown): e is ApiError {
  return !!e && typeof e === 'object' && 'code' in e && 'message' in e;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
  if (method !== 'GET') headers['X-Lemone-Request'] = '1';
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, method, headers, credentials: 'same-origin' });
  } catch {
    throw { code: 'NETWORK', message: 'Tidak bisa terhubung ke server.' } satisfies ApiError;
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) {
    const d = (data ?? {}) as Partial<ApiError>;
    throw {
      ...d,
      code: d.code ?? (res.status === 401 ? 'UNAUTHENTICATED' : `HTTP_${res.status}`),
      message: d.message ?? `Permintaan gagal (${res.status}).`,
      status: res.status,
    } satisfies ApiError;
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export function errMsg(e: unknown, fallback = 'Terjadi kesalahan.'): string {
  if (isApiError(e)) return e.message || fallback;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}
