import { HttpException, HttpStatus } from '@nestjs/common';

/** Kesalahan dengan kode stabil yang bisa ditampilkan frontend tanpa membocorkan detail. */
export class ApiError extends HttpException {
  constructor(public readonly code: string, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST, public readonly extra?: Record<string, unknown>) {
    super({ code, message, ...(extra ?? {}) }, status);
  }
}

export const E = {
  unauthenticated: () => new ApiError('UNAUTHENTICATED', 'Silakan masuk.', HttpStatus.UNAUTHORIZED),
  accountPending: () => new ApiError('ACCOUNT_PENDING', 'Akun belum diaktifkan.', HttpStatus.FORBIDDEN),
  accountDisabled: () => new ApiError('ACCOUNT_DISABLED', 'Akun dinonaktifkan.', HttpStatus.FORBIDDEN),
  noGrant: (app: string) => new ApiError('NO_APP_GRANT', `Tidak punya akses ${app}.`, HttpStatus.FORBIDDEN, { app }),
  forbidden: (why = 'Tidak berwenang.') => new ApiError('FORBIDDEN', why, HttpStatus.FORBIDDEN),
  notFound: (what = 'Data') => new ApiError('NOT_FOUND', `${what} tidak ditemukan.`, HttpStatus.NOT_FOUND),
  invalid: (msg: string, extra?: Record<string, unknown>) => new ApiError('INVALID', msg, HttpStatus.BAD_REQUEST, extra),
  conflict: (code: string, msg: string, extra?: Record<string, unknown>) => new ApiError(code, msg, HttpStatus.CONFLICT, extra),
  csrf: () => new ApiError('CSRF', 'Permintaan ditolak.', HttpStatus.FORBIDDEN),
};
