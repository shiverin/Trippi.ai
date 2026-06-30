import { writeAudit, getClientIp } from '../../services/auditLog';
import type { User } from '../../types';
import { AuthService } from './auth.service';
import { OptionalJwtGuard } from './optional-jwt.guard';
import { RateLimitService, rateLimitEmailKey, rateLimitIpKey, rateLimitOpaqueKey } from './rate-limit.service';
import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';

import type { Request, Response } from 'express';

const WINDOW = 15 * 60 * 1000;
const LOGIN_MIN_LATENCY_MS = 350;
const FORGOT_MIN_LATENCY_MS = 350;
const GENERIC_FORGOT_RESPONSE = { ok: true };
const LIMITS = {
  demoIp: 20,
  inviteIp: 120,
  inviteToken: 20,
  registerIp: 120,
  registerEmail: 3,
  loginIp: 300,
  loginEmail: 10,
  forgotIp: 60,
  forgotEmail: 3,
  resetIp: 60,
  resetToken: 5,
  mfaIp: 120,
  mfaToken: 5,
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Public auth endpoints (no session required). Source-IP buckets are deliberately
 * wider than the target-specific buckets because production traffic may arrive
 * through a shared proxy edge. Email/token keys are hashed before storage.
 */
@Controller('api/auth')
export class AuthPublicController {
  constructor(
    private readonly auth: AuthService,
    private readonly rl: RateLimitService,
  ) {}

  private limit(bucket: string, req: Request, max: number, key = rateLimitIpKey(req)): void {
    if (!this.rl.check(bucket, key, max, WINDOW, Date.now())) {
      throw new HttpException({ error: 'Too many attempts. Please try again later.' }, 429);
    }
  }

  @Get('app-config')
  @UseGuards(OptionalJwtGuard)
  async appConfig(@Req() req: Request) {
    return this.auth.getAppConfig((req.user as User | undefined) ?? undefined);
  }

  @Post('demo-login')
  @HttpCode(200)
  async demoLogin(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.limit('auth_demo_ip', req, LIMITS.demoIp);
    const result = await this.auth.demoLogin();
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    this.auth.setAuthCookie(res, result.token!, req);
    return { token: result.token, user: result.user };
  }

  @Get('invite/:token')
  async invite(@Param('token') token: string, @Req() req: Request) {
    this.limit('auth_invite_ip', req, LIMITS.inviteIp);
    const tokenKey = rateLimitOpaqueKey('invite', token);
    if (tokenKey) this.limit('auth_invite_token', req, LIMITS.inviteToken, tokenKey);
    const result = await this.auth.validateInviteToken(token);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    return {
      valid: result.valid,
      max_uses: result.max_uses,
      used_count: result.used_count,
      expires_at: result.expires_at,
    };
  }

  @Post('register')
  @HttpCode(201)
  async register(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.limit('auth_register_ip', req, LIMITS.registerIp);
    const emailKey = rateLimitEmailKey((body as { email?: unknown } | undefined)?.email);
    if (emailKey) this.limit('auth_register_email', req, LIMITS.registerEmail, emailKey);
    const result = await this.auth.registerUser(body);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    writeAudit({
      userId: result.auditUserId!,
      action: 'user.register',
      ip: getClientIp(req),
      details: result.auditDetails,
    });
    this.auth.setAuthCookie(res, result.token!, req);
    return { token: result.token, user: result.user };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.limit('auth_login_ip', req, LIMITS.loginIp);
    const emailKey = rateLimitEmailKey((body as { email?: unknown } | undefined)?.email);
    if (emailKey) this.limit('auth_login_email', req, LIMITS.loginEmail, emailKey);
    const started = Date.now();
    const result = await this.auth.loginUser(body);
    if (result.auditAction) {
      writeAudit({
        userId: result.auditUserId ?? null,
        action: result.auditAction,
        ip: getClientIp(req),
        details: result.auditDetails,
      });
    }
    const elapsed = Date.now() - started;
    if (elapsed < LOGIN_MIN_LATENCY_MS) await delay(LOGIN_MIN_LATENCY_MS - elapsed);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    if (result.mfa_required) {
      return { mfa_required: true, mfa_token: result.mfa_token };
    }
    this.auth.setAuthCookie(res, result.token!, req, result.remember);
    return { token: result.token, user: result.user };
  }

  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() body: { email?: unknown }, @Req() req: Request) {
    this.limit('auth_forgot_ip', req, LIMITS.forgotIp);
    const emailKey = rateLimitEmailKey(body?.email);
    if (emailKey) this.limit('auth_forgot_email', req, LIMITS.forgotEmail, emailKey);
    const started = Date.now();
    const rawEmail = typeof body?.email === 'string' ? body.email : '';
    const ip = getClientIp(req);

    const outcome = await this.auth.requestPasswordReset(rawEmail, ip);
    if (outcome.reason === 'issued' && outcome.tokenForDelivery && outcome.userEmail) {
      const origin = this.auth.getAppUrl();
      const url = `${origin.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(outcome.tokenForDelivery)}`;
      writeAudit({
        userId: outcome.userId,
        action: 'user.password_reset_request',
        ip,
        details: { delivered: 'pending' },
      });
      try {
        const delivery = await this.auth.sendPasswordResetEmail(outcome.userEmail, url, outcome.userId);
        writeAudit({
          userId: outcome.userId,
          action: 'user.password_reset_request',
          ip,
          details: { delivered: delivery.delivered },
        });
      } catch {
        writeAudit({
          userId: outcome.userId,
          action: 'user.password_reset_request',
          ip,
          details: { delivered: 'failed' },
        });
      }
    } else {
      writeAudit({
        userId: outcome.userId,
        action: 'user.password_reset_request',
        ip,
        details: { reason: outcome.reason },
      });
    }
    const elapsed = Date.now() - started;
    if (elapsed < FORGOT_MIN_LATENCY_MS) await delay(FORGOT_MIN_LATENCY_MS - elapsed);
    return GENERIC_FORGOT_RESPONSE;
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() body: unknown, @Req() req: Request) {
    this.limit('auth_reset_ip', req, LIMITS.resetIp);
    const tokenKey = rateLimitOpaqueKey('reset', (body as { token?: unknown } | undefined)?.token);
    if (tokenKey) this.limit('auth_reset_token', req, LIMITS.resetToken, tokenKey);
    const ip = getClientIp(req);
    const result = await this.auth.resetPassword(body);
    if (result.error) {
      writeAudit({ userId: null, action: 'user.password_reset_fail', ip, details: { reason: result.error } });
      throw new HttpException({ error: result.error }, result.status!);
    }
    if (result.mfa_required) {
      return { mfa_required: true };
    }
    writeAudit({ userId: result.userId ?? null, action: 'user.password_reset_success', ip });
    return { success: true };
  }

  @Post('mfa/verify-login')
  @HttpCode(200)
  async verifyMfaLogin(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.limit('auth_mfa_ip', req, LIMITS.mfaIp);
    const tokenKey = rateLimitOpaqueKey('mfa-login', (body as { mfa_token?: unknown } | undefined)?.mfa_token);
    if (tokenKey) this.limit('auth_mfa_token', req, LIMITS.mfaToken, tokenKey);
    const result = await this.auth.verifyMfaLogin(body);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    writeAudit({ userId: result.auditUserId!, action: 'user.login', ip: getClientIp(req), details: { mfa: true } });
    this.auth.setAuthCookie(res, result.token!, req, result.remember);
    return { token: result.token, user: result.user };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.auth.clearAuthCookie(res, req);
    return { success: true };
  }
}
