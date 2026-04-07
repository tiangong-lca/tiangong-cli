# 项目配置

本项目是 TianGong 的统一 CLI 仓库，运行时基线固定为 Node 24，源码使用 TypeScript，但运行时执行 `dist/` 下的构建产物。

设计原则：

- 统一入口：所有 TianGong 平台能力最终收敛到 `tiangong` 一个命令树
- 原生优先：优先使用 Node 24 原生能力，不默认引入高级包
- 直连 REST：不再以内置 MCP 作为 CLI 传输层
- 文件优先：输入优先走 JSON / JSONL / 本地文件，输出优先走结构化 JSON

## MCP 替代策略（明确约束）

统一 CLI 不再引入 MCP 作为内部传输层，替代策略固定为两条：

- 策略 1：优先直连 `tiangong-lca-edge-functions` 的 Edge Function / REST（适用于有明确业务语义的 API）
- 策略 2：对 Supabase 直接访问时不再经过 MCP；CLI 直接依赖官方 `@supabase/supabase-js`，并在此基础上保持 deterministic 的读写语义、URL 形状和报告契约

这两条共同目标是：不再发明新的中间 transport 实体。

当前已落地的命令：

- `tiangong doctor`
- `tiangong search flow`
- `tiangong search process`
- `tiangong search lifecyclemodel`
- `tiangong process get`
- `tiangong process auto-build`
- `tiangong process resume-build`
- `tiangong process publish-build`
- `tiangong process batch-build`
- `tiangong lifecyclemodel auto-build`
- `tiangong lifecyclemodel validate-build`
- `tiangong lifecyclemodel publish-build`
- `tiangong lifecyclemodel build-resulting-process`
- `tiangong lifecyclemodel publish-resulting-process`
- `tiangong lifecyclemodel orchestrate`
- `tiangong review process`
- `tiangong review flow`
- `tiangong review lifecyclemodel`
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
- `tiangong publish run`
- `tiangong validation run`
- `tiangong admin embedding-run`

## 安装依赖

只需要一个可用的 Node.js `24.x` 运行时。本仓库不要求 `bash`、`nvm` 或其他 Unix-only 初始化工具。你可以使用自己平台上最稳定的安装方式，例如：

- Windows: 官方 Node.js `24.x` 安装器
- macOS: 官方安装器、`fnm` 或 `nvm`
- Linux: 你自己的 Node 24 安装方式

```bash
npm ci
npm run build
```

## 发布流程

这个仓库对外公开发布的 npm 包名是 `@tiangong-lca/cli`。

日常 release 采用 tag 驱动的 GitHub Actions 流程：

- 从 `main` 开一个 release-prep PR
- 只修改 CLI 包自己的 `package.json` 版本号
- PR 合并后，`.github/workflows/tag-release-from-merge.yml` 自动创建 `cli-vX.Y.Z`
- `.github/workflows/publish.yml` 再从这个不可变 tag 通过 npm Trusted Publishing 发布

值班发布步骤见 [docs/release-runbook.md](./docs/release-runbook.md)。

一次性的仓库 secret、workflow 文件名和 npm Trusted Publisher 配置见 [docs/release-setup.md](./docs/release-setup.md)。

发布到 npm 之后，可直接安装：

```bash
npm install --global @tiangong-lca/cli
```

## 配置文件

本项目会自动加载仓库根目录下的 `.env` 文件。

初始化时，把 `.env.example` 复制成仓库根目录下的 `.env`。推荐直接用编辑器或文件管理器完成这一步，这样 macOS / Linux / Windows 都不需要自行翻译 shell 命令。

当前统一 CLI 的公开命令面必需环境变量是这一组：

```bash
TIANGONG_LCA_API_BASE_URL=
TIANGONG_LCA_API_KEY=
TIANGONG_LCA_REGION=us-east-1
TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY=
TIANGONG_LCA_SESSION_FILE=
TIANGONG_LCA_DISABLE_SESSION_CACHE=false
TIANGONG_LCA_FORCE_REAUTH=false
```

`TIANGONG_LCA_API_KEY` 是账户页生成的 TianGong 用户 API Key，不是 Supabase project key。CLI 只把它当作 bootstrap 凭证，配合 `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` 在本地换取用户 session，然后统一用解析出的 access token 访问 Edge Functions 和 direct Supabase。

