'use client';

import { useLogout } from '@/components/Session';
import { Button } from '@/components/ui';

export default function AkunBelumAktifPage() {
  const logout = useLogout();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-panel border border-gray-200 bg-white p-6 text-center">
        <h1 className="mb-3">Akun belum aktif</h1>
        <p className="text-ink">Akun belum diaktifkan. Buka tautan aktivasi dari HR.</p>
        <Button className="mt-5" onClick={() => logout()}>
          Keluar
        </Button>
      </div>
    </main>
  );
}
