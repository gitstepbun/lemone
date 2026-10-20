import { LOGIN_ERROR } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function MasukPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const msg = error ? (LOGIN_ERROR[error] ?? 'Login gagal. Coba lagi.') : null;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-panel border border-gray-200 bg-white p-6">
        <div className="mb-6 text-center text-[24px] font-bold text-ink">Lemone Work</div>
        {msg && <p className="mb-4 rounded-field border border-red-200 bg-red-50 px-3 py-2 text-danger">{msg}</p>}
        <a
          href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/auth/work/login?return=/user`}
          className="block w-full rounded-field bg-lemone px-4 py-3 text-center text-[15px] font-medium text-ink hover:bg-lemone-hover"
        >
          Masuk dengan akun Lemone
        </a>
      </div>
    </main>
  );
}
