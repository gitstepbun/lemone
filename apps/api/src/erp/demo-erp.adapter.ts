import { sql } from 'kysely';
import { getDb } from '../db/db';
import type { AttendanceNote, ErpAdapter, ErpEmployee, ErpWriteResult } from './erp.adapter';

/** Simulator ERP berlabel DEMO. Data hidup di ops.erp_demo_* supaya idempotensi bisa diamati. */
export class DemoErpAdapter implements ErpAdapter {
  readonly name = 'demo' as const;
  readonly connected = false;
  readonly label = 'DEMO';
  /** Dipakai uji: paksa kegagalan sementara pada pengiriman berikutnya. */
  failNext: 'retryable' | 'ambiguous' | null = null;

  private map(r: {
    employee_id: string; full_name: string; division: string; position: string | null; manager_employee_id: string | null;
    location: string | null; work_status: string; email: string | null; phone: string | null; shift_code: string; version: number;
  }): ErpEmployee {
    return {
      employeeId: r.employee_id, fullName: r.full_name, division: r.division, position: r.position,
      managerEmployeeId: r.manager_employee_id, location: r.location, workStatus: r.work_status as ErpEmployee['workStatus'],
      email: r.email, phone: r.phone, shiftCode: r.shift_code, version: String(r.version),
    };
  }

  async searchEmployees(q: string, limit: number): Promise<ErpEmployee[]> {
    const like = `%${q.trim()}%`;
    const rows = await getDb()
      .selectFrom('ops.erp_demo_employees')
      .selectAll()
      .where((eb) => eb.or([eb('full_name', 'ilike', like), eb('employee_id', 'ilike', like), eb('division', 'ilike', like)]))
      .orderBy('full_name')
      .limit(limit)
      .execute();
    return rows.map((r) => this.map(r));
  }

  async getEmployee(employeeId: string): Promise<ErpEmployee | null> {
    const r = await getDb().selectFrom('ops.erp_demo_employees').selectAll().where('employee_id', '=', employeeId).executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async listEmployees(): Promise<ErpEmployee[]> {
    const rows = await getDb().selectFrom('ops.erp_demo_employees').selectAll().orderBy('employee_id').execute();
    return rows.map((r) => this.map(r));
  }

  async getShift(employeeId: string, _date: string) {
    const e = await this.getEmployee(employeeId);
    if (!e) return null;
    const code = e.shiftCode ?? 'PAGI';
    return { shiftCode: code, crossesMidnight: code === 'MALAM' };
  }

  async postAttendanceNote(n: AttendanceNote): Promise<ErpWriteResult> {
    if (this.failNext === 'retryable') { this.failNext = null; return { ok: false, retryable: true, error: 'DEMO: ERP timeout (disimulasikan)' }; }
    const db = getDb();
    const existing = await db.selectFrom('ops.erp_demo_attendance_notes').select('id').where('source_ref', '=', n.sourceRef).executeTakeFirst();
    if (existing) return { ok: true, reference: `DEMO-ATT-${existing.id}`, duplicate: true };
    // satu baris per hari kerja dalam rentang
    const ids: number[] = [];
    const start = new Date(`${n.dateFrom}T00:00:00Z`);
    const end = new Date(`${n.dateTo}T00:00:00Z`);
    for (let d = new Date(start), i = 0; d <= end && i < 62; d.setUTCDate(d.getUTCDate() + 1), i++) {
      const ymd = d.toISOString().slice(0, 10);
      const ref = i === 0 ? n.sourceRef : `${n.sourceRef}#${ymd}`;
      const r = await db
        .insertInto('ops.erp_demo_attendance_notes')
        .values({ employee_id: n.employeeId, work_date: ymd, note_type: n.noteType, note: n.note, source_ref: ref })
        .onConflict((oc) => oc.column('source_ref').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (r) ids.push(r.id);
    }
    if (this.failNext === 'ambiguous') { this.failNext = null; return { ok: 'ambiguous', error: 'DEMO: respons ERP terputus setelah tulis (disimulasikan)' }; }
    const first = await db.selectFrom('ops.erp_demo_attendance_notes').select('id').where('source_ref', '=', n.sourceRef).executeTakeFirst();
    return { ok: true, reference: `DEMO-ATT-${first?.id ?? ids[0]}`, duplicate: false };
  }

  async findAttendanceNote(sourceRef: string) {
    const r = await getDb().selectFrom('ops.erp_demo_attendance_notes').select('id').where('source_ref', '=', sourceRef).executeTakeFirst();
    return r ? { reference: `DEMO-ATT-${r.id}` } : null;
  }

  /** Data contoh. Dipanggil seed. */
  static async seed(): Promise<number> {
    const rows = [
      ['EMP-0001', 'Stephanus Bundiarto (DEMO)', 'Manajemen', 'Founder', null, 'Jakarta', 'ACTIVE', 'PAGI'],
      ['EMP-0002', 'Rina Wijaya (DEMO)', 'HR', 'HR Manager', 'EMP-0001', 'Jakarta', 'ACTIVE', 'PAGI'],
      ['EMP-0003', 'Budi Santoso (DEMO)', 'Produksi', 'Supervisor Produksi', 'EMP-0001', 'Jakarta', 'ACTIVE', 'PAGI'],
      ['EMP-0004', 'Sari Lestari (DEMO)', 'Produksi', 'Operator Jahit', 'EMP-0003', 'Jakarta', 'ACTIVE', 'PAGI'],
      ['EMP-0005', 'Dedi Kurniawan (DEMO)', 'Gudang', 'Staf Gudang', 'EMP-0003', 'Jakarta', 'ACTIVE', 'MALAM'],
      ['EMP-0006', 'Maya Putri (DEMO)', 'Desain', 'Desainer', 'EMP-0001', 'Jakarta', 'ACTIVE', 'PAGI'],
      ['EMP-0007', 'Agus Pratama (DEMO)', 'Penjualan', 'Sales B2B', 'EMP-0001', 'Jakarta', 'ACTIVE', 'PAGI'],
      ['EMP-0008', 'Tono Hartono (DEMO)', 'Gudang', 'Staf Gudang', 'EMP-0003', 'Jakarta', 'TERMINATED', 'PAGI'],
      ['EMP-0009', 'Lina Marlina (DEMO)', 'Finance', 'Staf Finance', 'EMP-0001', 'Jakarta', 'ACTIVE', 'PAGI'],
      ['EMP-0010', 'Yusuf Hidayat (DEMO)', 'HR', 'Staf HR', 'EMP-0002', 'Jakarta', 'ACTIVE', 'PAGI'],
    ] as const;
    let n = 0;
    for (const r of rows) {
      await getDb()
        .insertInto('ops.erp_demo_employees')
        .values({ employee_id: r[0], full_name: r[1], division: r[2], position: r[3], manager_employee_id: r[4], location: r[5], work_status: r[6], email: null, phone: null, shift_code: r[7] })
        .onConflict((oc) => oc.column('employee_id').doUpdateSet({ full_name: r[1], division: r[2], position: r[3], work_status: r[6], version: sql`ops.erp_demo_employees.version + 1` }))
        .execute();
      n++;
    }
    return n;
  }
}
