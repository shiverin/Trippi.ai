import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { sessionCookie } from './harness';

const { db } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const tmp = new Database(':memory:');
  tmp.exec('PRAGMA foreign_keys = ON');
  tmp.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      avatar TEXT,
      password_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE user_follows (
      follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, followed_id),
      CHECK (follower_id != followed_id)
    );
    CREATE TABLE trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      start_date TEXT,
      end_date TEXT,
      cover_image TEXT,
      is_archived INTEGER DEFAULT 0
    );
    CREATE TABLE days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      day_number INTEGER NOT NULL
    );
    CREATE TABLE places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      address TEXT,
      lat REAL,
      lng REAL,
      notes TEXT
    );
    CREATE TABLE place_regions (
      place_id INTEGER PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
      country_code TEXT NOT NULL,
      region_code TEXT NOT NULL,
      region_name TEXT NOT NULL
    );
    CREATE TABLE visited_countries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      country_code TEXT NOT NULL,
      UNIQUE(user_id, country_code)
    );
    CREATE TABLE share_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL REFERENCES users(id),
      share_map INTEGER DEFAULT 1,
      share_bookings INTEGER DEFAULT 1,
      share_packing INTEGER DEFAULT 0,
      share_budget INTEGER DEFAULT 0,
      share_collab INTEGER DEFAULT 0,
      profile_visible INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return { db: tmp };
});

vi.mock('../../src/db/database', () => ({ db, closeDb: () => {}, reinitialize: () => {} }));

import { FriendsModule } from '../../src/nest/friends/friends.module';
import { TrippiExceptionFilter } from '../../src/nest/common/trippi-exception.filter';
import { clearAuthUserCache } from '../../src/middleware/auth';

