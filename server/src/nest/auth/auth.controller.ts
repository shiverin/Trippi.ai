import { writeAudit, getClientIp } from '../../services/auditLog';
import { isDemoEmail } from '../../services/demo';
import { deleteMediaBestEffort, storeUploadedMedia } from '../../services/mediaStorage';
import type { User } from '../../types';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RateLimitService, rateLimitUserKey } from './rate-limit.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import path from 'path';

const WINDOW = 15 * 60 * 1000;
const LIMITS = {
  accountSecurityUser: 5,
  mfaUser: 5,
  mcpTokenCreateUser: 10,
};
const ALLOWED_AVATAR_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const AVATAR_UPLOAD = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!file.mimetype.startsWith('image/') || !ALLOWED_AVATAR_EXTS.includes(ext)) {
      const err: Error & { statusCode?: number } = new Error('Only image files (jpg, png, gif, webp) are allowed');
      err.statusCode = 400;
      return cb(err, false);
    }
    cb(null, true);
  },
};

/**
 * Authenticated account endpoints. Security-sensitive operations are rate
 * limited by authenticated user id instead of only source IP, so shared proxy
 * edges do not make different users consume one another's buckets.
 */
@Controller('api/auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rl: RateLimitService,
  ) {}

  private limitUser(bucket: string, user: User, max: number): void {
    const key = rateLimitUserKey(user.id) ?? 'user:unknown';
    if (!this.rl.check(bucket, key, max, WINDOW, Date.now())) {
      throw new HttpException({ error: 'Too many attempts. Please try again later.' }, 429);
    }
  }

  @Get('me')
  async me(@CurrentUser() user: User) {
    const loaded = await this.auth.getCurrentUser(user.id);
    if (!loaded) {
      throw new HttpException({ error: 'User not found' }, 404);
    }
    return { user: loaded };
  }

  @Put('me/password')
  async changePassword(
    @CurrentUser() user: User,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.limitUser('auth_account_security_user', user, LIMITS.accountSecurityUser);
    const result = await this.auth.changePassword(user.id, user.email, body);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    // Refresh this device's cookie with the new password_version so the user
    // stays logged in here while all other sessions are invalidated.
    if (result.token) this.auth.setAuthCookie(res, result.token, req);
    writeAudit({ userId: user.id, action: 'user.password_change', ip: getClientIp(req) });
    return { success: true };
  }

  @Delete('me')
  async deleteAccount(@CurrentUser() user: User, @Req() req: Request) {
    const result = await this.auth.deleteAccount(user.id, user.email, user.role);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    writeAudit({ userId: user.id, action: 'user.account_delete', ip: getClientIp(req) });
    return { success: true };
  }

  @Put('me/maps-key')
  async mapsKey(@CurrentUser() user: User, @Body() body: { maps_api_key?: unknown }) {
    return this.auth.updateMapsKey(user.id, body.maps_api_key);
  }

  @Put('me/api-keys')
  async apiKeys(@CurrentUser() user: User, @Body() body: unknown) {
    return this.auth.updateApiKeys(user.id, body);
  }

  @Put('me/settings')
  async updateSettings(@CurrentUser() user: User, @Body() body: unknown) {
    const result = await this.auth.updateSettings(user.id, body);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    return { success: result.success, user: result.user };
  }

  @Get('me/settings')
  async getSettings(@CurrentUser() user: User) {
    const result = await this.auth.getSettings(user.id);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    return { settings: result.settings };
  }

  @Post('avatar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('avatar', AVATAR_UPLOAD))
  async avatar(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File | undefined) {
    if (process.env.DEMO_MODE?.toLowerCase() === 'true' && isDemoEmail(user.email)) {
      throw new HttpException(
        { error: 'Uploads are disabled in demo mode. Self-host trippi.ai for full functionality.' },
        403,
      );
    }
    if (!file) {
      throw new HttpException({ error: 'No image uploaded' }, 400);
    }
    const stored = await storeUploadedMedia('avatars', file, '.jpg');
    try {
      return await this.auth.saveAvatar(user.id, stored.filename);
    } catch (err) {
      await deleteMediaBestEffort(stored.key);
      throw err;
    }
  }

  @Delete('avatar')
  async deleteAvatar(@CurrentUser() user: User) {
    return this.auth.deleteAvatar(user.id);
  }

  @Get('users')
  async users(@CurrentUser() user: User) {
    return { users: await this.auth.listUsers(user.id) };
  }

  @Get('validate-keys')
  async validateKeys(@CurrentUser() user: User) {
    const result = await this.auth.validateKeys(user.id);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    return { maps: result.maps, weather: result.weather, maps_details: result.maps_details };
  }

  @Get('app-settings')
  async getAppSettings(@CurrentUser() user: User) {
    const result = await this.auth.getAppSettings(user.id);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    return result.data;
  }

  @Put('app-settings')
  async updateAppSettings(@CurrentUser() user: User, @Body() body: unknown, @Req() req: Request) {
    const result = await this.auth.updateAppSettings(user.id, body);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    writeAudit({
      userId: user.id,
      action: 'settings.app_update',
      ip: getClientIp(req),
      details: result.auditSummary,
      debugDetails: result.auditDebugDetails,
    });
    return { success: true };
  }

  @Get('travel-stats')
  async travelStats(@CurrentUser() user: User) {
    return this.auth.getTravelStats(user.id);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  async mfaSetup(@CurrentUser() user: User) {
    const result = await this.auth.setupMfa(user.id, user.email);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    try {
      const qr_svg = await result.qrPromise!;
      return { secret: result.secret, otpauth_url: result.otpauth_url, qr_svg };
    } catch (err) {
      console.error('[MFA] QR code generation error:', err);
      throw new HttpException({ error: 'Could not generate QR code' }, 500);
    }
  }

  @Post('mfa/enable')
  @HttpCode(200)
  async mfaEnable(@CurrentUser() user: User, @Body() body: { code?: unknown }, @Req() req: Request) {
    this.limitUser('auth_mfa_user', user, LIMITS.mfaUser);
    const result = await this.auth.enableMfa(user.id, body.code);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    writeAudit({ userId: user.id, action: 'user.mfa_enable', ip: getClientIp(req) });
    return { success: true, mfa_enabled: result.mfa_enabled, backup_codes: result.backup_codes };
  }

  @Post('mfa/disable')
  @HttpCode(200)
  async mfaDisable(@CurrentUser() user: User, @Body() body: unknown, @Req() req: Request) {
    this.limitUser('auth_account_security_user', user, LIMITS.accountSecurityUser);
    const result = await this.auth.disableMfa(user.id, user.email, body);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    writeAudit({ userId: user.id, action: 'user.mfa_disable', ip: getClientIp(req) });
    return { success: true, mfa_enabled: result.mfa_enabled };
  }

  @Get('mcp-tokens')
  async listMcpTokens(@CurrentUser() user: User) {
    return { tokens: await this.auth.listMcpTokens(user.id) };
  }

  @Post('mcp-tokens')
  @HttpCode(201)
  async createMcpToken(@CurrentUser() user: User, @Body() body: { name?: unknown }) {
    this.limitUser('auth_mcp_token_create_user', user, LIMITS.mcpTokenCreateUser);
    const result = await this.auth.createMcpToken(user.id, body.name);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    return { token: result.token };
  }

  @Delete('mcp-tokens/:id')
  async deleteMcpToken(@CurrentUser() user: User, @Param('id') id: string) {
    const result = await this.auth.deleteMcpToken(user.id, id);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    return { success: true };
  }

  @Post('ws-token')
  @HttpCode(200)
  async wsToken(@CurrentUser() user: User) {
    const result = await this.auth.createWsToken(user.id);
    if (result.error) {
      throw new HttpException({ error: result.error }, result.status!);
    }
    return { token: result.token };
  }

  @Post('resource-token')
  @HttpCode(200)
  resourceToken(@CurrentUser() user: User, @Body() body: { purpose?: unknown }) {
    const token = this.auth.createResourceToken(user.id, body.purpose);
    if (!token) {
      throw new HttpException({ error: 'Service unavailable' }, 503);
    }
    return token;
  }
}
