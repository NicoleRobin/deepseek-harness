import { describe, expect, it } from 'vitest'
import {
  GOOGLE_DEFAULT_BASE_URL,
  GoogleSearchProvider,
} from '@deepseek-ai/dsh-web-search-google'

/**
 * Real-API smoke for the Google Custom Search provider. Self-skips without both
 * `$GOOGLE_SEARCH_API_KEY` and `$GOOGLE_SEARCH_CX` (CI has no secrets), per the
 * with-key e2e policy in docs/testing.md.
 */
const apiKey = process.env.GOOGLE_SEARCH_API_KEY
const cx = process.env.GOOGLE_SEARCH_CX
const maybe = apiKey !== undefined && apiKey.length > 0 && cx !== undefined && cx.length > 0
  ? describe
  : describe.skip

maybe('GoogleSearchProvider real API', () => {
  it('returns sources for a live query', async () => {
    const provider = new GoogleSearchProvider({
      apiKey: apiKey!,
      searchEngineId: cx!,
      baseURL: GOOGLE_DEFAULT_BASE_URL,
    })
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
