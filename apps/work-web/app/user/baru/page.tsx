'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MultiCombobox } from '@/components/Combobox';
import { HandoverPanel, type Handover } from '@/components/Handover';
import { useMe } from '@/components/Session';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Field, inputCls } from '@/components/ui';
import { api, errorMessage, isApiError, roleNames } from '@/lib/api';
import { USERNAME_RE } from '@/lib/format';

type Emp = { employeeId: string; fullName: string; division: string; position: string; workStatus: string; hasAccount: boolean; accountStatus: string | null; suggestedUsername: string };
type EmpList = { source: string; connected: boolean; items: Emp[] };
type CreateRes = { userId: string; jobId: string; jobStatus: string; stage: string; error?: string | null; handover: Handover | null };

const STEPS = ['Pilih karyawan', 'Username', 'Akses aplikasi', 'Cara penyerahan', 'Ringkasan'];

export default function BuatAkunPage() {
  const me = useMe();
  const toast = useToast();
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [q, setQ] = useState('');
  const [emps, setEmps] = useState<EmpList | null>(null);
  const [searching, setSearching] = useState(false);
  const [emp, setEmp] = useState<Emp | null>(null);

  const [username, setUsername] = useState('');
  const [chat, setChat] = useState(true);
  const [work, setWork] = useState(false);
  const [role, setRole] = useState<'' | 'HR' | 'APPROVER'>('');
  const [hrAll, setHrAll] = useState(true);
  const [hrDivs, setHrDivs] = useState<string[]>([]);
  const [divisions, setDivisions] = useState<string[]>([]);
  const [delivery, setDelivery] = useState<'HR_HANDOVER' | 'EMAIL'>('HR_HANDOVER');

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateRes | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearching(true);
      api
        .get<EmpList>(`/work/employees?q=${encodeURIComponent(q)}`)
        .then(setEmps)
        .catch((e) => toast(errorMessage(e), 'danger'))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, toast]);

  useEffect(() => {
    api
      .get<{ divisions: string[] }>('/work/accounts?pageSize=5')
      .then((d) => setDivisions(d.divisions ?? []))
      .catch(() => {});
  }, []);

  const canHR = roleNames(me).includes('OWNER') || roleNames(me).includes('ACCOUNT_ADMIN');
  const canWork = canHR;
  const usernameOk = USERNAME_RE.test(username);
  const apps = [chat && 'CHAT', work && 'WORK'].filter(Boolean) as Array<'CHAT' | 'WORK'>;

  function next() {
    setFormErr(null);
    if (step === 0 && !emp) return setFormErr('Pilih karyawan dulu.');
    if (step === 1 && !usernameOk) return setFormErr('Username 3-32 karakter: huruf kecil, angka, titik, garis bawah, atau strip.');
    if (step === 2) {
      if (apps.length === 0) return setFormErr('Pilih minimal satu aplikasi.');
      if (role === 'HR' && !hrAll && hrDivs.length === 0) return setFormErr('Pilih divisi untuk HR atau pilih Semua divisi.');
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function submit() {
    if (!emp) return;
    setBusy(true);
    setFormErr(null);
    setExistingId(null);
    const roles = role ? [{ role, scope: role === 'HR' ? (hrAll ? null : hrDivs) : null }] : undefined;
    try {
      const r = await api.post<CreateRes>('/work/accounts', { employeeId: emp.employeeId, username, apps, delivery, roles });
      setResult(r);
      toast(r.jobStatus === 'DONE' ? 'Undangan dibuat.' : 'Akun dibuat, perlu ditinjau.', r.jobStatus === 'DONE' ? 'ok' : 'danger');
    } catch (e) {
      if (isApiError(e) && e.code === 'ALREADY_EXISTS') {
        const id = (e.userId as string | undefined) ?? (e.existingUserId as string | undefined) ?? (e.id as string | undefined) ?? null;
        setExistingId(id);
        setFormErr(e.message || 'Karyawan ini sudah punya akun.');
      } else if (isApiError(e) && e.code === 'USERNAME_TAKEN') {
        setFormErr(e.message || 'Username sudah dipakai. Ganti username.');
        setStep(1);
      } else setFormErr(errorMessage(e));
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const ok = result.jobStatus === 'DONE';
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-4">{ok ? 'Undangan dibuat' : 'Akun perlu ditinjau'}</h1>
        {!ok && (
          <Card className="mb-4">
            <div className="mb-2">
              <Badge tone="danger">Perlu ditinjau</Badge>
            </div>
            <p>
              Tahap: <span className="font-mono">{result.stage}</span> · Status: <span className="font-mono">{result.jobStatus}</span>
            </p>
            {result.error && <p className="mt-1 text-danger">{result.error}</p>}
          </Card>
        )}
        {result.handover && (
          <div className="mb-4">
            <HandoverPanel h={result.handover} />
          </div>
        )}
        <Button variant="primary" onClick={() => router.push(`/user/${result.userId}`)}>
          Selesai
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1>Buat akun</h1>
        <Link href="/user" className="text-[13px] text-muted hover:underline">
          Batal
        </Link>
      </div>

      <ol className="mb-4 flex flex-wrap gap-2 text-[13px]">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`rounded-[6px] border px-2 py-1 ${i === step ? 'border-lemone bg-yellow-50 font-medium text-ink' : i < step ? 'border-gray-300 bg-white text-ink' : 'border-gray-200 bg-white text-muted'}`}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      <Card title={STEPS[step]}>
        {step === 0 && (
          <div>
            <input className={inputCls} placeholder="Cari nama atau no. karyawan" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <div className="mt-1 text-[13px] text-muted">
              Sumber: {emps?.source ?? '...'} {emps && !emps.connected ? '· Belum terhubung' : ''}
            </div>
            <ul className={`mt-3 max-h-80 divide-y divide-gray-100 overflow-auto rounded-field border border-gray-200 ${searching ? 'opacity-60' : ''}`}>
              {emps?.items.length === 0 && <li className="p-3 text-muted">Tidak ada karyawan yang cocok.</li>}
              {emps?.items.map((e) => {
                const sel = emp?.employeeId === e.employeeId;
                return (
                  <li key={e.employeeId}>
                    <button
                      type="button"
                      disabled={e.hasAccount}
                      onClick={() => {
                        setEmp(e);
                        if (!username) setUsername(e.suggestedUsername);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${sel ? 'bg-yellow-50' : 'hover:bg-gray-50'}`}
                    >
                      <span>
                        <span className="font-medium">{e.fullName}</span>
                        <span className="block text-[13px] text-muted">
                          {e.employeeId} · {e.division} · {e.position}
                        </span>
                      </span>
                      {e.hasAccount ? <Badge tone="muted">Sudah punya akun</Badge> : sel ? <Badge tone="ok">Dipilih</Badge> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {step === 1 && (
          <Field label="Username">
            <input className={`${inputCls} font-mono`} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoFocus />
            {username && !usernameOk && <span className="mt-1 block text-[13px] text-danger">Format username tidak sesuai.</span>}
          </Field>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={chat} onChange={(e) => setChat(e.target.checked)} /> Chat
              </label>
              <label className={`flex items-center gap-2 ${canWork ? '' : 'opacity-50'}`}>
                <input type="checkbox" checked={work} disabled={!canWork} onChange={(e) => setWork(e.target.checked)} /> Work
              </label>
            </div>
            <Field label="Peran tambahan">
              <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                <option value="">Tidak ada</option>
                {canHR && <option value="HR">HR</option>}
                <option value="APPROVER">Atasan</option>
              </select>
            </Field>
            {role === 'HR' && (
              <div className="grid gap-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={hrAll} onChange={(e) => setHrAll(e.target.checked)} /> Semua divisi
                </label>
                {!hrAll && <MultiCombobox options={divisions} value={hrDivs} onChange={setHrDivs} />}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-2">
            <label className="flex items-center gap-2">
              <input type="radio" name="delivery" checked={delivery === 'HR_HANDOVER'} onChange={() => setDelivery('HR_HANDOVER')} /> Diserahkan HR langsung
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="delivery" checked={delivery === 'EMAIL'} onChange={() => setDelivery('EMAIL')} /> Email
            </label>
            {delivery === 'EMAIL' && <p className="text-[13px] text-muted">Email belum terhubung, tautan tetap ditampilkan untuk diserahkan manual.</p>}
          </div>
        )}

        {step === 4 && emp && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
            <dt className="text-muted">Karyawan</dt>
            <dd>
              {emp.fullName} ({emp.employeeId}) · {emp.division}
            </dd>
            <dt className="text-muted">Username</dt>
            <dd className="font-mono">{username}</dd>
            <dt className="text-muted">Akses</dt>
            <dd>{apps.join(', ')}</dd>
            <dt className="text-muted">Peran</dt>
            <dd>{role === '' ? 'Tidak ada' : role === 'HR' ? `HR (${hrAll ? 'semua divisi' : hrDivs.join(', ')})` : 'Atasan'}</dd>
            <dt className="text-muted">Penyerahan</dt>
            <dd>{delivery === 'HR_HANDOVER' ? 'Diserahkan HR langsung' : 'Email'}</dd>
          </dl>
        )}

        {formErr && (
          <p className="mt-3 text-danger">
            {formErr}{' '}
            {existingId && (
              <Link href={`/user/${existingId}`} className="underline">
                Buka akun yang ada
              </Link>
            )}
          </p>
        )}

        <div className="mt-5 flex justify-between">
          <Button disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>
            Kembali
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={next}>
              Lanjut
            </Button>
          ) : (
            <Button variant="primary" busy={busy} onClick={submit}>
              Buat undangan
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
