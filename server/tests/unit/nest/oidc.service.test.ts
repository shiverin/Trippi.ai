import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// The Nest service is a thin pass-through to the legacy OIDC helpers plus a few
// adjacent service modules. Mock each one and assert the wrapper forwards every
// argument and returns whatever the legacy function hands back.
const { oidc } = vi.hoisted(() => ({
  oidc: {
    getOidcConfig: vi.fn(),
    getOidcConfigAsync: vi.fn(),
    discover: vi.fn(),
    createState: vi.fn(),
    consumeState: vi.fn(),
    exchangeCodeForToken: vi.fn(),
    verifyIdToken: vi.fn(),
    getUserInfo: vi.fn(),
    findOrCreateUser: vi.fn(),
    findOrCreateUserAsync: vi.fn(),
    touchLastLogin: vi.fn(),
    touchLastLoginAsync: vi.fn(),
    generateToken: vi.fn(),
    generateTokenAsync: vi.fn(),
    createAuthCode: vi.fn(),
    consumeAuthCode: vi.fn(),
    frontendUrl: vi.fn(),
  },
}));
vi.mock('../../../src/services/oidcService', () => oidc);

const { getAppUrl } = vi.hoisted(() => ({ getAppUrl: vi.fn() }));
vi.mock('../../../src/services/notifications', () => ({ getAppUrl }));

const { resolveAuthTogglesAsync } = vi.hoisted(() => ({ resolveAuthTogglesAsync: vi.fn() }));
vi.mock('../../../src/services/authService', () => ({ resolveAuthTogglesAsync }));

const { setAuthCookie } = vi.hoisted(() => ({ setAuthCookie: vi.fn() }));
vi.mock('../../../src/services/cookie', () => ({ setAuthCookie }));

import { OidcService } from '../../../src/nest/oidc/oidc.service';

let s: OidcService;
beforeEach(() => {
  vi.clearAllMocks();
  s = new OidcService();
});

