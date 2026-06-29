import { describe, expect, it } from 'vitest'
import { isAuthPublicPath } from './client'

describe('api client auth public paths', () => {
  it('treats the marketing landing page as public for interceptor redirects', () => {
    expect(isAuthPublicPath('/')).toBe(true)
  })

  it('treats the OAuth consent screen as public for interceptor redirects', () => {
    expect(isAuthPublicPath('/oauth/consent')).toBe(true)
  })

  it('keeps protected app routes non-public', () => {
    expect(isAuthPublicPath('/trips')).toBe(false)
  })
})
