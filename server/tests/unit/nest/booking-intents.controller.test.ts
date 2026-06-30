import { BookingIntentsController } from '../../../src/nest/booking-intents/booking-intents.controller';
import {
  BookingIntentValidationError,
  type BookingIntentsService,
} from '../../../src/nest/booking-intents/booking-intents.service';
import type { User } from '../../../src/types';
import { HttpException } from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';

const user = { id: 1, role: 'user', email: 'u@example.test' } as User;
const trip = { id: 5, user_id: 1 };

function makeService(overrides: Partial<BookingIntentsService> = {}): BookingIntentsService {
  return {
    verifyTripAccess: vi.fn().mockResolvedValue(trip),
    canEdit: vi.fn().mockResolvedValue(true),
    broadcast: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 9, status: 'draft' }),
    update: vi.fn().mockResolvedValue({ id: 9, status: 'watching' }),
    startWatch: vi.fn().mockResolvedValue({
      bookingIntent: { id: 9, status: 'watching', watch_status: 'queued' },
      agentJob: { id: 3, type: 'booking-intent.price-watch', status: 'queued' },
    }),
    archive: vi.fn().mockResolvedValue({ id: 9, status: 'archived' }),
    ...overrides,
  } as unknown as BookingIntentsService;
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

describe('BookingIntentsController', () => {
  it('404 when trip is not accessible', async () => {
    const svc = makeService({
      verifyTripAccess: vi.fn().mockResolvedValue(undefined),
    });
    await expect(thrown(() => new BookingIntentsController(svc).list(user, '5'))).resolves.toEqual({
      status: 404,
      body: { error: 'Trip not found' },
    });
  });

  it('GET / lists booking intents and maps validation errors', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 1, status: 'draft' }]);
    const svc = makeService({ list } as Partial<BookingIntentsService>);
    await expect(new BookingIntentsController(svc).list(user, '5', 'draft')).resolves.toEqual({
      booking_intents: [{ id: 1, status: 'draft' }],
    });
    expect(list).toHaveBeenCalledWith('5', 'draft');

    const bad = makeService({
      list: vi.fn().mockRejectedValue(new BookingIntentValidationError('bad status')),
    });
    await expect(thrown(() => new BookingIntentsController(bad).list(user, '5', 'bad'))).resolves.toEqual({
      status: 400,
      body: { error: 'bad status' },
    });
  });

  it('POST requires edit permission, creates, and broadcasts', async () => {
    const denied = makeService({ canEdit: vi.fn().mockResolvedValue(false) });
    await expect(
      thrown(() =>
        new BookingIntentsController(denied).create(user, '5', {
          type: 'flight',
        }),
      ),
    ).resolves.toEqual({
      status: 403,
      body: { error: 'No permission' },
    });

    const create = vi.fn().mockResolvedValue({ id: 9, type: 'flight' });
    const broadcast = vi.fn();
    const svc = makeService({
      create,
      broadcast,
    } as Partial<BookingIntentsService>);
    await expect(new BookingIntentsController(svc).create(user, '5', { type: 'flight' }, 'sock')).resolves.toEqual({
      booking_intent: { id: 9, type: 'flight' },
    });
    expect(create).toHaveBeenCalledWith('5', 1, { type: 'flight' });
    expect(broadcast).toHaveBeenCalledWith(
      '5',
      'booking-intent:created',
      { booking_intent: { id: 9, type: 'flight' } },
      'sock',
    );
  });

  it('POST maps service validation to 400', async () => {
    const svc = makeService({
      create: vi.fn().mockRejectedValue(new BookingIntentValidationError('type is required')),
    });
    await expect(thrown(() => new BookingIntentsController(svc).create(user, '5', {}))).resolves.toEqual({
      status: 400,
      body: { error: 'type is required' },
    });
  });

  it('PUT updates or 404s when the intent is missing', async () => {
    const missing = makeService({ update: vi.fn().mockResolvedValue(null) });
    await expect(thrown(() => new BookingIntentsController(missing).update(user, '5', '9', {}))).resolves.toEqual({
      status: 404,
      body: { error: 'Booking intent not found' },
    });

    const update = vi.fn().mockResolvedValue({ id: 9, status: 'approved' });
    const broadcast = vi.fn();
    const svc = makeService({
      update,
      broadcast,
    } as Partial<BookingIntentsService>);
    await expect(
      new BookingIntentsController(svc).update(user, '5', '9', { status: 'approved' }, 'sock'),
    ).resolves.toEqual({
      booking_intent: { id: 9, status: 'approved' },
    });
    expect(broadcast).toHaveBeenCalledWith(
      '5',
      'booking-intent:updated',
      { booking_intent: { id: 9, status: 'approved' } },
      'sock',
    );
  });

  it('POST /:id/start-watch starts watching, broadcasts, and returns the queued job', async () => {
    const missing = makeService({ startWatch: vi.fn().mockResolvedValue(null) });
    await expect(thrown(() => new BookingIntentsController(missing).startWatch(user, '5', '9'))).resolves.toEqual({
      status: 404,
      body: { error: 'Booking intent not found' },
    });

    const startWatch = vi.fn().mockResolvedValue({
      bookingIntent: { id: 9, status: 'watching', watch_status: 'queued' },
      agentJob: { id: 3, type: 'booking-intent.price-watch', status: 'queued' },
    });
    const broadcast = vi.fn();
    const svc = makeService({
      startWatch,
      broadcast,
    } as Partial<BookingIntentsService>);

    await expect(new BookingIntentsController(svc).startWatch(user, '5', '9', 'sock')).resolves.toEqual({
      booking_intent: { id: 9, status: 'watching', watch_status: 'queued' },
      agent_job: { id: 3, type: 'booking-intent.price-watch', status: 'queued' },
    });
    expect(startWatch).toHaveBeenCalledWith('5', '9');
    expect(broadcast).toHaveBeenCalledWith(
      '5',
      'booking-intent:watch-started',
      {
        booking_intent: { id: 9, status: 'watching', watch_status: 'queued' },
        agent_job: { id: 3, type: 'booking-intent.price-watch', status: 'queued' },
      },
      'sock',
    );
  });

  it('POST /:id/archive archives with 200 semantics or 404s', async () => {
    const missing = makeService({ archive: vi.fn().mockResolvedValue(null) });
    await expect(thrown(() => new BookingIntentsController(missing).archive(user, '5', '9'))).resolves.toEqual({
      status: 404,
      body: { error: 'Booking intent not found' },
    });

    const archive = vi.fn().mockResolvedValue({ id: 9, status: 'archived' });
    const broadcast = vi.fn();
    const svc = makeService({
      archive,
      broadcast,
    } as Partial<BookingIntentsService>);
    await expect(new BookingIntentsController(svc).archive(user, '5', '9', 'sock')).resolves.toEqual({
      booking_intent: { id: 9, status: 'archived' },
    });
    expect(broadcast).toHaveBeenCalledWith(
      '5',
      'booking-intent:archived',
      { booking_intent: { id: 9, status: 'archived' } },
      'sock',
    );
  });
});