此外，只有在显式启用 `tiangong review process --enable-llm` 或 `tiangong review flow --enable-llm` 时，才会额外使用这一组可选变量。这一整组配置默认都是 optional；只有打开 review LLM 模式时才需要填写。`TIANGONG_LCA_REVIEW_LLM_BASE_URL` 应指向一个 OpenAI-compatible Responses API 根地址，CLI 会向 `<base_url>/responses` 发请求：

```bash
TIANGONG_LCA_REVIEW_LLM_BASE_URL=
TIANGONG_LCA_REVIEW_LLM_API_KEY=
TIANGONG_LCA_REVIEW_LLM_MODEL=
```

仓库里还已经存在一组 internal/preparatory env 归一化入口，但当前没有任何公开 `tiangong` 命令消费它们：

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

当前也不需要额外配置通用的 `SUPABASE_URL`、`SUPABASE_KEY` 或 `TIANGONG_LCA_TIDAS_SDK_DIR`。CLI 会从 `TIANGONG_LCA_API_BASE_URL` 派生原生 `@supabase/supabase-js` client，用 `TIANGONG_LCA_API_KEY + TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` 换取用户 session，并直接从 `package.json` 依赖加载 `@tiangong-lca/tidas-sdk`。

不再兼容旧变量名，也不再把 KB、TianGong unstructured service、MCP 相关 env 混写成当前公开命令面的必需配置。

原因很直接：

- 当前 CLI 已实现命令只直连 TianGong LCA 的 REST / Edge Functions
- `review process` / `review flow` 的可选语义审核统一走 review-only 的 `TIANGONG_LCA_REVIEW_LLM_*`，不再使用 `OPENAI_*`
- `publish run` / `validation run` 只做本地契约和执行收口，不新增远程 env
- CLI 仓库内部虽然已经有 `kb-search` / `unstructured` 模块，但当前没有任何公开命令消费这些 env
- `.env.example` 会把这类 key 标成 internal/preparatory，防止代码和文档脱节，也防止调用方误认为它们已经是稳定公开 contract

命令级 env 现实如下：

| 命令组 | 必需 env |
| --- | --- | --- | --- | --- |
| `doctor` | 无 |
| `search flow | process | lifecyclemodel` | `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`（`TIANGONG_LCA_REGION` 可选） |
| `admin embedding-run` | `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`（`TIANGONG_LCA_REGION` 可选） |
| `process get` | `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` |
| `process auto-build | resume-build | publish-build | batch-build` | 无 |
| `lifecyclemodel auto-build | validate-build | publish-build | orchestrate` | 无 |
| `lifecyclemodel build-resulting-process` | 本地运行默认无；若 request 打开 `process_sources.allow_remote_lookup=true`，则需要 `TIANGONG_LCA_API_BASE_URL`、`TIANGONG_LCA_API_KEY`、`TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY` |
| `lifecyclemodel publish-resulting-process` | 无 |
| `review process` | 纯规则 review 默认无；若显式启用 `--enable-llm`，则需要 `TIANGONG_LCA_REVIEW_LLM_BASE_URL`、`TIANGONG_LCA_REVIEW_LLM_API_KEY`、`TIANGONG_LCA_REVIEW_LLM_MODEL` |
| `review flow` | 纯规则 review 默认无；若显式启用 `--enable-llm`，则需要 `TIANGONG_LCA_REVIEW_LLM_BASE_URL`、`TIANGONG_LCA_REVIEW_LLM_API_KEY`、`TIANGONG_LCA_REVIEW_LLM_MODEL` |
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

## 调试项目

公开推荐的跨平台执行入口按优先级是：

- `npm exec tiangong -- ...`
- `node ./bin/tiangong.js ...`
- `node ./dist/src/main.js ...`

`npm start -- ...` 仍可用于本地开发时的“先构建再执行”，但它不是 skills / 文档的 canonical 公共入口。

