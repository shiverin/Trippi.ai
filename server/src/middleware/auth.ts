import { JWT_SECRET } from '../config';
import { asyncDb } from '../db/asyncDatabase';
import { logWarn } from '../services/auditLog';
import { isDemoEmail } from '../services/demo';
import { AuthRequest, OptionalAuthRequest, User } from '../types';
import { applyIdempotency } from './idempotency';

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

export function extractToken(req: Request): string | null {
  // Prefer httpOnly cookie; fall back to Authorization: Bearer (MCP, API clients)
  const cookieToken = (req as any).cookies?.trippi_session;
  if (cookieToken) return cookieToken;
  const authHeader = req.headers['authorization'];
  return (authHeader && authHeader.split(' ')[1]) || null;
}

interface AuthUserCacheEntry {
  expiresAt: number;
  promise?: Promise<User | null>;
  user?: User;
}

const AUTH_USER_CACHE_TTL_MS = Math.max(0, Number(process.env.AUTH_USER_CACHE_TTL_MS ?? 15_000));
const AUTH_USER_CACHE_MAX = Math.max(0, Number(process.env.AUTH_USER_CACHE_MAX ?? 1000));
const authUserCache = new Map<string, AuthUserCacheEntry>();

function authTokenCacheKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

function cloneUser(user: User): User {
  return { ...user };
}

function trimAuthUserCache(): void {
  if (!AUTH_USER_CACHE_MAX) {
    authUserCache.clear();
    return;
  }
  while (authUserCache.size > AUTH_USER_CACHE_MAX) {
    const firstKey = authUserCache.keys().next().value as string | undefined;
    if (!firstKey) return;
    authUserCache.delete(firstKey);
  }
}

export function clearAuthUserCache(): void {
  authUserCache.clear();
}

/**
 * Verify a JWT and load its user, enforcing the password_version gate.
 *
 * Exported so every auth surface in the codebase (MCP bearer tokens,
 * file download query tokens, the photo-serving route) goes through the
 * same check. A password reset bumps `users.password_version`, which
 * invalidates every JWT that embedded the prior value — but only if
 * every verify path actually compares the claim. Previously several
 * paths called `jwt.verify` directly and skipped the DB lookup, so a
 * stolen token kept working after the victim reset.
 */
export async function verifyJwtAndLoadUser(token: string): Promise<User | null> {
  const startedAt = Date.now();
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as {
      id: number;
      pv?: number;
      purpose?: string;
    };
    // Purpose-scoped tokens (e.g. the short-lived mfa_login token) share this
    // secret but are not full session tokens — only their dedicated endpoint
    // may accept them, so reject any token carrying a purpose claim here.
    if (decoded.purpose) return null;

    if (AUTH_USER_CACHE_TTL_MS > 0) {
      const now = Date.now();
      const key = authTokenCacheKey(token);
      const cached = authUserCache.get(key);
      if (cached && cached.expiresAt > now) {
        if (cached.user) return cloneUser(cached.user);
        if (cached.promise) {
          const pendingUser = await cached.promise;
          return pendingUser ? cloneUser(pendingUser) : null;
        }
      }

      const promise = loadUserForSession(decoded.id, decoded.pv).then(
        (user) => {
          if (user) {
            authUserCache.set(key, { user: cloneUser(user), expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS });
            trimAuthUserCache();
          } else {
            authUserCache.delete(key);
          }
          return user;
        },
        (err) => {
          authUserCache.delete(key);
          throw err;
        },
      );
      authUserCache.set(key, { promise, expiresAt: now + AUTH_USER_CACHE_TTL_MS });
      trimAuthUserCache();
      const user = await promise;
      return user ? cloneUser(user) : null;
    }

    return await loadUserForSession(decoded.id, decoded.pv);
  } catch {
    return null;
  } finally {
    const ms = Date.now() - startedAt;
    if (ms >= 1000) {
      logWarn(`[perf] verifyJwtAndLoadUser took ${ms}ms`);
    }
  }
}

async function loadUserForSession(userId: number, tokenPasswordVersion?: number): Promise<User | null> {
  const row = await asyncDb
    .prepare('SELECT id, username, email, role, password_version FROM users WHERE id = ?')
    .get<User & { password_version?: number }>(userId);
  if (!row) return null;
  // Session invalidation: any token whose embedded password_version
  // predates the user's current one is rejected. Tokens issued before
  // the `pv` claim existed (tokenPasswordVersion === undefined) are treated as
  // version 0 so legacy sessions keep working until the user resets.
  const tokenPv = typeof tokenPasswordVersion === 'number' ? tokenPasswordVersion : 0;
  const currentPv = typeof row.password_version === 'number' ? row.password_version : 0;
  if (tokenPv !== currentPv) return null;
  // Don't leak password_version beyond the middleware.
  const { password_version: _pv, ...user } = row;
  return user as User;
}

const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  void (async () => {
    const token = extractToken(req);

    if (!token) {
      res.status(401).json({ error: 'Access token required', code: 'AUTH_REQUIRED' });
      return;
    }

    const user = await verifyJwtAndLoadUser(token);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired token', code: 'AUTH_REQUIRED' });
      return;
    }
    (req as AuthRequest).user = user;
    applyIdempotency(req, res, next, user.id);
  })().catch(next);
};

/** Like `authenticate` but rejects requests that don't carry an httpOnly session cookie.
 *  Used on state-mutating OAuth endpoints (consent POST, client CRUD, session revoke)
 *  to prevent Bearer JWT tokens obtained by other means from managing OAuth clients. */
const requireCookieAuth = (req: Request, res: Response, next: NextFunction): void => {
  void (async () => {
    const cookieToken = (req as any).cookies?.trippi_session;
    if (!cookieToken) {
      res.status(401).json({ error: 'Cookie session required for this endpoint', code: 'COOKIE_AUTH_REQUIRED' });
      return;
    }
    const user = await verifyJwtAndLoadUser(cookieToken);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
      return;
    }
    (req as AuthRequest).user = user;
    next();
  })().catch(next);
};

const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  void (async () => {
    const token = extractToken(req);

    if (!token) {
      (req as OptionalAuthRequest).user = null;
      return next();
    }

    (req as OptionalAuthRequest).user = (await verifyJwtAndLoadUser(token)) || null;
    next();
  })().catch(next);
};

const adminOnly = (req: Request, res: Response, next: NextFunction): void => {
  const authReq = req as AuthRequest;
  if (!authReq.user || authReq.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
};

const demoUploadBlock = (req: Request, res: Response, next: NextFunction): void => {
  const authReq = req as AuthRequest;
  if (process.env.DEMO_MODE?.toLowerCase() === 'true' && isDemoEmail(authReq.user?.email)) {
    res.status(403).json({ error: 'Uploads are disabled in demo mode. Self-host trippi.ai for full functionality.' });
    return;
  }
  next();
};

export { authenticate, requireCookieAuth, optionalAuth, adminOnly, demoUploadBlock };
