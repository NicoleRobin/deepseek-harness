# @deepseek-ai/dsh-web-search-google

[English](README.md) | 中文

由 [Google 自定义搜索](https://programmablesearchengine.google.com/)（Custom Search）支持的 `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.zh.md)（`ctx.web`）。它调用 Google 的 `GET /customsearch/v1` 端点，把 `items[]` 中的每一项映射为 seam 规范化的 `WebSearchResult`。

这是一个**实现**包：它向 `ctx.web` 注册提供方，不拥有 `ctx.web` 键，也不注册面向模型的工具（后者属于 `@deepseek-ai/dsh-tool-web`）。与 `@deepseek-ai/dsh-llm-deepseek` 一样，它是函数／命名空间插件（`inject: ['web']`），负责注册后端，而非默认导出服务。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | `$GOOGLE_SEARCH_API_KEY` | Google API 密钥。为空或缺失时提供方不可用。 |
| `searchEngineId` | `$GOOGLE_SEARCH_CX` | 自定义搜索引擎 ID（`cx`）。为空或缺失时提供方不可用。 |
| `baseURL` | `https://www.googleapis.com` | 端点基址；追加 `/customsearch/v1`。无法解析时提供方不可用。 |
| `numResults` | `10` | 请求不含 `maxResults` 时使用的默认结果数。必须是 1 到 10 的整数；Google 拒绝更大的值。 |

本提供方是可选安装的。请在同一组合中将它选为搜索后端并安装该插件：

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

## 映射

Google 的 `items[]` 把结果 URL 命名为 `link`（不是 `url`），并可选携带 `title` 与 `snippet` 摘要。每项映射为 `WebSearchSource`：`url` ← `link`、`title` ← `title`、`snippet` ← `snippet`；没有 `link` 的项缺少可移植的引用地址，会被丢弃。Google 不返回生成答案，因此 `content` 始终省略；该 JSON API 不返回可靠的逐结果日期，因此 `publishedAt` 始终不填。请求的 `maxResults` 优先于已配置的 `numResults`，发送前会被钳制到 Google `num` 的 1..10 范围；最终上限由 seam 强制执行。提供方失败（HTTP 错误、网络失败、响应体无法解析或结构不符）以 `WebError` `WEB_PROVIDER_ERROR` 呈现；中止请求以 `WEB_ABORTED` 呈现。HTTP 重定向会在访问 `Location` 指向的目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。

## 模型体验

通过 [`dsh-tool-web`](../tool-web/README.zh.md) 间接影响；该工具保留此提供方经 `maxResults` 限制的 URL、标题与 snippet，或将确切的错误消息 `Google search aborted`、`Google search request failed: <error>` 和 `Google returned an unprocessable response body: <error>` 置于消费方的错误包装层内；生成答案与提供方私有字段不进入上下文。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **单次请求最多返回 10 条结果**：Google 的 `num` 上限为 10，因此无法满足超过 10 的 `maxResults`；seam 只能对 Google 实际返回的条数做截断。
- **没有发布日期**：Custom Search JSON API 不返回可靠的逐结果日期，因此 `publishedAt` 从不填充。
- **没有生成答案**：官方端点只返回结果条目，因此 `content` 始终省略。
- **只公开 `numResults`**：站点、语言、日期等 Custom Search 控制项等待提供方无关的 Service Definition 字段（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)）。
- **按错误形状分类中止**：只有 `DOMException` 且名为 `AbortError` 时才映射为 `WEB_ABORTED`；携带自定义原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）会呈现为 `WEB_PROVIDER_ERROR`。