```bash
npm exec tiangong -- --help
npm exec tiangong -- doctor
npm exec tiangong -- doctor --json
npm exec tiangong -- search flow --input ./request.json --dry-run
npm exec tiangong -- process get --id <process-id> --version <version> --json
npm exec tiangong -- process auto-build --input ./examples/process-auto-build.request.json --json
npm exec tiangong -- process resume-build --run-id <run-id> --json
npm exec tiangong -- process publish-build --run-id <run-id> --json
npm exec tiangong -- process batch-build --input ./examples/process-batch-build.request.json --json
npm exec tiangong -- lifecyclemodel auto-build --input ./examples/lifecyclemodel-auto-build.request.json --json
npm exec tiangong -- lifecyclemodel validate-build --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id> --json
npm exec tiangong -- lifecyclemodel publish-build --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id> --json
npm exec tiangong -- lifecyclemodel orchestrate plan --input ./lifecyclemodel-orchestrate.request.json --out-dir ./artifacts/lifecyclemodel_recursive/<run_id> --json
npm exec tiangong -- lifecyclemodel build-resulting-process --input ./request.json --json
npm exec tiangong -- lifecyclemodel publish-resulting-process --run-dir ./runs/example --publish-processes --publish-relations --json
npm exec tiangong -- review process --run-root ./artifacts/process_from_flow/<run_id> --run-id <run_id> --out-dir ./review --json
npm exec tiangong -- review flow --rows-file ./flows.json --out-dir ./flow-review --json
npm exec tiangong -- review lifecyclemodel --run-dir ./artifacts/lifecyclemodel_auto_build/<run_id> --out-dir ./lifecyclemodel-review --json
npm exec tiangong -- flow get --id <flow-id> --version <version> --json
npm exec tiangong -- flow list --id <flow-id> --state-code 100 --limit 20 --json
npm exec tiangong -- flow remediate --input-file ./invalid-flows.jsonl --out-dir ./flow-remediation --json
npm exec tiangong -- flow publish-version --input-file ./ready-flows.jsonl --out-dir ./flow-publish --dry-run --json
npm exec tiangong -- flow publish-reviewed-data --flow-rows-file ./reviewed-flows.jsonl --original-flow-rows-file ./original-flows.jsonl --out-dir ./flow-publish-reviewed --dry-run --json
npm exec tiangong -- flow build-alias-map --old-flow-file ./old-flows.jsonl --new-flow-file ./new-flows.jsonl --out-dir ./flow-alias-map --json
npm exec tiangong -- flow scan-process-flow-refs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-scan --json
npm exec tiangong -- flow plan-process-flow-repairs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --scan-findings ./flow-scan/scan-findings.json --out-dir ./flow-repair-plan --json
npm exec tiangong -- flow apply-process-flow-repairs --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --scan-findings ./flow-scan/scan-findings.json --out-dir ./flow-repair-apply --json
npm exec tiangong -- flow regen-product --processes-file ./processes.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-regen --apply --json
npm exec tiangong -- flow validate-processes --original-processes-file ./before.jsonl --patched-processes-file ./after.jsonl --scope-flow-file ./flows.jsonl --out-dir ./flow-validate --json
npm exec tiangong -- publish run --input ./examples/publish-run.request.json --dry-run
npm exec tiangong -- validation run --input-dir ./tidas-package --engine auto
npm exec tiangong -- admin embedding-run --input ./jobs.json --dry-run
```

## process / review / publish / validation 边界

`tiangong process get` 现在是统一 CLI 持有的只读 process 详情命令，负责：

- 从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase `/rest/v1` 读取路径
- 读取单个 process `id`
- 若显式提供 `--version`，先做精确版本查找；找不到时回退到同一 `id` 的最新版本
- 输出一个稳定的结构化 JSON 报告

这个命令当前只负责 deterministic direct-read，不负责任何远端写入、review、publish 或 workflow 编排。

`tiangong process auto-build` 现在已经承担 `process_from_flow` 主链的第一个 CLI 切片，负责：

- 读取单个 process-from-flow request
- 解析 `flow_file` 指向的 ILCD flow JSON
- 生成兼容旧工作流的 `run_id`
- 创建本地 `artifacts/process_from_flow/<run_id>/` 运行骨架
- 预写 `cache/process_from_flow_state.json`
- 预写 `cache/agent_handoff_summary.json`
- 产出 request / flow / assembly / lineage / invocation / run manifest / report

这个命令当前只负责本地 intake 与 scaffold，不负责继续执行后续工作流阶段。

`tiangong process resume-build` 现在也已经进入可执行状态，负责：

