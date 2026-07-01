import { isTripEditLockedForActor } from '../../services/entitlementService';
import type { User } from '../../types';
import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';

import type { Observable } from 'rxjs';
import type { Request } from 'express';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TRIP_PATH = /^\/api\/trips\/([^/?#]+)(?:[/?#]|$)/;
const TRIP_ROOT_PATH = /^\/api\/trips\/([^/?#]+)\/?$/;

function requestPath(req: Request): string {
  return (req.path || req.originalUrl || req.url || '').split('?')[0];
}

function allowsLockedTripCleanup(req: Request, path: string): boolean {
  const method = req.method.toUpperCase();
  if (!TRIP_ROOT_PATH.test(path)) return false;
  if (method === 'DELETE') return true;
  if (method !== 'PUT') return false;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const keys = Object.keys(body);
  return keys.length === 1 && body.is_archived === true;
}

@Injectable()
export class TripEditLockInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const method = req.method.toUpperCase();
    if (!MUTATING_METHODS.has(method) || READ_METHODS.has(method)) return next.handle();

    const path = requestPath(req);
    const match = TRIP_PATH.exec(path);
    if (!match) return next.handle();
    if (allowsLockedTripCleanup(req, path)) return next.handle();

    const tripId = match[1];
    if (await isTripEditLockedForActor(tripId, req.user)) {
      throw new HttpException(
        {
          error: 'This trip is read-only on your current plan. Upgrade to keep surplus trips editable.',
          code: 'TRIP_EDIT_LOCKED',
        },
        403,
      );
    }

    return next.handle();
  }
}
