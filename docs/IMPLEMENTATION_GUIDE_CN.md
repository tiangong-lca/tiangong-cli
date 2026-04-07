# TianGong LCA CLI 实施指南

## 1. 目标

`tiangong-lca-cli` 是 TianGong 的统一执行面。

它解决的不是“有没有脚本”，而是：

- agent 的动作空间过大
- skills、shell、HTTP、MCP、Python 执行器的入口过碎
- 同类能力缺少统一参数风格和环境变量约定
- 质量门没有收敛到一个稳定仓库

本仓库的设计结论很明确：

- 用 TypeScript 直接实现 CLI
- 不把 MCP 作为 CLI 内部传输层
- 优先 Node 24 原生能力
- 优先文件输入、结构化 JSON 输出
- 把 `tiangong-lca-skills` 收敛成这个 CLI 的调用方，而不是并行产品面

MCP 替代策略也固定为两条：

- 策略 1：对业务 API 直接调用 `tiangong-lca-edge-functions`（Edge Functions / REST）
- 策略 2：对 Supabase 直接访问时不再经过 MCP；CLI 直接依赖官方 `@supabase/supabase-js`，并在此基础上保持 deterministic 的读写语义、URL 形状和报告契约

这两条是并行可选策略，不再引入新的 MCP 中间层。

## 2. 当前落地范围

### 2.1 已实现命令

```text
tiangong
  doctor
  search
    flow
    process
    lifecyclemodel
  flow
    get
    list
    remediate
    publish-version
    publish-reviewed-data
    build-alias-map
    scan-process-flow-refs
    plan-process-flow-repairs
    apply-process-flow-repairs
    regen-product
    validate-processes
  process
    get
    auto-build
    resume-build
    publish-build
    batch-build
  lifecyclemodel
    auto-build
    validate-build
    publish-build
    build-resulting-process
    publish-resulting-process
    orchestrate
  review
    process
    flow
  publish
    run
  validation
    run
  admin
    embedding-run
```

对应关系：

| CLI 命令 | 当前后端能力 |
| --- | --- |
| `tiangong doctor` | 本地环境诊断、`.env` 加载、统一 env 合同检查 |
| `tiangong search flow` | `flow_hybrid_search` |
| `tiangong search process` | `process_hybrid_search` |
| `tiangong search lifecyclemodel` | `lifecyclemodel_hybrid_search` |
| `tiangong flow get` | 统一 CLI 持有的只读 flow 详情读取面；从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase 目标并通过原生 `@supabase/supabase-js` 按 `id/version/user/state` 读取 |
| `tiangong flow list` | 统一 CLI 持有的只读 flow 枚举面；通过原生 `@supabase/supabase-js` 保持稳定过滤/排序/分页语义 |
| `tiangong flow remediate` | 本地 flow governance round1 deterministic remediation、artifact-first 输出 |
| `tiangong flow publish-version` | 统一 CLI 持有的 remediated-flow publish/update 入口；从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase 目标并通过原生 `@supabase/supabase-js` 写出稳定 success/failure artifacts |
| `tiangong flow publish-reviewed-data` | 统一 CLI 持有的 reviewed publish preparation 入口；支持 flow unchanged skip、flow/process append-only bump / current-version upsert、process flow-ref rewrite、本地 `publish-report.json` 与兼容的 flow success/failure artifacts |
| `tiangong flow build-alias-map` | 独立 deterministic alias map 入口；从 old/new flow snapshots 与可选 seed alias map 生成 alias plan、manual queue 与稳定 alias map |
| `tiangong flow scan-process-flow-refs` | 独立 process ref 扫描入口；对 local process rows 做 scope/catalog/alias 分类并写出 scan artifacts |
| `tiangong flow plan-process-flow-repairs` | 独立 deterministic repair planning 入口；从 process/scope/alias/scan 契约生成 repair plan |
| `tiangong flow apply-process-flow-repairs` | 独立 deterministic repair apply 入口；应用 deterministic subset、写出 patch evidence，并可同步本地 process pool |
| `tiangong flow regen-product` | 本地治理后 process-side 再生产物入口；在一个命令下执行 scan / repair / apply / validate 并输出稳定 artifacts |
| `tiangong flow validate-processes` | 本地治理后 patched process rows 的独立校验入口；校验 flow ref-only diff、quantitative reference 稳定性，并可选复用 `tidas-sdk` |
| `tiangong process get` | 统一 CLI 持有的只读 process 详情读取面；从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase 目标并通过原生 `@supabase/supabase-js` 按 `id/version` 读取 |
| `tiangong process auto-build` | 本地 `process_from_flow` intake、run-id 生成、artifact scaffold 预写 |
| `tiangong process resume-build` | 本地 `process_from_flow` resume handoff、state-lock/manifest 收口、resume 元数据与报告输出 |
| `tiangong process publish-build` | 本地 `process_from_flow` publish handoff、publish bundle/request/intent 产出、state/invocation/handoff 更新 |
| `tiangong process batch-build` | 本地 `process_from_flow` batch manifest 编排、批量调用 auto-build、batch report 输出 |
| `tiangong lifecyclemodel auto-build` | 本地 lifecyclemodel local-run intake、graph 推断、reference process 选择、`json_ordered` artifact 输出 |
| `tiangong lifecyclemodel validate-build` | 本地 lifecyclemodel build run 校验重跑、per-model 校验报告与 aggregate report 输出 |
| `tiangong lifecyclemodel publish-build` | 本地 lifecyclemodel publish handoff、publish bundle/request/intent 产出、validation 摘要复用 |
| `tiangong lifecyclemodel build-resulting-process` | 本地 lifecycle model resulting process 聚合、内部 flow 抵消、artifact 输出 |
| `tiangong lifecyclemodel publish-resulting-process` | 读取 resulting-process run，生成 `publish-bundle.json` / `publish-intent.json` 本地交付物 |
| `tiangong lifecyclemodel orchestrate` | 递归装配的 plan / execute / publish-handoff 命令；写出 graph/lineage/publish bundle 工件，并只调用原生 CLI builder slices |
| `tiangong review process` | 本地 process review、artifact-first 报告输出、可选 CLI LLM 语义审核 |
| `tiangong review flow` | 本地 flow governance review、rows-file 物化、artifact-first 报告输出、可选 CLI LLM 语义审核 |
| `tiangong publish run` | 本地 publish 契约归一化、dry-run/commit、report 输出 |
| `tiangong validation run` | 本地 `@tiangong-lca/tidas-sdk` 直接依赖校验收口 |
| `tiangong admin embedding-run` | `embedding_ft` |