- 从 `--run-id` 或 `--run-dir` 重开一个现有 process build run
- 校验 `process_from_flow_state.json`、`agent_handoff_summary.json`、`run-manifest.json` 等关键产物
- 复用本地 state lock，避免并发写入同一个 run
- 清理持久化的 `stop_after` checkpoint，并把状态推进到 `resume_prepared`
- 输出 `resume-metadata.json`、`resume-history.jsonl`、更新 `invocation-index.json`
- 重写 `agent_handoff_summary.json`
- 输出 `process-resume-build-report.json`

这个命令当前也只负责本地 resume handoff，不负责继续执行后续工作流阶段。

`tiangong process publish-build` 现在也已经进入可执行状态，负责：

- 从 `--run-id` 或 `--run-dir` 读取一个现有 process build run
- 校验 `process_from_flow_state.json`、`agent_handoff_summary.json`、`run-manifest.json`、`invocation-index.json`
- 优先从 `exports/processes`、`exports/sources` 收集 canonical 数据，缺失时回退到 state 中的 `process_datasets`、`source_datasets`
- 生成 `stage_outputs/10_publish/publish-bundle.json`
- 生成 `stage_outputs/10_publish/publish-request.json`
- 生成 `stage_outputs/10_publish/publish-intent.json`
- 更新 `process_from_flow_state.json`、`invocation-index.json`、`agent_handoff_summary.json`
- 输出 `process-publish-build-report.json`

这个命令当前只负责本地 publish handoff，不负责真正的远端 publish commit；真正的 dry-run / commit 边界仍由 `tiangong publish run` 负责。

`tiangong process batch-build` 现在也已经进入可执行状态，负责：

- 读取单个 batch manifest
- 创建自包含的 batch root 和聚合 report 路径
- 顺序复用 CLI 的 `process auto-build` 契约执行多个 item
- 为每个 item 生成稳定的本地 run 目录
- 在 batch report 中记录 per-item prepared / failed / skipped 结果
- 为后续 `resume-build` / `publish-build` 保留明确的 `run_root`

这个命令当前只负责本地 batch orchestration，不负责继续串接 resume / publish，也不负责远端 publish commit。

`tiangong lifecyclemodel auto-build` 现在已经承担 `lifecyclemodel-automated-builder` 主链的第一个 CLI 切片，负责：

- 读取单个 local-run manifest
- 解析一个或多个 `process-automated-builder` 本地 run 目录
- 从共享 flow UUID 推断 process graph
- 选择 reference process
- 计算每个 process instance 的 `@multiplicationFactor`
- 写出原生 `json_ordered` lifecyclemodel 数据集
- 写出 `run-plan.json`、`resolved-manifest.json`、`selection/selection-brief.md`
- 写出 `discovery/reference-model-summary.json`、`models/**/summary.json`、`connections.json`、`process-catalog.json`

这个命令当前只负责本地只读 build，不负责：

- 远端 lifecyclemodel 写入
- MCP / KB / LLM reference-model discovery
- 自动串接 `validate-build` 或 `publish-build`

`tiangong lifecyclemodel validate-build` 现在也已经进入可执行状态，负责：

- 从 `--run-dir` 重开一个已有 lifecyclemodel auto-build run
- 扫描 `models/*/tidas_bundle/lifecyclemodels/*.json`
- 通过统一 `validation` 模块重新执行本地校验
- 在 `reports/model-validations/` 下输出 per-model 校验结果
- 更新 `manifests/invocation-index.json`
- 输出 `reports/lifecyclemodel-validate-build-report.json`

这个命令当前只负责本地 validation handoff，不负责远端写入，也不自动触发 publish。

`tiangong lifecyclemodel publish-build` 现在也已经进入可执行状态，负责：

- 从 `--run-dir` 重开一个已有 lifecyclemodel auto-build run
- 收集 `models/*/tidas_bundle/lifecyclemodels/*.json` 下的原生 lifecyclemodel payload
- 若存在 `reports/lifecyclemodel-validate-build-report.json`，则读取其中的 aggregate 校验摘要
- 输出 `stage_outputs/10_publish/publish-bundle.json`
- 输出 `stage_outputs/10_publish/publish-request.json`
- 输出 `stage_outputs/10_publish/publish-intent.json`
- 更新 `manifests/invocation-index.json`
- 输出 `reports/lifecyclemodel-publish-build-report.json`

