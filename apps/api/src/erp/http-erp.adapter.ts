import type { AttendanceNote, ErpAdapter, ErpEmployee, ErpWriteResult } from './erp.adapter';

/**
 * Adapter ERP nyata lewat HTTP. Kontrak endpoint berikut adalah usulan untuk ERP Lemone;
 * sesuaikan path/skema ketika API ERP tersedia. Tanpa ERP_BASE_URL adapter ini dilaporkan "Belum terhubung".
 */
export class HttpErpAdapter implements ErpAdapter {
  readonly name = 'http' as const;
  readonly label = 'ERP';
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}
  get connected() { return Boolean(this.baseUrl && this.apiKey); }

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null);
      return { status: res.status, data };
    } finally {
      clearTimeout(t);
    }
  }

  private requireConnected() {
    if (!this.connected) throw new Error('ERP belum terhubung (ERP_BASE_URL/ERP_API_KEY kosong)');
  }

  async searchEmployees(q: string, limit: number): Promise<ErpEmployee[]> {
    this.requireConnected();
    const r = await this.call<{ items: ErpEmployee[] }>('GET', `/v1/employees?q=${encodeURIComponent(q)}&limit=${limit}`);
    return r.data?.items ?? [];
  }
  async getEmployee(employeeId: string): Promise<ErpEmployee | null> {
    this.requireConnected();
    const r = await this.call<ErpEmployee>('GET', `/v1/employees/${encodeURIComponent(employeeId)}`);
    return r.status === 200 ? r.data : null;
  }
  async listEmployees(): Promise<ErpEmployee[]> {
    this.requireConnected();
    const r = await this.call<{ items: ErpEmployee[] }>('GET', `/v1/employees?limit=5000`);
    return r.data?.items ?? [];
  }
  async getShift(employeeId: string, date: string) {
    this.requireConnected();
    const r = await this.call<{ shiftCode: string; crossesMidnight: boolean }>('GET', `/v1/employees/${encodeURIComponent(employeeId)}/shift?date=${date}`);
    return r.status === 200 ? r.data : null;
  }
  async postAttendanceNote(n: AttendanceNote): Promise<ErpWriteResult> {
    this.requireConnected();
    try {
      const r = await this.call<{ reference: string; duplicate?: boolean }>('POST', `/v1/attendance/notes`, n);
      if (r.status === 200 || r.status === 201) return { ok: true, reference: r.data!.reference, duplicate: Boolean(r.data?.duplicate) };
      if (r.status === 409) return { ok: true, reference: r.data?.reference ?? n.sourceRef, duplicate: true };
      if (r.status >= 500) return { ok: false, retryable: true, error: `ERP ${r.status}` };
      return { ok: false, retryable: false, error: `ERP ${r.status}` };
    } catch (e) {
      // timeout setelah mungkin tertulis: ambigu, perlu rekonsiliasi lewat findAttendanceNote
      return { ok: 'ambiguous', error: (e as Error).message };
    }
  }
  async findAttendanceNote(sourceRef: string) {
    this.requireConnected();
    const r = await this.call<{ reference: string }>('GET', `/v1/attendance/notes/by-source/${encodeURIComponent(sourceRef)}`);
    return r.status === 200 && r.data ? { reference: r.data.reference } : null;
  }
}
