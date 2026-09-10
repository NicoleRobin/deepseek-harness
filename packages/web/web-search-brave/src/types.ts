/**
 * Wire types for the Brave Search API (`GET /res/v1/web/search`). Types only — no
 * runtime code. Brave groups results under `web.results[]`; each entry carries a
 * `url`, optional `title`, optional `description` excerpt, and an optional `age`
 * (a publication/recency string). Errors use `{ error: { code, message, ... } }`.
 *
 * @module @deepseek-ai/dsh-web-search-brave/types
 */

/** One result entry inside Brave's `web.results[]`. */
export interface BraveWebResultItem {
  url: string
  title?: string | null
  /** Plain-text excerpt Brave generated for the result. */
  description?: string | null
  /** Provider-supplied recency/age string (mapped to `publishedAt` when present). */
  age?: string | null
  language?: string | null
}

/** The `web` group of a Brave Search response. */
export interface BraveWebGroup {
  results?: BraveWebResultItem[]
  type?: string
}

/** Brave's search response envelope. Only the `web` group is consumed. */
export interface BraveSearchResponse {
  web?: BraveWebGroup
}

/** One error detail in Brave's error envelope. */
export interface BraveErrorDetail {
  code?: string
  message?: string
}

/** Brave's error response envelope (best-effort; fields vary by failure). */
export interface BraveError {
  error?: {
    code?: string
    message?: string
    details?: BraveErrorDetail[]
  }
}
