import { API_URL, loadTokens, refresh, type Tokens } from './auth';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function token(): Promise<Tokens | null> {
  let t = await loadTokens();
  if (t && t.expiresAt - Date.now() < 20_000) t = await refresh(t);
  return t;
}

/** Panggilan API dengan Bearer access token (audience lemone-api). Status akun/grant diperiksa server. */
export async function api<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const t = await token();
  if (!t) throw new ApiError('UNAUTHENTICATED', 'Silakan masuk.', 401);
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${t.accessToken}`, ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.code ?? 'ERROR', data?.message ?? `HTTP ${res.status}`, res.status);
  return data as T;
}