describe('Friends e2e (real auth guard + temp SQLite)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof build>>;

  async function build() {
    const moduleRef = await Test.createTestingModule({ imports: [FriendsModule] }).compile();
    const nest = moduleRef.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalFilters(new TrippiExceptionFilter());
    await nest.init();
    return nest;
  }

  function seed() {
    db.exec(`
      DELETE FROM share_tokens;
      DELETE FROM place_regions;
      DELETE FROM places;
      DELETE FROM days;
      DELETE FROM trips;
      DELETE FROM user_follows;
      DELETE FROM visited_countries;
      DELETE FROM users;
    `);
    db.prepare('INSERT INTO users (id, username, email, role, avatar, password_version) VALUES (?, ?, ?, ?, ?, 0)').run(
      1,
      'viewer',
      'viewer@example.test',
      'user',
      null,
    );
    db.prepare('INSERT INTO users (id, username, email, role, avatar, password_version) VALUES (?, ?, ?, ?, ?, 0)').run(
      2,
      'mika',
      'mika@example.test',
      'user',
      'mika.png',
    );
    db.prepare('INSERT INTO users (id, username, email, role, avatar, password_version) VALUES (?, ?, ?, ?, ?, 0)').run(
      3,
      'leo',
      'leo@example.test',
      'user',
      null,
    );
    db.prepare('INSERT INTO user_follows (follower_id, followed_id) VALUES (?, ?)').run(1, 2);
    db.prepare(
      'INSERT INTO trips (id, user_id, title, description, start_date, end_date, cover_image) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(10, 2, 'Visible Kyoto', 'Cherry blossom loop', '2026-03-01', '2026-03-03', null);
    db.prepare(
      'INSERT INTO trips (id, user_id, title, description, start_date, end_date, cover_image) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(11, 2, 'Hidden budget trip', 'Should stay private', '2025-04-01', '2025-04-02', null);
    db.prepare(
      'INSERT INTO trips (id, user_id, title, description, start_date, end_date, cover_image) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(12, 2, 'Expired secret trip', 'Should stay private', '2024-05-01', '2024-05-02', null);
    db.prepare('INSERT INTO days (trip_id, day_number) VALUES (?, ?), (?, ?)').run(10, 1, 10, 2);
    db.prepare('INSERT INTO places (id, trip_id, name, address, lat, lng, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      100,
      10,
      'Private ramen spot',
      'Kyoto, JP',
      35.0,
      135.0,
      'private note',
    );
    db.prepare('INSERT INTO places (id, trip_id, name, address, lat, lng, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      101,
      11,
      'Hidden hotel',
      'Paris, FR',
      48.0,
      2.0,
      'hidden note',
    );
    db.prepare('INSERT INTO place_regions (place_id, country_code, region_code, region_name) VALUES (?, ?, ?, ?)').run(
      100,
      'JP',
      'JP-26',
      'Kyoto',
    );
    db.prepare('INSERT INTO visited_countries (user_id, country_code) VALUES (?, ?)').run(2, 'SG');
    db.prepare(
      `INSERT INTO share_tokens
        (trip_id, token, created_by, share_map, share_bookings, share_packing, share_budget, share_collab, profile_visible, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(10, 'visible-token', 2, 1, 0, 0, 0, 0, 1, '2999-01-01T00:00:00.000Z');
    db.prepare(
      `INSERT INTO share_tokens
        (trip_id, token, created_by, share_map, share_bookings, share_packing, share_budget, share_collab, profile_visible, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(11, 'hidden-token', 2, 1, 1, 1, 1, 1, 0, '2999-01-01T00:00:00.000Z');
    db.prepare(
      `INSERT INTO share_tokens
        (trip_id, token, created_by, share_map, share_bookings, share_packing, share_budget, share_collab, profile_visible, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(12, 'expired-token', 2, 1, 1, 1, 1, 1, 1, '2000-01-01T00:00:00.000Z');
  }

  beforeAll(async () => {
    app = await build();
    server = app.getHttpServer();
  });

  beforeEach(() => {
    clearAuthUserCache();
    seed();
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires auth for the social hub', async () => {
    expect((await request(server).get('/api/friends')).status).toBe(401);
  });

  it('searches usernames case-insensitively, excludes self, and redacts email', async () => {
    const res = await request(server).get('/api/friends/search?q=MI').set('Cookie', sessionCookie(1));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0]).toMatchObject({ id: 2, username: 'mika', is_following: true });
    expect(JSON.stringify(res.body)).not.toContain('mika@example.test');
  });

  it('follows and unfollows idempotently while rejecting self-follow', async () => {
    const first = await request(server).post('/api/friends/3/follow').set('Cookie', sessionCookie(1)).send({});
    expect(first.status).toBe(201);
    expect(first.body.user).toMatchObject({ id: 3, username: 'leo', is_following: true });

    const second = await request(server).post('/api/friends/3/follow').set('Cookie', sessionCookie(1)).send({});
    expect(second.status).toBe(201);
    expect(db.prepare('SELECT COUNT(*) as count FROM user_follows WHERE follower_id = 1 AND followed_id = 3').get().count).toBe(1);

    const self = await request(server).post('/api/friends/1/follow').set('Cookie', sessionCookie(1)).send({});
    expect(self.status).toBe(400);

    const unfollow = await request(server).delete('/api/friends/3/follow').set('Cookie', sessionCookie(1));
    expect(unfollow.status).toBe(200);
    const again = await request(server).delete('/api/friends/3/follow').set('Cookie', sessionCookie(1));
    expect(again.status).toBe(200);
  });

  it('returns redacted profile stats and only visible, unexpired shared trips', async () => {
    const res = await request(server).get('/api/friends/users/Mika').set('Cookie', sessionCookie(1));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 2, username: 'mika', avatar_url: '/uploads/avatars/mika.png' });
    expect(res.body.stats).toMatchObject({ total_trips: 3, total_places: 2, total_countries: 3 });
    expect(res.body.shared_trips).toHaveLength(1);
    expect(res.body.shared_trips[0]).toMatchObject({
      title: 'Visible Kyoto',
      token: 'visible-token',
      day_count: 2,
      place_count: 1,
      country_count: 1,
      permissions: { share_map: true, share_bookings: false },
    });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('mika@example.test');
    expect(body).not.toContain('Private ramen spot');
    expect(body).not.toContain('private note');
    expect(body).not.toContain('Hidden budget trip');
    expect(body).not.toContain('Expired secret trip');
    expect(body).not.toContain('35');
    expect(body).not.toContain('135');
  });
});