此外，CLI 现在已经正式引入 `tiangong lifecyclemodel ...` 一级命名空间，其中：

- `tiangong lifecyclemodel auto-build` 已可执行
- `tiangong lifecyclemodel validate-build` 已可执行
- `tiangong lifecyclemodel publish-build` 已可执行
- `tiangong lifecyclemodel build-resulting-process` 已可执行
- `tiangong lifecyclemodel publish-resulting-process` 已可执行
- `tiangong lifecyclemodel orchestrate` 已可执行

`tiangong review ...` 也已经开始进入统一命令树，其中：

- `tiangong review process` 已可执行
- `tiangong review flow` 已可执行
- `tiangong review lifecyclemodel` 已可执行

`tiangong flow ...` 也已经开始承接 flow-governance 主链迁移，其中：

- `tiangong flow get` 已可执行
- `tiangong flow list` 已可执行
- `tiangong flow remediate` 已可执行
- `tiangong flow publish-version` 已可执行
- `tiangong flow publish-reviewed-data` 已可执行
- `tiangong flow build-alias-map` 已可执行
- `tiangong flow scan-process-flow-refs` 已可执行
- `tiangong flow plan-process-flow-repairs` 已可执行
- `tiangong flow apply-process-flow-repairs` 已可执行
- `tiangong flow regen-product` 已可执行
- `tiangong flow validate-processes` 已可执行

`tiangong process ...` 也已经开始承接 `process_from_flow` 主链迁移，其中：

- `tiangong process get` 已可执行
- `tiangong process auto-build` 已可执行
- `tiangong process resume-build` 已可执行
- `tiangong process publish-build` 已可执行
- `tiangong process batch-build` 已可执行

注意：

