# TianGong Skills -> CLI 迁移清单

## 1. 目标结论

这份清单服务于一个明确判断：

- `tiangong-lca-cli` 应该成为唯一执行入口
- 业务执行逻辑应以 TypeScript 为主，收敛到 CLI
- `tiangong-lca-skills` 最终只保留安装面、提示面、调用约定
- Python workflow 只能视为迁移中的遗留层，不再是目标架构

换句话说，未来不应该再有“skill 自己维护一套 transport / env / orchestration / publish 逻辑”的情况。

## 2. 硬规则

- [ ] 不再新增任何 Python 业务 workflow
- [ ] 不再新增任何 skill 自带 HTTP / MCP / env parsing
- [ ] 不再新增任何基于 MCP 的 CLI 内部传输层
- [ ] 所有新能力只能先定义成 `tiangong <noun> <verb>` 命令，再实现
- [ ] `tiangong-lca-skills` 中的 wrapper 只能调用 `tiangong`，不能再直接 `curl`、直接调 MCP、直接跑业务 Python
- [ ] CLI 的 env 只能按实际已实现命令逐步增加，不预埋未来猜测接口

## 3. Repo 边界

### 3.1 `tiangong-lca-cli`

唯一执行面，负责：

- 命令树
- 参数解析
- env 合同
- REST 客户端
- 本地运行态管理
- artifact / manifest / run-id / job 输出契约
- 测试与 100% 覆盖率质量门

### 3.2 `tiangong-lca-skills`

最终只负责：

- `SKILL.md`
- 使用说明
- 示例输入
- 对 `tiangong` 的薄调用

最终不负责：

- transport
- CRUD 逻辑
- env 合同
- LLM / KB / OCR / publish 主逻辑
- 独立 workflow runtime

### 3.3 `tidas-sdk` / `tidas-tools`

继续作为库层存在，不需要把它们“并入 CLI 仓库”。

正确做法是：

- CLI 调用这些库
- 不在 skills 里重复实现一遍
- 不在 CLI 里手抄 schema / validation / export 逻辑

## 4. 当前 Skill 盘点

| Skill | 当前状态 | 当前技术形态 | 目标状态 | 优先级 |
| --- | --- | --- | --- | --- |
| `flow-hybrid-search` | 已有等价 CLI | shell wrapper，历史 token/env 兼容 | 只保留 skill 文档，调用 `tiangong search flow` | P0 |
| `process-hybrid-search` | 已有等价 CLI | shell wrapper，历史 token/env 兼容 | 只保留 skill 文档，调用 `tiangong search process` | P0 |
| `lifecyclemodel-hybrid-search` | 已有等价 CLI | shell wrapper，历史 token/env 兼容 | 只保留 skill 文档，调用 `tiangong search lifecyclemodel` | P0 |
| `embedding-ft` | 已有等价 CLI | shell wrapper | 只保留 skill 文档，调用 `tiangong admin embedding-run` | P0 |
| `process-automated-builder` | 已进入 CLI 化，6.1 已落地 | `tiangong process auto-build` + shell/Python/LangGraph/MCP/OpenAI/AI edge search/TianGong unstructured 遗留阶段 | 迁成 `tiangong process ...` 主链 | P1 |
| `lifecyclemodel-automated-builder` | 仍是重 workflow | shell + Python + MCP + OpenAI | 迁成 `tiangong lifecyclemodel ...` 主链 | P1 |
| `lifecyclemodel-resulting-process-builder` | CLI 本地 build/publish handoff 已落地，skill wrapper 已切换 | `skill -> tiangong lifecyclemodel build/publish-resulting-process` | 保持薄 wrapper，继续去掉遗留 lookup 分支 | P1 |
| `lifecycleinventory-review` | 仍是 review workflow | Python review script | 迁成 `tiangong review process` | P2 |
| `flow-governance-review` | 仍是治理 workflow | shell + 多个 Python helper + 可选 MCP | 迁成 `tiangong flow ...` / `tiangong review flow` | P2 |
| `lifecyclemodel-recursive-orchestrator` | 仍是 orchestrator | Python orchestrator，串联多个技能 | 迁成 CLI 编排命令 | P3 |
| `lca-publish-executor` | 仍是 publish contract layer | Python publish executor | 迁成 CLI publish / handoff 层 | P3 |

## 5. 现状证据

当前 workspace 里，重逻辑确实还留在 skills / Python 层：

