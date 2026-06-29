import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Response } from 'express';

const { createReadStream } = vi.hoisted(() => ({ createReadStream: vi.fn() }));
vi.mock('node:fs', () => ({ createReadStream }));

import { TripShareController, SharedController } from '../../../src/nest/share/share.controller';
import type { ShareService } from '../../../src/nest/share/share.service';
import type { User } from '../../../src/types';

const user = { id: 1, role: 'user', email: 'u@example.test' } as User;

function svc(o: Partial<ShareService> = {}): ShareService {
  return {
    verifyTripAccess: vi.fn().mockReturnValue({ user_id: 1 }),
    canManage: vi.fn().mockReturnValue(true),
    ...o,
  } as unknown as ShareService;
}

function res() {
  const r = { statusCode: 200, status: vi.fn((c: number) => { r.statusCode = c; return r; }) };
  return r as unknown as Response & { statusCode: number };
}

async function thrown(fn: () => unknown | Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error('expected throw');
}

beforeEach(() => vi.clearAllMocks());

describe('TripShareController', () => {
  it('POST 404 without access, 403 without share_manage', async () => {
    expect(await thrown(() => new TripShareController(svc({ verifyTripAccess: vi.fn().mockReturnValue(undefined) })).create(user, '5', {}, res()))).toEqual({ status: 404, body: { error: 'Trip not found' } });
    expect(await thrown(() => new TripShareController(svc({ canManage: vi.fn().mockReturnValue(false) })).create(user, '5', {}, res()))).toEqual({ status: 403, body: { error: 'No permission' } });
  });

  it('POST answers 201 on create, 200 on update', async () => {
    const createdRes = res();
    const c1 = new TripShareController(svc({ createOrUpdate: vi.fn().mockReturnValue({ token: 't', created: true }) } as Partial<ShareService>));
    expect(await c1.create(user, '5', { share_map: true }, createdRes)).toEqual({ token: 't' });
    expect(createdRes.statusCode).toBe(201);

    const updatedRes = res();
    const c2 = new TripShareController(svc({ createOrUpdate: vi.fn().mockReturnValue({ token: 't', created: false }) } as Partial<ShareService>));
    expect(await c2.create(user, '5', {}, updatedRes)).toEqual({ token: 't' });
    expect(updatedRes.statusCode).toBe(200);
  });

  it('GET 404 without access, returns info or a null token', async () => {
    expect(await thrown(() => new TripShareController(svc({ verifyTripAccess: vi.fn().mockReturnValue(undefined) })).get(user, '5'))).toEqual({ status: 404, body: { error: 'Trip not found' } });
    expect(await new TripShareController(svc({ get: vi.fn().mockReturnValue({ token: 't' }) } as Partial<ShareService>)).get(user, '5')).toEqual({ token: 't' });
    expect(await new TripShareController(svc({ get: vi.fn().mockReturnValue(null) } as Partial<ShareService>)).get(user, '5')).toEqual({ token: null });
  });

  it('DELETE 403 without share_manage, else removes', async () => {
    expect(await thrown(() => new TripShareController(svc({ canManage: vi.fn().mockReturnValue(false) })).remove(user, '5'))).toEqual({ status: 403, body: { error: 'No permission' } });
    const remove = vi.fn();
    expect(await new TripShareController(svc({ remove } as Partial<ShareService>)).remove(user, '5')).toEqual({ success: true });
    expect(remove).toHaveBeenCalledWith('5');
  });
});

describe('SharedController', () => {
  it('404 for an invalid token, else returns the snapshot', async () => {
    expect(await thrown(() => new SharedController(svc({ getSharedTripData: vi.fn().mockReturnValue(null) } as Partial<ShareService>)).read('bad'))).toEqual({ status: 404, body: { error: 'Invalid or expired link' } });
    expect(await new SharedController(svc({ getSharedTripData: vi.fn().mockReturnValue({ trip: { id: 9 } }) } as Partial<ShareService>)).read('tok')).toEqual({ trip: { id: 9 } });
  });

  describe('place-photo proxy', () => {
    function photoRes() {
      const r = {
        statusCode: 200,
        headersSent: false,
        status: vi.fn(function (this: unknown, c: number) { (r as { statusCode: number }).statusCode = c; return r; }),
        json: vi.fn(),
        set: vi.fn(),
        type: vi.fn(),
      };
      return r as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; type: ReturnType<typeof vi.fn> };
    }

    beforeEach(() => createReadStream.mockReset());

    function controller(path: string | null) {
      return new SharedController(svc({ getSharedPlacePhotoPath: vi.fn().mockReturnValue(path) } as Partial<ShareService>));
    }

    it('404 without streaming when the photo is not cached for the token', async () => {
      const res = photoRes();
      await controller(null).placePhotoBytes('tok', 'p1', res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Photo not cached' });
      expect(createReadStream).not.toHaveBeenCalled();
    });

    it('streams the cached file with image/jpeg + an immutable cache header on a hit', async () => {
      const stream = { on: vi.fn().mockReturnThis(), pipe: vi.fn() };
      createReadStream.mockReturnValue(stream);
      const res = photoRes();
      await controller('/cache/p1.jpg').placePhotoBytes('tok', 'p1', res);
      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=2592000, immutable');
      expect(res.type).toHaveBeenCalledWith('image/jpeg');
      expect(createReadStream).toHaveBeenCalledWith('/cache/p1.jpg');
      expect(stream.pipe).toHaveBeenCalledWith(res);
    });

    it('falls back to 404 when the read stream errors before headers were sent', async () => {
      let onError: () => void = () => {};
      const stream = { on: vi.fn((ev: string, cb: () => void) => { if (ev === 'error') onError = cb; return stream; }), pipe: vi.fn() };
      createReadStream.mockReturnValue(stream);
      const res = photoRes();
      await controller('/cache/p1.jpg').placePhotoBytes('tok', 'p1', res);
      onError();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Photo not cached' });
    });

    it('does not re-send a 404 when the stream errors after headers were flushed', async () => {
      let onError: () => void = () => {};
      const stream = { on: vi.fn((ev: string, cb: () => void) => { if (ev === 'error') onError = cb; return stream; }), pipe: vi.fn() };
      createReadStream.mockReturnValue(stream);
      const res = photoRes();
      (res as { headersSent: boolean }).headersSent = true;
      await controller('/cache/p1.jpg').placePhotoBytes('tok', 'p1', res);
      onError();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
