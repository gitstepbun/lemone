import { config } from '../config';

export interface IdpUser {
  id: string;
  username: string;
  enabled: boolean;
  attributes?: Record<string, string[]>;
  requiredActions?: string[];
  firstName?: string;
  lastName?: string;
}

export class IdpError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryable: boolean) {
    super(message);
  }
}

/**
 * Adapter admin Keycloak. Hanya dipanggil backend dengan service account izin minimum
 * (manage-users, view-users, query-users). Secret tidak pernah keluar dari server.
 */
export class KeycloakAdmin {
  private token: { value: string; exp: number } | null = null;
  private get base() { return `${config().KC_ADMIN_URL}/admin/realms/${config().KC_REALM}`; }

  get configured() { return Boolean(config().IDP_PROVISIONER_CLIENT_SECRET); }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 10_000) return this.token.value;
    const c = config();
    if (!c.IDP_PROVISIONER_CLIENT_SECRET) throw new IdpError('IdP belum terhubung: IDP_PROVISIONER_CLIENT_SECRET kosong', 0, false);
    const res = await fetch(`${c.KC_ADMIN_URL}/realms/${c.KC_REALM}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.IDP_PROVISIONER_CLIENT_ID, client_secret: c.IDP_PROVISIONER_CLIENT_SECRET }),
    }).catch((e) => { throw new IdpError(`IdP tidak terjangkau: ${(e as Error).message}`, 0, true); });
    if (!res.ok) throw new IdpError(`Token service account gagal (${res.status})`, res.status, res.status >= 500);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async req<T>(method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<{ status: number; data: T | null; location?: string }> {
    const t = await this.accessToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as T) : null;
      if (res.status >= 500) throw new IdpError(`IdP ${res.status} ${method} ${path}`, res.status, true);
      return { status: res.status, data, location: res.headers.get('location') ?? undefined };
    } catch (e) {
      if (e instanceof IdpError) throw e;
      throw new IdpError(`IdP gagal (${method} ${path}): ${(e as Error).message}`, 0, true);
    } finally {
      clearTimeout(timer);
    }
  }

  async findByUsername(username: string): Promise<IdpUser | null> {
    const r = await this.req<IdpUser[]>('GET', `/users?username=${encodeURIComponent(username)}&exact=true&briefRepresentation=false`);
    return r.data?.[0] ?? null;
  }

  /** Cari berdasarkan referensi provisioning stabil (atribut lemone_user_id). */
  async findByLemoneUserId(userId: string): Promise<IdpUser | null> {
    const r = await this.req<IdpUser[]>('GET', `/users?q=${encodeURIComponent(`lemone_user_id:${userId}`)}&exact=true&briefRepresentation=false`);
    return r.data?.find((u) => u.attributes?.lemone_user_id?.[0] === userId) ?? null;
  }

  async getUser(id: string): Promise<IdpUser | null> {
    const r = await this.req<IdpUser>('GET', `/users/${id}`);
    return r.status === 200 ? r.data : null;
  }

  async createUser(u: { username: string; firstName: string; lastName: string; lemoneUserId: string; employeeId: string; email?: string | null }): Promise<string> {
    const r = await this.req<unknown>('POST', '/users', {
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      enabled: true,
      email: u.email ?? undefined,
      emailVerified: false,
      attributes: { lemone_user_id: [u.lemoneUserId], employee_id: [u.employeeId] },
      requiredActions: ['UPDATE_PASSWORD'],
    });
    if (r.status === 201 && r.location) return r.location.split('/').pop()!;
    if (r.status === 409) throw new IdpError('Username sudah ada di IdP', 409, false);
    throw new IdpError(`Buat user IdP gagal (${r.status})`, r.status, false);
  }

  async setTemporaryPassword(id: string, password: string): Promise<void> {
    const r = await this.req<unknown>('PUT', `/users/${id}/reset-password`, { type: 'password', value: password, temporary: true });
    if (r.status !== 204) throw new IdpError(`Set kata sandi sementara gagal (${r.status})`, r.status, false);
  }

  async setRequiredActions(id: string, actions: string[]): Promise<void> {
    const r = await this.req<unknown>('PUT', `/users/${id}`, { requiredActions: actions });
    if (r.status !== 204) throw new IdpError(`Set required actions gagal (${r.status})`, r.status, false);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const r = await this.req<unknown>('PUT', `/users/${id}`, { enabled });
    if (r.status !== 204) throw new IdpError(`Ubah status user IdP gagal (${r.status})`, r.status, false);
  }

  /** Mencabut semua sesi SSO dan refresh token pengguna di IdP. */
  async logoutAll(id: string): Promise<void> {
    const r = await this.req<unknown>('POST', `/users/${id}/logout`);
    if (r.status !== 204) throw new IdpError(`Logout IdP gagal (${r.status})`, r.status, false);
  }

  async listSessions(id: string): Promise<Array<{ id: string; ipAddress?: string; start?: number; lastAccess?: number; clients?: Record<string, string> }>> {
    const r = await this.req<Array<{ id: string; ipAddress?: string; start?: number; lastAccess?: number; clients?: Record<string, string> }>>('GET', `/users/${id}/sessions`);
    return r.data ?? [];
  }

  /** Role realm dicari lewat mapping pengguna (available/assigned) supaya cukup izin view-users, tanpa view-realm. */
  async addRealmRole(id: string, name: string): Promise<void> {
    const cur = await this.req<Array<{ id: string; name: string }>>('GET', `/users/${id}/role-mappings/realm`);
    if (cur.data?.some((r) => r.name === name)) return;
    const avail = await this.req<Array<{ id: string; name: string }>>('GET', `/users/${id}/role-mappings/realm/available`);
    const role = avail.data?.find((r) => r.name === name);
    if (!role) throw new IdpError(`Role ${name} tidak tersedia di realm`, 404, false);
    const r = await this.req<unknown>('POST', `/users/${id}/role-mappings/realm`, [{ id: role.id, name: role.name }]);
    if (r.status !== 204) throw new IdpError(`Tambah role gagal (${r.status})`, r.status, false);
  }

  async removeRealmRole(id: string, name: string): Promise<void> {
    const cur = await this.req<Array<{ id: string; name: string }>>('GET', `/users/${id}/role-mappings/realm`);
    const role = cur.data?.find((r) => r.name === name);
    if (!role) return;
    const r = await this.req<unknown>('DELETE', `/users/${id}/role-mappings/realm`, [{ id: role.id, name: role.name }]);
    if (r.status !== 204) throw new IdpError(`Hapus role gagal (${r.status})`, r.status, false);
  }
}

let inst: KeycloakAdmin | null = null;
export function idp(): KeycloakAdmin {
  if (!inst) inst = new KeycloakAdmin();
  return inst;
}