- `process get` 当前固定为 CLI 内部共享的 deterministic direct-read 面，内部执行已收口到原生 `@supabase/supabase-js`，供 lifecyclemodel resulting-process 和后续 review/governance 迁移复用
- 已实现的 `process auto-build` 保留了旧 `artifacts/process_from_flow/<run_id>/`、`cache/process_from_flow_state.json`、`cache/agent_handoff_summary.json` 等运行布局
- `process auto-build` 当前只负责本地 request intake、flow 归一化、run scaffold 和 manifest/report 预写，不继续执行后续阶段
- 已实现的 `process resume-build` 保留同一套 run 布局，并把本地 state-lock、run-manifest 校验、resume metadata/history、invocation index 更新统一收口到 CLI
- `process resume-build` 当前只负责本地 resume handoff，不直接执行 route / split / exchange / QA / publish 阶段
- 已实现的 `process publish-build` 继续保留同一套 run 布局，并把本地 publish-bundle/request/intent、state/invocation/handoff 更新统一收口到 CLI
- `process publish-build` 当前只负责本地 publish handoff，不直接执行远端 publish commit 或数据库写入
- 已实现的 `process batch-build` 继续走本地优先、artifact-first 路径，并把批量 item 编排、聚合 report、默认 run_dir 分配统一收口到 CLI
- `process batch-build` 当前只负责本地 batch orchestration，不直接串接 resume / publish 或远端执行器
- 已实现的 `lifecyclemodel auto-build` 走本地只读、artifact-first 路径，输入固定为 local run manifest，不依赖 Python、MCP、KB、LLM 或远端 CRUD
- `lifecyclemodel auto-build` 当前负责 graph 推断、reference process 选择、`@multiplicationFactor` 计算与 `json_ordered` lifecyclemodel 产物输出，并保留 `run-plan.json`、`resolved-manifest.json`、`selection/selection-brief.md`、`discovery/reference-model-summary.json`、`connections.json`、`process-catalog.json` 等 CLI 契约
- `lifecyclemodel auto-build` 当前明确不负责 reference-model discovery、任何远端 lifecyclemodel 写入，也不会自动串接 validate-build / publish-build
- 已实现的 `lifecyclemodel validate-build` 继续保留同一套 run 布局，并把模型扫描、统一 validation 模块调用、per-model report 与 aggregate report 输出统一收口到 CLI
- `lifecyclemodel validate-build` 当前只负责本地 validation handoff，不直接触发 publish，也不做任何远端写入
- 已实现的 `lifecyclemodel publish-build` 继续保留同一套 run 布局，并把本地 publish-bundle/request/intent、validation 摘要复用、invocation index 更新统一收口到 CLI
- `lifecyclemodel publish-build` 当前只负责本地 publish handoff，不直接执行远端 publish commit 或数据库写入；真正的 dry-run / commit 边界仍由 `tiangong publish run` 负责
- 已实现的 `build-resulting-process` 和 `publish-resulting-process` 都走本地优先、artifact-first 路径，不依赖 Python 或 MCP
- `build-resulting-process` 现在还支持一个显式的 deterministic direct-read 补全路径：当 request 打开 `process_sources.allow_remote_lookup=true` 时，CLI 会从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase 目标，并通过原生 `@supabase/supabase-js` 按 `process_id/version` 直接补齐缺失的 process dataset
- `publish-resulting-process` 当前负责生成本地 publish handoff 产物，还没有把提交语义直接并入 `publish run`
- 已实现的 `lifecyclemodel orchestrate` 把递归装配的 `plan | execute | publish` 三个动作统一收口到 CLI，并直接复用原生 `process auto-build`、`lifecyclemodel auto-build`、`lifecyclemodel build-resulting-process` slices
- `lifecyclemodel orchestrate` 的 `process_builder` request schema 已删除旧 builder 控制项，只保留 CLI-native 本地构建字段，并在归一化阶段拒绝额外键；不再保留任何 Python fallback 配置面
- 已实现的 `review process` 保留本地 artifact-first review contract，把规则核查、报告输出和可选 LLM 语义审核统一收口到 CLI；语义审核只使用 `TIANGONG_LCA_REVIEW_LLM_*`，不再透出 `OPENAI_*`
- 已实现的 `review flow` 保留本地 artifact-first governance review contract，把 flow 摘要、相似对、规则 findings、可选 LLM findings 和双语 markdown 报告统一收口到 CLI；语义审核同样只使用 `TIANGONG_LCA_REVIEW_LLM_*`
- `review flow` 当前明确不支持 `--with-reference-context`，也还没有接入本地 registry enrichment；这部分仍需后续迁移切片单独落地
- 已实现的 `flow get` 保留 deterministic direct-read 边界，但内部执行已经收口到原生 `@supabase/supabase-js`；支持 `id` + 可选 `version/user_id/state_code` 读取；若精确版本 miss，则回退到最新可见版本；若出现多个同版本可见候选，则直接报 ambiguous
- 已实现的 `flow list` 保留 deterministic direct-read 边界，但内部执行已经收口到原生 `@supabase/supabase-js`；支持稳定 `id/state_code/type_of_dataset` 过滤、显式 `order=id.asc,version.asc` 默认值，以及 `--all --page-size` 的 offset 分页
- 已实现的 `flow remediate` 保留旧 invalid-flow 输入与 round1 artifact 契约，但运行时已经收口到 CLI，不再需要 skill 私有 Python remediation 入口
- 已实现的 `flow publish-version` 直接从 `TIANGONG_LCA_API_BASE_URL` 推导 `/rest/v1/flows` 写入目标，并通过原生 `@supabase/supabase-js` 支持 dry-run/commit；同时保留 `mcp_success_list`、`remote_validation_failed`、`mcp_sync_report` 这些历史文件名
- 已实现的 `flow publish-reviewed-data` 负责 reviewed publish preparation 阶段：支持 `--original-flow-rows-file` unchanged skip、flow/process `skip | append_only_bump | upsert_current_version`、`prepared-flow-rows.json` / `prepared-process-rows.json` / `flow-version-map.json` / `skipped-unchanged-flow-rows.json` / `process-flow-ref-rewrite-evidence.jsonl` / `publish-report.json` 输出，并在 `--commit` 时通过同一条 `@supabase/supabase-js` writer layer 同时执行 prepared flow rows 与 prepared process rows 的远端写入
- 已实现的 `flow build-alias-map` 把治理链中的 deterministic alias-map 构建切片收口到 CLI，固定 old/new flow snapshots 与可选 `seed-alias-map` 输入契约，并直接写出 `alias-plan.json` / `flow-alias-map.json` / `manual-review-queue.jsonl` / `alias-summary.json`
- 已实现的 `flow scan-process-flow-refs` 把治理链中的独立 process ref scan 切片收口到 CLI，固定 process/scope/catalog/alias 输入契约，并直接写出 `scan-summary.json` / `scan-findings.json` / `scan-findings.jsonl`
- 已实现的 `flow plan-process-flow-repairs` 把治理链中的独立 deterministic repair planning 切片收口到 CLI，固定 process/scope/alias/scan 输入契约，并直接写出 `repair-plan.json` / `manual-review-queue.jsonl` / `repair-summary.json`
- 已实现的 `flow apply-process-flow-repairs` 把治理链中的独立 deterministic repair apply 切片收口到 CLI，固定与 planning 相同的输入契约，直接写出 `patched-processes.json` / `process-patches/**`，并可在 `--process-pool-file` 下同步本地 pool
- 已实现的 `flow regen-product` 把治理后的 process-side 再生产物链收口到 CLI，在一个命令下固定 `scan -> repair plan -> optional apply -> optional validate` 契约，并把退出码 `1` 保留给 `--apply` 之后的本地校验失败
- 已实现的 `flow validate-processes` 把治理后 patched process rows 的独立校验切片收口到 CLI，固定 original/patched/scope 三类输入契约，并直接写出 `validation-report.json` / `validation-failures.jsonl`
- 现有命令族里已经没有残留的 Python / shell validation fallback；其余 review / build / publish CLI 面已经进入可执行状态，未迁移子命令只剩 `auth` / `job` 这类 placeholder surface
- 这样做的目的不是“假装已完成”，而是先固定命令树，再逐个把 workflow 迁入 TypeScript CLI

### 2.2 已经固定的工程约束

- 运行时：Node 24
- 源码：TypeScript
- 包管理：npm
- 测试：`node:test`
- 覆盖率：`c8`
- 构建产物：`dist/`
- 开发期运行器：`tsx`

这里的边界现在很明确：

- 运行时不再依赖 `tsx`
- `bin` 入口只加载 `dist/src/main.js`
- `tsx` 只保留给开发期和测试期

## 3. 目录职责

```text
tiangong-lca-cli/
  bin/
    tiangong.js
    tiangong.d.ts
  dist/
  src/
    cli.ts
    main.ts
    lib/
  test/
  scripts/
    assert-full-coverage.ts
  docs/
```

职责边界：

- `bin/`：稳定启动器，只负责把 `tiangong` 命令接到 `dist/src/main.js`
- `dist/`：构建产物，供正式运行路径使用
- `src/cli.ts`：命令分发、参数解析、命令帮助、错误出口
- `src/main.ts`：进程入口源码，构建后输出到 `dist/src/main.js`
- `src/lib/`：纯功能模块
- `test/`：单元测试和 smoke test
- `scripts/assert-full-coverage.ts`：覆盖率硬门源码，构建后输出到 `dist/scripts/`

