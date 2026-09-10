# @deepseek-ai/dsh-web-search-brave

English | [中文](README.zh.md)

A [Brave Search](https://brave.com/search/api/)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Brave's `GET /res/v1/web/search` endpoint and maps each `web.results[]` entry into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). Like `@deepseek-ai/dsh-llm-deepseek`, it is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | `$BRAVE_SEARCH_API_KEY` | Brave Search API key. Empty/absent makes the provider unavailable. |
| `baseURL` | `https://api.search.brave.com` | Endpoint base; `/res/v1/web/search` is appended. An unparseable value makes the provider unavailable. |
| `numResults` | `10` | Default result count when a request carries no `maxResults`. Must be an integer from 1 to 20; Brave rejects larger values. |

The provider is opt-in. Select it as the active search backend and install the plugin in the same composition:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: brave

- id: web-search-brave
  name: '@deepseek-ai/dsh-web-search-brave'
  # Omit config to fall back to $BRAVE_SEARCH_API_KEY.
  config:
    apiKey: !!js process.env.BRAVE_SEARCH_API_KEY
```

## Mapping

Brave groups results under a `web` object. Each `web.results[]` item maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← `description`, `publishedAt` ← `age`; an item with no `url` has no portable citation and is dropped. Brave returns no generated answer, so `content` is always omitted. A request's `maxResults` overrides the configured `numResults` and is clamped to Brave's `count` range of 1..20 before being sent; the final bound is enforced by the seam. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, snippets, and publication ages or its exact `Brave search aborted`, `Brave search request failed: <error>`, and `Brave returned an unprocessable response body: <error>` failures under the consumer's error wrapper, while generated answers and provider-private fields remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **A single request returns at most 20 results** — Brave's `count` is capped at 20, so a `maxResults` above 20 cannot be satisfied; the seam truncates to whatever Brave returned.
- **`age` is a free-form string** — Brave's `age` field is mapped to `publishedAt` verbatim; consumers must not assume a strict ISO-8601 date.
- **No generated answer** — this endpoint returns only result items, so `content` is always omitted.
- **Only `numResults` is exposed** — Brave's other controls (safe search, country, language, freshness, goggles) wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (for example `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
