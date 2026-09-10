import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { BRAVE_DEFAULT_BASE_URL, BRAVE_PROVIDER_ID, BraveSearchProvider } from '@deepseek-ai/dsh-web-search-brave'
import * as bravePlugin from '@deepseek-ai/dsh-web-search-brave'
import { mapBraveItem, mapBraveResponse, resolveCount } from '../src/provider.ts'

const options = {
  apiKey: 'brave-key',
  baseURL: 'https://api.search.brave.com',
} as const

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Brave result mapping', () => {
  it('maps a full result item', () => {
    expect(mapBraveItem({
      url: 'https://a.test',
      title: 'A',
      description: 'salient sentence',
      age: '2026-01-01',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'salient sentence', publishedAt: '2026-01-01' })
  })

  it('drops an item with no url', () => {
    expect(mapBraveItem({ url: '', title: 'A', description: 'hi' })).toBeUndefined()
  })

  it('maps an item with only a url', () => {
    expect(mapBraveItem({ url: 'https://a.test' })).toEqual({ url: 'https://a.test' })
  })

  it('omits null/empty optional fields rather than emitting them', () => {
    expect(mapBraveItem({ url: 'https://a.test', title: null, description: null, age: null }))
      .toEqual({ url: 'https://a.test' })
    expect(mapBraveItem({ url: 'https://a.test', title: '', description: '', age: '' }))
      .toEqual({ url: 'https://a.test' })
  })

  it('maps a response to a result with no content and filtered sources', () => {
    const result = mapBraveResponse({
      web: {
        results: [
          { url: 'https://a.test', description: 'one' },
          { url: '', title: 'no url' },
          { url: 'https://c.test', title: 'C', description: 'three' },
        ],
      },
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

  it('tolerates a missing web group', () => {
    expect(mapBraveResponse({}).sources).toEqual([])
  })

  it('tolerates a web group with no results array', () => {
    expect(mapBraveResponse({ web: {} }).sources).toEqual([])
  })
})

describe('Brave count resolution', () => {
  it('prefers a request maxResults over the configured default', () => {
    expect(resolveCount(5, 7)).toBe(5)
  })

  it('falls back to the configured numResults when the request omits it', () => {
    expect(resolveCount(undefined, 7)).toBe(7)
  })

  it('defaults to 10 when neither is set', () => {
    expect(resolveCount(undefined, undefined)).toBe(10)
  })

  it('clamps values above Brave\'s maximum of 20', () => {
    expect(resolveCount(25, undefined)).toBe(20)
    expect(resolveCount(undefined, 25)).toBe(20)
  })

  it('falls back to 10 for non-positive or non-integer values', () => {
    expect(resolveCount(0, undefined)).toBe(10)
    expect(resolveCount(-3, undefined)).toBe(10)
    expect(resolveCount(2.5, undefined)).toBe(10)
  })
})

describe('BraveSearchProvider availability', () => {
  it('is unavailable without an API key', () => {
    expect(new BraveSearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a key', () => {
    expect(new BraveSearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new BraveSearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when numResults is set outside 1..20', () => {
    expect(new BraveSearchProvider({ ...options, numResults: 0 }).available()).toBe(false)
    expect(new BraveSearchProvider({ ...options, numResults: 21 }).available()).toBe(false)
    expect(new BraveSearchProvider({ ...options, numResults: 1.5 }).available()).toBe(false)
  })

  it('allows numResults to be omitted', () => {
    expect(new BraveSearchProvider(options).available()).toBe(true)
  })
})

describe('BraveSearchProvider request mapping', () => {
  it('sends q and count query parameters with the subscription-token header on a GET request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [{ url: 'https://a.test', description: 'hi' }] } }))
    vi.stubGlobal('fetch', fetchMock)

    await new BraveSearchProvider(options).search({ query: 'hello world', maxResults: 15 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
    expect((init.headers as Record<string, string>)['x-subscription-token']).toBe('brave-key')
    const params = new URL(url.toString()).searchParams
    expect(params.get('q')).toBe('hello world')
    expect(params.get('count')).toBe('15')
    expect(new URL(url.toString()).pathname).toBe('/res/v1/web/search')
  })

  it('falls back to the configured numResults when a request omits maxResults', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await new BraveSearchProvider({ ...options, numResults: 7 }).search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [URL]
    expect(new URL(url.toString()).searchParams.get('count')).toBe('7')
  })

  it('sends 10 when neither maxResults nor a configured default is set', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await new BraveSearchProvider(options).search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [URL]
    expect(new URL(url.toString()).searchParams.get('count')).toBe('10')
  })

  it('clamps a request maxResults above 20 to Brave\'s maximum', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await new BraveSearchProvider(options).search({ query: 'q', maxResults: 50 })
    const [url] = fetchMock.mock.calls[0] as unknown as [URL]
    expect(new URL(url.toString()).searchParams.get('count')).toBe('20')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new BraveSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('BraveSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the Brave message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'bad key' } }, { status: 401 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Brave API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Brave API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ web: { results: 'not-array' } }, { status: 200 })))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new BraveSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-brave plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ web: { results: [] } })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
    const fiber = await ctx.plugin(bravePlugin, { apiKey: 'brave-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in bravePlugin).toBe(false)
  })

  it('threads numResults config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
    const fiber = await ctx.plugin(bravePlugin, { apiKey: 'brave-key', numResults: 3 })
    await ctx.web.search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [URL]
    expect(new URL(url.toString()).searchParams.get('count')).toBe('3')
    await fiber.dispose()
  })

  it('falls back to $BRAVE_SEARCH_API_KEY and the default base URL when config omits them', async () => {
    const prev = process.env.BRAVE_SEARCH_API_KEY
    process.env.BRAVE_SEARCH_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      const fiber = await ctx.plugin(bravePlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [URL]
      const params = new URL(url.toString()).searchParams
      expect(params.get('q')).toBe('q')
      expect(url.toString()).toBe(`${BRAVE_DEFAULT_BASE_URL}/res/v1/web/search?q=q&count=10`)
      expect(fiber).toBeTruthy()
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.BRAVE_SEARCH_API_KEY
      else process.env.BRAVE_SEARCH_API_KEY = prev
    }
  })

  it('sends the env API key in the subscription-token header', async () => {
    const prev = process.env.BRAVE_SEARCH_API_KEY
    process.env.BRAVE_SEARCH_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      const fiber = await ctx.plugin(bravePlugin, {})
      await ctx.web.search({ query: 'q' })
      const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
      expect((init.headers as Record<string, string>)['x-subscription-token']).toBe('env-key')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.BRAVE_SEARCH_API_KEY
      else process.env.BRAVE_SEARCH_API_KEY = prev
    }
  })

  it('is unavailable when neither config nor env supplies a key', async () => {
    const prev = process.env.BRAVE_SEARCH_API_KEY
    delete process.env.BRAVE_SEARCH_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: BRAVE_PROVIDER_ID })
      await ctx.plugin(bravePlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      if (prev !== undefined) process.env.BRAVE_SEARCH_API_KEY = prev
    }
  })
})
