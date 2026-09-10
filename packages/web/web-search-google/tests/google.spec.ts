import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  GOOGLE_DEFAULT_BASE_URL,
  GOOGLE_PROVIDER_ID,
  GoogleSearchProvider,
} from '@deepseek-ai/dsh-web-search-google'
import * as googlePlugin from '@deepseek-ai/dsh-web-search-google'
import {
  mapGoogleItem,
  mapGoogleResponse,
  resolveNumResults,
} from '../src/provider.ts'

const options = {
  apiKey: 'google-key',
  searchEngineId: 'cx-id',
  baseURL: 'https://www.googleapis.com',
} as const

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Google result mapping', () => {
  it('maps a full result item', () => {
    expect(mapGoogleItem({
      link: 'https://a.test',
      title: 'A',
      snippet: 'salient sentence',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'salient sentence' })
  })

  it('drops an item with no link', () => {
    expect(mapGoogleItem({ link: '', title: 'A', snippet: 'hi' })).toBeUndefined()
  })

  it('maps an item with only a link', () => {
    expect(mapGoogleItem({ link: 'https://a.test' })).toEqual({ url: 'https://a.test' })
  })

  it('omits null/empty optional fields rather than emitting them', () => {
    expect(mapGoogleItem({ link: 'https://a.test', title: null, snippet: null }))
      .toEqual({ url: 'https://a.test' })
    expect(mapGoogleItem({ link: 'https://a.test', title: '', snippet: '' }))
      .toEqual({ url: 'https://a.test' })
  })

  it('maps a response to a result with no content and filtered sources', () => {
    const result = mapGoogleResponse({
      items: [
        { link: 'https://a.test', snippet: 'one' },
        { link: '', title: 'no link' },
        { link: 'https://c.test', title: 'C', snippet: 'three' },
      ],
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', snippet: 'one' },
        { url: 'https://c.test', title: 'C', snippet: 'three' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('tolerates a missing items array', () => {
    expect(mapGoogleResponse({}).sources).toEqual([])
  })
})

describe('Google numResults resolution', () => {
  it('prefers a request maxResults over the configured default', () => {
    expect(resolveNumResults(5, 7)).toBe(5)
  })

  it('falls back to the configured numResults when the request omits it', () => {
    expect(resolveNumResults(undefined, 7)).toBe(7)
  })

  it('defaults to 10 when neither is set', () => {
    expect(resolveNumResults(undefined, undefined)).toBe(10)
  })

  it('clamps values above Google\'s maximum of 10', () => {
    expect(resolveNumResults(25, undefined)).toBe(10)
    expect(resolveNumResults(undefined, 25)).toBe(10)
  })

  it('falls back to 10 for non-positive or non-integer values', () => {
    expect(resolveNumResults(0, undefined)).toBe(10)
    expect(resolveNumResults(-3, undefined)).toBe(10)
    expect(resolveNumResults(2.5, undefined)).toBe(10)
  })
})

describe('GoogleSearchProvider availability', () => {
  it('is unavailable without an API key', () => {
    expect(new GoogleSearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is unavailable without a search engine id', () => {
    expect(new GoogleSearchProvider({ ...options, searchEngineId: '' }).available()).toBe(false)
  })

  it('is available with a key and search engine id', () => {
    expect(new GoogleSearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new GoogleSearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when numResults is set outside 1..10', () => {
    expect(new GoogleSearchProvider({ ...options, numResults: 0 }).available()).toBe(false)
    expect(new GoogleSearchProvider({ ...options, numResults: 11 }).available()).toBe(false)
    expect(new GoogleSearchProvider({ ...options, numResults: 1.5 }).available()).toBe(false)
  })

  it('allows numResults to be omitted', () => {
    expect(new GoogleSearchProvider(options).available()).toBe(true)
  })
})

describe('GoogleSearchProvider request mapping', () => {
  it('sends key, cx, q and num as query parameters on a GET request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [{ link: 'https://a.test', snippet: 'hi' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await new GoogleSearchProvider(options).search({ query: 'hello world', maxResults: 5 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
    const params = new URL(url.toString()).searchParams
    expect(params.get('key')).toBe('google-key')
    expect(params.get('cx')).toBe('cx-id')
    expect(params.get('q')).toBe('hello world')
    expect(params.get('num')).toBe('5')
    expect(new URL(url.toString()).pathname).toBe('/customsearch/v1')
  })

  it('falls back to the configured numResults when a request omits maxResults', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new GoogleSearchProvider({ ...options, numResults: 7 }).search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [URL]
    expect(new URL(url.toString()).searchParams.get('num')).toBe('7')
  })

  it('sends 10 when neither maxResults nor a configured default is set', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new GoogleSearchProvider(options).search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [URL]
    expect(new URL(url.toString()).searchParams.get('num')).toBe('10')
  })

  it('clamps a request maxResults above 10 to Google\'s maximum', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new GoogleSearchProvider(options).search({ query: 'q', maxResults: 50 })
    const [url] = fetchMock.mock.calls[0] as unknown as [URL]
    expect(new URL(url.toString()).searchParams.get('num')).toBe('10')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new GoogleSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('GoogleSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the Google message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 403, message: 'bad key' } }, { status: 403 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Google API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Google API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: 'not-array' }, { status: 200 })))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new GoogleSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-google plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: GOOGLE_PROVIDER_ID })
    const fiber = await ctx.plugin(googlePlugin, { apiKey: 'google-key', searchEngineId: 'cx-id' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in googlePlugin).toBe(false)
  })

  it('threads numResults config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: GOOGLE_PROVIDER_ID })
    const fiber = await ctx.plugin(googlePlugin, { apiKey: 'google-key', searchEngineId: 'cx-id', numResults: 3 })
    await ctx.web.search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [URL]
    expect(new URL(url.toString()).searchParams.get('num')).toBe('3')
    await fiber.dispose()
  })

  it('falls back to $GOOGLE_SEARCH_API_KEY, $GOOGLE_SEARCH_CX and the default base URL when config omits them', async () => {
    const prevKey = process.env.GOOGLE_SEARCH_API_KEY
    const prevCx = process.env.GOOGLE_SEARCH_CX
    process.env.GOOGLE_SEARCH_API_KEY = 'env-key'
    process.env.GOOGLE_SEARCH_CX = 'env-cx'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: GOOGLE_PROVIDER_ID })
      const fiber = await ctx.plugin(googlePlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [URL]
      const params = new URL(url.toString()).searchParams
      expect(params.get('key')).toBe('env-key')
      expect(params.get('cx')).toBe('env-cx')
      expect(url.toString()).toBe(`${GOOGLE_DEFAULT_BASE_URL}/customsearch/v1?key=env-key&cx=env-cx&q=q&num=10`)
      await fiber.dispose()
    } finally {
      if (prevKey === undefined) delete process.env.GOOGLE_SEARCH_API_KEY
      else process.env.GOOGLE_SEARCH_API_KEY = prevKey
      if (prevCx === undefined) delete process.env.GOOGLE_SEARCH_CX
      else process.env.GOOGLE_SEARCH_CX = prevCx
    }
  })

  it('is unavailable when neither config nor env supplies a key', async () => {
    const prevKey = process.env.GOOGLE_SEARCH_API_KEY
    delete process.env.GOOGLE_SEARCH_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: GOOGLE_PROVIDER_ID })
      await ctx.plugin(googlePlugin, { searchEngineId: 'cx-id' })
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      if (prevKey !== undefined) process.env.GOOGLE_SEARCH_API_KEY = prevKey
    }
  })

  it('is unavailable when neither config nor env supplies a search engine id', async () => {
    const prevCx = process.env.GOOGLE_SEARCH_CX
    delete process.env.GOOGLE_SEARCH_CX
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: GOOGLE_PROVIDER_ID })
      await ctx.plugin(googlePlugin, { apiKey: 'google-key' })
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      if (prevCx !== undefined) process.env.GOOGLE_SEARCH_CX = prevCx
    }
  })
})
