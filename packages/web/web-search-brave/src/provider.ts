/**
 * `BraveSearchProvider`: a `WebSearchProvider` backed by the Brave Search API
 * (`GET /res/v1/web/search`). It maps each `web.results[]` entry to a normalized
 * source (`title`/`description`/`age`) and omits `content`, because Brave's web
 * endpoint returns no generated answer.
 *
 * Brave's `count` parameter is capped at 20, so a request asking for more still
 * sends 20; the web seam owns the final `maxResults` truncation on the way back.
 *
 * @module @deepseek-ai/dsh-web-search-brave/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { BraveError, BraveSearchResponse, BraveWebResultItem } from './types.ts'

/** Stable id this provider registers under. */
export const BRAVE_PROVIDER_ID = 'brave'

/** Default endpoint base; `/res/v1/web/search` is appended. */
export const BRAVE_DEFAULT_BASE_URL = 'https://api.search.brave.com'

/** Brave's `count` parameter lower bound. */
export const BRAVE_MIN_RESULTS = 1

/** Brave's `count` parameter upper bound (the API rejects larger values). */
export const BRAVE_MAX_NUM_RESULTS = 20

/** Result count sent when neither the request nor the config supplies one. */
export const BRAVE_DEFAULT_MAX_RESULTS = 10

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface BraveSearchProviderOptions {
  /** Brave Search API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Endpoint base; `/res/v1/web/search` is appended. */
  baseURL: string
  /**
   * Default result count when a request carries no `maxResults`. Omitted = 10
   * (Brave's own default). Must be an integer in
   * {@link BRAVE_MIN_RESULTS}..{@link BRAVE_MAX_NUM_RESULTS}.
   */
  numResults?: number
}

/**
 * Resolve the `count` query value sent to Brave from a request bound and a
 * configured default. The API only accepts 1..20, so larger values clamp to 20
 * and missing/non-positive values fall back to 10 (the documented default and
 * Brave's own behavior when `count` is absent).
 *
 * @param requestMax - the current request's `maxResults`, when any.
 * @param configured - the provider's configured default, when any.
 * @returns an integer in 1..20 to send as Brave's `count`.
 */
export function resolveCount(requestMax: number | undefined, configured: number | undefined): number {
  const requested = requestMax ?? configured ?? BRAVE_DEFAULT_MAX_RESULTS
  if (!Number.isInteger(requested) || requested < BRAVE_MIN_RESULTS) return BRAVE_DEFAULT_MAX_RESULTS
  return Math.min(requested, BRAVE_MAX_NUM_RESULTS)
}

/**
 * Map one Brave result item to a normalized source, or `undefined` when it
 * carries no URL (an entry without `url` has no portable citation and is dropped).
 *
 * @param item - one entry of Brave's `web.results[]`.
 * @returns the normalized source, or `undefined` when the entry has no `url`.
 */
export function mapBraveItem(item: BraveWebResultItem): WebSearchSource | undefined {
  if (typeof item.url !== 'string' || item.url.length === 0) return undefined
  return {
    url: item.url,
    ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
    ...item.description != null && item.description.length > 0 ? { snippet: item.description } : {},
    ...item.age != null && item.age.length > 0 ? { publishedAt: item.age } : {},
  }
}

/**
 * Map a Brave Search response envelope to a normalized search result. Brave
 * returns no generated answer, so `content` is omitted. The web service owns the
 * final `maxResults` truncation, so this provider reports `truncated: false`.
 *
 * @param response - the parsed `GET /res/v1/web/search` response body.
 * @returns the normalized result; url-less entries are dropped
 *   ({@link mapBraveItem}).
 */
export function mapBraveResponse(response: BraveSearchResponse): WebSearchResult {
  const results = response.web?.results ?? []
  const sources = results
    .map(mapBraveItem)
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}

/** The Brave-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class BraveSearchProvider implements WebSearchProvider {
  readonly id = BRAVE_PROVIDER_ID

  constructor(private readonly options: BraveSearchProviderOptions) {}

  available(): boolean {
    const { numResults } = this.options
    return this.options.apiKey.length > 0
      && URL.canParse(this.options.baseURL)
      // Brave's `count` only accepts 1..20; an out-of-range configured default
      // is a misconfiguration, not a runtime clamp target.
      && (numResults === undefined
        || (Number.isInteger(numResults) && numResults >= BRAVE_MIN_RESULTS && numResults <= BRAVE_MAX_NUM_RESULTS))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const count = resolveCount(request.maxResults, this.options.numResults)
    const endpoint = new URL('/res/v1/web/search', this.options.baseURL)
    endpoint.searchParams.set('q', request.query)
    endpoint.searchParams.set('count', String(count))

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'x-subscription-token': this.options.apiKey,
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Brave search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Brave API error (HTTP ${status})`
      try {
        const parsed = await response.json() as BraveError
        const detail = parsed.error?.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as BraveSearchResponse
      return mapBraveResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Brave returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