这个命令当前只负责本地 publish handoff，不负责真正的远端 publish commit；真正的 dry-run / commit 边界仍由 `tiangong publish run` 负责。

`tiangong lifecyclemodel build-resulting-process` 现在仍然保持本地优先，但已经支持一个显式的 deterministic 远端补全路径：

- 只有当 request 中 `process_sources.allow_remote_lookup=true` 时才启用
- 直接从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase `/rest/v1` 读取路径
- 按 `process_id + version` 精确读取，找不到时回退到该 `id` 的最新版本
- 不走 MCP，不走语义检索，不改变本地 artifact 契约

也就是说，这个命令现在解决的是“缺 process JSON 时的 deterministic direct-read”，不是把整个 lifecyclemodel build workflow 变成远端编排。

`tiangong lifecyclemodel publish-resulting-process` 现在已经进入可执行状态，负责：

- 从 `--run-dir` 重开一个已有 resulting-process run
- 汇总 projected process payload 与 resulting-process relation payload
- 输出 `publish-bundle.json`
- 输出 `publish-intent.json`
- 输出 `publish-summary.json`

这个命令当前只负责 resulting-process 的本地 publish handoff，不直接执行远端提交；真正的 dry-run / commit 仍由 `tiangong publish run` 负责。

`tiangong lifecyclemodel orchestrate` 现在已经进入可执行状态，负责：

- `plan`：把递归装配请求规范化为 `assembly-plan.json`、`graph-manifest.json`、`lineage-manifest.json`、`boundary-report.json`
- `execute`：只调用原生 CLI builder slices，记录 `invocations/*.json` 与执行汇总
- `publish`：重开一个已有 orchestrator run，汇总上游本地产物并输出 `publish-bundle.json`、`publish-summary.json`

这个命令的 `process_builder` 请求面已经收窄到 CLI-native 本地构建字段集合；额外的旧 builder 控制项会在请求归一化阶段直接被拒绝，不再保留任何 Python fallback 配置面。

`tiangong review process` 现在也已经进入可执行状态，负责：

- 从 `--run-root` 读取 `exports/processes/*.json`
- 沿用当前 process review 的平衡核查、基础信息核查、单位疑似问题记录逻辑
- 输出 `one_flow_rerun_timing.md`
- 输出 `one_flow_rerun_review_v2_1_zh.md`
- 输出 `one_flow_rerun_review_v2_1_en.md`
- 输出 `flow_unit_issue_log.md`
- 输出 `review_summary_v2_1.json`
- 输出 `process-review-report.json`

这个命令当前保持本地 artifact-first。若显式传入 `--enable-llm`，则通过 CLI 内部统一的 `TIANGONG_LCA_REVIEW_LLM_*` 运行时做可选语义审核；即使 LLM 失败，也不会影响规则层 review 主流程。

`tiangong review flow` 现在也已经进入可执行状态，负责：

- 接受 `--rows-file`、`--flows-dir`、`--run-root` 三种本地输入模式之一
- 在 `--rows-file` 模式下物化 `review-input/flows/*.json` 和 `review-input/materialization-summary.json`
- 输出 `rule_findings.jsonl`
- 输出 `llm_findings.jsonl`
- 输出 `findings.jsonl`
- 输出 `flow_summaries.jsonl`
- 输出 `similarity_pairs.jsonl`
- 输出 `flow_review_summary.json`
- 输出 `flow_review_zh.md`
- 输出 `flow_review_en.md`
- 输出 `flow_review_timing.md`
- 输出 `flow_review_report.json`

这个命令同样保持本地 artifact-first。若显式传入 `--enable-llm`，则通过 CLI 内部统一的 `TIANGONG_LCA_REVIEW_LLM_*` 运行时做可选语义审核；当前 CLI 切片明确不支持 `--with-reference-context`，也还没有接入本地 registry enrichment。

`tiangong review lifecyclemodel` 现在也已经进入可执行状态，负责：

