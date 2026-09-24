import { describe, expect, it } from 'vitest'
import { detectPlatform } from './install'
import { codeFromSetupLink } from './setupLink'

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0',
}

describe('detectPlatform', () => {
  it('recognises iPhone browsers', () => {
    expect(detectPlatform(UA.iphoneSafari, 5)).toEqual({ platform: 'ios', browser: 'safari' })
    expect(detectPlatform(UA.iphoneChrome, 5)).toEqual({ platform: 'ios', browser: 'chrome' })
    expect(detectPlatform(UA.instagramIos, 5)).toEqual({ platform: 'ios', browser: 'inapp' })
  })
  it('tells an iPad in desktop mode from a Mac by its touch screen', () => {
    expect(detectPlatform(UA.ipadDesktop, 5).platform).toBe('ios')
    expect(detectPlatform(UA.ipadDesktop, 0)).toEqual({ platform: 'mac', browser: 'safari' })
  })
  it('recognises Android browsers and web views', () => {
    expect(detectPlatform(UA.androidChrome, 5)).toEqual({ platform: 'android', browser: 'chrome' })
    expect(detectPlatform(UA.androidSamsung, 5)).toEqual({ platform: 'android', browser: 'samsung' })
    expect(detectPlatform(UA.androidWebView, 5)).toEqual({ platform: 'android', browser: 'inapp' })
  })
  it('recognises desktop browsers', () => {
    expect(detectPlatform(UA.windowsEdge, 0)).toEqual({ platform: 'windows', browser: 'edge' })
    expect(detectPlatform(UA.windowsFirefox, 0)).toEqual({ platform: 'windows', browser: 'firefox' })
  })
})

describe('codeFromSetupLink', () => {
  it('extracts the code from a pasted setup link', () => {
    expect(codeFromSetupLink('https://example.github.io/ee-hub/#setup=ABCD-EFGH-JKLM-NPQR')).toBe('ABCD-EFGH-JKLM-NPQR')
    expect(codeFromSetupLink('  Open this: https://example.github.io/ee-hub/#/setup=abcd-efgh-jklm-npqr thanks')).toBe('abcd-efgh-jklm-npqr')
  })
  it('leaves a plain code alone', () => {
    expect(codeFromSetupLink('ABCD-EFGH-JKLM-NPQR')).toBeNull()
  })
})
