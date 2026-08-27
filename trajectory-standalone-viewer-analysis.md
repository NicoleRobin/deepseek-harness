# 轨迹（Trajectory）实现分析 与 独立查看器剥离方案

> 分析对象：`packages/client/ui-trajectory`（`@deepseek-ai/dsh-client-ui-trajectory`）
> 目标：理解轨迹的渲染方式，将其剥离为独立轨迹查看器，请求信息改为从火山引擎日志服务（TLS）获取。

---

## 一、轨迹是什么

轨迹 = 一次 agent 会话的**事件账本视图**：按 Turn（轮）→ Step（步）组织，展示
User 输入 / System Prompt 变更 / Assistant 消息 / Tool 调用与结果 / Compaction 等记录，
每一条记录可展开查看输入、输出、token 用量、耗时；顶部还有一条
Chrome DevTools Network 风格的**时间轴总览**（Overview），支持拖选、缩放、聚焦。

它完全在**浏览器端渲染**，不参与任何模型请求（README 明确 "Model Experience: None"）。

## 二、整体数据流（实现方式）

```
会话日志事件流                          (host 侧持久化，每条 {type, seq, time, data})
   │  session 连接 / 重放
   ▼
ConversationNodeDefinition 注册          (ui-trajectory 注册 6 个)
   │  trajectory-assistant-definition    step/start → assistant/chunk|message → step/end、llm/retry、turn/end
   │  trajectory-message-definitions     user/message、inbox
   │  trajectory-request-header-def      request/header → 记录 model-visible prompt 快照
   │  trajectory-tool-definition         tool/call → tool/result（含嵌套 subCalls）
   │  trajectory-compaction-definition   compaction/start、session/end
   │  每个事件被 fold 成 TrajectoryConversationViewNode（带 anchorSeq 排序贡献）
   ▼
TrajectorySnapshotBuilder                (ConversationViewDefinition, target: 'trajectory')
   │  把 contributions 折叠成 TrajectorySnapshot：
   │    eventNodes      排序后的会话节点（user/assistant/tool-result/context/...）
   │    eventLocations  seq → turn/step 位置索引
   │    requests        RequestView[]（每次模型请求：状态/时序/usage/模型/重试/请求头）
   │    callSchemas     callId → 工具 schema
   │    partial         流式中的 assistant 半成品
   │    runningCalls    执行中的工具调用
   ▼
TrajectoryView (React, 订阅 snapshot.views.get('trajectory'))
   │  deriveTrajectoryLayout()  → turns → groups(Message/Step N/Compaction N) → cells(TrajectoryCellProps[])
   │  appendTrajectoryPartialLayout() 流式增量
   │  deriveTrajectoryTimeline() 时间轴投影（4 种模式）
   │  请求编号 + 累计 token 统计 + 搜索索引
   ▼
渲染：TrajectoryToolbar + TrajectoryTimeline(总览) + TrajectoryTable(虚拟滚动账本)
```

**核心契约**（剥离时的输入边界，定义在 `trajectory-contract.ts` / `trajectory-record.ts`）：

```ts
interface TrajectorySnapshot {
  eventNodes: ConversationNode[]                    // 排序后的会话节点
  eventLocations: Map<number, ConversationLocation> // seq → turn/step
  requests: RequestView[]                           // 模型请求生命周期
  callSchemas: Map<string, ToolSchema>              // 工具 schema
  partial: PartialAssistant | null                  // 实时流半成品
  runningCalls: RunningToolCall[]                   // 实时执行中工具
}

interface TrajectoryCellProps {                     // 单条账本记录的展示契约
  index, kind('system'|'user'|'context'|'compacted'|'message'|'tool'|'subtool'),
  text / previewMarkdown, inputDetail / outputDetail / thinkingDetail,
  sourceBlocks / outputBlocks, schemaDetail, assistantMetrics(TTFT/解码),
  result / isError, callId, timeSeconds, startedAt,
  input / cacheRead / cacheWrite / output / think    // token
}
```

