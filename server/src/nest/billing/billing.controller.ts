import type { User } from '../../types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingError, BillingService } from './billing.service';
import { Body, Controller, Get, HttpCode, HttpException, Post, UseGuards } from '@nestjs/common';

@Controller('api/billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('entitlements')
  async getEntitlements(@CurrentUser() user: User) {
    return this.billing.getEntitlements(user);
  }

  @Post('checkout-session')
  @HttpCode(200)
  async createCheckoutSession(@CurrentUser() user: User, @Body() body: unknown = {}) {
    return this.handleBillingError(() => this.billing.createCheckoutSession(user, requestBody(body)));
  }

  @Post('portal-session')
  @HttpCode(200)
  async createPortalSession(@CurrentUser() user: User, @Body() body: unknown = {}) {
    return this.handleBillingError(() => this.billing.createPortalSession(user, requestBody(body)));
  }

  private async handleBillingError<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BillingError) {
        throw new HttpException({ error: err.message }, err.status);
      }
      throw err;
    }
  }
}

function requestBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
