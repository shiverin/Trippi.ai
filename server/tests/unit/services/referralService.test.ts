import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';
import {
  getLockedOwnedTripIdsForUser,
  getEntitlementsForUser,
} from '../../../src/services/entitlementService';
import {
  REFERRAL_MAX_BONUS_DAYS,
  awardReferralBonusDays,
  completeReferralSignup,
  getReferralBonusState,
  getReferralSummary,
  validateReferralCodeForPublic,
} from '../../../src/services/referralService';
import { upsertStripeSubscriptionState } from '../../../src/services/subscriptionService';
import { createTrip, createUser } from '../../helpers/factories';
import { resetTestDb } from '../../helpers/test-db';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return {
    testDb: db,
    dbMock: {
      db,
      closeDb: () => {},
      reinitialize: () => {},
      getPlaceWithTags: () => null,
      canAccessTrip: () => null,
      isOwner: () => false,
    },
  };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
});

afterAll(() => {
  testDb.close();
});

describe('referralService', () => {
  it('creates and validates a referral code without duplicating it', async () => {
    const { user } = createUser(testDb);

    const first = await getReferralSummary(user.id, { create: true });
    const second = await getReferralSummary(user.id, { create: true });

    expect(first.code).toBeTruthy();
    expect(second.code).toBe(first.code);
    await expect(validateReferralCodeForPublic(first.code)).resolves.toMatchObject({
      valid: true,
      code: first.code,
      referrer_username: user.username,
      reward_days: 7,
    });
  });

  it('awards both sides once per successful signup and prevents duplicate/self referrals', async () => {
    const { user: referrer } = createUser(testDb);
    const { user: referred } = createUser(testDb);
    const summary = await getReferralSummary(referrer.id, { create: true });

    await expect(completeReferralSignup(summary.code, referrer.id)).resolves.toEqual({ applied: false, reason: 'self' });
    await expect(completeReferralSignup(summary.code, referred.id)).resolves.toEqual({ applied: true });
    await expect(completeReferralSignup(summary.code, referred.id)).resolves.toEqual({
      applied: false,
      reason: 'duplicate',
    });

    expect(testDb.prepare('SELECT COUNT(*) AS count FROM referrals').get()).toMatchObject({ count: 1 });
    await expect(getReferralBonusState(referrer.id)).resolves.toMatchObject({ active: true, daysRemaining: 7 });
    await expect(getReferralBonusState(referred.id)).resolves.toMatchObject({ active: true, daysRemaining: 7 });
  });

  it('caps active local Pro bonus days at 90', async () => {
    const { user } = createUser(testDb);

    for (let i = 0; i < 20; i += 1) {
      await awardReferralBonusDays(user.id, 7, { paidAccessActive: false });
    }

    const bonus = await getReferralBonusState(user.id);
    expect(bonus.active).toBe(true);
    expect(bonus.daysRemaining).toBeLessThanOrEqual(REFERRAL_MAX_BONUS_DAYS);
    expect(bonus.daysRemaining).toBeGreaterThan(80);
  });

  it('keeps bonuses pending for paid users and activates them after paid access ends', async () => {
    const { user } = createUser(testDb);
    await upsertStripeSubscriptionState({
      userId: user.id,
      stripeCustomerId: 'cus_paid_referral',
      stripeSubscriptionId: 'sub_paid_referral',
      status: 'active',
      planKey: 'pro',
    });

    await awardReferralBonusDays(user.id);
    await expect(getReferralBonusState(user.id, { paidAccessActive: true })).resolves.toMatchObject({
      active: false,
      pendingDays: 7,
    });

    await upsertStripeSubscriptionState({
      userId: user.id,
      stripeCustomerId: 'cus_paid_referral',
      stripeSubscriptionId: 'sub_paid_referral',
      status: 'canceled',
      planKey: 'pro',
    });

    await expect(getEntitlementsForUser(user.id)).resolves.toMatchObject({
      planKey: 'pro',
      billingPlanKey: 'referral_bonus',
      billingStatus: 'referral_bonus',
      subscribed: false,
      referralBonus: { active: true, pendingDays: 0, daysRemaining: 7 },
    });
  });

  it('locks only surplus owned trips after the newest five unless referral Pro is active', async () => {
    const { user } = createUser(testDb);
    const trips = Array.from({ length: 7 }, (_, index) => createTrip(testDb, user.id, { title: `Trip ${index + 1}` }));

    await expect(getLockedOwnedTripIdsForUser(user.id)).resolves.toEqual(new Set([trips[1].id, trips[0].id]));

    await awardReferralBonusDays(user.id, 7, { paidAccessActive: false });
    await expect(getLockedOwnedTripIdsForUser(user.id)).resolves.toEqual(new Set());
  });
});
