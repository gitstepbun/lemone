'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MultiCombobox } from '@/components/Combobox';
import { HandoverPanel, type Handover } from '@/components/Handover';
import { useMe } from '@/components/Session';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, CopyButton, ErrorBox, Field, Modal, Spinner, inputCls } from '@/components/ui';
import { api, errorMessage, isApiError, roleNames } from '@/lib/api';
import { INVITE_LABEL, ROLE_LABEL, STATUS_LABEL, STATUS_TONE, SYNC_LABEL, fmtDate } from '@/lib/format';

type Detail = {
  user: { id: string; employee_id: string; username: string; display_name: string; status: string; status_reason: string | null; division: string | null; position: string | null; work_status: string | null };
  identity: { issuer: string; boundAt: string } | null;
  grants: Array<{ app: string; status: string; granted_at: string; revoked_at: string | null }>;
  roles: Array<{ id: string; role: string; scope_divisions: string[] | null; assigned_at: string }>;
  hrAssignments: Array<{ id: string; divisions: string[] | null }>;
  invitations: Array<{ id: string; status: string; delivery: string; expires_at: string; created_at: string }>;
  jobs: Array<{ id: string; kind: string; stage: string; status: string; attempts: number; last_error: string | null; updated_at: string }>;
  sessions: Array<{ id: string; app: string; created_at: string; last_seen_at: string | null; revoked_at: string | null; revoke_reason: string | null; user_agent: string | null }>;
  audit: Array<{ at: string; actor_user_id: string | null; action: string; outcome: string }>;
  syncStatus: string;
  uiStatus: string;
};
type InviteRes = { jobId: string; jobStatus: string; error?: string | null; handover: Handover | null };
type RecoveryRes = { username: string; temporaryPassword: string; note: string };

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [recovery, setRecovery] = useState<RecoveryRes | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; danger?: boolean; run: () => Promise<void> } | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [roleOpen, setRoleOpen] = useState(false);
  const [newRole, setNewRole] = useState('APPROVER');
  const [roleAll, setRoleAll] = useState(true);
  const [roleDivs, setRoleDivs] = useState<string[]>([]);
  const [divisions, setDivisions] = useState<string[]>([]);
  const [techOpen, setTechOpen] = useState(false);

  const load = useCallback(() => {
    return api
      .get<Detail>(`/work/accounts/${id}`)
      .then((x) => {
        setD(x);
        setErr(null);
      })
      .catch((e) => setErr(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    load();
    api
      .get<{ divisions: string[] }>('/work/accounts?pageSize=5')
      .then((x) => setDivisions(x.divisions ?? []))
      .catch(() => {});
  }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key);
    try {
      const r = await fn();
      toast(okMsg, 'ok');
      await load();
      return r;
    } catch (e) {
      toast(isApiError(e) && e.code === 'LAST_ADMIN' ? e.message : errorMessage(e), 'danger');
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (err) return <ErrorBox text={err} retry={load} />;
  if (!d) return <Spinner />;

  const u = d.user;
  const isSelf = me.userId === u.id;
  const isOwnerAdmin = roleNames(me).includes('OWNER') || roleNames(me).includes('ACCOUNT_ADMIN');
  const grantOf = (app: string) => d.grants.find((g) => g.app === app);
  const activeInvite = d.invitations.find((i) => i.status === 'PENDING' || i.status === 'RESERVED');
  const roleOptions = (roleNames(me).includes('OWNER') ? ['OWNER', 'ACCOUNT_ADMIN', 'HR', 'APPROVER'] : isOwnerAdmin ? ['HR', 'APPROVER'] : ['APPROVER']).filter((r) => !d.roles.some((x) => x.role === r));

  function toggleGrant(app: 'CHAT' | 'WORK') {
    const g = grantOf(app);
    const enable = !(g && g.status === 'ACTIVE');
    setConfirm({
      title: enable ? `Beri akses ${app}` : `Cabut akses ${app}`,
      text: enable ? `Akun ini akan bisa memakai Lemone ${app === 'CHAT' ? 'Chat' : 'Work'}.` : `Semua sesi ${app} akan ditutup.`,
      danger: !enable,
      run: async () => {
        await act(`grant-${app}`, () => api.post(`/work/accounts/${id}/grants`, { app, enable }), enable ? 'Akses diberikan.' : 'Akses dicabut.');
      },
    });
  }

  return (
    <div className="grid gap-4">
      <div>
        <Link href="/user" className="text-[13px] text-muted hover:underline">
          Kembali ke daftar akun
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1>{u.display_name}</h1>
            <div className="text-[15px] text-muted">
              <span className="font-mono">{u.username}</span> · {u.employee_id} · {u.division ?? '-'} · {u.position ?? '-'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS_TONE[d.uiStatus] ?? 'muted'}>{STATUS_LABEL[d.uiStatus] ?? d.uiStatus}</Badge>
            <Badge tone={d.syncStatus === 'SELESAI' ? 'ok' : d.syncStatus === 'SEDANG_DIPROSES' ? 'wait' : 'danger'}>{SYNC_LABEL[d.syncStatus] ?? d.syncStatus}</Badge>
          </div>
        </div>
        {u.status_reason && <p className="mt-1 text-[13px] text-muted">Alasan: {u.status_reason}</p>}
        {isSelf && <p className="mt-1 text-[13px] text-wait">Ini akun Anda sendiri. Perubahan peran, akses, dan status tidak diizinkan.</p>}
      </div>

      {handover && (
        <div>
          <HandoverPanel h={handover} />
          <Button className="mt-2" onClick={() => setHandover(null)}>
            Tutup
          </Button>
        </div>
      )}
      {recovery && (
        <div className="rounded-panel border-2 border-lemone bg-yellow-50 p-4">
          <p className="mb-3 text-[17px] font-bold text-danger">Tampil sekali. Tidak disimpan.</p>
          <div className="flex items-center justify-between gap-2 py-2">
            <span>
              <span className="text-[13px] text-muted">Username</span>
              <span className="block font-mono">{recovery.username}</span>
            </span>
            <CopyButton value={recovery.username} />
          </div>
          <div className="flex items-center justify-between gap-2 py-2">
            <span>
              <span className="text-[13px] text-muted">Kata sandi sementara</span>
              <span className="block font-mono">{recovery.temporaryPassword}</span>
            </span>
            <CopyButton value={recovery.temporaryPassword} />
          </div>
          <p className="text-[13px] text-muted">{recovery.note}</p>
          <Button className="mt-2" onClick={() => setRecovery(null)}>
            Tutup
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Akses aplikasi">
          <div className="grid gap-2">
            {(['CHAT', 'WORK'] as const).map((app) => {
              const g = grantOf(app);
              const on = g?.status === 'ACTIVE';
              const allowed = !isSelf && (app === 'CHAT' || isOwnerAdmin);
              return (
                <div key={app} className="flex items-center justify-between gap-2 rounded-field border border-gray-200 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{app === 'CHAT' ? 'Lemone Chat' : 'Lemone Work'}</span>
                    <Badge tone={on ? 'ok' : g?.status === 'PENDING' ? 'wait' : 'muted'}>{on ? 'Aktif' : g?.status === 'PENDING' ? 'Menunggu' : 'Tidak ada'}</Badge>
                  </span>
                  <Button variant={on ? 'danger' : 'secondary'} disabled={!allowed} busy={busy === `grant-${app}`} className="!px-3 !py-1 text-[13px]" onClick={() => toggleGrant(app)}>
                    {on ? 'Cabut' : 'Beri akses'}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card
          title="Peran"
          actions={
            !isSelf && roleOptions.length > 0 ? (
              <Button className="!px-3 !py-1 text-[13px]" onClick={() => { setNewRole(roleOptions[0]); setRoleOpen(true); }}>
                Tambah peran
              </Button>
            ) : null
          }
        >
          <ul className="grid gap-2">
            {d.roles.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-field border border-gray-200 px-3 py-2">
                <span>
                  <span className="font-medium">{ROLE_LABEL[r.role] ?? r.role}</span>
                  <span className="block text-[13px] text-muted">{r.scope_divisions ? r.scope_divisions.join(', ') : 'Semua divisi'}</span>
                </span>
                {r.role !== 'EMPLOYEE' && !isSelf && (
                  <Button
                    variant="danger"
                    className="!px-3 !py-1 text-[13px]"
                    busy={busy === `role-${r.role}`}
                    onClick={() =>
                      setConfirm({
                        title: `Cabut peran ${ROLE_LABEL[r.role] ?? r.role}`,
                        text: 'Peran akan dicabut dari akun ini.',
                        danger: true,
                        run: async () => {
                          await act(`role-${r.role}`, () => api.del(`/work/accounts/${id}/roles/${r.role}`), 'Peran dicabut.');
                        },
                      })
                    }
                  >
                    Cabut
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="Undangan"
          actions={
            u.status === 'PENDING_ACTIVATION' && !isSelf ? (
              <>
                <Button
                  className="!px-3 !py-1 text-[13px]"
                  busy={busy === 'reissue'}
                  onClick={() =>
                    setConfirm({
                      title: 'Buat ulang undangan',
                      text: 'Undangan lama dibatalkan. Kata sandi sementara baru dibuat.',
                      run: async () => {
                        const r = (await act('reissue', () => api.post<InviteRes>(`/work/accounts/${id}/invitation`, { delivery: 'HR_HANDOVER' }), 'Undangan dibuat ulang.')) as InviteRes | null;
                        if (r?.handover) setHandover(r.handover);
                        else if (r && r.jobStatus !== 'DONE') toast(`Perlu ditinjau: ${r.error ?? r.jobStatus}`, 'danger');
                      },
                    })
                  }
                >
                  Buat ulang undangan
                </Button>
                {activeInvite && (
                  <Button
                    variant="danger"
                    className="!px-3 !py-1 text-[13px]"
                    busy={busy === 'revoke-invite'}
                    onClick={() =>
                      setConfirm({
                        title: 'Cabut undangan',
                        text: 'Tautan aktivasi yang sudah dibagikan tidak berlaku lagi.',
                        danger: true,
                        run: async () => {
                          await act('revoke-invite', () => api.del(`/work/accounts/${id}/invitation`), 'Undangan dicabut.');
                        },
                      })
                    }
                  >
                    Cabut undangan
                  </Button>
                )}
              </>
            ) : null
          }
        >
          {d.invitations.length === 0 ? (
            <p className="text-muted">Belum ada undangan.</p>
          ) : (
            <ul className="grid gap-2">
              {d.invitations.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 rounded-field border border-gray-200 px-3 py-2 text-[15px]">
                  <span>
                    <Badge tone={i.status === 'PENDING' || i.status === 'RESERVED' ? 'wait' : i.status === 'USED' || i.status === 'CONSUMED' ? 'ok' : 'muted'}>{INVITE_LABEL[i.status] ?? i.status}</Badge>
                    <span className="ml-2 text-[13px] text-muted">{i.delivery === 'EMAIL' ? 'Email' : 'HR langsung'}</span>
                  </span>
                  <span className="text-[13px] text-muted">Sampai {fmtDate(i.expires_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Sesi dan perangkat"
          actions={
            d.sessions.some((s) => !s.revoked_at) ? (
              <Button
                variant="danger"
                className="!px-3 !py-1 text-[13px]"
                busy={busy === 'logout-all'}
                onClick={() =>
                  setConfirm({
                    title: 'Keluar dari semua perangkat',
                    text: 'Semua sesi akun ini akan ditutup.',
                    danger: true,
                    run: async () => {
                      await act('logout-all', () => api.post(`/work/accounts/${id}/logout-all`), 'Semua sesi ditutup.');
                    },
                  })
                }
              >
                Keluar dari semua perangkat
              </Button>
            ) : null
          }
        >
          {d.sessions.length === 0 ? (
            <p className="text-muted">Belum ada sesi.</p>
          ) : (
            <ul className="grid gap-2">
              {d.sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-field border border-gray-200 px-3 py-2">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{s.app}</span>
                      <Badge tone={s.revoked_at ? 'muted' : 'ok'}>{s.revoked_at ? 'Dicabut' : 'Aktif'}</Badge>
                    </span>
                    <span className="block truncate text-[13px] text-muted" title={s.user_agent ?? ''}>
                      {s.user_agent ?? '-'}
                    </span>
                    <span className="block text-[13px] text-muted">Terakhir {fmtDate(s.last_seen_at ?? s.created_at)}</span>
                  </span>
                  {!s.revoked_at && (
                    <Button variant="danger" className="!px-3 !py-1 text-[13px]" busy={busy === `sess-${s.id}`} onClick={() => act(`sess-${s.id}`, () => api.del(`/work/accounts/${id}/sessions/${s.id}`), 'Sesi dicabut.')}>
                      Cabut
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Tindakan">
          <div className="flex flex-wrap gap-2">
            {u.status !== 'DISABLED' ? (
              <Button variant="danger" disabled={isSelf} onClick={() => { setReason(''); setDisableOpen(true); }}>
                Nonaktifkan akun
              </Button>
            ) : (
              <Button disabled={isSelf} busy={busy === 'reactivate'} onClick={() => setConfirm({ title: 'Aktifkan kembali', text: 'Akun bisa dipakai lagi.', run: async () => { await act('reactivate', () => api.post(`/work/accounts/${id}/reactivate`), 'Akun diaktifkan kembali.'); } })}>
                Aktifkan kembali
              </Button>
            )}
            {u.status === 'ACTIVE' && (
              <Button
                disabled={isSelf}
                busy={busy === 'recovery'}
                onClick={() =>
                  setConfirm({
                    title: 'Mulai pemulihan akses',
                    text: 'Kata sandi sementara baru dibuat dan semua sesi ditutup. Verifikasi identitas dulu.',
                    danger: true,
                    run: async () => {
                      const r = (await act('recovery', () => api.post<RecoveryRes>(`/work/accounts/${id}/recovery`), 'Pemulihan dimulai.')) as RecoveryRes | null;
                      if (r) setRecovery(r);
                    },
                  })
                }
              >
                Mulai pemulihan akses
              </Button>
            )}
          </div>
        </Card>

        <Card title="Riwayat">
          <button type="button" className="mb-2 text-[13px] text-muted underline" onClick={() => setTechOpen((o) => !o)}>
            {techOpen ? 'Sembunyikan' : 'Tampilkan'} rincian teknis ({d.jobs.length} job)
          </button>
          {techOpen && (
            <ul className="mb-3 grid gap-1 rounded-field bg-gray-50 p-2 font-mono text-[12px]">
              {d.jobs.length === 0 && <li className="text-muted">Tidak ada job.</li>}
              {d.jobs.map((j) => (
                <li key={j.id}>
                  {j.kind} · {j.stage} · {j.status} · x{j.attempts} · {fmtDate(j.updated_at)}
                  {j.last_error && <span className="block text-danger">{j.last_error}</span>}
                </li>
              ))}
            </ul>
          )}
          {d.audit.length === 0 ? (
            <p className="text-muted">Belum ada riwayat.</p>
          ) : (
            <ul className="grid gap-1 text-[13px]">
              {d.audit.map((a, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-gray-100 py-1 last:border-0">
                  <span>
                    <span className="font-mono">{a.action}</span>{' '}
                    <Badge tone={a.outcome === 'OK' ? 'ok' : 'danger'}>{a.outcome}</Badge>
                  </span>
                  <span className="text-muted">{fmtDate(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p>{confirm.text}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setConfirm(null)}>Batal</Button>
            <Button
              variant={confirm.danger ? 'danger' : 'primary'}
              onClick={async () => {
                const c = confirm;
                setConfirm(null);
                await c.run();
              }}
            >
              Ya, lanjutkan
            </Button>
          </div>
        </Modal>
      )}

      {disableOpen && (
        <Modal title="Nonaktifkan akun" onClose={() => setDisableOpen(false)}>
          <Field label="Alasan">
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={200} />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setDisableOpen(false)}>Batal</Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 2}
              busy={busy === 'disable'}
              onClick={async () => {
                setDisableOpen(false);
                await act('disable', () => api.post(`/work/accounts/${id}/disable`, { reason: reason.trim() }), 'Akun dinonaktifkan.');
              }}
            >
              Nonaktifkan
            </Button>
          </div>
        </Modal>
      )}

      {roleOpen && (
        <Modal title="Tambah peran" onClose={() => setRoleOpen(false)}>
          <div className="grid gap-3">
            <Field label="Peran">
              <select className={inputCls} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r] ?? r}
                  </option>
                ))}
              </select>
            </Field>
            {(newRole === 'HR' || newRole === 'ACCOUNT_ADMIN') && (
              <>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={roleAll} onChange={(e) => setRoleAll(e.target.checked)} /> Semua divisi
                </label>
                {!roleAll && <MultiCombobox options={divisions} value={roleDivs} onChange={setRoleDivs} />}
              </>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setRoleOpen(false)}>Batal</Button>
            <Button
              variant="primary"
              busy={busy === 'add-role'}
              disabled={(newRole === 'HR' || newRole === 'ACCOUNT_ADMIN') && !roleAll && roleDivs.length === 0}
              onClick={async () => {
                setRoleOpen(false);
                const scope = newRole === 'HR' || newRole === 'ACCOUNT_ADMIN' ? (roleAll ? null : roleDivs) : null;
                await act('add-role', () => api.post(`/work/accounts/${id}/roles`, { role: newRole, scope }), 'Peran ditambahkan.');
              }}
            >
              Simpan
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