## 三、渲染方式（值得参考的点）

### 1. 纯函数投影，组件零业务逻辑
`layout.ts`（1126 行）、`timeline.ts`（200 行）是把快照折叠成展示模型的**纯函数**：
`deriveTrajectoryLayout(snapshot) → turns`，`deriveTrajectoryTimeline(turns, mode) → spans`。
组件只做订阅 + useMemo，逻辑可完全脱离插件体系单独复用/单测。

### 2. 时间轴总览（TrajectoryTimeline）——Chrome Network 风格
- **三车道**：Input（user/system）/ Model（assistant）/ Tools（tool/subtool），`laneFor(kind)` 定车道。
- **坐标投影全部走 CSS 自定义属性**：每个 span 是一个绝对定位的 `<span>`，
  style 注入 `--trajectory-span-left/width/gap/lane`，外层用
  `--trajectory-domain-left/width` 实现视口平移/缩放（纯 CSS transform 级投影，无 canvas）。
- **四种投影模式**（Toolbar 切换）：`sequence`（等宽按记录序）、`duration`（真实耗时、压缩空闲）、
  `time`（真实时钟、不压缩）、`actual`（真实时长+真实时钟）。
- **Assistant 分段**：`--trajectory-assistant-ttft` 百分比把 span 分成 TTFT / 解码两段。
- **交互**：左键拖拽框选 → 反算 `TrajectoryTimeRange` → 账本只保留区间内活跃记录
  （`trajectoryTimelineFocusIndexes`）；滚轮缩放（`passive: false` wheel 监听 + exp 缩放）；
  右键平移；点击 span 直达账本记录；500ms hover 显示 TTFT/解码/起止时钟；双击/Esc 清除。
- **早期历史截断**：未加载的前缀用 `…` 占位（不虚构时长），点击加载上一页。

### 3. 账本表格（TrajectoryTable）——虚拟滚动
- `@tanstack/react-virtual`，只挂载可视窗口 + 12 行 overscan；`anchorTo: 'end'` 从尾部打开。
- **语义化稳定行 key**：`trajectoryVirtualRecordKey(record)`（recordId/callId/sourceSeq 派生），
  prepend 历史后行身份不漂移；ARIA `aria-rowcount` 契约化。
- **request-only 分隔行**与下一个内容行合并为一个可测高的 virtual row（`groupTrajectoryVirtualRows`）。
- 折叠（整 Turn / 单 Assistant）、搜索（`TrajectorySearchIndex`，3s 节流重建）、请求编号、
  累计 token；行内 inspector 面板含 tabs：system-prompt / tools / overview / rendered / raw /
  input / output / schema / usage / timing / diff（`structuredPatch` 做 prompt diff）。
- 顶部时间轴与账本双向联动（timeline 选中 → 账本高亮；账本选中 → timeline 定位 viewport）。

### 4. 样式
CSS Modules + 设计 token（`--dsw-*`）+ 容器查询（`container: trajectory-table`）+ `color-mix`
生成 Turn 强调色；深色主题。

## 四、剥离为独立查看器

### 总体判断：可行性高
该包是**纯消费插件**：不定义服务、不注册 slot 之外的东西，组件全是 `(props) => ReactNode`。
数据边界就是 `TrajectorySnapshot` 这个快照形状。把它变成独立查看器 = **拷贝展示层 + 替换数据来源**。

### 方案 A（推荐）：拷贝纯展示层到独立 Vite + React 应用

需要拷贝的文件（无 ctx/slot 依赖）：

| 类别 | 文件 |
|---|---|
| 纯函数 | `layout.ts`、`timeline.ts`、`trajectory-record.ts`、`trajectory-search-index.ts`、`trajectory-virtual-rows.ts`、`trajectory-preview.ts` |
| 组件 | `TrajectoryView.tsx`、`TrajectoryToolbar.tsx`、`TrajectoryTimeline.tsx`、`TrajectoryTable.tsx`、`TrajectoryCell.tsx`、`TrajectoryTurn.tsx`、`TrajectoryTurnHeader.tsx`、`TrajectoryGroupHeader.tsx` |
| 样式 | 上述所有 `.module.css` + `views.module.css` |

