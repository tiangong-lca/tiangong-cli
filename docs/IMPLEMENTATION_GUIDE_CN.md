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

## 2. 当前落地范围

### 2.1 已实现命令

```text
tiangong
  doctor
  search
    flow
    process
    lifecyclemodel
  process
    auto-build
    resume-build
    publish-build
    batch-build
  lifecyclemodel
    build-resulting-process
    publish-resulting-process
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
| `tiangong process auto-build` | 本地 `process_from_flow` intake、run-id 生成、artifact scaffold 预写 |
| `tiangong process resume-build` | 本地 `process_from_flow` resume handoff、state-lock/manifest 收口、resume 元数据与报告输出 |
| `tiangong process publish-build` | 本地 `process_from_flow` publish handoff、publish bundle/request/intent 产出、state/invocation/handoff 更新 |
| `tiangong process batch-build` | 本地 `process_from_flow` batch manifest 编排、批量调用 auto-build、batch report 输出 |
| `tiangong lifecyclemodel build-resulting-process` | 本地 lifecycle model resulting process 聚合、内部 flow 抵消、artifact 输出 |
| `tiangong lifecyclemodel publish-resulting-process` | 读取 resulting-process run，生成 `publish-bundle.json` / `publish-intent.json` 本地交付物 |
| `tiangong publish run` | 本地 publish 契约归一化、dry-run/commit、report 输出 |
| `tiangong validation run` | 本地 `tidas-sdk` / `tidas-tools` 校验收口 |
| `tiangong admin embedding-run` | `embedding_ft` |

此外，CLI 现在已经正式引入 `tiangong lifecyclemodel ...` 一级命名空间，其中：

- `tiangong lifecyclemodel build-resulting-process` 已可执行
- `tiangong lifecyclemodel publish-resulting-process` 已可执行
- `auto-build`、`validate-build`、`publish-build` 仍处于 planned 状态

`tiangong process ...` 也已经开始承接 `process_from_flow` 主链迁移，其中：

- `tiangong process auto-build` 已可执行
- `tiangong process resume-build` 已可执行
- `tiangong process publish-build` 已可执行
- `tiangong process batch-build` 已可执行
- `get` 仍处于 planned 状态

注意：

- 已实现的 `process auto-build` 保留了旧 `artifacts/process_from_flow/<run_id>/`、`cache/process_from_flow_state.json`、`cache/agent_handoff_summary.json` 等运行布局
- `process auto-build` 当前只负责本地 request intake、flow 归一化、run scaffold 和 manifest/report 预写，不继续执行后续阶段
- 已实现的 `process resume-build` 保留同一套 run 布局，并把本地 state-lock、run-manifest 校验、resume metadata/history、invocation index 更新统一收口到 CLI
- `process resume-build` 当前只负责本地 resume handoff，不直接执行 route / split / exchange / QA / publish 阶段
- 已实现的 `process publish-build` 继续保留同一套 run 布局，并把本地 publish-bundle/request/intent、state/invocation/handoff 更新统一收口到 CLI
- `process publish-build` 当前只负责本地 publish handoff，不直接执行远端 publish commit 或数据库写入
- 已实现的 `process batch-build` 继续走本地优先、artifact-first 路径，并把批量 item 编排、聚合 report、默认 run_dir 分配统一收口到 CLI
- `process batch-build` 当前只负责本地 batch orchestration，不直接串接 resume / publish 或远端执行器
- 已实现的 `build-resulting-process` 和 `publish-resulting-process` 都走本地优先、artifact-first 路径，不依赖 Python 或 MCP
- `publish-resulting-process` 当前负责生成本地 publish handoff 产物，还没有把提交语义直接并入 `publish run`
- 其余未实现的 `lifecyclemodel` / `process` 子命令仍只提供 help 和固定命名
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

### 4.3 文件优先

优先形式：

```bash
tiangong search flow --input ./request.json --json
tiangong publish run --input ./publish-request.json --dry-run
tiangong validation run --input-dir ./tidas-package --engine auto
tiangong admin embedding-run --input ./jobs.json --dry-run
```

而不是长自然语言参数和不稳定的 shell 拼接。

### 4.4 process / publish / validation 的当前边界

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

- `auto` 模式优先走 `tidas-sdk`
- 找不到本地 parity validator 时，回退到 `tidas-tools`
- `all` 模式会给出两个引擎结果和 comparison

这保证后续 workflow 只依赖 `tiangong validation run`，而不需要在 skill 里自己判断到底调哪个校验器。

## 5. 环境变量策略

### 5.1 统一命名

新的标准变量名：

```bash
TIANGONG_LCA_API_BASE_URL=
TIANGONG_LCA_API_KEY=
TIANGONG_LCA_REGION=us-east-1
```

这就是当前 CLI 的完整 env 面。

规则是：

- 只为当前已实现的命令暴露 env
- 不为了历史实现或未来猜测保留 alias
- 某类能力如果还停留在 skills / Python workflow 层，就继续由那一层自己管理 env
- `publish run` / `validation run` 都是本地契约与执行收口，不新增远程 env
- 因此当前不预放 `TIANGONG_KB_*`、`TIANGONG_MINERU_*`、`OPENAI_*` 或 `TIANGONG_LCA_REMOTE_*`

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

### 7.3 已启动但未完成迁移的对象

这类能力已经进入 CLI 迁移路线，但还没有完全变成纯 TS 主链：

- `process-automated-builder`
  - 已落地 `tiangong process auto-build`
  - 已落地 `tiangong process resume-build`
  - 已落地 `tiangong process publish-build`
  - 已落地 `tiangong process batch-build`
- `lifecycleinventory-review`
- 其他重型 Python workflow

更合理的路径是：

1. 先让 CLI 成为统一入口
2. 由 CLI 调度现有本地执行器
3. 再逐步把值得平台化的环节抽成 REST 能力

## 8. 推荐的 skills 调用方式

在 workspace 内部，skill wrapper 应优先把 CLI 仓库作为相邻 repo 调用。

推荐约定：

- 默认路径：`${WORKSPACE_ROOT}/tiangong-lca-cli`
- 可覆盖路径：`TIANGONG_LCA_CLI_DIR`

调用方式优先顺序：

1. `node "${TIANGONG_LCA_CLI_DIR}/bin/tiangong.js" ...`
2. `node "${TIANGONG_LCA_CLI_DIR}/dist/src/main.js" ...`
3. `npm exec --prefix "${TIANGONG_LCA_CLI_DIR}" tiangong -- ...`

不要再在 skill 内部重复实现一套 `curl` 参数解析和环境变量规则。

## 9. 下一阶段路线

### Phase 1

- 完成当前薄远程命令
- 完成 skills 对这批命令的收敛
- 固定统一环境变量名和帮助文本

### Phase 2

- 切 `process-automated-builder` 到 CLI-only wrapper
- 引入 `review` / `job` / `flow` / `process` 的更多业务子命令
- 用 CLI 接管现有 workflow 的稳定 contract 层
- 统一 run-dir / artifact / manifest 输入输出格式

### Phase 3

- 把重型 workflow 中真正稳定的执行阶段逐步迁成纯 TS CLI
- 把其中适合服务化的远程能力逐步服务化
- 继续减少 skill 仓库里的 transport logic
- 让 agent 主要理解 `tiangong` 命令树，而不是 repo 内部脚本细节

## 10. 结论

这次实施的核心不是“又做一个工具”，而是收敛执行面：

- CLI 负责统一能力抽象
- skills 负责任务包装
- REST 负责明确远程边界
- MCP 不再进入 CLI 内部

如果后续继续扩能力，也必须遵守同一条原则：

先判断它是不是稳定的业务动作，再决定它是不是应该进入 `tiangong` 命令树。
