import { EventEmitter } from 'node:events';

/** Bus dalam proses: pencabutan akses → tutup WebSocket; pesan baru → kirim ke anggota. */
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export interface RevokeEvent { userId: string; app?: 'CHAT' | 'WORK'; reason: string }
export function emitRevoke(e: RevokeEvent) { bus.emit('revoke', e); }
export function onRevoke(fn: (e: RevokeEvent) => void) { bus.on('revoke', fn); }

export interface ChatEvent { conversationId: string; recipientUserIds: string[]; event: string; data: unknown }
export function emitChat(e: ChatEvent) { bus.emit('chat', e); }
export function onChat(fn: (e: ChatEvent) => void) { bus.on('chat', fn); }
