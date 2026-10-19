'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Toast = { id: number; text: string; tone: 'ok' | 'danger' | 'info' };
type Ctx = { toast: (text: string, tone?: Toast['tone']) => void };

const ToastCtx = createContext<Ctx>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++seq.current;
    setItems((cur) => [...cur, { id, text, tone }].slice(-3));
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 2400);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-card border bg-toast px-4 py-3 text-[15px] text-ink shadow-md ${
              t.tone === 'danger' ? 'border-danger' : t.tone === 'ok' ? 'border-ok' : 'border-gray-200'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx).toast;
