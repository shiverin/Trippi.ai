import * as svc from '../../services/fileService';
import { checkPermission } from '../../services/permissions';
import type { User, TripFile } from '../../types';
import { broadcast } from '../../websocket';
import { Injectable } from '@nestjs/common';

import type { Request } from 'express';

type Trip = NonNullable<Awaited<ReturnType<typeof svc.verifyTripAccess>>>;
type FilePermission = 'file_upload' | 'file_edit' | 'file_delete';

/**
 * Thin Nest wrapper around the existing file service. Trip access, the
 * file_* permissions, the SQL, the path-resolution guard, the download-token
 * auth and the WebSocket broadcasts reuse the legacy code unchanged.
 */
@Injectable()
export class FilesService {
  verifyTripAccess(tripId: string, userId: number) {
    return svc.verifyTripAccess(tripId, userId);
  }

  can(action: FilePermission, trip: Trip, user: User): boolean {
    return checkPermission(action, user.role, trip.user_id, user.id, trip.user_id !== user.id);
  }

  broadcast(tripId: string, event: string, payload: Record<string, unknown>, socketId: string | undefined): void {
    broadcast(tripId, event, payload, socketId);
  }

  // Download-token auth + safe path resolution (used by the unguarded download route).
  authenticateDownload(req: Request) {
    return svc.authenticateDownload(req);
  }
  resolveFilePath(filename: string) {
    return svc.resolveFilePath(filename);
  }

  listFiles(tripId: string, showTrash: boolean) {
    const fn = (svc as typeof svc & { listFilesAsync?: typeof svc.listFiles }).listFilesAsync ?? svc.listFiles;
    return fn(tripId, showTrash);
  }
  getFileById(id: string, tripId: string) {
    const fn = (svc as typeof svc & { getFileByIdAsync?: typeof svc.getFileById }).getFileByIdAsync ?? svc.getFileById;
    return fn(id, tripId);
  }
  getDeletedFile(id: string, tripId: string) {
    const fn =
      (svc as typeof svc & { getDeletedFileAsync?: typeof svc.getDeletedFile }).getDeletedFileAsync ??
      svc.getDeletedFile;
    return fn(id, tripId);
  }
  createFile(
    tripId: string,
    file: Parameters<typeof svc.createFile>[1],
    userId: number,
    opts: Parameters<typeof svc.createFile>[3],
  ) {
    const fn = (svc as typeof svc & { createFileAsync?: typeof svc.createFile }).createFileAsync ?? svc.createFile;
    return fn(tripId, file, userId, opts);
  }
  updateFile(id: string, current: TripFile, updates: Parameters<typeof svc.updateFile>[2]) {
    const fn = (svc as typeof svc & { updateFileAsync?: typeof svc.updateFile }).updateFileAsync ?? svc.updateFile;
    return fn(id, current, updates);
  }
  toggleStarred(id: string, currentStarred: number | undefined) {
    const fn =
      (svc as typeof svc & { toggleStarredAsync?: typeof svc.toggleStarred }).toggleStarredAsync ??
      svc.toggleStarred;
    return fn(id, currentStarred);
  }
  softDeleteFile(id: string) {
    const fn =
      (svc as typeof svc & { softDeleteFileAsync?: typeof svc.softDeleteFile }).softDeleteFileAsync ??
      svc.softDeleteFile;
    return fn(id);
  }
  restoreFile(id: string) {
    const fn = (svc as typeof svc & { restoreFileAsync?: typeof svc.restoreFile }).restoreFileAsync ?? svc.restoreFile;
    return fn(id);
  }
  permanentDeleteFile(file: TripFile) {
    return svc.permanentDeleteFile(file);
  }
  emptyTrash(tripId: string) {
    return svc.emptyTrash(tripId);
  }
  createFileLink(id: string, opts: Parameters<typeof svc.createFileLink>[1]) {
    const fn =
      (svc as typeof svc & { createFileLinkAsync?: typeof svc.createFileLink }).createFileLinkAsync ??
      svc.createFileLink;
    return fn(id, opts);
  }
  deleteFileLink(linkId: string, id: string) {
    const fn =
      (svc as typeof svc & { deleteFileLinkAsync?: typeof svc.deleteFileLink }).deleteFileLinkAsync ??
      svc.deleteFileLink;
    return fn(linkId, id);
  }
  getFileLinks(id: string) {
    const fn = (svc as typeof svc & { getFileLinksAsync?: typeof svc.getFileLinks }).getFileLinksAsync ?? svc.getFileLinks;
    return fn(id);
  }
}
