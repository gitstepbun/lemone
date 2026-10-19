'use client';

import { useRef, useState, type KeyboardEvent } from 'react';

export function Composer({ onSend, disabled }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText('');
    if (ref.current) ref.current.style.height = 'auto';
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-gray-200 bg-white p-2">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
        }}
        onKeyDown={onKey}
        rows={1}
        placeholder="Tulis pesan"
        disabled={disabled}
        className="max-h-[120px] min-h-[40px] flex-1 resize-none rounded-field border border-gray-300 px-3 py-2 text-[15px] text-ink outline-none focus:border-ink"
      />
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        aria-label="Kirim"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-field bg-lemone text-ink hover:bg-lemone-hover disabled:opacity-50"
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
          <path d="M2.5 10l15-7-4 7 4 7-15-7z" />
        </svg>
      </button>
    </div>
  );
}
