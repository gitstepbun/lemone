/**
 * Kontrak adapter ERP. Portal tidak menulis tabel ERP; semua lewat kontrak ini.
 * Implementasi: DemoErpAdapter (data berlabel DEMO) dan HttpErpAdapter (ERP nyata, butuh kredensial).
 */
export interface ErpEmployee {
  employeeId: string;
  fullName: string;
  division: string;
  position: string | null;
  managerEmployeeId: string | null;
  location: string | null;
  workStatus: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  email: string | null;
  phone: string | null;
  shiftCode: string | null;
  version: string;
}

export interface AttendanceNote {
  /** Idempotency: pengiriman ulang dengan sourceRef sama tidak boleh menggandakan. */
  sourceRef: string;
  employeeId: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  noteType: 'IZIN' | 'SAKIT' | 'CUTI' | 'TERLAMBAT' | 'PULANG_AWAL';
  note: string | null;
  approvedByEmployeeId: string | null;
  approvedAt: string;
}

export type ErpWriteResult =
  | { ok: true; reference: string; duplicate: boolean }
  | { ok: false; retryable: boolean; error: string }
  | { ok: 'ambiguous'; error: string };

export interface ErpAdapter {
  readonly name: 'demo' | 'http';
  readonly connected: boolean;
  /** Label untuk UI: "DEMO" atau "ERP". */
  readonly label: string;
  searchEmployees(q: string, limit: number): Promise<ErpEmployee[]>;
  getEmployee(employeeId: string): Promise<ErpEmployee | null>;
  listEmployees(): Promise<ErpEmployee[]>;
  getShift(employeeId: string, date: string): Promise<{ shiftCode: string; crossesMidnight: boolean } | null>;
  postAttendanceNote(note: AttendanceNote): Promise<ErpWriteResult>;
  /** Cek apakah catatan dengan sourceRef sudah ada (untuk rekonsiliasi hasil ambigu). */
  findAttendanceNote(sourceRef: string): Promise<{ reference: string } | null>;
}