## 4. 命令设计原则

### 4.1 不按 skill 名直接暴露命令

不推荐：

```bash
tiangong flow-hybrid-search
tiangong process-hybrid-search
tiangong embedding-ft
```

推荐：

```bash
tiangong search flow
tiangong search process
tiangong admin embedding-run
```

这能显著降低 agent 的搜索空间和误操作概率。

### 4.2 读操作偏通用，写操作必须带业务语义

这个仓库没有实现“万能 CRUD”。

原因很简单：

- 搜索是搜索
- 发布是发布
- review/build 是 workflow
- 长任务是 job

如果为了“统一”再做一个泛化 CRUD 协议，只会重新制造熵。

具体执行上：

- 有现成业务语义和服务边界的能力，统一走 edge-functions / REST
- 只需数据层 CRUD 且无需新服务抽象时，直接走 `@supabase/supabase-js`
- 不再设计“CLI -> MCP -> DB”的第三条路径

### 4.3 文件优先

优先形式：

```bash
tiangong search flow --input ./request.json --json
tiangong publish run --input ./publish-request.json --dry-run
tiangong validation run --input-dir ./tidas-package --engine auto
tiangong admin embedding-run --input ./jobs.json --dry-run
```

而不是长自然语言参数和不稳定的 shell 拼接。

### 4.3.1 `search flow` 的最小 contract

`tiangong search flow` 现在固定的是“CLI 持有的 edge-function 请求转发契约层”。

它负责：

- 从 `--input` 读取一个 JSON 请求体
- 用 `TIANGONG_LCA_API_KEY` 换取 user session/access token
- 把请求体原样转发到 `flow_hybrid_search`
- 原样返回 edge-function 的 JSON 响应，而不是在 CLI 里做本地 UI 映射

最小请求体：

```json
{
  "query": "soda lime glass",
  "filter": {
    "flowType": "Product flow"
  }
}
```

更完整的请求体示例：

```json
{
  "query": "methylbutane",
  "filter": {
    "flowType": "Elementary flow",
    "asInput": false,
    "flowDataSet": {
      "flowInformation": {
        "dataSetInformation": {
          "CASNumber": "541-28-6"
        }
      }
    }
  }
}
```

当前已确认的请求要点：

- `query` 必填
- `filter` 可选
- `filter.flowType` 是最常用的 real-DB review 过滤项
- `filter.asInput` 会被原样透传
- `filter.flowDataSet...` 这种嵌套条件也会被原样透传

当前已确认的返回要点：

- 非空结果通常是 `{ "data": [...] }`
- `data` 中的原始 row 常见字段包括 `id`、`version`、`modified_at`、`json`
- 某些部署还可能带出额外字段，例如 `team_id`
- 空结果当前可能直接返回裸 JSON 数组 `[]`
- `400` 常见于缺少可用 `query`
- `500` 常见于 embedding 或 `hybrid_search_flows` RPC 失败

它现在还不负责：

- 把搜索结果直接物化为 `review flow` 的本地 rows 输入
- 对 edge-function 返回做本地字段重命名或 UI 适配
- 用搜索结果替代 deterministic `flow get` / `flow list` 详情读取
- 任何 “synthetic rows” 自动补位

因此，当任务要求“基于真实 DB flow 做 review 判断”时，`search flow` 只能负责找候选 refs，后续仍应进入 CLI 的真实 row 物化链路，而不是直接手工拼接 review 输入。

### 4.4 process / review / publish / validation 的当前边界

`process auto-build` 现在固定的是“本地 process-from-flow intake 与 scaffold 契约层”。

它负责：

- 读取单个 request JSON
- 解析 `flow_file` 指向的 ILCD flow payload
- 兼容旧 `pfw_<flow_code>_<flow_uuid8>_<operation>_<UTC_TIMESTAMP>` run-id 规则
- 创建本地 run root、`input/`、`exports/`、`cache/`、`reports/` 等目录
- 预写 `process_from_flow_state.json`
- 预写 `agent_handoff_summary.json`
- 写出 normalized request、flow summary、assembly plan、lineage manifest、invocation index、run manifest、report

它现在还不负责：

- 执行 route / split / exchange / QA / publish 等后续阶段
- 远程检索、LLM、OCR、publish commit
- `resume-build`、`publish-build`、`batch-build`

`process resume-build` 现在固定的是“本地 process-from-flow resume handoff 契约层”。

它负责：

- 从 `--run-id` 或 `--run-dir` 重开已有 run
- 校验 `run-manifest.json`、`process_from_flow_state.json`、`agent_handoff_summary.json`
- 使用 CLI 的 state lock 保护本地状态更新
- 清除历史 `stop_after` checkpoint，并将状态推进到 `resume_prepared`
- 写出 `resume-metadata.json`、追加 `resume-history.jsonl`
- 更新 `invocation-index.json`
- 重写 `agent_handoff_summary.json`
- 产出 `process-resume-build-report.json`

它现在还不负责：

- 执行 route / split / exchange / QA / publish 等后续阶段
- 远程检索、LLM、OCR、publish commit
- 直接触发后续 `batch-build` 或远端 publish executor

`process publish-build` 现在固定的是“本地 process-from-flow publish handoff 契约层”。

它负责：

- 从 `--run-id` 或 `--run-dir` 读取已有 run
- 校验 `run-manifest.json`、`process_from_flow_state.json`、`agent_handoff_summary.json`、`invocation-index.json`
- 优先读取 `exports/processes/`、`exports/sources/`，缺失时回退到 state 中的 `process_datasets`、`source_datasets`
- 写出 `stage_outputs/10_publish/publish-bundle.json`
- 写出 `stage_outputs/10_publish/publish-request.json`
- 写出 `stage_outputs/10_publish/publish-intent.json`
- 更新 `process_from_flow_state.json`
- 更新 `invocation-index.json`
- 重写 `agent_handoff_summary.json`
- 产出 `process-publish-build-report.json`

