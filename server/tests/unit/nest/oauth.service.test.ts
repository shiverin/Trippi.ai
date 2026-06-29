import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Nest service is a thin wrapper that forwards to the legacy oauthService
// plus the addon/notification helpers. Mock those and assert the delegation.
const { oauth } = vi.hoisted(() => ({
  oauth: {
    consumeAuthCode: vi.fn(),
    authenticateClient: vi.fn(),
    authenticateClientAsync: vi.fn(),
    verifyPKCE: vi.fn(),
    issueTokens: vi.fn(),
    issueTokensAsync: vi.fn(),
    issueClientCredentialsToken: vi.fn(),
    issueClientCredentialsTokenAsync: vi.fn(),
    refreshTokens: vi.fn(),
    refreshTokensAsync: vi.fn(),
    revokeToken: vi.fn(),
    revokeTokenAsync: vi.fn(),
    getUserByAccessToken: vi.fn(),
    getUserByAccessTokenAsync: vi.fn(),
    validateAuthorizeRequest: vi.fn(),
    validateAuthorizeRequestAsync: vi.fn(),
    saveConsent: vi.fn(),
    saveConsentAsync: vi.fn(),
    createAuthCode: vi.fn(),
    listOAuthClients: vi.fn(),
    listOAuthClientsAsync: vi.fn(),
    createOAuthClient: vi.fn(),
    createOAuthClientAsync: vi.fn(),
    rotateOAuthClientSecret: vi.fn(),
    rotateOAuthClientSecretAsync: vi.fn(),
    deleteOAuthClient: vi.fn(),
    deleteOAuthClientAsync: vi.fn(),
    listOAuthSessions: vi.fn(),
    listOAuthSessionsAsync: vi.fn(),
    revokeSession: vi.fn(),
    revokeSessionAsync: vi.fn(),
  },
}));
vi.mock('../../../src/services/oauthService', () => oauth);

const { isAddonEnabledAsync } = vi.hoisted(() => ({ isAddonEnabledAsync: vi.fn() }));
vi.mock('../../../src/services/adminService', () => ({ isAddonEnabledAsync }));

const { getMcpSafeUrl } = vi.hoisted(() => ({ getMcpSafeUrl: vi.fn() }));
vi.mock('../../../src/services/notifications', () => ({ getMcpSafeUrl }));

import { OauthService } from '../../../src/nest/oauth/oauth.service';
import { ADDON_IDS } from '../../../src/addons';

function svc() { return new OauthService(); }

beforeEach(() => vi.clearAllMocks());

