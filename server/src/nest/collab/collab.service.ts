import { asyncDb } from '../../db/asyncDatabase';
import * as svc from '../../services/collabService';
import { checkPermission } from '../../services/permissions';
import type { User } from '../../types';
import { broadcast } from '../../websocket';
import { Injectable } from '@nestjs/common';

type Trip = NonNullable<Awaited<ReturnType<typeof svc.verifyTripAccess>>>;

/**
 * Thin Nest wrapper around the existing collab service. Trip access, the
 * 'collab_edit' / 'file_upload' permissions, the SQL and the WebSocket
 * broadcasts reuse the legacy code unchanged.
 */
@Injectable()
export class CollabService {
  verifyTripAccess(tripId: string, userId: number) {
    return svc.verifyTripAccess(tripId, userId);
  }

  canEdit(trip: Trip, user: User): boolean {
    return checkPermission('collab_edit', user.role, trip.user_id, user.id, trip.user_id !== user.id);
  }

  canUploadFiles(trip: Trip, user: User): boolean {
    return checkPermission('file_upload', user.role, trip.user_id, user.id, trip.user_id !== user.id);
  }

  broadcast(tripId: string, event: string, payload: Record<string, unknown>, socketId: string | undefined): void {
    broadcast(tripId, event, payload, socketId);
  }

  listNotes(tripId: string) {
    return svc.listNotesAsync(tripId);
  }
  createNote(tripId: string, userId: number, data: Parameters<typeof svc.createNote>[2]) {
    return svc.createNoteAsync(tripId, userId, data);
  }
  updateNote(tripId: string, id: string, data: Parameters<typeof svc.updateNote>[2]) {
    return svc.updateNoteAsync(tripId, id, data);
  }
  deleteNote(tripId: string, id: string) {
    return svc.deleteNoteAsync(tripId, id);
  }
  addNoteFile(tripId: string, id: string, file: Parameters<typeof svc.addNoteFile>[2]) {
    return svc.addNoteFileAsync(tripId, id, file);
  }
  getFormattedNoteById(id: string) {
    return svc.getFormattedNoteByIdAsync(id);
  }
  deleteNoteFile(id: string, fileId: string) {
    return svc.deleteNoteFileAsync(id, fileId);
  }

  listPolls(tripId: string) {
    return svc.listPollsAsync(tripId);
  }
  createPoll(tripId: string, userId: number, data: Parameters<typeof svc.createPoll>[2]) {
    return svc.createPollAsync(tripId, userId, data);
  }
  votePoll(tripId: string, id: string, userId: number, optionIndex: number) {
    return svc.votePollAsync(tripId, id, userId, optionIndex);
  }
  closePoll(tripId: string, id: string) {
    return svc.closePollAsync(tripId, id);
  }
  deletePoll(tripId: string, id: string) {
    return svc.deletePollAsync(tripId, id);
  }

  listMessages(tripId: string, before?: string) {
    return svc.listMessagesAsync(tripId, before);
  }
  createMessage(tripId: string, userId: number, text: string, replyTo?: number | null) {
    return svc.createMessageAsync(tripId, userId, text, replyTo);
  }
  deleteMessage(tripId: string, id: string, userId: number) {
    return svc.deleteMessageAsync(tripId, id, userId);
  }
  reactMessage(id: string, tripId: string, userId: number, emoji: string) {
    return svc.addOrRemoveReactionAsync(id, tripId, userId, emoji);
  }

  linkPreview(url: string) {
    return svc.fetchLinkPreview(url);
  }

  /** Fire-and-forget collab notification (mirrors the route's dynamic import). */
  notifyCollab(tripId: string, actor: User, preview?: string): void {
    import('../../services/notificationService').then(async ({ send }) => {
      const tripInfo = await asyncDb.prepare('SELECT title FROM trips WHERE id = ?').get<{ title: string }>(tripId);
      const params: Record<string, string> = {
        trip: tripInfo?.title || 'Untitled',
        actor: actor.email,
        tripId: String(tripId),
      };
      if (preview !== undefined) params.preview = preview;
      send({ event: 'collab_message', actorId: actor.id, scope: 'trip', targetId: Number(tripId), params }).catch(
        () => {},
      );
    });
  }
}
