'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type Tone = 'ok' | 'wait' | 'muted' | 'danger';

const toneCls: Record<Tone, string> = {
  ok: 'bg-green-50 text-ok border-green-200',
  wait: 'bg-yellow-50 text-wait border-yellow-200',
  muted: 'bg-gray-100 text-muted border-gray-200',
  danger: 'bg-red-50 text-danger border-red-200',
};

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[12px] font-medium ${toneCls[tone]}`}>
      {children}
    </span>
  );
}

export function VerifiedIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`inline-block h-4 w-4 ${className}`} aria-label="Akun resmi">
      <circle cx="10" cy="10" r="9" fill="#FFCC00" />
      <path d="M6 10.5l2.5 2.5L14 7.5" stroke="#1A1A1A" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variantCls: Record<Variant, string> = {
  primary: 'bg-lemone text-ink hover:bg-lemone-hover',
  secondary: 'bg-white text-ink border border-gray-300 hover:bg-gray-50',
  danger: 'bg-white text-danger border border-red-300 hover:bg-red-50',
  ghost: 'bg-transparent text-ink hover:bg-gray-100',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const sz = size === 'sm' ? 'h-8 px-3 text-[13px]' : size === 'lg' ? 'h-12 px-5 text-[16px]' : 'h-10 px-4 text-[14px]';
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-field font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${sz} ${variantCls[variant]} ${className}`}
    >
      {loading ? 'Memproses...' : children}
    </button>
  );
}

const fieldCls =
  'w-full rounded-field border border-gray-300 bg-white px-3 text-[15px] text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldCls} h-10 ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${fieldCls} py-2 ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${fieldCls} h-10 ${props.className ?? ''}`} />;
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-[13px] font-medium text-muted">{children}</label>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-panel bg-white p-4 md:max-w-md md:rounded-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-field px-2 py-1 text-muted hover:bg-gray-100" aria-label="Tutup">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return <div className="py-8 text-center text-[14px] text-muted">Memuat...</div>;
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center text-[14px] text-muted">
      <div>{text}</div>
      {action}
    </div>
  );
}