它现在还不负责：

- 直接执行远端 publish commit 或数据库 CRUD
- 重新实现历史 MCP transport
- `batch-build`

`process batch-build` 现在固定的是“本地 process-from-flow batch orchestration 契约层”。

它负责：

- 读取单个 batch manifest
- 生成 batch root、normalized request、invocation index、run manifest、aggregate report
- 顺序复用 `process auto-build` 为多个 item 准备本地 run
- 给每个 item 分配稳定的默认 `run_root`
- 输出 per-item `prepared` / `failed` / `skipped` 状态
- 为后续 `resume-build` / `publish-build` 保留明确的 `run_root`

它现在还不负责：

- 直接串接 `resume-build` / `publish-build`
- 并发调度、daemon、远端 CRUD、历史 Python orchestrator 复刻
- `process get`

`lifecyclemodel auto-build` 现在固定的是“本地 lifecyclemodel local-run 组装契约层”。

它负责：

- 读取单个 request JSON
- 解析一个或多个 `process-automated-builder` 本地 run
- 从共享 flow UUID 推断 process graph
- 选择 reference process
- 计算各 process instance 的 `@multiplicationFactor`
- 写出原生 `json_ordered` lifecyclemodel 数据集
- 写出 `run-plan.json`、`resolved-manifest.json`、`selection/selection-brief.md`
- 写出 `discovery/reference-model-summary.json`、`models/**/summary.json`、`connections.json`、`process-catalog.json`
- 产出 `lifecyclemodel-auto-build-report.json`

它现在还不负责：

- reference-model discovery
- 任何远端 lifecyclemodel CRUD
- MCP / KB / LLM / OCR runtime

`lifecyclemodel validate-build` 现在固定的是“本地 lifecyclemodel validation handoff 契约层”。

它负责：

- 从 `--run-dir` 重开已有 lifecyclemodel auto-build run
- 扫描 `models/*/tidas_bundle/lifecyclemodels/*.json`
- 通过统一 `validation` 模块重跑每个 model bundle 的本地校验
- 在 `reports/model-validations/` 下输出 per-model 校验报告
- 更新 `manifests/invocation-index.json`
- 产出 `reports/lifecyclemodel-validate-build-report.json`

它现在还不负责：

- 远端 lifecyclemodel CRUD
- 自动触发 `publish-build`
- MCP / KB / LLM / OCR runtime

`lifecyclemodel publish-build` 现在固定的是“本地 lifecyclemodel publish handoff 契约层”。

它负责：

- 从 `--run-dir` 重开已有 lifecyclemodel auto-build run
- 收集 `models/*/tidas_bundle/lifecyclemodels/*.json` 下的原生 lifecyclemodel payload
- 若存在 `reports/lifecyclemodel-validate-build-report.json`，则复用其中的 aggregate 校验摘要
- 写出 `stage_outputs/10_publish/publish-bundle.json`
- 写出 `stage_outputs/10_publish/publish-request.json`
- 写出 `stage_outputs/10_publish/publish-intent.json`
- 更新 `manifests/invocation-index.json`
- 产出 `reports/lifecyclemodel-publish-build-report.json`

它现在还不负责：

- 直接执行远端 publish commit 或数据库 CRUD
- 重新实现历史 MCP transport
- reference-model discovery

`review process` 现在固定的是“本地 process review 契约层”。

它负责：

- 从 `--run-root` 读取 `exports/processes/*.json`
- 延续现有 v2.1 review 规则做基础信息核查、物料平衡核查和单位疑似问题记录
- 写出中英文 markdown review、timing、unit issue log、summary 和 report
- 在显式启用 `--enable-llm` 时，通过 CLI 的 `TIANGONG_LCA_REVIEW_LLM_*` 运行时做可选语义审核

它现在还不负责：

- flow governance review
- lifecycle model review
- 远端 remediation / publish
- 任何 skill 私有的 `OPENAI_*` 调用路径

`review flow` 现在固定的是“本地 flow governance review 契约层”。

它负责：

- 接受且只接受一种输入模式：`--rows-file`、`--flows-dir`、`--run-root`
- 在 `--rows-file` 模式下物化 `review-input/flows/*.json` 与 `review-input/materialization-summary.json`
- 输出 `rule_findings.jsonl`、`llm_findings.jsonl`、`findings.jsonl`
- 输出 `flow_summaries.jsonl`、`similarity_pairs.jsonl`
- 输出 `flow_review_summary.json`、`flow_review_zh.md`、`flow_review_en.md`、`flow_review_timing.md`
- 输出 `flow_review_report.json`
- 在显式启用 `--enable-llm` 时，通过 CLI 的 `TIANGONG_LCA_REVIEW_LLM_*` 运行时做可选语义审核

它现在还不负责：

- flow remediation / publish-version / regen-product
- `--with-reference-context`
- 本地 registry enrichment
- 任何 skill 私有的 `OPENAI_*` 或 MCP review runtime

`flow get` 现在固定的是“deterministic direct-read detail 契约层”。

它负责：

- 从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase `/rest/v1/flows` 路径
- 按 `id` 读取单个 flow row
- 可选叠加 `version`、`user_id`、`state_code` 过滤
- 若显式提供 `version` 且精确版本 miss，则回退到同一 `id` 的最新可见版本
- 若最新版本或精确版本存在多个同版本可见候选，则直接报 ambiguous

它现在还不负责：

- 任意 flow 搜索或语义检索
- 远端 publish/write
- remediation / regen-product
- 任何 skill 私有 MCP 读路径

`flow list` 现在固定的是“deterministic direct-read list 契约层”。

它负责：

- 从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase `/rest/v1/flows` 路径
- 支持 `id`、`version`、`user_id`、`state_code`、`type_of_dataset` 过滤
- 默认使用 `order=id.asc,version.asc`
- 支持显式 `limit` / `offset`
- 支持 `--all --page-size <n>` 的 offset 分页汇总
- 输出稳定的结构化 JSON 报告

