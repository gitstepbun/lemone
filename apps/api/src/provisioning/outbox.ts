import { ChatService } from '../chat/chat.service';
import { LeaveService } from '../hr/leave.service';

/** Penanganan event outbox: dipanggil worker. Setiap handler harus idempoten. */
export function makeOutboxHandler(chat: ChatService, leave: LeaveService) {
  return async (e: { id: number; type: string; aggregate: string; aggregate_id: string; payload: Record<string, unknown> }) => {
    switch (e.type) {
      case 'ACCOUNT_ACTIVATED':
        await chat.ensureServiceConversations(e.aggregate_id);
        return;
      case 'HR_ASSIGNED':
        await chat.resyncAllHrInboxes();
        return;
      case 'LEAVE_APPROVED':
        await leave.syncApprovedToErp(String(e.payload.requestId), Number(e.payload.version), 'NOTE');
        return;
      case 'LEAVE_CANCELLED_AFTER_APPROVAL':
        await leave.syncApprovedToErp(String(e.payload.requestId), Number(e.payload.version), 'CANCEL');
        return;
      default:
        return; // event tidak dikenal: diabaikan, tercatat processed
    }
  };
}
