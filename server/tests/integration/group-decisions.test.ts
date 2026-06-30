/**
 * Group decisions integration tests.
 */
import { buildApp } from '../../src/bootstrap';
import { runMigrations } from '../../src/db/migrations';
import { createTables } from '../../src/db/schema';
import { invalidatePermissionsCache } from '../../src/services/permissions';
import { authCookie } from '../helpers/auth';
import {
  addTripMember,
  createDay,
  createPackingItem,
  createPlace,
  createReservation,
  createTrip,
  createUser,
} from '../helpers/factories';
import { resetRateLimits, resetTestDb } from '../helpers/test-db';
import type { INestApplication } from '@nestjs/common';

import type { Application } from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: (placeId: number) => {
      const place: any = db
        .prepare(
          `SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
           FROM places p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?`,
        )
        .get(placeId);
      if (!place) return null;
      const tags = db
        .prepare(`SELECT t.* FROM tags t JOIN place_tags pt ON t.id = pt.tag_id WHERE pt.place_id = ?`)
        .all(placeId);
      return {
        ...place,
        category: place.category_id
          ? { id: place.category_id, name: place.category_name, color: place.category_color, icon: place.category_icon }
          : null,
        tags,
      };
    },
    canAccessTrip: (tripId: any, userId: number) =>
      db
        .prepare(
          `SELECT t.id, t.user_id FROM trips t
           LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
           WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`,
        )
        .get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../src/db/database', () => dbMock);
vi.mock('../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trippi-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
  SESSION_DURATION: '24h',
  SESSION_DURATION_MS: 86400000,
  SESSION_DURATION_SECONDS: 86400,
  DEFAULT_LANGUAGE: 'en',
}));
vi.mock('../../src/websocket', () => ({ broadcast: vi.fn(), broadcastToUser: vi.fn() }));

let nestApp: INestApplication;
let app: Application;

beforeAll(async () => {
  createTables(testDb);
  runMigrations(testDb);
  nestApp = await buildApp();
  app = nestApp.getHttpAdapter().getInstance();
});

beforeEach(() => {
  resetTestDb(testDb);
  resetRateLimits(nestApp);
  invalidatePermissionsCache();
});

afterAll(async () => {
  await nestApp.close();
  testDb.close();
});

describe('Group decisions API', () => {
  it('creates and reads a decision linked to trip planning objects', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const day = createDay(testDb, trip.id);
    const place = createPlace(testDb, trip.id, { name: 'Museum' });
    const reservation = createReservation(testDb, trip.id, { title: 'Train' });
    const packingItem = createPackingItem(testDb, trip.id, { name: 'Adapter' });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/decisions`)
      .set('Cookie', authCookie(user.id))
      .send({
        title: 'Where should we stay?',
        description: 'Pick the base for the first weekend.',
        deadline: '2026-07-15T12:00:00Z',
        options: [{ label: 'Near the station' }, { label: 'Old town' }],
        links: [
          { target_type: 'trip', target_id: trip.id },
          { target_type: 'day', target_id: day.id },
          { target_type: 'place', target_id: place.id },
          { target_type: 'reservation', target_id: reservation.id },
          { target_type: 'booking_intent', target_id: 777 },
          { target_type: 'packing_item', target_id: packingItem.id },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.decision.title).toBe('Where should we stay?');
    expect(res.body.decision.deadline).toBe('2026-07-15T12:00:00Z');
    expect(res.body.decision.state).toBe('open');
    expect(res.body.decision.options.map((option: any) => option.label)).toEqual(['Near the station', 'Old town']);
    expect(res.body.decision.links.map((link: any) => link.target_type).sort()).toEqual([
      'booking_intent',
      'day',
      'packing_item',
      'place',
      'reservation',
      'trip',
    ]);

    const list = await request(app).get(`/api/trips/${trip.id}/decisions`).set('Cookie', authCookie(user.id));
    expect(list.status).toBe(200);
    expect(list.body.decisions).toHaveLength(1);
    expect(list.body.decisions[0].links).toHaveLength(6);
  });

  it('allows a trip member response and owner final selection', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    const create = await request(app)
      .post(`/api/trips/${trip.id}/decisions`)
      .set('Cookie', authCookie(owner.id))
      .send({ title: 'Dinner plan', options: ['Ramen', 'Tapas'] });
    expect(create.status).toBe(201);
    const decisionId = create.body.decision.id;
    const optionId = create.body.decision.options[1].id;

    const response = await request(app)
      .post(`/api/trips/${trip.id}/decisions/${decisionId}/responses`)
      .set('Cookie', authCookie(member.id))
      .send({ option_id: optionId, comment: 'Tapas works for me.' });
    expect(response.status).toBe(200);
    expect(response.body.decision.responses).toHaveLength(1);
    expect(response.body.decision.responses[0]).toMatchObject({
      user_id: member.id,
      option_id: optionId,
      response: 'selected',
      comment: 'Tapas works for me.',
    });

    const finalized = await request(app)
      .post(`/api/trips/${trip.id}/decisions/${decisionId}/finalize`)
      .set('Cookie', authCookie(owner.id))
      .send({ option_id: optionId });
    expect(finalized.status).toBe(200);
    expect(finalized.body.decision.state).toBe('decided');
    expect(finalized.body.decision.final_option_id).toBe(optionId);

    const lateResponse = await request(app)
      .post(`/api/trips/${trip.id}/decisions/${decisionId}/responses`)
      .set('Cookie', authCookie(member.id))
      .send({ option_id: create.body.decision.options[0].id });
    expect(lateResponse.status).toBe(400);
  });

  it('follows trip access and edit permissions', async () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const { user: outsider } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    const outsiderList = await request(app)
      .get(`/api/trips/${trip.id}/decisions`)
      .set('Cookie', authCookie(outsider.id));
    expect(outsiderList.status).toBe(404);

    const memberCreate = await request(app)
      .post(`/api/trips/${trip.id}/decisions`)
      .set('Cookie', authCookie(member.id))
      .send({ title: 'Member decision', options: ['A', 'B'] });
    expect(memberCreate.status).toBe(403);

    testDb.prepare("INSERT INTO app_settings (key, value) VALUES ('perm_trip_edit', 'trip_member')").run();
    invalidatePermissionsCache();
    const allowedCreate = await request(app)
      .post(`/api/trips/${trip.id}/decisions`)
      .set('Cookie', authCookie(member.id))
      .send({ title: 'Member decision', options: ['A', 'B'] });
    expect(allowedCreate.status).toBe(201);
  });

  it('rejects links to entities from another trip', async () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);
    const otherTrip = createTrip(testDb, user.id);
    const otherPlace = createPlace(testDb, otherTrip.id, { name: 'Wrong trip' });

    const res = await request(app)
      .post(`/api/trips/${trip.id}/decisions`)
      .set('Cookie', authCookie(user.id))
      .send({
        title: 'Invalid link',
        options: ['A', 'B'],
        links: [{ target_type: 'place', target_id: otherPlace.id }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/place/);
  });
});
