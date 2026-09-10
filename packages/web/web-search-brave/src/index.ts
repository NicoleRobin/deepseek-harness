/**
 * `@deepseek-ai/dsh-web-search-brave`: registers a Brave Search-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's provider registry, exactly
 * as `@deepseek-ai/dsh-web-search-exa` registers its backend. The key is owned by
 * `@deepseek-ai/dsh-web`.
 *
 * @module @deepseek-ai/dsh-web-search-brave
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { BRAVE_DEFAULT_BASE_URL, BraveSearchProvider } from './provider.ts'

export {
  BRAVE_DEFAULT_BASE_URL,
  BRAVE_DEFAULT_MAX_RESULTS,
  BRAVE_PROVIDER_ID,
  BraveSearchProvider,
} from './provider.ts'
export type { BraveSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-brave'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Brave Search API key. Falls back to `$BRAVE_SEARCH_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** Endpoint base; `/res/v1/web/search` is appended. Defaults to the public API. */
  baseURL?: string
  /**
   * Default result count when a request carries no `maxResults`. Omitted = 10.
   * Must be an integer from 1 to 20 (Brave's `count` range).
   */
  numResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  baseURL: z.string(),
  numResults: z.number().step(1).min(1).max(20),
})

/** Register the Brave search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new BraveSearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('BRAVE_SEARCH_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? BRAVE_DEFAULT_BASE_URL,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
  }))
}