依赖替换清单（对外 import 统计：runtime×16、ui-primitives×4、ui-slots×2、ui-conversation×2、tools/compaction/locale/agent 各 1）：

1. **`dsh-client-runtime` 类型** → 在本项目内定义等价类型。最省事的做法：
   `ConversationNode`、`RequestView`、`AssistantMessageNode`、`ToolCallBlock`、`ToolResultNode`、
   `ConversationPromptSnapshot`、`PartialAssistant`、`RunningToolCall` 这套类型只需保留
   layout/timeline 实际消费的字段（见上方 `TrajectorySnapshot` 契约），可以瘦身。
2. **`useSession` / `SnapshotStore` 订阅** → 独立 app 里用普通 `useState` / zustand，
   加载完成后把快照 set 进去即可（TrajectoryView 里的 `useSession(snapshot => ...)` 换成 props）。
3. **`ctx.locale`** → 内置一个 `{zh, en}` 字典对象（`locales.ts` 可原样拷走）。
4. **`ui-primitives`**（Tooltip / MarkdownText / JsonTree / 图标）→ 换等价实现或从该包拷贝
   （它们本身是纯展示组件）；`diff` 与 `@tanstack/react-virtual` 保留 npm 依赖。
5. **`ui-slots` / `ui-conversation` 的 slot props**（`ConvViewProps`、`InjectFace`、`PropsLocale`）
   → 简化成普通 props：`TrajectoryView({ snapshot, ... })`。
6. **实时字段**：`partial` / `runningCalls` 在独立查看器中传 `null` / `[]` 即可，
   组件对 running 状态有完整降级（in-flight span 显示起点标记而非虚构时长）。

### 方案 B（可选演进）：抽成 npm 包 `@scope/trajectory-viewer`
把方案 A 的组件打包成纯组件库，导出 `<TrajectoryViewer snapshot={TrajectorySnapshot} />`，
输入契约文档化。适合多个前端（内部平台、报表页）复用。

### TLS（火山引擎日志服务）数据接入

整体是"**适配器**"问题：TLS 原始日志 → 统一请求记录 → `TrajectorySnapshot`。

```
火山 TLS 日志库（按 trace_id / request_id / session_id + 时间范围检索）
   │  TLS SDK / OpenAPI（检索、getLogContexts、按主题 + 查询语句）
   ▼
RequestLog[]（统一中间格式，一个元素 = 一次模型请求 + 其工具对）
   │  适配器 normalize
   ▼
TrajectorySnapshot（直接喂给查看器）
```

适配层要做的映射：

| TLS 里的信息 | 映射到 | 说明 |
|---|---|---|
| 请求头（model、system prompt、tools schema、采样参数、请求起始时间） | `AssistantRequestView.prompt / provenance / requestConfig / startedAt` | 对应 harness 的 `request/header` 事件 |
| 请求完成/失败（耗时、usage tokens、错误、重试次数） | `RequestView.status / completedAt / usage / error / retry` | 对应 `llm/response`、`llm/retry` |
| 响应正文（text / reasoning / tool-call 块） | `AssistantMessageNode.blocks` | 对应 `assistant/message` |
| 工具调用/结果对（callId、args、输出、错误、嵌套子调用） | `ToolResultNode` / `RunningToolCall` + `callSchemas` | 对应 `tool/call` + `tool/result` |
| 轮/步边界 | `turn / step` 字段 | 可由请求序号/时间推导；`RequestView.turn/step` |
| 首 token 时间 | `AssistantMessageNode.timing.firstTokenTime` | 用于 TTFT 分段；没有就不渲染 |
| Compaction / 会话结束 | `CompactionRequestView` / 忽略 | 无则省略 |

关键点：

