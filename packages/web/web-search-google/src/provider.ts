/**
 * `GoogleSearchProvider`: a `WebSearchProvider` backed by the Google Custom Search
 * JSON API (`GET /customsearch/v1`). It maps each `items[]` entry to a normalized
 * source (`link` → `url`, `snippet` → `snippet`) and omits `content`, because the
 * JSON API returns no generated answer (only the AI-overview endpoints do, and they
 * are not part of this provider's official contract).
 *
 * Google's `num` parameter is capped at 10, so a request asking for more still sends
 * 10; the web seam owns the final `maxResults` truncation on the way back.
 *
 * @module @deepseek-ai/dsh-web-search-google/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { GoogleError, GoogleSearchItem, GoogleSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const GOOGLE_PROVIDER_ID = 'google'

/** Default endpoint base; `/customsearch/v1` is appended. */
export const GOOGLE_DEFAULT_BASE_URL = 'https://www.googleapis.com'

/** Google's `num` parameter lower bound. */
export const GOOGLE_MIN_RESULTS = 1

/** Google's `num` parameter upper bound (the API rejects larger values). */
export const GOOGLE_MAX_NUM_RESULTS = 10

/** Result count sent when neither the request nor the config supplies one. */
export const GOOGLE_DEFAULT_MAX_RESULTS = GOOGLE_MAX_NUM_RESULTS

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface GoogleSearchProviderOptions {
  /** Google API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Custom Search Engine ID (`cx`). Empty/absent makes the provider unavailable. */
  searchEngineId: string
  /** Endpoint base; `/customsearch/v1` is appended. */
  baseURL: string
  /**
   * Default result count when a request carries no `maxResults`. Omitted = the
   * {@link GOOGLE_DEFAULT_MAX_RESULTS} maximum. Must be an integer in
   * {@link GOOGLE_MIN_RESULTS}..{@link GOOGLE_MAX_NUM_RESULTS}.
   */
  numResults?: number
}

/**
 * Resolve the `num` query value sent to Google from a request bound and a
 * configured default. The API only accepts 1..10, so larger values clamp to 10
 * and missing/non-positive values fall back to 10 (the documented default and
 * the API's own behavior when `num` is absent).
 *
 * @param requestMax - the current request's `maxResults`, when any.
 * @param configured - the provider's configured default, when any.
 * @returns an integer in 1..10 to send as Google's `num`.
 */
export function resolveNumResults(requestMax: number | undefined, configured: number | undefined): number {
  const requested = requestMax ?? configured ?? GOOGLE_DEFAULT_MAX_RESULTS
  if (!Number.isInteger(requested) || requested < GOOGLE_MIN_RESULTS) return GOOGLE_DEFAULT_MAX_RESULTS
  return Math.min(requested, GOOGLE_MAX_NUM_RESULTS)

}

/**
 * Map one Google result item to a normalized source, or `undefined` when it
 * carries no URL (an entry without `link` has no portable citation and is dropped).
 *
 * @param item - one entry of Google's `items[]`.
 * @returns the normalized source, or `undefined` when the entry has no `link`.
 */
export function mapGoogleItem(item: GoogleSearchItem): WebSearchSource | undefined {
  if (typeof item.link !== 'string' || item.link.length === 0) return undefined
  return {
    url: item.link,
    ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
    ...item.snippet != null && item.snippet.length > 0 ? { snippet: item.snippet } : {},
  }
}

/**
 * Map a Google Custom Search response envelope to a normalized search result.
 * Google returns no generated answer, so `content` is omitted. The web service
 * owns the final `maxResults` truncation, so this provider reports `truncated: false`.
 *
 * @param response - the parsed `GET /customsearch/v1` response body.
 * @returns the normalized result; link-less entries are dropped
 *   ({@link mapGoogleItem}).
 */
export function mapGoogleResponse(response: GoogleSearchResponse): WebSearchResult {
  const sources = (response.items ?? [])
    .map(mapGoogleItem)
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}

/** The Google-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class GoogleSearchProvider implements WebSearchProvider {
  readonly id = GOOGLE_PROVIDER_ID

  constructor(private readonly options: GoogleSearchProviderOptions) {}

  available(): boolean {
    return this.options.apiKey.length > 0
      && this.options.searchEngineId.length > 0
      && isValidBaseUrl(this.options.baseURL)
      && isValidNumResults(this.options.numResults)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const numResults = resolveNumResults(request.maxResults, this.options.numResults)
    const endpoint = new URL('/customsearch/v1', this.options.baseURL)
    endpoint.searchParams.set('key', this.options.apiKey)
    endpoint.searchParams.set('cx', this.options.searchEngineId)
    endpoint.searchParams.set('q', request.query)
    endpoint.searchParams.set('num', String(numResults))

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Google search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Google search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Google API error (HTTP ${status})`
      try {
        const parsed = await response.json() as GoogleError
        const detail = parsed.error?.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('Google search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as GoogleSearchResponse
      return mapGoogleResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Google search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Google returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True when a configured result count is usable with Google's `num` (1..10). */
function isValidNumResults(value: number | undefined): boolean {
  return value === undefined
    || (Number.isInteger(value) && value >= GOOGLE_MIN_RESULTS && value <= GOOGLE_MAX_NUM_RESULTS)
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
