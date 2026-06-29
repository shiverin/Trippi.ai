import { canAccessTripAsync, isOwnerAsync } from '../db/asyncDatabase';
import { AuthRequest } from '../types';

import { Request, Response, NextFunction } from 'express';

/** Middleware: verifies the authenticated user is an owner or member of the trip, then attaches trip to req. */
function requireTripAccess(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const authReq = req as AuthRequest;
    const tripId = req.params.tripId || req.params.id;
    if (!tripId) {
      res.status(400).json({ error: 'Trip ID required' });
      return;
    }
    const trip = await canAccessTripAsync(Number(tripId), authReq.user.id);
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }
    authReq.trip = trip;
    next();
  })().catch(next);
}

/** Middleware: verifies the authenticated user is the trip owner (not just a member). */
function requireTripOwner(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const authReq = req as AuthRequest;
    const tripId = req.params.tripId || req.params.id;
    if (!tripId) {
      res.status(400).json({ error: 'Trip ID required' });
      return;
    }
    if (!(await isOwnerAsync(Number(tripId), authReq.user.id))) {
      res.status(403).json({ error: 'Only the trip owner can do this' });
      return;
    }
    next();
  })().catch(next);
}

export { requireTripAccess, requireTripOwner };