- 从 `--run-dir` 重开一个已有 lifecyclemodel auto-build run
- 扫描 `models/*/tidas_bundle/lifecyclemodels/*.json`
- 复用 `summary.json`、`connections.json`、`process-catalog.json`
- 若存在 `reports/lifecyclemodel-validate-build-report.json`，则聚合其中的 validate findings
- 输出 `model_summaries.jsonl`
- 输出 `findings.jsonl`
- 输出 `lifecyclemodel_review_summary.json`
- 输出 `lifecyclemodel_review_zh.md`
- 输出 `lifecyclemodel_review_en.md`
- 输出 `lifecyclemodel_review_timing.md`
- 输出 `lifecyclemodel_review_report.json`

这个命令当前保持本地 artifact-first，不引入 Python、LangGraph 或 skill 私有 review runtime。本地 validation 边界也已经收口到 CLI 内组装的 `@tiangong-lca/tidas-sdk` 校验器，不再依赖 sibling repo、`uv run tidas-validate` 或其他外部 fallback。

`tiangong flow get` 现在已经承担 flow governance 的只读详情切片，负责：

- 从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase `/rest/v1/flows` 读取路径
- 按 `id` 读取单个 flow
- 可选叠加 `--version`、`--user-id`、`--state-code` 过滤条件
- 若显式提供 `--version` 但精确版本未命中，则回退到该 `id` 的最新可见版本
- 若出现多个可见候选同时命中，则直接报 ambiguous，而不是隐式猜测

这个命令当前只负责 deterministic direct-read，不负责任何治理修复、publish 或 workflow 编排。

`tiangong flow list` 现在已经承担 flow governance 的只读枚举切片，负责：

- 从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase `/rest/v1/flows` 读取路径
- 支持重复 `--id`、`--state-code`、`--type-of-dataset` 过滤
- 默认使用 `order=id.asc,version.asc`
- 支持 `--limit` / `--offset`
- 支持 `--all --page-size <n>` 的显式 offset 分页收集
- 输出稳定的结构化 JSON 报告

这个命令当前只负责 deterministic direct-read list，不负责修复、publish 或后续产品侧再生逻辑。

`tiangong flow remediate` 现在已经承担 flow governance 的第一个 CLI remediation 切片，负责：

- 读取单个 invalid flow JSON / JSONL 输入
- 执行 deterministic round1 remediation
- 输出历史兼容的 `remediated_all`、`ready_for_mcp`、`manual_queue`、`audit`、`report`、`prompt` 工件

这个命令当前只负责本地 round1 remediation，不负责远端 publish、round2 重试或后续产品侧再生逻辑。

`tiangong flow publish-version` 现在已经承担 flow governance 的第一个 CLI 远端写入切片，负责：

- 读取单个 ready-for-publish flow JSON / JSONL 输入
- 从 `TIANGONG_LCA_API_BASE_URL` 推导 Supabase `/rest/v1/flows` 路径
- 在 dry-run 或 commit 模式下决定 `insert` / `update_existing` / failure
- 输出历史兼容的 `mcp_success_list`、`remote_validation_failed`、`mcp_sync_report`

这个命令当前只负责 remediated flow version 的 publish/update 契约，不负责 round2 失败再修复；后续产品侧再生已经由 `tiangong flow regen-product` 单独承接。

`tiangong flow publish-reviewed-data` 现在已经承担 flow governance 的 reviewed publish preparation 切片，负责：

- 读取 reviewed flow 和/或 reviewed process 的本地 JSON / JSONL 输入
- 可选读取 `--original-flow-rows-file`，对 unchanged reviewed rows 直接跳过，不再 version bump
- 支持 `skip | append_only_bump | upsert_current_version`
- 输出 `prepared-flow-rows.json`
- 输出 `prepared-process-rows.json`
- 输出 `flow-version-map.json`
- 输出 `skipped-unchanged-flow-rows.json`
- 在需要时重写 process `referenceToFlowDataSet` 并输出 `process-flow-ref-rewrite-evidence.jsonl`
- 输出 `publish-report.json`
- 保留历史兼容的 `mcp_success_list`、`remote_validation_failed`、`mcp_sync_report`

这个命令现在已经覆盖 flow/process 的本地 reviewed publish 准备阶段；当显式传入 `--commit` 时，prepared flow rows 和 prepared process rows 都会通过 CLI 自己基于 `@supabase/supabase-js` 的 writer layer 执行远端提交，不再依赖任何 legacy skill 路径。

`tiangong flow build-alias-map` 现在已经承担 flow governance 的 deterministic alias map 切片，负责：

