import { describe, expect, it } from 'vitest'
import { formatPlatformKo, parseBrowser, parsePlatform } from '@/lib/operations/parse-ua'

describe('parsePlatform', () => {
  it('Mac + Chrome UA → desktop', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
    expect(parsePlatform(ua)).toBe('desktop')
  })

  it('Windows + Chrome UA → desktop', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
    expect(parsePlatform(ua)).toBe('desktop')
  })

  it('Windows + Firefox UA → desktop', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
    expect(parsePlatform(ua)).toBe('desktop')
  })

  it('Windows + Edge UA → desktop', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/135.0.0.0'
    expect(parsePlatform(ua)).toBe('desktop')
  })

  it('Mac + Safari UA → desktop', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
    expect(parsePlatform(ua)).toBe('desktop')
  })

  it('iPhone UA → mobile', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    expect(parsePlatform(ua)).toBe('mobile')
  })

  it('iPad UA → tablet', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    expect(parsePlatform(ua)).toBe('tablet')
  })

  it('Android mobile (Pixel 8) UA → mobile', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    expect(parsePlatform(ua)).toBe('mobile')
  })

  it('empty string → desktop', () => {
    expect(parsePlatform('')).toBe('desktop')
  })

  it('null → desktop', () => {
    expect(parsePlatform(null)).toBe('desktop')
  })

  it('undefined → desktop', () => {
    expect(parsePlatform(undefined)).toBe('desktop')
  })

  it('unknown UA (curl) → desktop', () => {
    expect(parsePlatform('curl/8.4.0')).toBe('desktop')
  })
})

describe('parseBrowser', () => {
  it('Mac + Chrome UA → Chrome', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
    expect(parseBrowser(ua)).toBe('Chrome')
  })

  it('Windows + Chrome UA → Chrome', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
    expect(parseBrowser(ua)).toBe('Chrome')
  })

  it('Windows + Firefox UA → Firefox', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
    expect(parseBrowser(ua)).toBe('Firefox')
  })

  it('Windows + Edge UA → Edge', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/135.0.0.0'
    expect(parseBrowser(ua)).toBe('Edge')
  })

  it('Mac + Safari UA → Safari', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
    expect(parseBrowser(ua)).toBe('Safari')
  })

  it('iPhone + Safari UA → Safari', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    expect(parseBrowser(ua)).toBe('Safari')
  })

  it('iPad + Safari UA → Safari', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    expect(parseBrowser(ua)).toBe('Safari')
  })

  it('Android + Chrome Mobile UA → Chrome', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    expect(parseBrowser(ua)).toBe('Chrome')
  })

  it('empty string → Other', () => {
    expect(parseBrowser('')).toBe('Other')
  })

  it('null → Other', () => {
    expect(parseBrowser(null)).toBe('Other')
  })

  it('undefined → Other', () => {
    expect(parseBrowser(undefined)).toBe('Other')
  })

  it('unknown UA (curl) → Other', () => {
    expect(parseBrowser('curl/8.4.0')).toBe('Other')
  })
})

describe('formatPlatformKo', () => {
  it("'desktop' → 'PC'", () => {
    expect(formatPlatformKo('desktop')).toBe('PC')
  })

  it("'mobile' → '모바일'", () => {
    expect(formatPlatformKo('mobile')).toBe('모바일')
  })

  it("'tablet' → '태블릿'", () => {
    expect(formatPlatformKo('tablet')).toBe('태블릿')
  })

  it('null → —', () => {
    expect(formatPlatformKo(null)).toBe('—')
  })
})
