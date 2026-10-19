export const LEAVE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'IZIN', label: 'Izin tidak masuk' },
  { value: 'SAKIT', label: 'Sakit' },
  { value: 'CUTI', label: 'Cuti' },
  { value: 'TERLAMBAT', label: 'Terlambat' },
  { value: 'PULANG_AWAL', label: 'Pulang lebih awal' },
];

export function statusTone(status?: string): 'ok' | 'wait' | 'muted' | 'danger' {
  switch ((status ?? '').toUpperCase()) {
    case 'APPROVED':
    case 'SYNCED':
      return 'ok';
    case 'PENDING_APPROVAL':
    case 'NEEDS_INFO':
    case 'PENDING':
      return 'wait';
    case 'REJECTED':
    case 'FAILED':
    case 'AMBIGUOUS':
      return 'danger';
    default:
      return 'muted';
  }
}

export function loginError(code?: string | null): string {
  switch (code) {
    case 'tidak_terdaftar':
      return 'Akun tidak terdaftar';
    case 'nonaktif':
      return 'Akun dinonaktifkan. Hubungi HR.';
    case 'tanpa_akses':
      return 'Akun tidak punya akses Chat.';
    case 'callback_ditolak':
      return 'Login ditolak. Coba lagi.';
    default:
      return 'Login gagal. Coba lagi.';
  }
}