describe('OidcService', () => {
  it('oidcLoginEnabled reads the resolved auth toggle', async () => {
    resolveAuthTogglesAsync.mockResolvedValue({ oidc_login: true });
    await expect(s.oidcLoginEnabled()).resolves.toBe(true);
    resolveAuthTogglesAsync.mockResolvedValue({ oidc_login: false });
    await expect(s.oidcLoginEnabled()).resolves.toBe(false);
  });

  it('getOidcConfig delegates to the legacy helper', async () => {
    const cfg = { issuer: 'https://idp' };
    oidc.getOidcConfigAsync.mockResolvedValue(cfg);
    await expect(s.getOidcConfig()).resolves.toBe(cfg);
  });

  it('getAppUrl delegates to notifications.getAppUrl', () => {
    getAppUrl.mockReturnValue('https://app');
    expect(s.getAppUrl()).toBe('https://app');
  });

  it('discover forwards the issuer and discovery url', async () => {
    const doc = { authorization_endpoint: 'https://idp/auth' };
    oidc.discover.mockResolvedValue(doc);
    await expect(s.discover('https://idp', 'https://idp/.well-known')).resolves.toBe(doc);
    expect(oidc.discover).toHaveBeenCalledWith('https://idp', 'https://idp/.well-known');
  });

  it('discover works without a discovery url', async () => {
    oidc.discover.mockResolvedValue('doc');
    await expect(s.discover('https://idp')).resolves.toBe('doc');
    expect(oidc.discover).toHaveBeenCalledWith('https://idp', undefined);
  });

  it('createState forwards the redirect uri and invite token', () => {
    const st = { state: 'st', codeChallenge: 'cc' };
    oidc.createState.mockReturnValue(st);
    expect(s.createState('https://app/cb', 'inv')).toBe(st);
    expect(oidc.createState).toHaveBeenCalledWith('https://app/cb', 'inv');
  });

  it('createState works without an invite token', () => {
    oidc.createState.mockReturnValue({ state: 'st', codeChallenge: 'cc' });
    s.createState('https://app/cb');
    expect(oidc.createState).toHaveBeenCalledWith('https://app/cb', undefined);
  });

  it('consumeState forwards the state', () => {
    oidc.consumeState.mockReturnValue({ redirectUri: 'r', codeVerifier: 'v' });
    expect(s.consumeState('st')).toEqual({ redirectUri: 'r', codeVerifier: 'v' });
    expect(oidc.consumeState).toHaveBeenCalledWith('st');
  });

  it('exchangeCodeForToken spreads all arguments through', async () => {
    oidc.exchangeCodeForToken.mockResolvedValue({ _ok: true });
    const doc = { token_endpoint: 'https://idp/token' } as never;
    await expect(s.exchangeCodeForToken(doc, 'code', 'redir', 'cid', 'secret', 'verifier')).resolves.toEqual({ _ok: true });
    expect(oidc.exchangeCodeForToken).toHaveBeenCalledWith(doc, 'code', 'redir', 'cid', 'secret', 'verifier');
  });

  it('verifyIdToken spreads all arguments through', async () => {
    oidc.verifyIdToken.mockResolvedValue({ ok: true });
    const doc = { issuer: 'https://idp' } as never;
    await expect(s.verifyIdToken('id_token', doc, 'cid', 'https://idp')).resolves.toEqual({ ok: true });
    expect(oidc.verifyIdToken).toHaveBeenCalledWith('id_token', doc, 'cid', 'https://idp');
  });

  it('getUserInfo forwards the endpoint and access token', async () => {
    oidc.getUserInfo.mockResolvedValue({ email: 'a@b.c' });
    await expect(s.getUserInfo('https://idp/ui', 'at')).resolves.toEqual({ email: 'a@b.c' });
    expect(oidc.getUserInfo).toHaveBeenCalledWith('https://idp/ui', 'at');
  });

  it('findOrCreateUser spreads all arguments through', async () => {
    const result = { user: { id: 1 } };
    oidc.findOrCreateUserAsync.mockResolvedValue(result);
    const info = { email: 'a@b.c' } as never;
    const cfg = { issuer: 'https://idp' } as never;
    await expect(s.findOrCreateUser(info, cfg, 'inv')).resolves.toBe(result);
    expect(oidc.findOrCreateUserAsync).toHaveBeenCalledWith(info, cfg, 'inv');
  });

  it('touchLastLogin forwards the user id', async () => {
    oidc.touchLastLoginAsync.mockResolvedValue(undefined);
    await s.touchLastLogin(42);
    expect(oidc.touchLastLoginAsync).toHaveBeenCalledWith(42);
  });

  it('generateToken forwards the user', async () => {
    oidc.generateTokenAsync.mockResolvedValue('jwt');
    await expect(s.generateToken({ id: 7 })).resolves.toBe('jwt');
    expect(oidc.generateTokenAsync).toHaveBeenCalledWith({ id: 7 });
  });

  it('createAuthCode forwards the token', () => {
    oidc.createAuthCode.mockReturnValue('ac');
    expect(s.createAuthCode('jwt')).toBe('ac');
    expect(oidc.createAuthCode).toHaveBeenCalledWith('jwt');
  });

  it('consumeAuthCode forwards the code', () => {
    oidc.consumeAuthCode.mockReturnValue({ token: 'jwt' });
    expect(s.consumeAuthCode('ac')).toEqual({ token: 'jwt' });
    expect(oidc.consumeAuthCode).toHaveBeenCalledWith('ac');
  });

  it('frontendUrl forwards the path', () => {
    oidc.frontendUrl.mockReturnValue('https://app/login');
    expect(s.frontendUrl('/login')).toBe('https://app/login');
    expect(oidc.frontendUrl).toHaveBeenCalledWith('/login');
  });

  it('setAuthCookie forwards res, token and req to the cookie helper', () => {
    const res = {} as Response;
    const req = {} as Request;
    s.setAuthCookie(res, 'jwt', req);
    expect(setAuthCookie).toHaveBeenCalledWith(res, 'jwt', req);
  });
});
