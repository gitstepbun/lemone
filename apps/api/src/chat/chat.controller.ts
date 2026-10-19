import { Body, Controller, Get, Param, Post, Query, Inject } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequireApp, type Principal } from '../auth/principal';
import { E } from '../common/errors';
import { config } from '../config';
import { getDb } from '../db/db';
import { LeaveService } from '../hr/leave.service';
import { AiService } from './ai.service';
import { ChatService } from './chat.service';
import { issueWsTicket } from './ws';

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw E.invalid(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

@Controller('chat')
@RequireApp('CHAT')
export class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService, @Inject(LeaveService) private readonly leave: LeaveService, @Inject(AiService) private readonly ai: AiService) {}

  @Get('me')
  me(@CurrentUser() me: Principal) {
    return {
      userId: me.userId, username: me.username, displayName: me.displayName, employeeId: me.employeeId,
      roles: me.roles.map((r) => r.role), isHr: me.hrDivisions !== undefined, isApprover: me.roles.some((r) => r.role === 'APPROVER'),
      hrInbox: `@${config().HR_INBOX_USERNAME}`, erpLabel: config().ERP_ADAPTER === 'demo' ? 'DEMO' : 'ERP', aiStatus: config().AI_PROVIDER === 'none' ? 'BELUM_TERHUBUNG' : 'TERHUBUNG',
    };
  }

  @Post('ws-ticket')
  ticket(@CurrentUser() me: Principal) {
    return { ticket: issueWsTicket(me.userId, me.authzVersion), expiresIn: 60 };
  }

  @Get('directory')
  directory(@CurrentUser() me: Principal, @Query('q') q = '') {
    return this.chat.directory(me, q);
  }

  @Get('conversations')
  list(@CurrentUser() me: Principal) {
    return this.chat.listConversations(me);
  }

  @Post('conversations/dm')
  dm(@CurrentUser() me: Principal, @Body() body: unknown) {
    const { userId } = parse(z.object({ userId: z.string().uuid() }), body);
    return this.chat.openDm(me, userId);
  }

  @Post('conversations/group')
  group(@CurrentUser() me: Principal, @Body() body: unknown) {
    const { title, memberIds } = parse(z.object({ title: z.string().min(1).max(80), memberIds: z.array(z.string().uuid()).min(1) }), body);
    return this.chat.createGroup(me, title, memberIds);
  }

  @Get('conversations/:id')
  conversation(@CurrentUser() me: Principal, @Param('id') id: string) {
    return this.chat.conversation(me, id);
  }

  @Post('conversations/:id/members')
  addMembers(@CurrentUser() me: Principal, @Param('id') id: string, @Body() body: unknown) {
    const { memberIds } = parse(z.object({ memberIds: z.array(z.string().uuid()).min(1) }), body);
    return this.chat.addMembers(me, id, memberIds);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentUser() me: Principal, @Param('id') id: string, @Query('before') before?: string, @Query('after') after?: string, @Query('limit') limit = '50') {
    return this.chat.messages(me, id, { beforeSeq: before ? Number(before) : undefined, afterSeq: after ? Number(after) : undefined, limit: Math.min(200, Number(limit) || 50) });
  }

  @Post('conversations/:id/messages')
  async send(@CurrentUser() me: Principal, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        clientMsgId: z.string().uuid().optional(),
        kind: z.enum(['TEXT', 'VOICE', 'FILE']).default('TEXT'),
        body: z.string().max(4000).optional(),
        payload: z.record(z.unknown()).optional(),
        replyToId: z.string().uuid().nullable().optional(),
        forwarded: z.boolean().optional(),
        asService: z.boolean().optional(),
      }),
      body,
    );
    const m = await this.chat.send(me, id, input);
    let detection: unknown = null;
    if (!m.duplicate && m.conversationType === 'HR_INBOX' && m.senderRole === 'MEMBER') {
      detection = await this.leave.handleInboxMessage(me, { id: m.id, conversation_id: m.conversation_id, body: m.body, forwarded: m.forwarded, reply_to_id: m.reply_to_id, kind: m.kind });
    }
    if (!m.duplicate && m.conversationType === 'AI') await this.ai.reply(me, m.conversation_id, m.body ?? '');
    return { message: m, detection };
  }

  @Post('conversations/:id/read')
  read(@CurrentUser() me: Principal, @Param('id') id: string, @Body() body: unknown) {
    const { seq } = parse(z.object({ seq: z.number().int().nonnegative() }), body);
    return this.chat.markRead(me, id, seq);
  }

  @Post('devices')
  async registerDevice(@CurrentUser() me: Principal, @Body() body: unknown) {
    const { platform, label } = parse(z.object({ platform: z.enum(['ANDROID', 'IOS', 'WEB']), label: z.string().max(80).optional() }), body);
    const r = await getDb().insertInto('directory.device_registrations').values({ user_id: me.userId, app: 'CHAT', platform, device_label: label ?? null, push_token_hash: null }).returning('id').executeTakeFirstOrThrow();
    return { id: r.id, push: 'BELUM_TERHUBUNG' };
  }
}

@Controller('hr')
@RequireApp('CHAT')
export class HrController {
  constructor(@Inject(LeaveService) private readonly leave: LeaveService) {}

  @Get('requests/mine')
  mine(@CurrentUser() me: Principal) {
    return this.leave.myRequests(me);
  }

  @Post('requests')
  create(@CurrentUser() me: Principal, @Body() body: unknown) {
    const input = parse(z.object({ type: z.enum(['IZIN', 'SAKIT', 'CUTI', 'TERLAMBAT', 'PULANG_AWAL']), dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reason: z.string().max(300).nullable().optional() }), body);
    return this.leave.create(me, { type: input.type, dateFrom: input.dateFrom, dateTo: input.dateTo ?? input.dateFrom, reason: input.reason ?? null, source: 'MANUAL' }).then((r) => this.leave.cardPayload(r as never));
  }

  @Post('requests/:id/update')
  update(@CurrentUser() me: Principal, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(z.object({ type: z.enum(['IZIN', 'SAKIT', 'CUTI', 'TERLAMBAT', 'PULANG_AWAL']).optional(), dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reason: z.string().max(300).nullable().optional() }), body);
    return this.leave.update(me, id, input);
  }

  @Post('requests/:id/cancel')
  cancel(@CurrentUser() me: Principal, @Param('id') id: string) {
    return this.leave.cancel(me, id);
  }

  @Get('queue')
  queue(@CurrentUser() me: Principal, @Query('status') status = 'PENDING_APPROVAL') {
    return this.leave.queue(me, status as never);
  }

  @Post('requests/:id/decide')
  decide(@CurrentUser() me: Principal, @Param('id') id: string, @Body() body: unknown) {
    const { decision, note } = parse(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().max(300).nullable().optional() }), body);
    return this.leave.decide(me, id, decision, note ?? null);
  }

  @Get('attendance/mine')
  attendance(@CurrentUser() me: Principal) {
    return this.leave.myAttendance(me);
  }
}
