# TianGong Skills -> CLI 迁移清单

## 1. 最终结论

这轮迁移已经固定成一个明确结果：

- `tiangong-lca-cli` 是唯一执行入口
- 业务执行逻辑以 TypeScript / Node 24 为主，收敛到 CLI
- `tiangong-lca-skills` 只保留 `SKILL.md`、参考文档、示例输入、原生 Node `.mjs` 薄 wrapper
- Python、MCP、shell 兼容壳、私有 env parsing 都不再是 supported path

MCP 替代策略也已经固定，不再反复讨论：

- 策略 1：直接调用 `tiangong-lca-edge-functions` 的 Edge Function / REST
- 策略 2：直接访问 Supabase；复杂 CRUD 走官方 Supabase JS SDK，窄读路径允许 deterministic REST

这份文档现在记录的是“迁移已完成后的完成态”，不是待做路线图。

## 2. 硬规则

- [x] 不再新增任何 Python 业务 workflow
- [x] 不再新增任何 skill 自带 HTTP / MCP / env parsing
- [x] 不再新增任何基于 MCP 的 CLI 内部传输层
- [x] 不再新增任何 shell 兼容壳 wrapper；canonical wrapper 统一为原生 Node `.mjs`
- [x] 所有新能力必须先定义成 `tiangong <noun> <verb>` 命令，再实现
- [x] `tiangong-lca-skills` 中的 wrapper 只能调用 `tiangong`
- [x] CLI 的 env 只按真实已实现命令暴露，不预埋未来猜测接口
- [x] CLI 内部不再保留 “MCP 传输层” 作为技术路径

## 3. Repo 边界

### 3.1 `tiangong-lca-cli`

唯一执行面，负责：

- 命令树
- 参数解析
- env 合同
- REST / Edge Function / Supabase 访问
- 本地运行态与 artifact 契约
- 测试、lint、100% 覆盖率质量门

### 3.2 `tiangong-lca-skills`

只负责：

- `SKILL.md`
- 使用说明
- 示例输入
- 原生 Node `.mjs` wrapper
- 对 `tiangong` 的薄调用

不再负责：

- transport
- CRUD 逻辑
- env 合同
- LLM / KB / OCR / publish 主逻辑
- 独立 workflow runtime

### 3.3 `tidas-sdk` / `tidas-tools`

继续作为库层存在：

- CLI 直接消费 `tidas-sdk` 的本地 validation/parity 能力，并按需保留 `tidas-tools` 的其他库层职责
- skills 不再重复实现一遍
- CLI 不手抄 schema / validation / export 逻辑

## 4. 当前 Skill 映射

| Skill | Canonical 调用链 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| `flow-hybrid-search` | `node wrapper (.mjs) -> tiangong search flow` | 已完成 | 薄 wrapper 模板 |
| `process-hybrid-search` | `node wrapper (.mjs) -> tiangong search process` | 已完成 | 薄 wrapper 模板 |
| `lifecyclemodel-hybrid-search` | `node wrapper (.mjs) -> tiangong search lifecyclemodel` | 已完成 | 薄 wrapper 模板 |
| `embedding-ft` | `node wrapper (.mjs) -> tiangong admin embedding-run` | 已完成 | 薄 wrapper 模板 |
| `process-automated-builder` | `node wrapper (.mjs) -> tiangong process auto-build / resume-build / publish-build / batch-build` | 已完成当前 CLI 收口 | skill 侧已无 Python / LangGraph / MCP fallback |
| `lifecyclemodel-automated-builder` | `node wrapper (.mjs) -> tiangong lifecyclemodel auto-build / validate-build / publish-build` | 已完成当前 CLI 收口 | discovery / AI 选择若未来需要，按新的 CLI 特性处理，不再算遗留债务 |
| `lifecyclemodel-resulting-process-builder` | `node wrapper (.mjs) -> tiangong lifecyclemodel build-resulting-process / publish-resulting-process` | 已完成 | resulting-process 模板 |
| `lifecycleinventory-review` | `node wrapper (.mjs) -> tiangong review process / review lifecyclemodel` | 已完成 | review 入口已经完全走原生 CLI |
| `flow-governance-review` | `node wrapper (.mjs) -> tiangong review flow / flow ...` | 已完成当前 CLI 收口 | reviewed publish、repair、regen、validate 均已进入 CLI |
| `lifecyclemodel-recursive-orchestrator` | `node wrapper (.mjs) -> tiangong lifecyclemodel orchestrate` | 已完成 | plan / execute / publish-handoff 已原生化 |
| `lca-publish-executor` | `node wrapper (.mjs) -> tiangong publish run` | 已完成 | 不再保留私有 publish Python contract |

