'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

interface ToastCtx {
  toast: (text: string, tone?: 'info' | 'error') => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {} });

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, text, tone }].slice(-3));
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2400);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-sm rounded-card border bg-toast px-4 py-2.5 text-[14px] text-ink shadow-md ${
              t.tone === 'error' ? 'border-danger' : 'border-gray-200'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Small helper hook for mount-safe state updates. */
export function useMounted() {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return ref;
}
