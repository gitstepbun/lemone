'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { loginError } from '@/lib/labels';

function LoginInner() {
  const params = useSearchParams();
  const error = params.get('error');
  const msg = error ? (error === 'akses_dicabut' ? 'Akses dicabut. Masuk kembali.' : loginError(error)) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f4] p-6">
      <div className="w-full max-w-sm rounded-panel border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-card bg-lemone text-[20px] font-bold text-ink">L</div>
          <h1 className="text-[24px] font-semibold text-ink">Lemone Chat</h1>
        </div>
        {msg ? <div className="mb-4 rounded-field border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-danger">{msg}</div> : null}
        <a
          href="/api/auth/chat/login?return=/"
          className="flex h-12 w-full items-center justify-center rounded-field bg-lemone text-[16px] font-semibold text-ink hover:bg-lemone-hover"
        >
          Masuk dengan akun Lemone
        </a>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
