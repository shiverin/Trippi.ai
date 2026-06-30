import { BookingOptionsController } from '../../../src/nest/booking-options/booking-options.controller';
import {
  BookingOptionValidationError,
  type BookingOptionsService,
} from '../../../src/nest/booking-options/booking-options.service';
import type { User } from '../../../src/types';
import { HttpException } from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/nest/auth/current-user.decorator', () => ({ CurrentUser: () => () => undefined }));
vi.mock('../../../src/nest/auth/jwt-auth.guard', () => ({ JwtAuthGuard: class JwtAuthGuard {} }));

const user = { id: 1, role: 'user', email: 'u@example.test' } as User;
const trip = { id: 5, user_id: 1 };

function makeService(overrides: Partial<BookingOptionsService> = {}): BookingOptionsService {
  return {
    verifyTripAccess: vi.fn().mockResolvedValue(trip),
    canEdit: vi.fn().mockResolvedValue(true),
    broadcast: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    upsertFromWorker: vi.fn().mockResolvedValue({ id: 9, status: 'current' }),
    update: vi.fn().mockResolvedValue({ id: 9, status: 'current' }),
    archive: vi.fn().mockResolvedValue({ id: 9, status: 'archived' }),
    expire: vi.fn().mockResolvedValue({ id: 9, status: 'expired' }),
    ...overrides,
  } as unknown as BookingOptionsService;
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

describe('BookingOptionsController', () => {
  it('404 when trip is not accessible', async () => {
    const svc = makeService({
      verifyTripAccess: vi.fn().mockResolvedValue(undefined),
    });
    await expect(thrown(() => new BookingOptionsController(svc).list(user, '5', '8'))).resolves.toEqual({
      status: 404,
      body: { error: 'Trip not found' },
    });
  });

  it('GET lists options, 404s missing intents, and maps validation errors', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 1, status: 'current' }]);
    const svc = makeService({ list } as Partial<BookingOptionsService>);
    await expect(new BookingOptionsController(svc).list(user, '5', '8', 'current')).resolves.toEqual({
      booking_options: [{ id: 1, status: 'current' }],
    });
    expect(list).toHaveBeenCalledWith('5', '8', 'current');

    const missing = makeService({ list: vi.fn().mockResolvedValue(null) });
    await expect(thrown(() => new BookingOptionsController(missing).list(user, '5', '99'))).resolves.toEqual({
      status: 404,
      body: { error: 'Booking intent not found' },
    });

    const bad = makeService({
      list: vi.fn().mockRejectedValue(new BookingOptionValidationError('bad status')),
    });
    await expect(thrown(() => new BookingOptionsController(bad).list(user, '5', '8', 'bad'))).resolves.toEqual({
      status: 400,
      body: { error: 'bad status' },
    });
  });

  it('POST requires edit permission, upserts, and broadcasts', async () => {
    const denied = makeService({ canEdit: vi.fn().mockResolvedValue(false) });
    await expect(
      thrown(() =>
        new BookingOptionsController(denied).upsertFromWorker(user, '5', '8', {
          provider: 'mock',
        }),
      ),
    ).resolves.toEqual({
      status: 403,
      body: { error: 'No permission' },
    });

    const upsertFromWorker = vi.fn().mockResolvedValue({ id: 9, provider: 'mock' });
    const broadcast = vi.fn();
    const svc = makeService({
      upsertFromWorker,
      broadcast,
    } as Partial<BookingOptionsService>);
    await expect(
      new BookingOptionsController(svc).upsertFromWorker(user, '5', '8', { provider: 'mock' }, 'sock'),
    ).resolves.toEqual({
      booking_option: { id: 9, provider: 'mock' },
    });
    expect(upsertFromWorker).toHaveBeenCalledWith('5', '8', { provider: 'mock' });
    expect(broadcast).toHaveBeenCalledWith(
      '5',
      'booking-option:upserted',
      { booking_option: { id: 9, provider: 'mock' } },
      'sock',
    );
  });

  it('POST maps service validation and missing intent to API errors', async () => {
    const bad = makeService({
      upsertFromWorker: vi.fn().mockRejectedValue(new BookingOptionValidationError('provider is required')),
    });
    await expect(thrown(() => new BookingOptionsController(bad).upsertFromWorker(user, '5', '8', {}))).resolves.toEqual(
      {
        status: 400,
        body: { error: 'provider is required' },
      },
    );

    const missing = makeService({ upsertFromWorker: vi.fn().mockResolvedValue(null) });
    await expect(
      thrown(() => new BookingOptionsController(missing).upsertFromWorker(user, '5', '99', { provider: 'mock' })),
    ).resolves.toEqual({
      status: 404,
      body: { error: 'Booking intent not found' },
    });
  });

  it('PUT updates or 404s when the option is missing', async () => {
    const missing = makeService({ update: vi.fn().mockResolvedValue(null) });
    await expect(thrown(() => new BookingOptionsController(missing).update(user, '5', '8', '9', {}))).resolves.toEqual({
      status: 404,
      body: { error: 'Booking option not found' },
    });

    const update = vi.fn().mockResolvedValue({ id: 9, price: 199 });
    const broadcast = vi.fn();
    const svc = makeService({
      update,
      broadcast,
    } as Partial<BookingOptionsService>);
    await expect(
      new BookingOptionsController(svc).update(user, '5', '8', '9', { price: 199 }, 'sock'),
    ).resolves.toEqual({
      booking_option: { id: 9, price: 199 },
    });
    expect(update).toHaveBeenCalledWith('5', '8', '9', { price: 199 });
    expect(broadcast).toHaveBeenCalledWith(
      '5',
      'booking-option:updated',
      { booking_option: { id: 9, price: 199 } },
      'sock',
    );
  });

  it('archives and expires options with 200 semantics or 404s', async () => {
    const missing = makeService({ archive: vi.fn().mockResolvedValue(null) });
    await expect(thrown(() => new BookingOptionsController(missing).archive(user, '5', '8', '9'))).resolves.toEqual({
      status: 404,
      body: { error: 'Booking option not found' },
    });

    const archive = vi.fn().mockResolvedValue({ id: 9, status: 'archived' });
    const expire = vi.fn().mockResolvedValue({ id: 10, status: 'expired' });
    const broadcast = vi.fn();
    const svc = makeService({
      archive,
      expire,
      broadcast,
    } as Partial<BookingOptionsService>);

    await expect(new BookingOptionsController(svc).archive(user, '5', '8', '9', 'sock')).resolves.toEqual({
      booking_option: { id: 9, status: 'archived' },
    });
    await expect(new BookingOptionsController(svc).expire(user, '5', '8', '10', 'sock')).resolves.toEqual({
      booking_option: { id: 10, status: 'expired' },
    });
    expect(broadcast).toHaveBeenCalledWith(
      '5',
      'booking-option:archived',
      { booking_option: { id: 9, status: 'archived' } },
      'sock',
    );
    expect(broadcast).toHaveBeenCalledWith(
      '5',
      'booking-option:expired',
      { booking_option: { id: 10, status: 'expired' } },
      'sock',
    );
  });
});
