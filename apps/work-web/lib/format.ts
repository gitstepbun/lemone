const dt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '-';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '-';
  return `${dt.format(d)} WIB`;
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING_ACTIVATION: 'Menunggu aktivasi',
  ACTIVE: 'Aktif',
  DISABLED: 'Dinonaktifkan',
  PERLU_DITINJAU: 'Perlu ditinjau',
};

export const STATUS_TONE: Record<string, 'ok' | 'wait' | 'muted' | 'danger'> = {
  PENDING_ACTIVATION: 'wait',
  ACTIVE: 'ok',
  DISABLED: 'muted',
  PERLU_DITINJAU: 'danger',
};

export const SYNC_LABEL: Record<string, string> = {
  SELESAI: 'Sinkron selesai',
  SEDANG_DIPROSES: 'Sedang diproses',
  PERLU_DITINJAU: 'Perlu ditinjau',
};

export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Pemilik',
  ACCOUNT_ADMIN: 'Admin akun',
  HR: 'HR',
  APPROVER: 'Atasan',
  EMPLOYEE: 'Karyawan',
};

export const INVITE_LABEL: Record<string, string> = {
  PENDING: 'Menunggu',
  RESERVED: 'Sedang diaktifkan',
  CONSUMED: 'Dipakai',
  EXPIRED: 'Kedaluwarsa',
  REVOKED: 'Dibatalkan',
};

export const LOGIN_ERROR: Record<string, string> = {
  tidak_terdaftar: 'Akun tidak terdaftar',
  nonaktif: 'Akun dinonaktifkan. Hubungi HR.',
  tanpa_akses: 'Akun tidak punya akses aplikasi ini.',
  callback_ditolak: 'Login ditolak. Coba lagi.',
};

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;