describe('OauthService', () => {
  it('mcpEnabled checks the MCP addon flag', async () => {
    isAddonEnabledAsync.mockResolvedValue(true);
    await expect(svc().mcpEnabled()).resolves.toBe(true);
    expect(isAddonEnabledAsync).toHaveBeenCalledWith(ADDON_IDS.MCP);
    isAddonEnabledAsync.mockResolvedValue(false);
    await expect(svc().mcpEnabled()).resolves.toBe(false);
  });

  it('mcpSafeUrl forwards to the notifications helper', () => {
    getMcpSafeUrl.mockReturnValue('https://safe');
    expect(svc().mcpSafeUrl()).toBe('https://safe');
    expect(getMcpSafeUrl).toHaveBeenCalled();
  });

  it('consumeAuthCode delegates', () => {
    oauth.consumeAuthCode.mockReturnValue({ clientId: 'c' });
    expect(svc().consumeAuthCode('code')).toEqual({ clientId: 'c' });
    expect(oauth.consumeAuthCode).toHaveBeenCalledWith('code');
  });

  it('authenticateClient delegates with both args', async () => {
    oauth.authenticateClientAsync.mockResolvedValue({ id: 'c' });
    await expect(svc().authenticateClient('c', 'secret')).resolves.toEqual({ id: 'c' });
    expect(oauth.authenticateClientAsync).toHaveBeenCalledWith('c', 'secret');
  });

  it('verifyPKCE delegates', () => {
    oauth.verifyPKCE.mockReturnValue(true);
    expect(svc().verifyPKCE('v', 'ch')).toBe(true);
    expect(oauth.verifyPKCE).toHaveBeenCalledWith('v', 'ch');
  });

  it('issueTokens forwards the full argument list', async () => {
    oauth.issueTokensAsync.mockResolvedValue({ access_token: 'at' });
    await expect(svc().issueTokens('c', 1, ['s'], null, 'aud')).resolves.toEqual({ access_token: 'at' });
    expect(oauth.issueTokensAsync).toHaveBeenCalledWith('c', 1, ['s'], null, 'aud');
  });

  it('issueClientCredentialsToken forwards the full argument list', async () => {
    oauth.issueClientCredentialsTokenAsync.mockResolvedValue({ access_token: 'cc' });
    await expect(svc().issueClientCredentialsToken('c', 1, ['s'], 'aud')).resolves.toEqual({ access_token: 'cc' });
    expect(oauth.issueClientCredentialsTokenAsync).toHaveBeenCalledWith('c', 1, ['s'], 'aud');
  });

  it('refreshTokens forwards the full argument list', async () => {
    oauth.refreshTokensAsync.mockResolvedValue({ tokens: { access_token: 'new' } });
    await expect(svc().refreshTokens('rt', 'c', 's', '1.2.3.4')).resolves.toEqual({ tokens: { access_token: 'new' } });
    expect(oauth.refreshTokensAsync).toHaveBeenCalledWith('rt', 'c', 's', '1.2.3.4');
  });

  it('revokeToken forwards the full argument list', async () => {
    oauth.revokeTokenAsync.mockResolvedValue(undefined);
    await svc().revokeToken('t', 'c', undefined, '1.2.3.4');
    expect(oauth.revokeTokenAsync).toHaveBeenCalledWith('t', 'c', undefined, '1.2.3.4');
  });

  it('getUserByAccessToken delegates', async () => {
    oauth.getUserByAccessTokenAsync.mockResolvedValue({ user: { id: 1 } });
    await expect(svc().getUserByAccessToken('tok')).resolves.toEqual({ user: { id: 1 } });
    expect(oauth.getUserByAccessTokenAsync).toHaveBeenCalledWith('tok');
  });

  it('validateAuthorizeRequest delegates with the user id', async () => {
    oauth.validateAuthorizeRequestAsync.mockResolvedValue({ valid: true });
    const params = { response_type: 'code' } as never;
    await expect(svc().validateAuthorizeRequest(params, 5)).resolves.toEqual({ valid: true });
    expect(oauth.validateAuthorizeRequestAsync).toHaveBeenCalledWith(params, 5);
  });

  it('saveConsent forwards the full argument list', async () => {
    oauth.saveConsentAsync.mockResolvedValue(undefined);
    await svc().saveConsent('c', 1, ['s'], '1.2.3.4');
    expect(oauth.saveConsentAsync).toHaveBeenCalledWith('c', 1, ['s'], '1.2.3.4');
  });

  it('createAuthCode forwards the params object', () => {
    oauth.createAuthCode.mockReturnValue('the_code');
    const p = { clientId: 'c', userId: 1, redirectUri: 'u', scopes: ['s'], resource: null, codeChallenge: 'cc', codeChallengeMethod: 'S256' } as const;
    expect(svc().createAuthCode(p)).toBe('the_code');
    expect(oauth.createAuthCode).toHaveBeenCalledWith(p);
  });

  it('listOAuthClients delegates', async () => {
    oauth.listOAuthClientsAsync.mockResolvedValue([{ id: 'c1' }]);
    await expect(svc().listOAuthClients(1)).resolves.toEqual([{ id: 'c1' }]);
    expect(oauth.listOAuthClientsAsync).toHaveBeenCalledWith(1);
  });

  it('createOAuthClient forwards the full argument list', async () => {
    oauth.createOAuthClientAsync.mockResolvedValue({ client_id: 'c1' });
    await expect(svc().createOAuthClient(1, 'CLI', ['https://cb'], ['a'], '1.2.3.4', { allowsClientCredentials: true })).resolves.toEqual({ client_id: 'c1' });
    expect(oauth.createOAuthClientAsync).toHaveBeenCalledWith(1, 'CLI', ['https://cb'], ['a'], '1.2.3.4', { allowsClientCredentials: true });
  });

  it('rotateOAuthClientSecret delegates', async () => {
    oauth.rotateOAuthClientSecretAsync.mockResolvedValue({ client_secret: 'new' });
    await expect(svc().rotateOAuthClientSecret(1, 'c1', '1.2.3.4')).resolves.toEqual({ client_secret: 'new' });
    expect(oauth.rotateOAuthClientSecretAsync).toHaveBeenCalledWith(1, 'c1', '1.2.3.4');
  });

  it('deleteOAuthClient delegates', async () => {
    oauth.deleteOAuthClientAsync.mockResolvedValue({});
    await expect(svc().deleteOAuthClient(1, 'c1', '1.2.3.4')).resolves.toEqual({});
    expect(oauth.deleteOAuthClientAsync).toHaveBeenCalledWith(1, 'c1', '1.2.3.4');
  });

  it('listOAuthSessions delegates', async () => {
    oauth.listOAuthSessionsAsync.mockResolvedValue([{ id: 1 }]);
    await expect(svc().listOAuthSessions(1)).resolves.toEqual([{ id: 1 }]);
    expect(oauth.listOAuthSessionsAsync).toHaveBeenCalledWith(1);
  });

  it('revokeSession delegates', async () => {
    oauth.revokeSessionAsync.mockResolvedValue({});
    await expect(svc().revokeSession(1, 7, '1.2.3.4')).resolves.toEqual({});
    expect(oauth.revokeSessionAsync).toHaveBeenCalledWith(1, 7, '1.2.3.4');
  });
});

describe('OauthModule', () => {
  it('wires the public + api controllers and the providers', async () => {
    const { OauthModule } = await import('../../../src/nest/oauth/oauth.module');
    const { OauthPublicController } = await import('../../../src/nest/oauth/oauth-public.controller');
    const { OauthApiController } = await import('../../../src/nest/oauth/oauth-api.controller');
    const { OauthService: Svc } = await import('../../../src/nest/oauth/oauth.service');
    const { RateLimitService } = await import('../../../src/nest/auth/rate-limit.service');

    const controllers = Reflect.getMetadata('controllers', OauthModule);
    const providers = Reflect.getMetadata('providers', OauthModule);
    expect(controllers).toEqual([OauthPublicController, OauthApiController]);
    expect(providers).toEqual([Svc, RateLimitService]);
  }, 45_000);
});