- 读取一个或多个 old flow JSON / JSONL 输入
- 读取一个或多个 new flow JSON / JSONL 输入
- 可选读取 `--seed-alias-map`
- 输出 `alias-plan.json`
- 输出 `alias-plan.jsonl`
- 输出 `flow-alias-map.json`
- 输出 `manual-review-queue.jsonl`
- 输出 `alias-summary.json`

这个命令当前只负责本地 alias map 构建，不负责 process repair、publish 或任何远端写入。

`tiangong flow scan-process-flow-refs` 现在已经承担 flow governance 的独立 process ref 扫描切片，负责：

- 读取本地 process JSON / JSONL 输入
- 读取一个或多个 scope/catalog flow JSON / JSONL 输入
- 对每个 exchange 的 `referenceToFlowDataSet` 做 scope / catalog / alias 分类
- 可选在扫描前剔除 emergy-named process
- 输出 `emergy-excluded-processes.json`
- 输出 `scan-summary.json`
- 输出 `scan-findings.json`
- 输出 `scan-findings.jsonl`

这个命令当前只负责本地 deterministic 扫描，不负责 patch、publish 或 OpenClaw 语义决策。

`tiangong flow plan-process-flow-repairs` 现在已经承担 flow governance 的独立 deterministic repair plan 切片，负责：

- 读取本地 process JSON / JSONL 输入
- 读取一个或多个 scope flow JSON / JSONL 输入
- 可选读取 `--alias-map`
- 可选读取上一步 `--scan-findings`
- 显式收口 `disabled | alias-only | alias-or-unique-name` auto-patch policy
- 输出 `repair-plan.json`
- 输出 `repair-plan.jsonl`
- 输出 `manual-review-queue.jsonl`
- 输出 `repair-summary.json`

这个命令当前只负责 repair planning，不直接修改 process rows。

`tiangong flow apply-process-flow-repairs` 现在已经承担 flow governance 的独立 deterministic repair apply 切片，负责：

- 复用与 repair plan 相同的 process / scope / alias / scan 输入契约
- 只应用 deterministic subset
- 输出 `patched-processes.json`
- 输出 `process-patches/<process-id__version>/before.json`
- 输出 `process-patches/<process-id__version>/after.json`
- 输出 `process-patches/<process-id__version>/diff.patch`
- 输出 `process-patches/<process-id__version>/evidence.json`
- 若传入 `--process-pool-file`，把 exact-version patched rows 同步回本地 pool，并在 `repair-summary.json` 记录 `process_pool_sync`

这个命令当前只负责本地 deterministic patch apply，不负责后续校验或远端写入；后续校验由 `tiangong flow validate-processes` 承接。

`tiangong flow regen-product` 现在已经承担 flow governance 的产品侧再生切片，负责：

- 读取本地 process JSON / JSONL 输入
- 读取一个或多个 scope/catalog flow JSON / JSONL 输入
- 在一个统一命令下执行 `scan -> repair plan -> optional apply -> optional validate`
- 输出 `flow-regen-product-report.json`
- 输出 `scan/`、`repair/`、`repair-apply/`、`validate/` 工件目录
- 在 `--apply` 后可选同步 `process-pool-file`

这个命令当前只负责本地 deterministic 再生产物链，不负责远端 publish/write，也不负责 round2 remote-validation retry。

`tiangong flow validate-processes` 现在已经承担 flow governance repair 之后的独立 process patch 校验切片，负责：

- 读取 original / patched process rows
- 读取一个或多个 scope flow JSON / JSONL 输入
- 校验只允许 `referenceToFlowDataSet` 路径变化
- 校验 quantitative reference 保持稳定
- 可选复用 CLI 侧基于直接依赖 `@tiangong-lca/tidas-sdk` 组装的本地 TIDAS 校验器
- 输出 `validation-report.json`、`validation-failures.jsonl`

这个命令当前只负责本地 patch validation，不负责 repair 规划、apply 或远端写入。

`tiangong publish run` 现在已经成为统一 publish 契约入口，负责：

- 读取 publish request
- 归一化 `bundle_paths` / 直接数组输入
- 统一 `dry-run` / `commit` 语义
- 输出 `normalized-request.json`
- 输出 `collected-inputs.json`
- 输出 `relation-manifest.json`
- 输出 `publish-report.json`

