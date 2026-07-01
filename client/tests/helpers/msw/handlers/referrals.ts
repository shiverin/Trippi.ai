import { http, HttpResponse } from 'msw';

export const referralHandlers = [
  http.get('/api/referrals/me', () =>
    HttpResponse.json({
      code: null,
      referral_url: null,
      reward_days: 7,
      max_bonus_days: 90,
      successful_referrals: 0,
      pending_bonus_days: 0,
      active_bonus_until: null,
      active_bonus_days_remaining: 0,
      expires_soon: false,
    })
  ),
  http.post('/api/referrals/me', () =>
    HttpResponse.json({
      code: 'TESTCODE',
      referral_url: 'http://localhost:3001/register?ref=TESTCODE',
      reward_days: 7,
      max_bonus_days: 90,
      successful_referrals: 0,
      pending_bonus_days: 0,
      active_bonus_until: null,
      active_bonus_days_remaining: 0,
      expires_soon: false,
    })
  ),
  http.get('/api/referrals/expiry-warning', () =>
    HttpResponse.json({ show: false, active_until: null, trips: [] })
  ),
  http.post('/api/referrals/expiry-warning/dismiss', () => HttpResponse.json({ ok: true })),
  http.get('/api/referrals/:code', ({ params }) =>
    HttpResponse.json({
      valid: true,
      code: String(params.code),
      referrer_username: 'Referrer',
      reward_days: 7,
    })
  ),
];
