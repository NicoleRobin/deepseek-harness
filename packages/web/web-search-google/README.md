# @deepseek-ai/dsh-web-search-google

English | [中文](README.zh.md)

A [Google Custom Search](https://programmablesearchengine.google.com/)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Google's `GET /customsearch/v1` endpoint and maps each `items[]` entry into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). Like `@deepseek-ai/dsh-llm-deepseek`, it is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | `$GOOGLE_SEARCH_API_KEY` | Google API key. Empty/absent makes the provider unavailable. |
| `searchEngineId` | `$GOOGLE_SEARCH_CX` | Custom Search Engine ID (`cx`). Empty/absent makes the provider unavailable. |
| `baseURL` | `https://www.googleapis.com` | Endpoint base; `/customsearch/v1` is appended. An unparseable value makes the provider unavailable. |
| `numResults` | `10` | Default result count when a request carries no `maxResults`. Must be an integer from 1 to 10; Google rejects larger values. |

The provider is opt-in. Select it as the active search backend and install the plugin in the same composition:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: google

- id: web-search-google
  name: '@deepseek-ai/dsh-web-search-google'
  # Omit config to fall back to $GOOGLE_SEARCH_API_KEY and $GOOGLE_SEARCH_CX.
  config:
    apiKey: !!js process.env.GOOGLE_SEARCH_API_KEY
    searchEngineId: !!js process.env.GOOGLE_SEARCH_CX
```

## Mapping

Google returns an `items[]` where each entry names its URL `link` (not `url`), carries an optional `title`, and an optional `snippet` excerpt. Each item maps to a `WebSearchSource`: `url` ← `link`, `title` ← `title`, `snippet` ← `snippet`; an item with no `link` has no portable citation and is dropped. Google returns no generated answer, so `content` is always omitted, and the JSON API carries no reliable per-result date, so `publishedAt` stays unset. A request's `maxResults` overrides the configured `numResults` and is clamped to Google's `num` range of 1..10 before being sent; the final bound is enforced by the seam. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, and snippets or its exact `Google search aborted`, `Google search request failed: <error>`, and `Google returned an unprocessable response body: <error>` failures under the consumer's error wrapper, while generated answers and provider-private fields remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **A single request returns at most 10 results** — Google's `num` is capped at 10, so a `maxResults` above 10 cannot be satisfied; the seam truncates to whatever Google returned.
- **No publication date** — the Custom Search JSON API does not return a reliable per-result date, so `publishedAt` is never populated.
- **No generated answer** — the official endpoint returns only result items, so `content` is always omitted.
- **Only `numResults` is exposed** — Custom Search controls such as site, language, and date filters wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (for example `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