当前实现刻意没有把旧 MCP 数据库写入逻辑重新塞回 CLI；commit 模式通过可插拔执行器承接，CLI 先把稳定的输入/输出契约和报告形状固定下来。

`tiangong validation run` 负责把本地 TIDAS 包校验统一收口到 CLI：

- `--engine auto`：走当前默认的 direct-dependency 校验路径，也就是 CLI 内基于 `@tiangong-lca/tidas-sdk` 组装的 package validator
- `--engine sdk`：显式固定到同一条 `@tiangong-lca/tidas-sdk` 校验链

这两个命令都不需要新增 `TIANGONG_LCA_*` 之外的环境变量。

## 开发模式

```bash
npm run dev -- --help
```

说明：

- `npm run dev` 仍可使用 `tsx` 做开发期直接运行
- 正式运行入口不再依赖 `tsx`，而是执行构建后的 `dist/` 产物

## 检查与测试

```bash
npm run lint
npm run prettier
npm test
npm run test:coverage
npm run test:coverage:assert-full
npm run prepush:gate
```

说明：

- `npm run lint` 会执行 `eslint`、deprecated API 检查、coverage-ignore 守卫、`prettier --check` 和 `tsc`
- `npm run prettier` 用于实际改写格式
- `npm test` 包含普通单元测试和 `bin` / 入口 smoke test
- `npm run test:coverage` 对 `src/**/*.ts` 执行 100% 覆盖率门
- `npm run prepush:gate` 是提交前的完整质量门
- 不允许通过 `c8 ignore` / `istanbul ignore` / `v8 ignore` 这类 pragma 规避覆盖率；边缘情况必须在测试里覆盖

## 构建项目

当前 `build` 会把 CLI 源码编译到 `dist/`：

```bash
npm run build
```

## 可执行入口

仓库内当前统一推荐三个稳定入口：

- `npm exec tiangong -- ...`
- `node ./bin/tiangong.js ...`
- `node ./dist/src/main.js ...`

其中：

- `npm exec tiangong -- ...` 直接走 `package.json` 里的 `bin.tiangong`
- `node ./bin/tiangong.js ...` 会加载 `dist/src/main.js`
- `node ./dist/src/main.js ...` 适合调试编译后的真实 runtime
- `npm start -- ...` 仍然可用，但本质是“先构建再运行”的开发便利脚本

## 与 skills 的联动约定

`tiangong-lca-skills` 后续不再各自维护独立 HTTP/MCP 入口，而是逐步收敛到这个 CLI。

当前建议：

- 轻量远程 skill 直接调用 `tiangong search ...` 或 `tiangong admin ...`
- `process-automated-builder` 已先迁入 `tiangong process auto-build` 本地 scaffold；剩余阶段继续按子命令切片迁移
- `process-automated-builder` 的本地 resume handoff 也已迁入 `tiangong process resume-build`；后续阶段继续按子命令切片迁移
- `process-automated-builder` 的本地 publish handoff 也已迁入 `tiangong process publish-build`
- `process-automated-builder` 的本地 batch orchestration 也已迁入 `tiangong process batch-build`
- `lifecyclemodel-automated-builder` 的 canonical skill 入口已切为原生 Node `.mjs` wrapper -> `tiangong lifecyclemodel auto-build | validate-build | publish-build`；本地 local-run 组装、validation handoff、publish handoff 已迁入 CLI，剩余 discovery 继续按子命令切片迁移
- 其余重型 workflow 先保留原执行器，但由 `tiangong` 统一调度
- 所有新脚本优先使用统一环境变量名，不再扩散旧变量名

## 示例请求文件

仓库已提供三份最小请求样例，便于 skills 和 agent 直接复用：

- `examples/process-auto-build.request.json`
- `examples/process-batch-build.request.json`
- `examples/lifecyclemodel-auto-build.request.json`
- `examples/publish-run.request.json`

## 当前目录约定

```text
tiangong-lca-cli/
  .env.example
  .nvmrc
  DEV_CN.md
  README.md
  bin/
  dist/
  docs/
  scripts/
  src/
  test/
```

## 详细说明

- [docs/IMPLEMENTATION_GUIDE_CN.md](./docs/IMPLEMENTATION_GUIDE_CN.md)
