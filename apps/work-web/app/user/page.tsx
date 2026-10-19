'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Combobox } from '@/components/Combobox';
import { Badge, Button, ErrorBox, Field, Spinner, inputCls } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/format';

type Grant = { app: string; status: string };
type Row = { id: string; employee_id: string; username: string; display_name: string; status: string; division: string | null; position: string | null; grants: Grant[]; uiStatus: string };
type List = { total: number; page: number; pageSize: number; divisions: string[]; items: Row[] };

const STATUS_OPTIONS = ['PENDING_ACTIVATION', 'ACTIVE', 'DISABLED', 'PERLU_DITINJAU'];
const PAGE_SIZE = 20;

function GrantChips({ grants }: { grants: Grant[] }) {
  if (!grants?.length) return <span className="text-muted">-</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {grants.map((g) => (
        <Badge key={g.app} tone={g.status === 'ACTIVE' ? 'ok' : g.status === 'PENDING' ? 'wait' : 'muted'}>
          {g.app}
        </Badge>
      ))}
    </span>
  );
}

export default function UserListPage() {
  const [q, setQ] = useState('');
  const [division, setDivision] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<List | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const divisionsRef = useRef<string[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const p = new URLSearchParams({ q, division, status, page: String(page), pageSize: String(PAGE_SIZE) });
      api
        .get<List>(`/work/accounts?${p}`)
        .then((d) => {
          if (d.divisions?.length) divisionsRef.current = d.divisions;
          setData(d);
          setErr(null);
        })
        .catch((e) => setErr(errorMessage(e)))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, division, status, page, tick]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1>Akun</h1>
        <Link href="/user/baru" className="rounded-field bg-lemone px-4 py-2 text-[15px] font-medium text-ink hover:bg-lemone-hover">
          Buat akun
        </Link>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Field label="Cari">
          <input
            className={inputCls}
            placeholder="Nama, username, no. karyawan"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Divisi">
          <Combobox
            options={divisionsRef.current}
            value={division}
            onChange={(v) => {
              setDivision(v);
              setPage(1);
            }}
            emptyLabel="Semua divisi"
          />
        </Field>
        <Field label="Status">
          <Combobox
            options={STATUS_OPTIONS.map(statusLabel)}
            value={status ? statusLabel(status) : ''}
            onChange={(v) => {
              setStatus(STATUS_OPTIONS.find((s) => statusLabel(s) === v) ?? '');
              setPage(1);
            }}
            emptyLabel="Semua status"
          />
        </Field>
      </div>

      {err && <ErrorBox text={err} retry={() => setTick((t) => t + 1)} />}
      {!err && !data && loading && <Spinner />}
      {data && (
        <div className={loading ? 'opacity-60' : ''}>
          {data.items.length === 0 ? (
            <div className="rounded-card border border-gray-200 bg-white p-6 text-center">
              <p className="text-muted">Tidak ada akun yang cocok.</p>
              <div className="mt-3 flex justify-center gap-2">
                {(q || division || status) && (
                  <Button
                    onClick={() => {
                      setQ('');
                      setDivision('');
                      setStatus('');
                      setPage(1);
                    }}
                  >
                    Hapus filter
                  </Button>
                )}
                <Link href="/user/baru" className="rounded-field bg-lemone px-4 py-2 font-medium text-ink hover:bg-lemone-hover">
                  Buat akun
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-card border border-gray-200 bg-white md:block">
                <table className="w-full text-left text-[15px]">
                  <thead className="bg-gray-50 text-[13px] text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">Nama</th>
                      <th className="px-4 py-2 font-medium">No. karyawan</th>
                      <th className="px-4 py-2 font-medium">Username</th>
                      <th className="px-4 py-2 font-medium">Divisi</th>
                      <th className="px-4 py-2 font-medium">Akses</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r) => (
                      <tr key={r.id} className="border-t border-gray-100 hover:bg-yellow-50">
                        <td className="px-4 py-2">
                          <Link href={`/user/${r.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                            {r.display_name}
                          </Link>
                        </td>
                        <td className="px-4 py-2">{r.employee_id}</td>
                        <td className="px-4 py-2 font-mono text-[14px]">{r.username}</td>
                        <td className="px-4 py-2">{r.division ?? '-'}</td>
                        <td className="px-4 py-2">
                          <GrantChips grants={r.grants} />
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone={STATUS_TONE[r.uiStatus] ?? 'muted'}>{statusLabel(r.uiStatus)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-2 md:hidden">
                {data.items.map((r) => (
                  <Link key={r.id} href={`/user/${r.id}`} className="block rounded-card border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{r.display_name}</div>
                        <div className="text-[13px] text-muted">
                          {r.employee_id} · {r.username}
                        </div>
                        <div className="text-[13px] text-muted">{r.division ?? '-'}</div>
                      </div>
                      <Badge tone={STATUS_TONE[r.uiStatus] ?? 'muted'}>{statusLabel(r.uiStatus)}</Badge>
                    </div>
                    <div className="mt-2">
                      <GrantChips grants={r.grants} />
                    </div>
                  </Link>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
                <span>
                  {data.total} akun · halaman {page} dari {pages}
                </span>
                <div className="flex gap-2">
                  <Button className="!px-3 !py-1 text-[13px]" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Sebelumnya
                  </Button>
                  <Button className="!px-3 !py-1 text-[13px]" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                    Berikutnya
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
