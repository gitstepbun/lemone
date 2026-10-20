'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { get, post, errMsg } from '@/lib/api';
import { loginError } from '@/lib/labels';

type Mode = { mode: 'local' | 'oidc'; registrationOpen: boolean };

function LoginInner() {
  const params = useSearchParams();
  const router = useRouter();
  const error = params.get('error');
  const [mode, setMode] = useState<Mode | null>(null);
  const [tab, setTab] = useState<'masuk' | 'daftar'>('masuk');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(error ? (error === 'akses_dicabut' ? 'Akses dicabut. Masuk kembali.' : loginError(error)) : null);

  useEffect(() => {
    get<Mode>('/auth/chat/mode').then(setMode).catch(() => setMode({ mode: 'oidc', registrationOpen: false }));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (tab === 'daftar') await post('/auth/chat/register', { username, password, displayName });
      else await post('/auth/chat/password-login', { username, password });
      router.replace('/');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setMsg(code === 'UNAUTHENTICATED' ? 'Username atau sandi salah.' : code === 'USERNAME_TAKEN' ? 'Username sudah dipakai.' : errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const field = 'h-11 w-full rounded-field border border-gray-300 px-3 text-[15px] text-ink outline-none focus:border-ink';
  const label = 'mb-1 block text-[13px] text-muted';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f4] p-4 sm:p-6">
      <div className="w-full max-w-sm overflow-hidden rounded-panel border border-gray-200 bg-white shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/masuk-hero.jpg" alt="" className="block h-44 w-full object-cover object-top sm:h-52" />
        <div className="p-6">
        <div className="mb-5 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/icon-192.png" alt="" className="h-11 w-11 rounded-card" />
          <div>
            <h1 className="text-[22px] font-semibold leading-tight text-ink">Lemone Chat</h1>
            <p className="text-[13px] text-muted">Komunikasi internal, izin lewat chat</p>
          </div>
        </div>
        {msg ? <div className="mb-4 rounded-field border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-danger">{msg}</div> : null}

        {mode === null ? null : mode.mode === 'oidc' ? (
          <a href="/api/auth/chat/login?return=/" className="flex h-12 w-full items-center justify-center rounded-field bg-lemone text-[16px] font-semibold text-ink hover:bg-lemone-hover">
            Masuk dengan akun Lemone
          </a>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {mode.registrationOpen ? (
              <div className="mb-2 flex rounded-field border border-gray-200 p-1 text-[14px]">
                {(['masuk', 'daftar'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => { setTab(t); setMsg(null); }} className={`flex-1 rounded-[8px] py-2 font-medium ${tab === t ? 'bg-lemone text-ink' : 'text-muted'}`}>
                    {t === 'masuk' ? 'Masuk' : 'Daftar'}
                  </button>
                ))}
              </div>
            ) : null}
            {tab === 'daftar' ? (
              <div>
                <label className={label}>Nama lengkap</label>
                <input className={field} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required minLength={2} autoComplete="name" />
              </div>
            ) : null}
            <div>
              <label className={label}>Username</label>
              <input className={field} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} required minLength={3} autoComplete="username" autoCapitalize="none" pattern="[a-z0-9][a-z0-9._\-]{1,30}[a-z0-9]" />
            </div>
            <div>
              <label className={label}>Kata sandi</label>
              <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={tab === 'daftar' ? 'new-password' : 'current-password'} />
            </div>
            <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center rounded-field bg-lemone text-[16px] font-semibold text-ink hover:bg-lemone-hover disabled:opacity-60">
              {tab === 'daftar' ? 'Buat akun' : 'Masuk'}
            </button>
          </form>
        )}
        </div>
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