## 5. 迁移完成清单

### Phase 0：冻结旧世界

- [x] 新需求默认先定义 CLI 命令，而不是先写 skill 脚本
- [x] 不再新增 Python workflow、MCP client、独立 env parser
- [x] “skills 最终只保留文档、示例、薄 wrapper” 已写进仓库文档

### Phase 1：让 CLI 成为诚实入口

- [x] CLI help 只暴露真实已实现命令，未实现能力明确标为 planned
- [x] `lifecyclemodel` 已成为正式一级命名空间
- [x] README / `DEV_CN.md` / 实施指南 / 迁移清单 与真实命令面对齐

### Phase 2：收口薄 remote skills

- [x] `flow-hybrid-search` -> `tiangong search flow`
- [x] `process-hybrid-search` -> `tiangong search process`
- [x] `lifecyclemodel-hybrid-search` -> `tiangong search lifecyclemodel`
- [x] `embedding-ft` -> `tiangong admin embedding-run`
- [x] 这批 wrapper 已固定为原生 Node `.mjs`
- [x] 技术路径只剩 `skill -> tiangong`

### Phase 3：把 CLI 基础模块变成统一依赖面

- [x] `run` 模块：`run_id`、目录布局、manifest、resume 元数据
- [x] `artifacts` 模块：统一 JSON / JSONL / audit / report 输出
- [x] `state-lock` 模块：本地单写者锁
- [x] `http` / `rest-client` 模块：统一 REST 调用、错误格式、超时与重试
- [x] `llm` 模块：统一 `TIANGONG_LCA_LLM_*`
- [x] `kb-search` 模块：作为 CLI 内部预备模块存在，但还没有公开命令消费它
- [x] `unstructured` 模块：作为 CLI 内部预备模块存在，但还没有公开命令消费它
- [x] `publish` 模块：统一 dry-run / commit / publish report
- [x] `validation` 模块：统一本地校验收口，并固定 SDK-owned validation boundary

### Phase 4：迁 resulting-process builder

- [x] `tiangong lifecyclemodel build-resulting-process`
- [x] `tiangong lifecyclemodel publish-resulting-process`
- [x] resulting-process 远端 lookup 已改为 deterministic direct-read
- [x] skill wrapper 已改成纯 CLI 路径
- [x] Python build / publish 主入口已删除

### Phase 5：统一 publish / validation

- [x] 所有本地校验统一收口到 `tiangong validation run`
- [x] 所有 publish handoff 统一收口到 `tiangong publish run`
- [x] `lca-publish-executor` 已收口成 CLI wrapper
- [x] relation manifest / deferred publish / dry-run / commit 的唯一语义已写进 CLI 文档
- [x] skills 不再自行判断使用哪个校验器

### Phase 6：迁 `process-automated-builder`

- [x] `tiangong process auto-build`
- [x] `tiangong process resume-build`
- [x] `tiangong process publish-build`
- [x] `tiangong process batch-build`
- [x] intake / run-id / scaffold / state-lock / publish handoff / batch orchestration 已迁入 CLI
- [x] skill runtime 中的业务 Python / LangGraph / MCP / OpenAI / KB / TianGong unstructured 依赖已删除
- [x] 当前 skill 只剩 `skill -> tiangong process ...`

说明：

- 当前 CLI 只保留真实已落地的本地 artifact-first slices
- 旧的端到端 Python 主链没有被“兼容保留”，而是直接移出 supported path
- 若未来需要新的远端或 AI 阶段，必须作为新的原生 `tiangong process ...` 命令重建

### Phase 7：迁 `lifecyclemodel-automated-builder`

- [x] `tiangong lifecyclemodel auto-build`
- [x] `tiangong lifecyclemodel validate-build`
- [x] `tiangong lifecyclemodel publish-build`
- [x] 本地 `json_ordered` 组装改为 TS
- [x] 本地校验统一改为 CLI 调用 `tidas-sdk`
- [x] publish handoff 改为统一 publish 模块
- [x] canonical skill 入口切为原生 Node `.mjs` -> CLI
- [x] 不再保留 shell 兼容壳或 Python / MCP runtime

说明：

- reference-model discovery / AI 选择如果未来要做，属于新的原生 CLI 特性
- 它不再是“迁移遗留项”，也不应该通过 skill 私有 runtime 补回去