- **seq 是 harness 会话日志的全局单调序号**，TLS 没有。适配器用"请求内序号/全局递增号"生成，
  保证 `eventNodes` 与 `requests` 按序排序即可（layout 依赖排序，不依赖 seq 的具体值）。
- **turn/step 语义**：`Step N` 分组来自 `RequestView.turn/step`。若 TLS 日志带 agent 的
  turn/step 字段最好；否则按"一个用户消息 + 其后续请求序列 = 一 Turn，一个请求 = 一个 Step"
  归并。
- **TTFT / 真实耗时**：时间轴 `time/duration` 模式依赖 `startedAt` + `timeSeconds`，
  需要 TLS 记录请求开始、首 token、完成三个时间点；缺失时降级到 `sequence` 模式（等宽）。
- **usage**：`input/output/cacheRead/cacheWrite/reasoning` tokens 有则显示，无则缺省。

### 建议分步实施

1. 新建独立 Vite + React 应用（`pnpm create vite --template react-ts`）。
2. 拷贝上表文件；先做依赖替换（runtime 类型 → 本地类型、locale → 字典、slot props → 普通 props）。
3. 用一段 JSON fixture（手工构造 `TrajectorySnapshot`）把渲染跑通——这是剥离正确性的验证点。
4. Node 侧写 TLS 查询服务：火山 TLS SDK（Java/Go/Python/Node 均可，走
   [日志服务文档](https://docs.volcengine.com/docs/6470/1119991?lang=zh)）按会话检索，
   输出 `RequestLog[]`。
5. 写适配器 `RequestLog[] → TrajectorySnapshot`（复用本分析第二节的折叠思路，
   或直接构造快照字段）。
6. 接 UI：会话/请求列表（TLS 查询入口）→ 点开 → 加载快照 → 渲染查看器。
7. 可选裁剪：删除 `partial`/`runningCalls` 相关分支，砍掉 slot 体系残留，减重。

## 五、工作量与风险

- **渲染层**约 5k 行 TSX/TS（layout 1.1k + table 3k + timeline 730 + cell/turn/toolbar）。
  因是纯消费代码，剥离主要是**替换依赖**而非重写，预计 1–2 天可跑通 fixture，TLS 适配另计。
- **风险 1**：`TrajectoryTable` 对 `Session` 的分页/加载历史逻辑（`loadOlder`、`hasMore`）
  依赖 runtime 的会话窗口；独立查看器按"一次全量快照"处理，把 `hasOlderRecords=false`、
  `loadOlder=undefined` 传入即可禁用（组件有完整降级路径）。
- **风险 2**：CSS 依赖 `--dsw-*` token 与深色主题变量，需从 `packages/client/ui-theme/src/styles/`
  带上 token 定义或做主题适配。
- **风险 3**：TLS 日志字段覆盖度决定展示丰富度——缺失时序字段则时间轴退化、缺失 usage 则
  token 列/累计统计为空，都不影响账本主体。

## 参考源码位置

- 插件入口与注册：`packages/client/ui-trajectory/src/client/index.ts`
- 数据契约：`trajectory-contract.ts`、`trajectory-record.ts`
- 快照折叠：`trajectory-snapshot-builder.ts`（+ 6 个 `trajectory-*-definition.ts` 事件折叠）
- 布局/时间轴纯函数：`layout.ts`、`timeline.ts`
- 渲染：`TrajectoryView.tsx`、`TrajectoryTimeline.tsx`、`TrajectoryTable.tsx`
- 运行时数据类型：`packages/client/runtime/src/client/sessions/conversation.ts`、
  `request-inspection.ts`
- 火山引擎日志服务（TLS）文档：
  [C++ SDK 概述](https://docs.volcengine.com/docs/6470/1119991?lang=zh)、
  [Java SDK 检索分析日志](https://www.volcengine.com/docs/6470/1172147?lang=zh#1)、
  [Go SDK 检索分析日志](https://docs.volcengine.com/docs/6470/1172153?lang=zh)、
  [Query overview（Torch Log Service）](https://www.volcengine.com/docs/6470/1206701?lang=en#1)
