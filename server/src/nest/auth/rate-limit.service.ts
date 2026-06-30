import { Injectable } from '@nestjs/common';

import type { Request } from 'express';
import crypto from 'node:crypto';

interface Attempt {
  count: number;
  first: number;
}

const DEFAULT_MAX_KEYS_PER_BUCKET = 100_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function maxKeysPerBucket(): number {
  const parsed = Number.parseInt(process.env.RATE_LIMIT_MAX_KEYS_PER_BUCKET ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_KEYS_PER_BUCKET;
}

export function rateLimitHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function rateLimitIpKey(req: Pick<Request, 'ip' | 'headers' | 'socket'>): string {
  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

export function rateLimitEmailKey(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return null;
  return `email:${rateLimitHash(normalized)}`;
}

export function rateLimitUserKey(userId: unknown): string | null {
  if (typeof userId !== 'number' && typeof userId !== 'bigint' && typeof userId !== 'string') return null;
  const normalized = String(userId).trim();
  if (!normalized) return null;
  return `user:${normalized}`;
}

export function rateLimitOpaqueKey(prefix: string, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return `${prefix}:${rateLimitHash(normalized)}`;
}

/**
 * In-memory per-key rate limiter for auth-adjacent flows. Each named bucket
 * keeps its own attempt map; `check` returns false once a key exceeds `max`
 * within `windowMs` (the caller answers 429).
 *
 * Expired records are pruned opportunistically when a bucket approaches the
 * configured cap, so abusive unique-key sprays cannot grow memory forever.
 */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Map<string, Attempt>>();
  private readonly maxKeys = maxKeysPerBucket();

  private store(bucket: string): Map<string, Attempt> {
    let s = this.buckets.get(bucket);
    if (!s) {
      s = new Map();
      this.buckets.set(bucket, s);
    }
    return s;
  }

  private prune(store: Map<string, Attempt>, windowMs: number, now: number): void {
    if (store.size < this.maxKeys) return;
    for (const [key, record] of store) {
      if (now - record.first >= windowMs) store.delete(key);
    }
    while (store.size >= this.maxKeys) {
      const oldest = store.keys().next().value as string | undefined;
      if (!oldest) break;
      store.delete(oldest);
    }
  }

  /** Returns true when the request is allowed, false when it should be rejected (429). */
  check(bucket: string, key: string, max: number, windowMs: number, now: number): boolean {
    const store = this.store(bucket);
    const record = store.get(key);
    if (record && record.count >= max && now - record.first < windowMs) {
      return false;
    }
    if (!record || now - record.first >= windowMs) {
      this.prune(store, windowMs, now);
      store.set(key, { count: 1, first: now });
    } else {
      record.count++;
    }
    return true;
  }

  /** Test helper: clear a bucket (mirrors the legacy exported maps used for resets). */
  reset(bucket?: string): void {
    if (bucket) this.buckets.get(bucket)?.clear();
    else this.buckets.clear();
  }
}