### Phase 8：迁 review / governance

- [x] `lifecycleinventory-review` -> `tiangong review process`
- [x] `flow-governance-review` 的 review slice -> `tiangong review flow`
- [x] `flow-governance-review` 的 read / remediate / publish / alias / repair / regen / validate slices 全部进入 `tiangong flow ...`
- [x] `tiangong flow publish-reviewed-data --commit` 已覆盖 prepared process rows 的远端提交
- [x] review 输出继续保持本地 artifact-first
- [x] OpenClaw / dedup / legacy Python orchestration 已从 supported path 中移除

### Phase 9：迁 orchestrator

- [x] `lifecyclemodel-recursive-orchestrator` 已迁成 `tiangong lifecyclemodel orchestrate`
- [x] `plan | execute | publish` 已原生进入 CLI
- [x] orchestrator 只编排 CLI-native builder slices，不再承载 Python 业务实现
- [x] 不再保留 Python orchestrator 作为总入口

### Phase 10：删除遗留层

- [x] 删除 skills 中的业务 Python runtime
- [x] 删除 skills 中的业务 shell 实现，仅保留原生 Node `.mjs` wrapper
- [x] 删除 skills 中的 transport / env parsing 逻辑
- [x] 删除 skills 中的 MCP-only 实现
- [x] 删除旧 env 名的 runtime 依赖与文档残留
- [x] 删除对 `TIANGONG_CLI_DIR` 旧变量名的依赖，统一为 `TIANGONG_LCA_CLI_DIR`

## 6. Env 收敛清单

### 6.1 当前 CLI 公开 env

- [x] `TIANGONG_LCA_API_BASE_URL`
- [x] `TIANGONG_LCA_API_KEY`
- [x] `TIANGONG_LCA_REGION`
- [x] `TIANGONG_LCA_LLM_BASE_URL`
- [x] `TIANGONG_LCA_LLM_API_KEY`
- [x] `TIANGONG_LCA_LLM_MODEL`

### 6.2 当前 wrapper 约定变量

- [x] `TIANGONG_LCA_CLI_DIR`

### 6.3 已从 runtime / 文档中淘汰的旧命名

- [x] `TIANGONG_API_BASE_URL`
- [x] `TIANGONG_API_KEY`
- [x] `TIANGONG_REGION`
- [x] `TIANGONG_LCA_APIKEY`
- [x] `SUPABASE_FUNCTIONS_URL`
- [x] `SUPABASE_FUNCTION_REGION`
- [x] `OPENAI_*`
- [x] `LCA_OPENAI_*`
- [x] `TIANGONG_KB_*`（旧直连命名）
- [x] `TIANGONG_LCA_REMOTE_*`
- [x] `TIANGONG_KB_REMOTE_*`
- [x] `TIANGONG_MINERU_WITH_IMAGE_*`
- [x] `MINERU_*`
- [x] `MINERU_WITH_IMAGES_*`

说明：

- `kb-search` / `unstructured` 虽然已经有 CLI 内部模块，但当前没有公开命令消费它们
- 因此这些 env 不应进入 `.env.example`，也不应该被 skill wrapper 私自解析

## 7. 每个 Skill 的完成定义

一个 skill 在当前架构下只有满足下面条件，才算迁移完成：

- [x] skill 不再直接执行业务 Python
- [x] skill 不再直接访问 REST / MCP
- [x] skill 不再解析 env
- [x] skill 不再持有独立 publish 逻辑
- [x] skill 只调用统一 `tiangong` 命令
- [x] 对应 CLI 子命令有测试
- [x] 对应 CLI 子命令有文档
- [x] 对应 CLI 子命令纳入 `npm run prepush:gate`
- [x] 对应 skill 文档已改成 CLI 用法

## 8. 未来原生增量候选（不再算迁移 TODO）

下面这些可以做，但它们已经不是“清遗留”的待办，而是新的产品能力：

- lifecyclemodel 的 discovery / AI 选择逻辑
- `auth` / `job` 等只有在真实场景出现时才应该补齐的命令面
- 更深的 KB / TianGong unstructured 能力，前提是先形成稳定的 CLI 业务动作

## 9. 一句话标准

只问一句：

> 一个 agent 要完成工作时，是否只需要知道 `tiangong` 命令树，而不需要知道 skills 内部的 Python、MCP、shell、OpenAI、KB、OCR 实现细节？

当前答案已经是“是”。
