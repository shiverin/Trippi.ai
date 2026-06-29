import { ADDON_IDS } from '../../addons';
import { isAddonEnabledAsync } from '../../services/adminService';
import { getMcpSafeUrl } from '../../services/notifications';
import * as oauth from '../../services/oauthService';
import { Injectable } from '@nestjs/common';

/**
 * Thin Nest wrapper around the existing OAuth 2.1 service. The grant handling,
 * PKCE, client auth, consent storage, token issue/refresh/revoke and the
 * client/session CRUD all reuse the legacy code unchanged.
 */
@Injectable()
export class OauthService {
  mcpEnabled(): Promise<boolean> {
    return isAddonEnabledAsync(ADDON_IDS.MCP);
  }
  mcpSafeUrl(): string {
    return getMcpSafeUrl();
  }

  consumeAuthCode(code: string) {
    return oauth.consumeAuthCode(code);
  }
  authenticateClient(clientId: string, clientSecret?: string) {
    return oauth.authenticateClientAsync(clientId, clientSecret);
  }
  verifyPKCE(verifier: string, challenge: string) {
    return oauth.verifyPKCE(verifier, challenge);
  }
  issueTokens(...args: Parameters<typeof oauth.issueTokens>) {
    return oauth.issueTokensAsync(...args);
  }
  issueClientCredentialsToken(...args: Parameters<typeof oauth.issueClientCredentialsToken>) {
    return oauth.issueClientCredentialsTokenAsync(...args);
  }
  refreshTokens(...args: Parameters<typeof oauth.refreshTokens>) {
    return oauth.refreshTokensAsync(...args);
  }
  revokeToken(...args: Parameters<typeof oauth.revokeToken>) {
    return oauth.revokeTokenAsync(...args);
  }
  getUserByAccessToken(token: string) {
    return oauth.getUserByAccessTokenAsync(token);
  }

  validateAuthorizeRequest(params: oauth.AuthorizeParams, userId: number | null) {
    return oauth.validateAuthorizeRequestAsync(params, userId);
  }
  saveConsent(...args: Parameters<typeof oauth.saveConsent>) {
    return oauth.saveConsentAsync(...args);
  }
  createAuthCode(...args: Parameters<typeof oauth.createAuthCode>) {
    return oauth.createAuthCode(...args);
  }

  listOAuthClients(userId: number) {
    return oauth.listOAuthClientsAsync(userId);
  }
  createOAuthClient(...args: Parameters<typeof oauth.createOAuthClient>) {
    return oauth.createOAuthClientAsync(...args);
  }
  rotateOAuthClientSecret(userId: number, id: string, ip: string | undefined) {
    return oauth.rotateOAuthClientSecretAsync(userId, id, ip);
  }
  deleteOAuthClient(userId: number, id: string, ip: string | undefined) {
    return oauth.deleteOAuthClientAsync(userId, id, ip);
  }
  listOAuthSessions(userId: number) {
    return oauth.listOAuthSessionsAsync(userId);
  }
  revokeSession(userId: number, id: number, ip: string | undefined) {
    return oauth.revokeSessionAsync(userId, id, ip);
  }
}