它现在还不负责：

- 任意修复或 publish
- `regen-product`
- skill 私有 transport / env parsing
- MCP-only list/runtime

`flow remediate` 现在固定的是“本地 deterministic remediation 契约层”。

它负责：

- 读取 invalid flow JSON / JSONL 输入
- 统一 round1 deterministic remediation 规则
- 保留历史 `remediated_all`、`ready_for_mcp`、`manual_queue`、`audit`、`report`、`prompt` 工件

它现在还不负责：

- 任何远端 publish/write
- round2 remote-validation retry
- regen-product
- 任何 skill 私有 Python remediation runtime

`flow publish-version` 现在固定的是“remediated-flow remote publish/update 契约层”。

它负责：

- 读取 ready-for-publish flow JSON / JSONL 输入
- 从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase `/rest/v1/flows` 路径
- 在 dry-run 或 commit 模式下执行 `would_insert`、`would_update_existing`、`insert`、`update_existing`
- 输出 `flows_tidas_sdk_plus_classification_mcp_success_list.json`
- 输出 `flows_tidas_sdk_plus_classification_remote_validation_failed.jsonl`
- 输出 `flows_tidas_sdk_plus_classification_mcp_sync_report.json`

它现在还不负责：

- round2 remote-validation retry
- reviewed-data publish contract
- 其他治理后处理
- 任何 MCP transport

`flow build-alias-map` 现在固定的是“治理链中的独立 deterministic alias-map 构建契约层”。

它负责：

- 读取一个或多个 old flow JSON / JSONL 输入
- 读取一个或多个 new flow JSON / JSONL 输入
- 可选读取 `seed-alias-map`
- 对每个 old flow 生成 `no_alias_needed | alias_map_entry | manual_review` 决策
- 输出 `alias-plan.json`
- 输出 `alias-plan.jsonl`
- 输出 `flow-alias-map.json`
- 输出 `manual-review-queue.jsonl`
- 输出 `alias-summary.json`

它现在还不负责：

- process ref 扫描
- repair planning / apply
- 任何远端 publish/write
- 任何 MCP transport

`flow scan-process-flow-refs` 现在固定的是“治理链中的独立 process ref scan 契约层”。

它负责：

- 读取 process JSON / JSONL 输入
- 读取一个或多个 scope flow JSON / JSONL 输入
- 可选读取 catalog flow 与 alias map
- 对每个 exchange 的 `referenceToFlowDataSet` 做 deterministic 分类
- 可选先剔除 emergy-named process
- 输出 `emergy-excluded-processes.json`
- 输出 `scan-summary.json`
- 输出 `scan-findings.json`
- 输出 `scan-findings.jsonl`

它现在还不负责：

- 修复计划
- patch apply
- 后续本地校验
- 任何远端 publish/write
- 任何 MCP transport

`flow plan-process-flow-repairs` 现在固定的是“治理链中的独立 deterministic repair planning 契约层”。

它负责：

- 读取 process JSON / JSONL 输入
- 读取一个或多个 scope flow JSON / JSONL 输入
- 可选读取 alias map
- 可选读取 `scan-findings`
- 显式执行 `disabled | alias-only | alias-or-unique-name` auto-patch boundary
- 输出 `repair-plan.json`
- 输出 `repair-plan.jsonl`
- 输出 `manual-review-queue.jsonl`
- 输出 `repair-summary.json`

它现在还不负责：

- 真正修改 process rows
- 后续本地校验
- 任何远端 publish/write
- 任何 MCP transport

`flow apply-process-flow-repairs` 现在固定的是“治理链中的独立 deterministic repair apply 契约层”。

它负责：

- 复用 planning 相同的 process / scope / alias / scan 输入契约
- 只应用 deterministic subset
- 输出 `patched-processes.json`
- 输出 `process-patches/<process-id__version>/before.json`
- 输出 `process-patches/<process-id__version>/after.json`
- 输出 `process-patches/<process-id__version>/diff.patch`
- 输出 `process-patches/<process-id__version>/evidence.json`
- 若显式传入 `--process-pool-file`，把 exact-version patched rows 同步回本地 pool，并在 `repair-summary.json` 记录 `process_pool_sync`

它现在还不负责：

- 后续本地校验
- 任何远端 publish/write
- round2 remote-validation retry
- 任何 MCP transport

`flow regen-product` 现在固定的是“治理后 process-side 再生产物契约层”。

它负责：

- 读取 process JSON / JSONL 输入
- 读取一个或多个 scope flow JSON / JSONL 输入
- 可选读取 catalog flow 与 alias map
- 在一个命令下执行 `scan -> repair plan -> optional apply -> optional validate`
- 输出 `scan/`、`repair/`、`repair-apply/`、`validate/` 工件目录
- 输出顶层 `flow-regen-product-report.json`
- 在 `--apply` 后可选同步 `process-pool-file`

它现在还不负责：

- 任何远端 publish/write
- reviewed-data publish contract
- round2 remote-validation retry
- 任何 MCP transport

`publish run` 现在固定的是“稳定 publish 契约层”，不是历史 MCP 写库脚本的 TypeScript 复刻。

它负责：

- 吞入 `publish-bundle.json` 和直接数组输入
- 统一 `dry-run` / `commit` override
- 识别 canonical process payload 与 projection payload
- 产出结构化 `publish-report.json`
- 把真正的 commit 执行动作留给显式 executor

这样做的好处是：

- CLI 先稳定输入/输出合同
- 不把旧 MCP transport 重新带回命令树
- 后续真有直连 REST publish executor 时，只需要接到同一模块，不需要再改调用方契约

`validation run` 则固定“统一校验报告层”：

- `auto` 模式走当前默认的 direct-dependency 校验路径，也就是 CLI 内基于 `@tiangong-lca/tidas-sdk` 组装的 package validator
- `sdk` 模式显式固定到同一条 `@tiangong-lca/tidas-sdk` 校验链