- `process-automated-builder` 仍要求 standalone Python env，并显式依赖 `TIANGONG_LCA_REMOTE_*`、`OPENAI_*`、`TIANGONG_KB_REMOTE_*`、`TIANGONG_MINERU_WITH_IMAGE_*`。[`tiangong-lca-skills/process-automated-builder/SKILL.md`](../../tiangong-lca-skills/process-automated-builder/SKILL.md)
- 其运行时配置代码也仍围绕 MCP 连接组织，而不是 CLI 内部 TS 客户端。[`tiangong-lca-skills/process-automated-builder/tiangong_lca_spec/core/config.py`](../../tiangong-lca-skills/process-automated-builder/tiangong_lca_spec/core/config.py)
- `lifecyclemodel-automated-builder` 仍是 Python 脚本 + MCP/OpenAI 路径。[`tiangong-lca-skills/lifecyclemodel-automated-builder/SKILL.md`](../../tiangong-lca-skills/lifecyclemodel-automated-builder/SKILL.md)
- `skills` 仓库 README 也明确写着“thin remote skills are being migrated to the unified `tiangong` CLI”，说明迁移尚未完成。[`tiangong-lca-skills/README.md`](../../tiangong-lca-skills/README.md)

这说明：

- “应该统一到 CLI”是目标态
- “现在还有 Python / skills 逻辑”是现状债务
- 但 `process_from_flow` 的 intake/scaffold 已经开始被 CLI 接管，后续应该沿同一路径继续削减遗留层

## 6. 可执行迁移路线

下面这部分不是“方向建议”，而是可以直接排期和建 issue 的执行顺序。

总原则只有一句：

> 先让 CLI 成为唯一真实入口，再把每个 skill 逐个改成 `skill -> tiangong`，最后删除 Python / MCP / 旧 env 遗留层。

### Phase 0：冻结旧世界

目标：

- 停止继续制造新的 Python / MCP 债务

ToDo：

- [ ] 明确宣布：不再新增任何 Python 业务 workflow
- [ ] 明确宣布：不再新增任何 skill 自带 transport / env parsing
- [ ] 明确宣布：不再新增任何基于 MCP 的 CLI 内部能力
- [ ] 将 `tiangong-lca-skills` 中所有新需求默认路由到 CLI issue
- [ ] 将“skills 最终只保留文档、示例、薄 wrapper”写成明确约束，而不是口头共识

完成定义：

- [ ] 新需求默认先问“CLI 命令叫什么”，而不是“再加一个 skill 脚本吗”
- [ ] 新提交里不再出现新的 Python workflow、MCP client、独立 env parser

### Phase 1：收口 CLI 当前事实

目标：

- 先把 CLI 变成“诚实的入口”，避免命令帮助和真实能力脱节

ToDo：

- [x] 整理 `tiangong-lca-cli` 当前命令面，只保留真实可用命令，或把未实现命令明确标成 `planned`
- [x] 决定 `lifecyclemodel` 是否作为 CLI 一级命名空间正式引入
- [x] 把当前真实已实现能力和计划中能力分开写清楚
- [x] 清理明显的文档残留，例如 `TIANGONG_CLI_DIR` -> `TIANGONG_LCA_CLI_DIR`
- [x] 确保 agent 看完 `--help` 后不会误以为某个关键命令已经可用

交付物：

- [x] 更新后的 CLI help
- [x] 更新后的 CLI 实施文档
- [x] 更新后的 skills 说明文档

完成定义：

- [x] “命令面”与“实际实现”一致
- [x] 当前阶段需要调用的能力，都能从 CLI 文档直接找到

### Phase 2：清掉薄 remote skills

目标：

- 完成第一批已经有 CLI 等价能力的 skill 收口

ToDo：

- [x] `flow-hybrid-search` wrapper 改为只调用 `tiangong search flow`
- [x] `process-hybrid-search` wrapper 改为只调用 `tiangong search process`
- [x] `lifecyclemodel-hybrid-search` wrapper 改为只调用 `tiangong search lifecyclemodel`
- [x] `embedding-ft` wrapper 改为只调用 `tiangong admin embedding-run`
- [ ] 再做一轮 smoke check，确认这些 wrapper 不再保留旧 token / env / HTTP 分支
- [x] 全量文档中统一 skill 调用路径变量为 `TIANGONG_LCA_CLI_DIR`

完成定义：

