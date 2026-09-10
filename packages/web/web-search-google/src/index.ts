/**
 * `@deepseek-ai/dsh-web-search-google`: registers a Google Custom Search-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's provider registry, exactly
 * as `@deepseek-ai/dsh-web-search-exa` registers its backend. The key is owned by
 * `@deepseek-ai/dsh-web`.
 *
 * @module @deepseek-ai/dsh-web-search-google
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  GOOGLE_DEFAULT_BASE_URL,
  GoogleSearchProvider,
} from './provider.ts'

export {
  GOOGLE_DEFAULT_BASE_URL,
  GOOGLE_DEFAULT_MAX_RESULTS,
  GOOGLE_PROVIDER_ID,
  GoogleSearchProvider,
} from './provider.ts'
export type { GoogleSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-google'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Google API key. Falls back to `$GOOGLE_SEARCH_API_KEY`. Empty → provider unavailable. */
  apiKey?: string
  /** Custom Search Engine ID (`cx`). Falls back to `$GOOGLE_SEARCH_CX`. Empty → unavailable. */
  searchEngineId?: string
  /** Endpoint base; `/customsearch/v1` is appended. Defaults to the public API. */
  baseURL?: string
  /**
   * Default result count when a request carries no `maxResults`. Omitted = 10
   * (Google's maximum). Must be an integer from 1 to 10.
   */
  numResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  searchEngineId: z.string(),
  baseURL: z.string(),
  numResults: z.number().step(1).min(1).max(10),
})

/** Register the Google search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new GoogleSearchProvider({
    // Every environment layer may name these keys: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('GOOGLE_SEARCH_API_KEY')?.value ?? '',
    searchEngineId: config.searchEngineId ?? launchEnvironmentOf(ctx).get('GOOGLE_SEARCH_CX')?.value ?? '',
    baseURL: config.baseURL ?? GOOGLE_DEFAULT_BASE_URL,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
  }))
}