这保证后续 workflow 只依赖 `tiangong validation run`，而不需要在 skill 里自己判断到底调哪个校验器。

## 5. 环境变量策略

### 5.1 统一命名

公开命令面的标准变量名：

```bash
TIANGONG_LCA_API_BASE_URL=
TIANGONG_LCA_API_KEY=
TIANGONG_LCA_REGION=us-east-1
TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY=
TIANGONG_LCA_SESSION_FILE=
TIANGONG_LCA_DISABLE_SESSION_CACHE=false
TIANGONG_LCA_FORCE_REAUTH=false
```

其中：

- `TIANGONG_LCA_API_KEY` 是 TianGong 账户页生成的用户 API Key，不是 Supabase project key
- CLI 只把它当作 bootstrap 凭证，本地解码后调用 Supabase auth 换取用户 session
- 运行时统一使用 access token，既用于 Edge Functions，也用于 direct Supabase
- `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` 是 authenticated CLI 命令的必需项
- `TIANGONG_LCA_SESSION_FILE`、`TIANGONG_LCA_DISABLE_SESSION_CACHE`、`TIANGONG_LCA_FORCE_REAUTH` 是可选 session cache 控制项

按需启用的可选 review-only 变量：只有显式启用 `tiangong review process --enable-llm` 或 `tiangong review flow --enable-llm` 时才需要配置。`TIANGONG_LCA_REVIEW_LLM_BASE_URL` 应指向 OpenAI-compatible Responses API 根地址，CLI 会向 `<base_url>/responses` 发请求。

```bash
TIANGONG_LCA_REVIEW_LLM_BASE_URL=
TIANGONG_LCA_REVIEW_LLM_API_KEY=
TIANGONG_LCA_REVIEW_LLM_MODEL=
```

仓库中已归一化、但当前没有任何公开 `tiangong` 命令消费的 internal/preparatory 变量：

```bash
TIANGONG_LCA_KB_SEARCH_API_BASE_URL=
TIANGONG_LCA_KB_SEARCH_API_KEY=
TIANGONG_LCA_KB_SEARCH_REGION=us-east-1

TIANGONG_LCA_UNSTRUCTURED_API_BASE_URL=
TIANGONG_LCA_UNSTRUCTURED_API_KEY=
TIANGONG_LCA_UNSTRUCTURED_PROVIDER=
TIANGONG_LCA_UNSTRUCTURED_MODEL=
TIANGONG_LCA_UNSTRUCTURED_CHUNK_TYPE=false
TIANGONG_LCA_UNSTRUCTURED_RETURN_TXT=true
```

测试/质量脚本还会使用一个内部开关：

```bash
TIANGONG_LCA_COVERAGE=0
```

规则是：

- 公开命令只暴露当前已实现、且真实消费的 env
- internal/preparatory 和 test-only env 也要在 `.env.example` 里显式列出，避免代码与文档脱节
- 不为了历史实现或未来猜测保留 alias
- 不引入 `SUPABASE_URL`、`SUPABASE_KEY`、`TIANGONG_LCA_TIDAS_SDK_DIR` 这类额外兼容层；原生 Supabase client 一律从 `TIANGONG_LCA_API_BASE_URL` 派生，用户 session 一律从 `TIANGONG_LCA_API_KEY + TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` 换取，`@tiangong-lca/tidas-sdk` 一律走直接依赖
- `review process` 的可选语义审核统一走 review-only 的 `TIANGONG_LCA_REVIEW_LLM_*`，不再引入 `OPENAI_*`
- `review flow` 的可选语义审核也统一走 review-only 的 `TIANGONG_LCA_REVIEW_LLM_*`，不再引入 `OPENAI_*`
- `publish run` / `validation run` 都是本地契约与执行收口，不新增远程 env
- `TIANGONG_LCA_KB_SEARCH_*` 与 `TIANGONG_LCA_UNSTRUCTURED_*` 目前只属于 internal/preparatory 层，不属于公开命令契约

命令级 env 矩阵：

| 命令组 | 必需 env |
| --- | --- | --- | --- | --- |
| `doctor` | 无 |
| `search flow | process | lifecyclemodel` | `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`（`TIANGONG_LCA_REGION` 可选） |
| `admin embedding-run` | `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`（`TIANGONG_LCA_REGION` 可选） |
| `process get` | `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` |
| `process auto-build | resume-build | publish-build | batch-build` | 无 |
| `lifecyclemodel auto-build | validate-build | publish-build | orchestrate` | 无 |
| `lifecyclemodel build-resulting-process` | 本地运行默认无；若 request 开启 `process_sources.allow_remote_lookup=true`，则需要 `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` |
| `lifecyclemodel publish-resulting-process` | 无 |
| `review process` | 纯规则 review 默认无；若显式开启 `--enable-llm`，则需要 `TIANGONG_LCA_REVIEW_LLM_BASE_URL`、`TIANGONG_LCA_REVIEW_LLM_API_KEY`、`TIANGONG_LCA_REVIEW_LLM_MODEL` |
| `review flow` | 纯规则 review 默认无；若显式开启 `--enable-llm`，则需要 `TIANGONG_LCA_REVIEW_LLM_BASE_URL`、`TIANGONG_LCA_REVIEW_LLM_API_KEY`、`TIANGONG_LCA_REVIEW_LLM_MODEL` |
| `review lifecyclemodel` | 无 |
| `flow get` | `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` |
| `flow list` | `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` |
| `flow remediate` | 无 |
| `flow publish-version` | `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` |
| `flow publish-reviewed-data` | 本地 dry-run 默认无；若 `--commit` 发布 prepared flow/process rows，则需要 `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` |
| `flow build-alias-map` | 无 |
| `flow scan-process-flow-refs` | 无 |
| `flow plan-process-flow-repairs` | 无 |
| `flow apply-process-flow-repairs` | 无 |
| `flow regen-product` | 无 |
| `flow validate-processes` | 无 |
| `publish run` | 无 |
| `validation run` | 无 |

