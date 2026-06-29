import * as auth from '../../services/authService';
import { setAuthCookie, clearAuthCookie } from '../../services/cookie';
import { sendPasswordResetEmail, getAppUrl } from '../../services/notifications';
import type { User } from '../../types';
import { Injectable } from '@nestjs/common';

import type { Request, Response } from 'express';

/**
 * Thin Nest wrapper around the existing auth service. Token generation, the
 * password/MFA/backup-code crypto, the JWT cookie set/clear and the reset-email
 * delivery all reuse the legacy code unchanged. Access control + audit stay in
 * the controller (mirroring the legacy route handlers).
 */
@Injectable()
export class AuthService {
  // Cookie
  setAuthCookie(res: Response, token: string, req: Request, remember?: boolean) {
    setAuthCookie(res, token, req, remember);
  }
  clearAuthCookie(res: Response, req: Request) {
    clearAuthCookie(res, req);
  }

  // Reset-email delivery (canonical app URL, never request headers)
  getAppUrl() {
    return getAppUrl();
  }
  sendPasswordResetEmail(email: string, url: string, userId: number | null) {
    return sendPasswordResetEmail(email, url, userId);
  }

  // Public config + auth flows
  getAppConfig(user: User | undefined) {
    return auth.getAppConfigAsync(user);
  }
  demoLogin() {
    return auth.demoLoginAsync();
  }
  validateInviteToken(token: string) {
    return auth.validateInviteTokenAsync(token);
  }
  registerUser(body: unknown) {
    return auth.registerUserAsync(body as Parameters<typeof auth.registerUser>[0]);
  }
  loginUser(body: unknown) {
    return auth.loginUserAsync(body as Parameters<typeof auth.loginUser>[0]);
  }
  requestPasswordReset(email: string, ip: string) {
    return auth.requestPasswordResetAsync(email, ip);
  }
  resetPassword(body: unknown) {
    return auth.resetPasswordAsync(body as Parameters<typeof auth.resetPassword>[0]);
  }
  verifyMfaLogin(body: unknown) {
    return auth.verifyMfaLoginAsync(body as Parameters<typeof auth.verifyMfaLogin>[0]);
  }

  // Account
  getCurrentUser(userId: number) {
    return auth.getCurrentUserAsync(userId);
  }
  changePassword(userId: number, email: string, body: unknown) {
    return auth.changePasswordAsync(userId, email, body as Parameters<typeof auth.changePassword>[2]);
  }
  deleteAccount(userId: number, email: string, role: string) {
    return auth.deleteAccountAsync(userId, email, role);
  }
  updateMapsKey(userId: number, key: unknown) {
    return auth.updateMapsKeyAsync(userId, key as string);
  }
  updateApiKeys(userId: number, body: unknown) {
    return auth.updateApiKeysAsync(userId, body as Parameters<typeof auth.updateApiKeys>[1]);
  }
  updateSettings(userId: number, body: unknown) {
    return auth.updateSettingsAsync(userId, body as Parameters<typeof auth.updateSettings>[1]);
  }
  getSettings(userId: number) {
    return auth.getSettingsAsync(userId);
  }
  saveAvatar(userId: number, filename: string) {
    return auth.saveAvatar(userId, filename);
  }
  deleteAvatar(userId: number) {
    return auth.deleteAvatar(userId);
  }
  listUsers(userId: number) {
    return auth.listUsersAsync(userId);
  }
  validateKeys(userId: number) {
    return auth.validateKeys(userId);
  }
  getAppSettings(userId: number) {
    return auth.getAppSettingsAsync(userId);
  }
  updateAppSettings(userId: number, body: unknown) {
    return auth.updateAppSettingsAsync(userId, body as Parameters<typeof auth.updateAppSettings>[1]);
  }
  getTravelStats(userId: number) {
    return auth.getTravelStatsAsync(userId);
  }

  // MFA
  setupMfa(userId: number, email: string) {
    return auth.setupMfaAsync(userId, email);
  }
  enableMfa(userId: number, code: unknown) {
    return auth.enableMfaAsync(userId, code as string);
  }
  disableMfa(userId: number, email: string, body: unknown) {
    return auth.disableMfaAsync(userId, email, body as Parameters<typeof auth.disableMfa>[2]);
  }

  // MCP tokens + short-lived tokens
  listMcpTokens(userId: number) {
    return auth.listMcpTokensAsync(userId);
  }
  createMcpToken(userId: number, name: unknown) {
    return auth.createMcpTokenAsync(userId, name as string);
  }
  deleteMcpToken(userId: number, id: string) {
    return auth.deleteMcpTokenAsync(userId, id);
  }
  createWsToken(userId: number) {
    return auth.createWsTokenAsync(userId);
  }
  createResourceToken(userId: number, purpose: unknown) {
    return auth.createResourceToken(userId, purpose as string);
  }

  // Passkeys
  passkeyRegisterOptions(userId: number, password: string | undefined) {
    return auth.passkeyRegisterOptionsAsync(userId, password);
  }
  passkeyRegisterVerify(userId: number, body: unknown) {
    return auth.passkeyRegisterVerifyAsync(userId, body as Parameters<typeof auth.passkeyRegisterVerifyAsync>[1]);
  }
  passkeyLoginOptions() {
    return auth.passkeyLoginOptionsAsync();
  }
  passkeyLoginVerify(body: unknown) {
    return auth.passkeyLoginVerifyAsync(body as Parameters<typeof auth.passkeyLoginVerifyAsync>[0]);
  }
  listPasskeys(userId: number) {
    return auth.listPasskeysAsync(userId);
  }
  renamePasskey(userId: number, id: string, name: unknown) {
    return auth.renamePasskeyAsync(userId, id, name);
  }
  deletePasskey(userId: number, id: string, password: string | undefined) {
    return auth.deletePasskeyAsync(userId, id, password);
  }
}
