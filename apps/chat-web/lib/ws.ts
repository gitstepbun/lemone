'use client';

import { post } from './api';

export type WsEvent = { event: string; conversationId?: string; data?: unknown };
type Listener = (ev: WsEvent) => void;
type StatusListener = (s: WsStatus) => void;
export type WsStatus = 'CONNECTING' | 'OPEN' | 'CLOSED' | 'REVOKED';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws';

class ChatSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private started = false;
  private stopped = false;
  status: WsStatus = 'CLOSED';

  start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.started = false;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('CLOSED');
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  onStatus(fn: StatusListener) {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  private setStatus(s: WsStatus) {
    this.status = s;
    this.statusListeners.forEach((f) => f(s));
  }

  private emit(ev: WsEvent) {
    this.listeners.forEach((f) => {
      try {
        f(ev);
      } catch (e) {
        console.error(e);
      }
    });
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }

  private async connect() {
    if (this.stopped) return;
    this.setStatus('CONNECTING');
    let ticket: string;
    try {
      const r = await post<{ ticket: string }>('/chat/ws-ticket');
      ticket = r.ticket;
    } catch (e) {
      const code = (e as { code?: string; status?: number })?.status;
      if (code === 401 || code === 403) {
        this.setStatus('REVOKED');
        this.emit({ event: 'revoked' });
        return;
      }
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;
    const ws = new WebSocket(`${WS_URL}?ticket=${encodeURIComponent(ticket)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('OPEN');
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };
    ws.onmessage = (m) => {
      try {
        const ev = JSON.parse(String(m.data)) as WsEvent;
        if (ev && ev.event) this.emit(ev);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = (ev) => {
      this.clearTimers();
      this.ws = null;
      if (ev.code === 4401) {
        this.stopped = true;
        this.started = false;
        this.setStatus('REVOKED');
        this.emit({ event: 'revoked' });
        return;
      }
      this.setStatus('CLOSED');
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.attempt += 1;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt, 5));
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }
}

export const chatSocket = new ChatSocket();