## 6. 质量门

### 6.1 当前质量门

```bash
npm run lint
npm run prettier
npm test
npm run test:coverage
npm run test:coverage:assert-full
npm run prepush:gate
```

### 6.2 为什么覆盖率门只卡 `src/**/*.ts`

这是一个有意设计，不是偷懒。

原因：

- `bin/tiangong.js` 是极薄启动器
- 运行时真正执行的是由 `src/**/*.ts` 编译出来的 `dist/` 产物
- 它的价值主要在 smoke test，而不是复杂业务逻辑

所以当前做法是：

- `src/**/*.ts` 必须 100% lines / branches / functions / statements
- `bin` 入口由普通测试做 smoke 保证

这比“把所有文件都硬塞进 coverage，结果统计失真”更可靠。

### 6.3 发布自动化

CLI 现在额外有一条独立于质量门的 npm 发布链路：

- release-prep PR 修改 `package.json` 版本号
- 合并到 `main` 后，`tag-release-from-merge.yml` 自动创建 `cli-vX.Y.Z`
- `publish.yml` 从该 tag 触发 npm Trusted Publishing

每次发版的 operator runbook 见 [release-runbook.md](./release-runbook.md)。

一次性的仓库 secret 和 npm Trusted Publisher 配置见 [release-setup.md](./release-setup.md)。

## 7. 与 `tiangong-lca-skills` 的关系

### 7.1 定位分工

- `tiangong-lca-cli`：统一执行面
- `tiangong-lca-skills`：agent 安装面、任务包装面

### 7.2 第一批迁移对象

最适合先迁移到统一 CLI 的，是当前的薄远程 skill：

| 当前 skill                     | 目标 CLI                         |
| ------------------------------ | -------------------------------- |
| `flow-hybrid-search`           | `tiangong search flow`           |
| `process-hybrid-search`        | `tiangong search process`        |
| `lifecyclemodel-hybrid-search` | `tiangong search lifecyclemodel` |
| `embedding-ft`                 | `tiangong admin embedding-run`   |

### 7.3 已完成 CLI 收口的 workflow skills

当前 canonical path 已经固定为 `skill -> 原生 Node .mjs wrapper -> tiangong CLI`：

- `process-automated-builder`
  - `tiangong process auto-build`
  - `tiangong process resume-build`
  - `tiangong process publish-build`
  - `tiangong process batch-build`
  - skill 侧不再保留 Python / LangGraph / MCP / KB / OCR fallback
- `lifecyclemodel-automated-builder`
  - `tiangong lifecyclemodel auto-build`
  - `tiangong lifecyclemodel validate-build`
  - `tiangong lifecyclemodel publish-build`
  - skill 侧不再保留 shell 兼容壳或 Python / MCP runtime
- `lifecycleinventory-review`
  - `tiangong review process`
  - `tiangong review lifecyclemodel`
- `flow-governance-review`
  - `tiangong review flow`
  - `tiangong flow get`
  - `tiangong flow list`
  - `tiangong flow remediate`
  - `tiangong flow publish-version`
  - `tiangong flow publish-reviewed-data`
  - `tiangong flow build-alias-map`
  - `tiangong flow scan-process-flow-refs`
  - `tiangong flow plan-process-flow-repairs`
  - `tiangong flow apply-process-flow-repairs`
  - `tiangong flow regen-product`
  - `tiangong flow validate-processes`
  - OpenClaw / dedup / legacy Python orchestration 已从 supported path 中移除
- `lifecyclemodel-recursive-orchestrator`
  - `tiangong lifecyclemodel orchestrate`
  - skill wrapper 只保留对 `plan | execute | publish` 的薄调用
- `lca-publish-executor`
  - `tiangong publish run`
  - publish contract 已不再保留私有 Python 实现

当前更合理的扩展路径是：

1. 先在 CLI 命令树定义稳定动作
2. 再让 skill 只做薄调用
3. 最后才判断是否值得继续下沉成 REST/Edge Function 能力

## 8. 推荐的 skills 调用方式

在 workspace 内部，skill wrapper 应优先把 CLI 仓库作为相邻 repo 调用。

推荐约定：

- 默认路径：`${WORKSPACE_ROOT}/tiangong-lca-cli`
- 可覆盖路径：`TIANGONG_LCA_CLI_DIR`
- skill wrapper 直接使用原生 Node `.mjs`，不再保留 shell 兼容壳

调用方式优先顺序：

1. `node "${TIANGONG_LCA_CLI_DIR}/bin/tiangong.js" ...`
2. `node "${TIANGONG_LCA_CLI_DIR}/dist/src/main.js" ...`
3. `npm exec --prefix "${TIANGONG_LCA_CLI_DIR}" tiangong -- ...`

不要再在 skill 内部重复实现一套 `curl` 参数解析和环境变量规则。

## 9. 下一阶段路线

### 当前已经完成

- 统一 CLI 命令树已经固定
- skills 已切为原生 Node `.mjs` 薄 wrapper
- 旧 Python / MCP / shell runtime 已不再是 supported path
- publish / validation / governance / orchestrate 都已经有统一 CLI 边界

### 后续只保留原生增量，不再叫“遗留迁移”

- lifecyclemodel 的 discovery / AI 选择逻辑，只有在产品面确认需要时才继续抽象成新的 CLI 子命令
- `auth` / `job` 之类 placeholder surface 只有在真实场景出现时才补齐，而不是为了对称性先做
- 任何新增能力都必须先定义成 `tiangong <noun> <verb>`，再决定是否要进一步服务化

## 10. 结论

这次实施的核心不是“又做一个工具”，而是收敛执行面：

- CLI 负责统一能力抽象
- skills 负责任务包装
- REST 负责明确远程边界
- MCP 不再进入 CLI 内部

如果后续继续扩能力，也必须遵守同一条原则：

先判断它是不是稳定的业务动作，再决定它是不是应该进入 `tiangong` 命令树。
