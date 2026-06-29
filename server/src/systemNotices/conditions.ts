import { isAddonEnabled, isAddonEnabledAsync } from '../services/adminService.js';
import type { NoticeCondition, SystemNotice } from './types.js';

import semver from 'semver';

interface ConditionContext {
  user: { login_count: number; first_seen_version: string; role: string; noTrips: number };
  currentAppVersion: string;
  now: Date;
}

// Custom predicate registry — extensible without modifying this file
const customPredicates = new Map<string, (ctx: ConditionContext) => boolean>();
export function registerPredicate(id: string, fn: (ctx: ConditionContext) => boolean): void {
  customPredicates.set(id, fn);
}

const customPredicatesAsync = new Map<string, (ctx: ConditionContext) => boolean | Promise<boolean>>();
export function registerPredicateAsync(id: string, fn: (ctx: ConditionContext) => boolean | Promise<boolean>): void {
  customPredicatesAsync.set(id, fn);
}

function evaluateOne(condition: NoticeCondition, ctx: ConditionContext): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'firstLogin':
      // login_count is incremented during login, so on the FIRST post-login fetch it's 1.
      return ctx.user.login_count <= 1;
    case 'noTrips':
      return ctx.user.noTrips === 0;

    case 'existingUserBeforeVersion': {
      // Show to users who existed BEFORE this version was released.
      // Backfilled users have first_seen_version='0.0.0', so all pass semver.lt.
      const userVersion = semver.valid(ctx.user.first_seen_version) ?? '0.0.0';
      const noticeVersion = semver.valid(condition.version);
      if (!noticeVersion) return false;
      // Strip prerelease/build metadata so '3.0.0-pre.42' is treated as '3.0.0'.
      const appVersion = semver.coerce(ctx.currentAppVersion)?.version ?? '0.0.0';
      return semver.lt(userVersion, noticeVersion) && semver.gte(appVersion, noticeVersion);
    }

    case 'dateWindow': {
      const start = new Date(condition.startsAt);
      const end = condition.endsAt ? new Date(condition.endsAt) : null;
      return ctx.now >= start && (end === null || ctx.now <= end);
    }

    case 'role':
      return condition.roles.includes(ctx.user.role as 'admin' | 'user');

    case 'addonEnabled':
      return isAddonEnabled(condition.addonId);

    case 'custom': {
      const fn = customPredicates.get(condition.id);
      if (!fn) {
        console.warn(`[systemNotices] unknown custom predicate: "${condition.id}"`);
        return false;
      }
      return fn(ctx);
    }

    default:
      return false;
  }
}

async function evaluateOneAsync(condition: NoticeCondition, ctx: ConditionContext): Promise<boolean> {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'firstLogin':
      return ctx.user.login_count <= 1;
    case 'noTrips':
      return ctx.user.noTrips === 0;

    case 'existingUserBeforeVersion': {
      const userVersion = semver.valid(ctx.user.first_seen_version) ?? '0.0.0';
      const noticeVersion = semver.valid(condition.version);
      if (!noticeVersion) return false;
      const appVersion = semver.coerce(ctx.currentAppVersion)?.version ?? '0.0.0';
      return semver.lt(userVersion, noticeVersion) && semver.gte(appVersion, noticeVersion);
    }

    case 'dateWindow': {
      const start = new Date(condition.startsAt);
      const end = condition.endsAt ? new Date(condition.endsAt) : null;
      return ctx.now >= start && (end === null || ctx.now <= end);
    }

    case 'role':
      return condition.roles.includes(ctx.user.role as 'admin' | 'user');

    case 'addonEnabled':
      return isAddonEnabledAsync(condition.addonId);

    case 'custom': {
      const asyncFn = customPredicatesAsync.get(condition.id);
      if (asyncFn) return asyncFn(ctx);
      const fn = customPredicates.get(condition.id);
      if (!fn) {
        console.warn(`[systemNotices] unknown custom predicate: "${condition.id}"`);
        return false;
      }
      return fn(ctx);
    }

    default:
      return false;
  }
}

/** Returns true only if ALL conditions pass (AND logic). */
export function evaluate(notice: SystemNotice, ctx: ConditionContext): boolean {
  return notice.conditions.every((c) => evaluateOne(c, ctx));
}

/** Async variant for request paths running under `TRIPPI_DB_PROVIDER=oracle-async`. */
export async function evaluateAsync(notice: SystemNotice, ctx: ConditionContext): Promise<boolean> {
  for (const condition of notice.conditions) {
    if (!(await evaluateOneAsync(condition, ctx))) return false;
  }
  return true;
}

export type { ConditionContext };
