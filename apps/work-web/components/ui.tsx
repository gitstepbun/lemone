'use client';

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useToast } from './Toast';

type Tone = 'ok' | 'wait' | 'muted' | 'danger' | 'info';

const toneCls: Record<Tone, string> = {
  ok: 'bg-green-50 text-ok border-green-200',
  wait: 'bg-yellow-50 text-wait border-yellow-200',
  muted: 'bg-gray-100 text-muted border-gray-200',
  danger: 'bg-red-50 text-danger border-red-200',
  info: 'bg-blue-50 text-blue-800 border-blue-200',
};

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-[6px] border px-2 py-0.5 text-[13px] font-medium ${toneCls[tone]}`}>{children}</span>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger'; full?: boolean; busy?: boolean };

export function Button({ variant = 'secondary', full, busy, className = '', children, disabled, ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center rounded-field px-4 py-2 text-[15px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50';
  const v =
    variant === 'primary'
      ? 'bg-lemone text-ink hover:bg-lemone-hover'
      : variant === 'danger'
        ? 'border border-danger/60 bg-white text-danger hover:bg-red-50'
        : 'border border-gray-300 bg-white text-ink hover:bg-gray-50';
  return (
    <button className={`${base} ${v} ${full ? 'w-full' : ''} ${className}`} disabled={disabled || busy} {...rest}>
      {busy ? 'Memproses...' : children}
    </button>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-gray-200 bg-white p-4 md:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-[17px] font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export const inputCls = 'w-full rounded-field border border-gray-300 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-ink';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export function CopyButton({ value, label = 'Salin' }: { value: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
      toast('Disalin.', 'ok');
    } catch {
      toast('Gagal menyalin. Salin manual.', 'danger');
    }
  }
  return (
    <Button type="button" onClick={copy} className="shrink-0 !px-3 !py-1 text-[13px]">
      {done ? 'Tersalin' : label}
    </Button>
  );
}

export function Spinner({ text = 'Memuat...' }: { text?: string }) {
  return <p className="py-6 text-center text-muted">{text}</p>;
}

export function ErrorBox({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="rounded-card border border-red-200 bg-red-50 p-4 text-danger">
      <p>{text}</p>
      {retry && (
        <Button className="mt-3" onClick={retry}>
          Coba lagi
        </Button>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-panel bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-[18px] font-semibold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  );
}