- [x] 调用链只剩 `skill -> tiangong`
- [x] 不再出现 `TIANGONG_API_KEY`、`TIANGONG_LCA_APIKEY`、`SUPABASE_FUNCTIONS_URL` 之类旧名
- [x] 不再出现 skill 自己解析 HTTP header / base URL
- [ ] 这 4 个 skill 可以被视为“迁移模板”

### Phase 3：把 CLI 基础模块正式变成 workflow 依赖面

目标：

- 不再让重 workflow 自己管理运行态、artifact、校验、LLM、KB、OCR、publish

当前已具备：

- [x] `run` 基础模块：`run_id`、目录布局、manifest、resume 元数据
- [x] `artifacts` 模块：统一 JSON / JSONL / audit / report 输出
- [x] `state-lock` 模块：本地单写者锁
- [x] `http` / `rest-client` 模块：统一 REST 调用、重试、超时、错误格式
- [x] `llm` 模块：统一模型调用抽象，不再直接暴露 `OPENAI_*`
- [x] `kb-search` 模块：统一 `tiangong-ai-edge-function` 检索客户端
- [x] `unstructured` 模块：统一 TianGong unstructured OCR / SI 解析客户端
- [x] `publish` 模块：统一 dry-run / commit / publish report
- [x] `validation` 模块：把 `tidas-sdk` / `tidas-tools` 校验调用收口到 CLI

还需要做：

- [ ] 明确哪些模块已经允许 workflow 直接依赖，哪些仍是内部预备模块
- [ ] 为后续 workflow 命令确定稳定的输入输出契约
- [ ] 确保未来不会再在 skill 里复制一份这些能力

完成定义：

- [ ] 重 workflow 迁移时，只需要编排 CLI 模块，而不需要重新设计 transport / cache / validation / publish

### Phase 4：先迁 `lifecyclemodel-resulting-process-builder`

这一步不是因为它最重要，而是因为它最适合作为“第一个完整 CLI 化重 workflow 模板”。

当前状态：

- `tiangong lifecyclemodel build-resulting-process` 已在 CLI 中落地，且通过 `npm run prepush:gate`
- `tiangong lifecyclemodel publish-resulting-process` 已在 CLI 中落地，且通过 `npm run prepush:gate`
- 仍未完成 skill wrapper 收口、旧 Python 主入口删除、远程 lookup 收口

目标命令：

- [x] `tiangong lifecyclemodel build-resulting-process`
- [x] `tiangong lifecyclemodel publish-resulting-process`

ToDo：

- [x] 在 CLI 中补齐 `lifecyclemodel` 顶层命名空间
- [x] 将 lifecycle model 读取、拓扑解析、聚合投影逻辑迁到 TS
- [x] 将 process catalog / local run 解析改为复用 CLI 模块
- [x] 将 resulting-process publish handoff 生成迁到 TS CLI
- [ ] 将远程 process lookup 从可选 MCP lookup 改为直接 REST 查询
- [ ] 保留 `publish-bundle.json` 契约，但发布入口统一走 CLI publish
- [ ] skill wrapper 改为只调用 CLI
- [ ] 删除 Python build / publish 主入口

交付物：

- [x] CLI 子命令实现
- [x] CLI 测试
- [x] 对应文档
- [ ] skills 薄 wrapper

完成定义：

- [ ] 这个 skill 不再需要 Python builder
- [ ] 这个 skill 不再需要 MCP lookup
- [ ] 这个 skill 成为后续其它重 workflow CLI 化的参考模板

### Phase 5：收口 publish / validation，清掉交付层并行实现

目标：

- 不再允许某个 skill 自带一套 publish 或 validation 逻辑

ToDo：

- [ ] 所有需要本地校验的 skill，统一改走 `tiangong validation run`
- [ ] 所有需要 publish handoff 的 skill，统一改走 `tiangong publish run`
- [ ] 若 `publish run` 还缺少远端 commit executor，则在 CLI 里补，不在 skills 里补
- [ ] 将 `lca-publish-executor` 改成 CLI wrapper 或直接废弃
- [ ] 明确 relation manifest / deferred publish / dry-run / commit 的唯一语义

完成定义：

- [ ] `lca-publish-executor` 不再是 Python publish contract layer
- [ ] 没有任何 skill 再维护独立 publish 契约
- [ ] 没有任何 skill 再自行判断用 `tidas-sdk` 还是 `tidas-tools`

### Phase 6：迁 `process-automated-builder`

这是最大的债务，也是最关键的主链迁移。

目标命令：

- [x] `tiangong process auto-build`
- [ ] `tiangong process resume-build`
- [ ] `tiangong process publish-build`
- [ ] `tiangong process batch-build`

