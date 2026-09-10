/**
 * Wire types for the Google Custom Search JSON API (`GET /customsearch/v1`). Types
 * only — no runtime code. Google returns an `items[]` of result entries; each entry
 * carries a `link` (mapped to `url`), an optional `title`, and an optional `snippet`
 * excerpt. Errors use Google's `{ error: { code, message, errors[] } }` envelope.
 *
 * @module @deepseek-ai/dsh-web-search-google/types
 */

/** One entry of Google's `items[]` result list. */
export interface GoogleSearchItem {
  /** Result URL (Google names it `link`, not `url`). */
  link: string
  title?: string | null
  /** Plain-text excerpt Google generated for the result. */
  snippet?: string | null
  /** Hostname Google displays for the result. */
  displayLink?: string | null
}

/** Google's Custom Search response envelope. */
export interface GoogleSearchResponse {
  items?: GoogleSearchItem[]
}

/** One error detail in Google's error envelope. */
export interface GoogleErrorDetail {
  reason?: string
  message?: string
  domain?: string
}

/** Google's error response envelope (best-effort; fields vary by failure). */
export interface GoogleError {
  error?: {
    code?: number
    message?: string
    errors?: GoogleErrorDetail[]
  }
}
