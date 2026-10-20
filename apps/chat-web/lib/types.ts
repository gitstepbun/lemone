export type ConversationType = 'DM' | 'GROUP' | 'HR_INBOX' | 'AI' | 'ANNOUNCEMENT';

export interface Me {
  authMode?: 'local' | 'oidc';
  isOwner?: boolean;
  userId: string;
  username: string;
  displayName: string;
  employeeId: string | null;
  roles: string[];
  isHr: boolean;
  isApprover: boolean;
  hrInbox?: string | null;
  erpLabel?: string;
  aiStatus?: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string;
  username?: string | null;
  verified?: boolean;
  myRole?: string;
  memberCount?: number;
  unread?: number;
  lastMessage?: string | { kind?: string; body?: string | null; senderUserId?: string | null; at?: string } | null;
  lastMessageAt?: string | null;
}

export interface DirectoryUser {
  userId: string;
  username: string;
  displayName: string;
  division?: string | null;
  position?: string | null;
  verified?: boolean;
}

export type MessageKind = 'TEXT' | 'SYSTEM' | 'CARD' | 'VOICE' | 'FILE';

export interface LeaveCardPayload {
  card: 'LEAVE_REQUEST';
  requestId: string;
  type: string;
  typeLabel: string;
  dateFrom: string;
  dateTo?: string | null;
  dateLabel: string;
  shift?: string | null;
  shiftLabel?: string | null;
  reason?: string | null;
  status: string;
  statusLabel: string;
  erpSync?: string;
  erpSyncLabel?: string;
  erpReference?: string | null;
  version?: number;
  actions?: string[];
  decidedByName?: string | null;
  decisionNote?: string | null;
}

export interface AskCardPayload {
  card: 'ASK';
  askingFor?: string;
  quickReplies?: string[];
}

export interface HintCardPayload {
  card: 'HINT';
  requestId: string;
}

export type CardPayload = LeaveCardPayload | AskCardPayload | HintCardPayload;

export interface Message {
  id: string;
  conversation_id: string;
  seq: number;
  sender_user_id?: string | null;
  sender_username?: string | null;
  sender_name?: string | null;
  sender_kind?: string | null;
  via_username?: string | null;
  client_msg_id?: string | null;
  kind: MessageKind;
  body?: string | null;
  payload?: CardPayload | Record<string, unknown> | null;
  reply_to_id?: string | null;
  forwarded?: boolean;
  created_at: string;
  // client-only
  local?: 'SENDING' | 'FAILED';
}

export interface Detection {
  intent: 'LEAVE_REQUEST' | 'NEEDS_INFO' | 'AMBIGUOUS' | 'QUESTION' | 'NEGATION' | 'NONE';
  requestId?: string;
}

export interface SendResult {
  message?: Message;
  duplicate?: boolean;
  detection?: Detection;
  [k: string]: unknown;
}

export interface QueueItem {
  id?: string;
  requestId?: string;
  employee?: { employeeId?: string; username?: string; displayName?: string; division?: string | null; position?: string | null };
  employeeName?: string;
  username?: string;
  division?: string | null;
  type?: string;
  typeLabel?: string;
  dateLabel?: string;
  reason?: string | null;
  source?: string;
  status?: string;
  statusLabel?: string;
  erpSync?: string;
  erpSyncLabel?: string;
  erpReference?: string | null;
  card?: LeaveCardPayload;
  createdAt?: string;
  [k: string]: unknown;
}

export interface AttendanceMine {
  source?: string;
  connected?: boolean;
  shift?: { shiftCode?: string; crossesMidnight?: boolean } | null;
  syncedAt?: string;
  notes?: Array<{ work_date?: string; note_type?: string; note?: string | null; source_ref?: string | null; created_at?: string }>;
  [k: string]: unknown;
}