建议拆成 4 个连续小步骤，而不是一次性大迁移：

- [x] 6.1 先实现 `auto-build` 的本地产物路径，不做 publish
- [ ] 6.2 再实现 `resume-build`，把 state-lock / run manifest 彻底收口到 CLI
- [ ] 6.3 再实现 `publish-build`，接到统一 publish 模块
- [ ] 6.4 最后实现 `batch-build`

迁移内容：

- [x] intake request normalization / flow 归一化 / run-id / local artifact scaffold 迁到 TS CLI
- [ ] 流程编排迁到 TS
- [ ] flow search 改为直接 REST，而不是 MCP
- [ ] publish 改为直接 REST / CLI publish，而不是 MCP CRUD
- [ ] LLM 调用改为 CLI 的 provider abstraction
- [ ] KB 检索改为 CLI 的 AI edge search client
- [ ] unstructured 调用改为 CLI 的 client
- [ ] 本地状态锁、cache、resume 逻辑迁到 CLI
- [ ] 保留 artifact 契约，不保留 Python 实现

迁移完成后应删除：

- [ ] `scripts/origin/process_from_flow_langgraph.py`
- [ ] 对 LangGraph 的硬依赖
- [ ] 对 `OPENAI_*`、`TIANGONG_LCA_REMOTE_*`、`TIANGONG_KB_REMOTE_*`、`TIANGONG_MINERU_WITH_IMAGE_*` 的依赖

完成定义：

- [ ] `process-automated-builder` 只剩 `skill -> tiangong process ...`
- [ ] agent 不再需要知道 LangGraph / MCP / OpenAI / MinerU 细节

### Phase 7：迁 `lifecyclemodel-automated-builder`

目标命令：

- [ ] `tiangong lifecyclemodel auto-build`
- [ ] `tiangong lifecyclemodel validate-build`
- [ ] `tiangong lifecyclemodel publish-build`

ToDo：

- [ ] process discovery 改为 CLI 统一查询面
- [ ] AI 选择逻辑改为 CLI LLM 模块
- [ ] 本地 `json_ordered` 组装改为 TS
- [ ] 本地校验改为 CLI 调用 `tidas-sdk` / `tidas-tools`
- [ ] publish 改为统一 publish 模块
- [ ] 去掉只为 MCP insert 保留的分支

完成定义：

- [ ] lifecycle model 自动构建不再依赖 Python 和 MCP
- [ ] 与 resulting-process / process build 的运行态契约一致

### Phase 8：迁 review / governance

目标：

- 把 review 与治理能力收口到统一 CLI，而不是分散脚本

ToDo：

- [ ] `lifecycleinventory-review` -> `tiangong review process`
- [ ] `flow-governance-review` -> `tiangong review flow`
- [ ] 视需要补 `tiangong flow get|list|remediate|publish-version|regen-product`
- [ ] review 输出继续保持本地 artifact-first
- [ ] 去掉 review 脚本中的直接 OpenAI / MCP 路径

完成定义：

- [ ] review / governance 能力可以直接从 CLI 命令树被发现
- [ ] agent 不再需要进入某个 skill 内部脚本目录才能执行治理任务

### Phase 9：最后迁 orchestrator

只有在前面的构建、publish、review 子命令都稳定后，才应该做这一步。

ToDo：

- [ ] `lifecyclemodel-recursive-orchestrator` 迁成 CLI 编排命令
- [ ] 所有子步骤只通过 `tiangong` 子命令调用
- [ ] orchestrator 只负责编排，不再承载业务实现
- [ ] 不再保留 Python orchestrator 作为总入口

完成定义：

- [ ] 总控层只编排 CLI
- [ ] 没有新的“第二套入口”

### Phase 10：删除遗留层

目标：

- 在代码层面真正完成“skills 全部只使用 CLI”

ToDo：

- [ ] 删除 skills 中的业务 Python 运行时
- [ ] 删除 skills 中的业务 shell 实现，只保留薄 wrapper
- [ ] 删除 skills 中的 transport / env parsing 逻辑
- [ ] 删除 skills 中的 MCP-only 实现
- [ ] 删除所有旧 env 名文档
- [ ] 删除对 `TIANGONG_CLI_DIR` 旧变量名的依赖
- [ ] 每个相关 repo merge 后，更新 `lca-workspace` 子模块指针

最终 `skills` 仓库应只剩：

