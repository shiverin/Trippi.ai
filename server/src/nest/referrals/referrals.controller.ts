import {
  dismissReferralExpiryWarning,
  getReferralExpiryWarning,
  getReferralSummary,
  validateReferralCodeForPublic,
} from '../../services/referralService';
import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Body, Controller, Get, HttpException, Param, Post, UseGuards } from '@nestjs/common';

@Controller('api/referrals')
export class ReferralsController {
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: User) {
    return getReferralSummary(user.id);
  }

  @Post('me')
  @UseGuards(JwtAuthGuard)
  async create(@CurrentUser() user: User) {
    return getReferralSummary(user.id, { create: true });
  }

  @Get('expiry-warning')
  @UseGuards(JwtAuthGuard)
  async expiryWarning(@CurrentUser() user: User) {
    return getReferralExpiryWarning(user.id);
  }

  @Post('expiry-warning/dismiss')
  @UseGuards(JwtAuthGuard)
  async dismissExpiryWarning(@CurrentUser() user: User, @Body() body: { active_until?: unknown }) {
    await dismissReferralExpiryWarning(user.id, body?.active_until);
    return { ok: true };
  }

  @Get(':code')
  async validate(@Param('code') code: string) {
    const result = await validateReferralCodeForPublic(code);
    if (!result.valid) throw new HttpException({ error: 'Invalid referral link', valid: false }, 404);
    return result;
  }
}
