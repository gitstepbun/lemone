import { Inject, Injectable } from '@nestjs/common';
import { config } from '../config';
import { getDb } from '../db/db';
import type { Principal } from '../auth/principal';
import { ChatService } from './chat.service';

/**
 * Asisten AI. Tanpa penyedia (AI_PROVIDER=none) hanya menjawab status dan mengarahkan ke @hr.
 * Konteks yang diberikan ke penyedia dibatasi: data diri yang diizinkan + SOP publik; tidak ada akses database bebas.
 */
@Injectable()
export class AiService {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  async reply(me: Principal, convId: string, text: string) {
    const conv = await getDb().selectFrom('chat.conversations').select('service_user_id').where('id', '=', convId).executeTakeFirstOrThrow();
    const svc = await getDb().selectFrom('directory.service_aliases').select(['kind', 'username']).where('user_id', '=', conv.service_user_id!).executeTakeFirstOrThrow();
    const hr = `@${config().HR_INBOX_USERNAME}`;
    let body: string;
    if (config().AI_PROVIDER === 'none') {
      body = svc.kind === 'AI_HR'
        ? `Asisten HR belum terhubung ke penyedia AI (AI_PROVIDER=none). Untuk izin, sakit, atau cuti kirim pesan ke ${hr}; pengajuan tetap diproses tanpa AI.`
        : `Asisten Lemone belum terhubung ke penyedia AI (AI_PROVIDER=none). Sumber data: DEMO. Untuk urusan HR gunakan ${hr}.`;
    } else {
      body = `Penyedia AI "${config().AI_PROVIDER}" dikonfigurasi, tetapi integrasi tool/konteks belum dihubungkan pada tahap ini. Untuk urusan HR gunakan ${hr}.`;
    }
    if (/\b(izin|cuti|sakit)\b/i.test(text)) body += ` Pesan Anda terlihat seperti pengajuan; kirim ke ${hr} agar menjadi pengajuan resmi.`;
    await this.chat.sendAsService(convId, conv.service_user_id!, { kind: 'TEXT', body, payload: { source: 'AI_STUB', freshness: new Date().toISOString() } });
  }
}