- [ ] `SKILL.md`
- [ ] 示例 request / assets
- [ ] 参考文档
- [ ] 对 `tiangong` 的薄调用

## 7. Env 收敛清单

### 7.1 已经落地

- [x] `TIANGONG_LCA_API_BASE_URL`
- [x] `TIANGONG_LCA_API_KEY`
- [x] `TIANGONG_LCA_REGION`

### 7.2 后续若 CLI 真正实现对应模块，再增加

- [x] `TIANGONG_LCA_LLM_API_KEY`
- [x] `TIANGONG_LCA_LLM_MODEL`
- [x] `TIANGONG_LCA_LLM_BASE_URL`
- [x] `TIANGONG_LCA_KB_SEARCH_API_BASE_URL`
- [x] `TIANGONG_LCA_KB_SEARCH_API_KEY`
- [x] `TIANGONG_LCA_KB_SEARCH_REGION`
- [x] `TIANGONG_LCA_UNSTRUCTURED_API_BASE_URL`
- [x] `TIANGONG_LCA_UNSTRUCTURED_API_KEY`
- [x] `TIANGONG_LCA_UNSTRUCTURED_PROVIDER`
- [x] `TIANGONG_LCA_UNSTRUCTURED_MODEL`
- [x] `TIANGONG_LCA_UNSTRUCTURED_CHUNK_TYPE`
- [x] `TIANGONG_LCA_UNSTRUCTURED_RETURN_TXT`
- [ ] `TIANGONG_LCA_CLI_DIR`

### 7.3 应彻底淘汰

- [ ] `TIANGONG_API_BASE_URL`
- [ ] `TIANGONG_API_KEY`
- [ ] `TIANGONG_REGION`
- [ ] `TIANGONG_LCA_APIKEY`
- [ ] `SUPABASE_FUNCTIONS_URL`
- [ ] `SUPABASE_FUNCTION_REGION`
- [ ] `OPENAI_*`
- [ ] `LCA_OPENAI_*`
- [ ] `TIANGONG_KB_*`（旧直连命名）
- [ ] `TIANGONG_LCA_REMOTE_*`
- [ ] `TIANGONG_KB_REMOTE_*`
- [ ] `TIANGONG_MINERU_WITH_IMAGE_*`
- [ ] `MINERU_*`
- [ ] `MINERU_WITH_IMAGES_*`

## 8. 每个 Skill 的完成定义

一个 skill 只有在满足下面条件后，才算迁移完成：

- [ ] skill 不再直接执行业务 Python
- [ ] skill 不再直接访问 REST / MCP
- [ ] skill 不再解析 env
- [ ] skill 不再持有独立 publish 逻辑
- [ ] skill 只调用统一 `tiangong` 命令
- [ ] 对应 CLI 子命令有测试
- [ ] 对应 CLI 子命令有文档
- [ ] 对应 CLI 子命令纳入 `npm run prepush:gate`
- [ ] 对应 skill 文档已改成 CLI 用法

## 9. 立即执行的短清单

如果只按最短路径推进，下一轮建议严格做这 8 件事：

当前重点已经推进到第 8 项，且 `tiangong process auto-build` / Phase 6.1 已完成。

1. 修 CLI help，让命令面和真实实现一致。
2. 修 skills 文档中的 `TIANGONG_CLI_DIR` 残留。
3. 正式引入 `tiangong lifecyclemodel ...` 命名空间。
4. 先完成 `tiangong lifecyclemodel build-resulting-process`。
5. 完成 `tiangong lifecyclemodel publish-resulting-process`。
6. 把 `lifecyclemodel-resulting-process-builder` 改成薄 wrapper。
7. 把 `lca-publish-executor` 收口到 `tiangong publish run`。
8. 继续推进 `tiangong process resume-build`，把后续阶段执行面从遗留 workflow 收口到 CLI。

## 10. 不应该做的事

- [ ] 不要先迁 orchestrator
- [ ] 不要保留 Python 主逻辑，只包一层 TS 壳就算完成
- [ ] 不要继续在 skills 里加新 env、新 transport、新 publish 约定
- [ ] 不要为了兼容旧实现，把 MCP 重新带回 CLI

## 11. 一句话标准

判断迁移是否走在正确方向上，只问一句：

> 一个 agent 要完成工作时，是否只需要知道 `tiangong` 命令树，而不需要知道 skills 内部 shell、Python、MCP、OpenAI、AI edge search、unstructured 的实现细节？

如果答案还是“否”，说明迁移还没完成。
