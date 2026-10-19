'use client';

import { useEffect, useRef, useState } from 'react';
import { inputCls } from './ui';

type Props = {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allowAny?: boolean;
  emptyLabel?: string;
};

export function Combobox({ options, value, onChange, placeholder = 'Ketik untuk mencari', allowAny, emptyLabel = 'Semua' }: Props) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        if (!allowAny && text !== value) setText(value);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [allowAny, text, value]);

  const q = text.trim().toLowerCase();
  const list = ['', ...options.filter((o) => !q || o.toLowerCase().includes(q))].slice(0, 50);

  function pick(v: string) {
    onChange(v);
    setText(v);
    setOpen(false);
  }

  return (
    <div className="relative" ref={box}>
      <input
        className={inputCls}
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setIdx(0);
          if (allowAny) onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, list.length - 1));
          else if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter' && open) {
            e.preventDefault();
            pick(list[idx] ?? '');
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-field border border-gray-200 bg-white py-1 shadow-md">
          {list.map((o, i) => (
            <li
              key={o || '__all'}
              className={`cursor-pointer px-3 py-2 text-[15px] ${i === idx ? 'bg-yellow-50' : ''} ${o === value ? 'font-semibold' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o || emptyLabel}
            </li>
          ))}
          {list.length === 1 && <li className="px-3 py-2 text-muted">Tidak ada yang cocok</li>}
        </ul>
      )}
    </div>
  );
}

export function MultiCombobox({ options, value, onChange, placeholder = 'Ketik divisi' }: { options: string[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const q = text.trim().toLowerCase();
  const list = options.filter((o) => !value.includes(o) && (!q || o.toLowerCase().includes(q))).slice(0, 50);
  return (
    <div ref={box} className="relative">
      <div className="mb-2 flex flex-wrap gap-1">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-[6px] border border-gray-300 bg-gray-50 px-2 py-0.5 text-[13px]">
            {v}
            <button type="button" aria-label={`Hapus ${v}`} className="text-muted hover:text-danger" onClick={() => onChange(value.filter((x) => x !== v))}>
              x
            </button>
          </span>
        ))}
      </div>
      <input
        className={inputCls}
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) {
            e.preventDefault();
            onChange([...value, list[0]]);
            setText('');
          }
        }}
      />
      {open && list.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-field border border-gray-200 bg-white py-1 shadow-md">
          {list.map((o) => (
            <li
              key={o}
              className="cursor-pointer px-3 py-2 text-[15px] hover:bg-yellow-50"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange([...value, o]);
                setText('');
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
