export type ApiError = { code: string; message: string; status: number; [k: string]: unknown };

export function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return 'Terjadi kesalahan.';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-Lemone-Request'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw { code: 'NETWORK', message: 'Tidak bisa terhubung ke server.', status: 0 } satisfies ApiError;
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const d = (data ?? {}) as Record<string, unknown>;
    throw {
      ...d,
      code: typeof d.code === 'string' ? d.code : typeof d.status === 'string' ? d.status : `HTTP_${res.status}`,
      message: typeof d.message === 'string' ? d.message : res.status === 401 ? 'Silakan masuk.' : `Permintaan gagal (${res.status}).`,
      status: res.status,
    } satisfies ApiError;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export type Me = {
  userId: string;
  username: string;
  displayName: string;
  employeeId: string | null;
  status: string;
  roles: Array<{ role: string; scope: string[] | null }>;
  grants: string[];
  hrDivisions: string[] | null;
  canUseApp: boolean;
  authMode: string;
  idpConfigured: boolean;
  erpLabel: string;
};

export const MANAGER_ROLES = ['OWNER', 'ACCOUNT_ADMIN', 'HR'];
export const roleNames = (me: Me) => me.roles.map((r) => (typeof r === 'string' ? r : r.role));
export const isManager = (me: Me) => roleNames(me).some((r) => MANAGER_ROLES.includes(r));
