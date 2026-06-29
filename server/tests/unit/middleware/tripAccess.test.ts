/**
 * Unit tests for requireTripAccess and requireTripOwner middleware.
 * TRIP-ACCESS-001 through TRIP-ACCESS-010.
 * canAccessTrip and isOwner are mocked; no DB required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockCanAccessTrip = vi.fn();
const mockIsOwner = vi.fn();

vi.mock('../../../src/db/asyncDatabase', () => ({
  canAccessTripAsync: (...args: any[]) => mockCanAccessTrip(...args),
  isOwnerAsync: (...args: any[]) => mockIsOwner(...args),
}));
vi.mock('../../../src/config', () => ({ JWT_SECRET: 'test-secret' }));

import { requireTripAccess, requireTripOwner } from '../../../src/middleware/tripAccess';

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Response;
  return { res, status, json };
}

function makeReq(params: Record<string, string> = {}, userId = 1): Request {
  return {
    params,
    user: { id: userId },
  } as unknown as Request;
}

beforeEach(() => {
  mockCanAccessTrip.mockReset();
  mockIsOwner.mockReset();
});

// ── requireTripAccess ─────────────────────────────────────────────────────────

describe('requireTripAccess', () => {
  it('TRIP-ACCESS-001: returns 400 when no tripId param', async () => {
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = makeRes();
    requireTripAccess(makeReq({}), res, next);
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith(400));
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('TRIP-ACCESS-002: returns 404 when canAccessTrip returns null (not a member)', async () => {
    mockCanAccessTrip.mockResolvedValue(null);
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = makeRes();
    requireTripAccess(makeReq({ tripId: '42' }), res, next);
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith(404));
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('TRIP-ACCESS-003: calls next and attaches trip when user has access', async () => {
    const fakeTrip = { id: 42, user_id: 1 };
    mockCanAccessTrip.mockResolvedValue(fakeTrip);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    const req = makeReq({ tripId: '42' }, 1);
    requireTripAccess(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(next).toHaveBeenCalledOnce();
    expect((req as any).trip).toEqual(fakeTrip);
  });

  it('TRIP-ACCESS-004: accepts req.params.id as fallback when tripId is absent', async () => {
    const fakeTrip = { id: 7, user_id: 2 };
    mockCanAccessTrip.mockResolvedValue(fakeTrip);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    requireTripAccess(makeReq({ id: '7' }), res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(mockCanAccessTrip).toHaveBeenCalledWith(7, expect.any(Number));
    expect(next).toHaveBeenCalledOnce();
  });

  it('TRIP-ACCESS-005: passes numeric tripId to canAccessTrip', async () => {
    mockCanAccessTrip.mockResolvedValue({ id: 99, user_id: 3 });
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    requireTripAccess(makeReq({ tripId: '99' }, 3), res, next);
    await vi.waitFor(() => expect(mockCanAccessTrip).toHaveBeenCalledWith(99, 3));
    expect(mockCanAccessTrip).toHaveBeenCalledWith(99, 3);
  });
});

// ── requireTripOwner ──────────────────────────────────────────────────────────

describe('requireTripOwner', () => {
  it('TRIP-ACCESS-006: returns 400 when no tripId param', async () => {
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = makeRes();
    requireTripOwner(makeReq({}), res, next);
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith(400));
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('TRIP-ACCESS-007: returns 403 when user is not the owner', async () => {
    mockIsOwner.mockResolvedValue(false);
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = makeRes();
    requireTripOwner(makeReq({ tripId: '10' }, 2), res, next);
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith(403));
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('TRIP-ACCESS-008: calls next when user is the owner', async () => {
    mockIsOwner.mockResolvedValue(true);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    requireTripOwner(makeReq({ tripId: '10' }, 1), res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(next).toHaveBeenCalledOnce();
  });

  it('TRIP-ACCESS-009: accepts req.params.id as fallback when tripId is absent', async () => {
    mockIsOwner.mockResolvedValue(true);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    requireTripOwner(makeReq({ id: '5' }, 1), res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(mockIsOwner).toHaveBeenCalledWith(5, 1);
    expect(next).toHaveBeenCalledOnce();
  });

  it('TRIP-ACCESS-010: passes numeric tripId to isOwner', async () => {
    mockIsOwner.mockResolvedValue(true);
    const next = vi.fn() as unknown as NextFunction;
    const { res } = makeRes();
    requireTripOwner(makeReq({ tripId: '77' }, 4), res, next);
    await vi.waitFor(() => expect(mockIsOwner).toHaveBeenCalledWith(77, 4));
    expect(mockIsOwner).toHaveBeenCalledWith(77, 4);
  });
});
