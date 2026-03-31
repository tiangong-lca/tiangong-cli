# TianGong Skills -> CLI 迁移清单（审计修订版）

这份文档替代上一版“迁移已全部完成”的口径。

当前更准确的判断是：

- `tiangong-lca-cli` 和 `tiangong-lca-skills` 的主运行时路径，已经完全收敛到 TypeScript / Node + `tiangong` CLI
- 仓库治理、开发质量门、公开文档和跨平台验证都已完成闭环
- 因此现在可以把这项工作标记为“已经彻底脱离 Python 和无法跨平台的 shell”

这份文档记录的是：

- 已经确认完成的部分
- 最终验收证据
- 一份已经按顺序清完并可回溯的整改 TODO

## 1. 审计后现状

### 1.1 已确认成立

- [x] `tiangong-lca-cli` 的稳定入口是 Node：`bin/tiangong.js` -> `dist/src/main.js`
- [x] `tiangong-lca-skills` 当前保留的 wrapper 入口都是原生 Node `.mjs`
- [x] skills wrapper 当前的 canonical 路径是 `wrapper -> tiangong`
- [x] 两个仓库当前没有现存的 `.py` 或 `.sh` 运行时文件
- [x] 业务 Python runtime、shell shim、MCP transport 已不再是主执行路径
- [x] `tiangong-lca-cli` 已把 `.env.example`、README、`DEV_CN.md` 收敛成 public / optional / internal-preparatory 三层 env 说明
- [x] `tiangong-lca-cli` 的本地 coverage 路径已改成 Node-only 脚本，不再依赖 POSIX 风格内联 env 赋值
- [x] `tiangong-lca-cli` 已增加 coverage-ignore 守卫，并明确禁止用 ignore pragma 逃避测试覆盖

### 1.2 已完成闭环

- [x] `tiangong-lca-cli` 的质量门脚本现已做到真正跨平台
- [x] CLI 和 skills 的公开文档不再默认读者处在 Unix / POSIX shell 环境
- [x] `tiangong-lca-skills` 的治理文档不再保留 Python 初始化流程残影
- [x] 参考文档和兼容层里只剩明确标注的 historical Python 提示，不再把 legacy 字段或脚本名当作当前路径
- [x] “测试全绿 + 100% 覆盖率” 已形成跨平台、可自动验证的统一门禁
- [x] 现在已有足够的跨平台 CI 证据来支撑“完全脱离”的结论

## 2. “完全脱离” 的完成定义

只有下面全部满足，才可以把这项工作改回完成态：

- [x] 两个仓库都不再要求 Python 作为运行时、脚手架或维护工具前提
- [x] `npm` / `node` 的核心质量门命令在 macOS、Linux、Windows 上都可直接运行
- [x] `.env.example`、README、`DEV_CN.md` 与真实公开 env contract 完全一致，并明确区分 required / optional / internal-only
- [x] 默认文档不再把 `bash` / `cp` / `/tmp` / `nvm` 作为唯一可用路径
- [x] skills 的治理与校验流程不再要求或暗示 Python 初始化器
- [x] 公开 contract 和示例不再把 Python legacy 字段写成“当前输入面的一部分”
- [x] CLI 和 skills 不兼容任何 legacy Python 输入面；不保留 Python fallback、兼容别名、兼容归一化层或“先读进来再拒绝”的兼容解析
- [x] 仓库不允许通过 `c8 ignore`、`istanbul ignore` 或同类 pragma 跳过未覆盖分支；边缘分支必须用测试覆盖
- [x] `npm test`、`npm run test:coverage`、`npm run test:coverage:assert-full`、`npm run prepush:gate` 形成统一的本地与 CI 门禁，并以 100% 覆盖率为硬要求
- [x] 有 CI 或等价自动化证据证明 CLI 与 skills wrapper 至少在 Linux + Windows 上可执行
- [x] 现在文档可以重新使用“迁移已全部完成”或“已经彻底脱离”这类表述

## 3. 推荐执行顺序

按下面顺序做，返工最少：

1. 先修 `tiangong-lca-cli` 的跨平台质量门脚本
2. 再补 CLI / skills 的跨平台 CI
3. 然后修公开文档里的 Unix-only 指令
4. 再清 skills 治理文档和参考文档里的 Python 残留
5. 最后移除 CLI 里的 legacy Python 兼容面
6. 重新跑一次审计扫描和 smoke test

## 4. 可执行 TODO

### Phase 1：修复 CLI 的跨平台质量门

当前状态：已完成；本地与远端跨平台质量门都已闭环。

- [x] 补全 `.env.example`，并让它和真实 env contract 对齐当前阻塞：`.env.example` 只列出了 API / LLM 变量，但代码里还存在 `TIANGONG_LCA_KB_SEARCH_*`、`TIANGONG_LCA_UNSTRUCTURED_*` 等 env 面处理目标：先按“公开命令实际消费”与“内部预备模块保留”做分类，再决定哪些 env 必须进入 `.env.example`，哪些应进入单独的 advanced/internal 文档最低要求：不能继续出现“代码里真实使用，但 `.env.example` 和 README / DEV 完全看不见”的 env 涉及文件：`tiangong-lca-cli/.env.example` 涉及文件：`tiangong-lca-cli/README.md` 涉及文件：`tiangong-lca-cli/DEV_CN.md` 涉及文件：`tiangong-lca-cli/src/lib/env.ts` 涉及文件：`tiangong-lca-cli/src/lib/llm.ts` 涉及文件：`tiangong-lca-cli/src/lib/kb-search.ts` 涉及文件：`tiangong-lca-cli/src/lib/unstructured.ts` 验收标准：一个维护者只看 `.env.example` 和 README / DEV，就能知道当前公开支持的 env、可选 env，以及哪些 env 只是内部预备面已完成：`.env.example`、README、`DEV_CN.md` 已补上 public / optional / internal-preparatory 的明确分层

- [x] 把 `test:coverage` 从内联环境变量赋值改成跨平台实现当前阻塞：`package.json` 里使用 `TIANGONG_LCA_COVERAGE=1 c8 ...` 推荐做法：新增一个 Node 自己的启动脚本，在脚本里设置 env 后再调用测试进程；不要默认引入新 npm 依赖涉及文件：`tiangong-lca-cli/package.json` 涉及文件：`tiangong-lca-cli/scripts/*` 验收标准：`npm run test:coverage` 在 Windows `cmd` / PowerShell 下也能直接通过已完成：`package.json` 已改成 `node ./scripts/run-test-coverage.cjs`，本地 coverage 和 100% 断言已通过

- [x] 明确禁止用 `c8 ignore` / `istanbul ignore` 一类 pragma 绕过覆盖率当前状态：这轮扫描没有发现现存 ignore pragma，但仓库还没有把这条规则固化成文档门禁和自动检查处理目标：把“边缘情况必须在 test 里覆盖，而不是靠 coverage ignore 跳过”写成明确规则，并在需要时加一个扫描脚本或 lint 检查涉及文件：`tiangong-lca-cli/AGENTS.md` 涉及文件：`tiangong-lca-cli/README.md` 涉及文件：`tiangong-lca-cli/DEV_CN.md` 涉及文件：`tiangong-lca-cli/package.json` 涉及文件：`tiangong-lca-cli/scripts/*` 验收标准：仓库规则明确禁止 coverage ignore；若有人新增 ignore pragma，会在本地或 CI 直接失败已完成：已新增 `scripts/assert-no-coverage-ignore.cjs`，并接入 `npm run lint`

- [x] 确认 `prepush:gate` 只依赖跨平台命令当前要求：`prepush:gate` 依赖 `test:coverage` 处理目标：`npm run prepush:gate` 不再因为 shell 语法差异在 Windows 失败涉及文件：`tiangong-lca-cli/package.json` 验收标准：`npm run prepush:gate` 在至少 Linux + Windows 两个平台上跑通已完成：本地门禁链条已全部转成 `npm` / `node` / `tsx` 路径；Windows 真实验证留给 Phase 6 的 OS matrix

- [x] 把“测试全绿 + 100% 覆盖率” 固化为唯一通过门槛当前状态：本地文档和 `prepush:gate` 已经表达了这个方向，但还没有在跨平台 CI 里形成稳定、可见、不可绕过的统一门禁处理目标：明确以下四个命令的角色并接入门禁： `npm test` `npm run test:coverage` `npm run test:coverage:assert-full` `npm run prepush:gate` 要求：所有测试必须通过，且 `src/**/*.ts` 维持 lines / statements / functions / branches 全部 100% 涉及文件：`tiangong-lca-cli/package.json` 涉及文件：`tiangong-lca-cli/AGENTS.md` 涉及文件：`tiangong-lca-cli/README.md` 涉及文件：`tiangong-lca-cli/DEV_CN.md` 涉及文件：`tiangong-lca-cli/scripts/assert-full-coverage.ts` 验收标准：本地与 CI 都以“测试全绿 + 严格 100% 覆盖率”作为硬门禁，不存在只跑部分测试或只看松散 coverage summary 的路径已完成：本地 `npm test`、`npm run test:coverage`、`npm run test:coverage:assert-full`、`npm run prepush:gate` 均已通过；coverage 断言现只聚焦 CLI 自有 `src` 文件集合；在本地按 CI 方式 checkout/build `.ci/tidas-sdk` 后再次执行 `TIANGONG_LCA_TIDAS_SDK_DIR=$PWD/.ci/tidas-sdk npm run test:coverage`、`npm run test:coverage:assert-full`、`npm run prepush:gate` 保持 100% 覆盖率；follow-up PR `tiangong-lca/tiangong-cli#53` 的 `ubuntu-latest` + `windows-latest` matrix 已双绿并合并

- [x] 为覆盖率质量门补一个最小的 Windows 回归验证处理目标：避免后续有人把 POSIX-only 语法重新加回 `package.json` 涉及文件：`tiangong-lca-cli/.github/workflows/*` 或等价 CI 所在位置验收标准：CI 中存在明确的 Windows 任务覆盖 `npm run test:coverage` 已完成：repo-local workflow 已在 `windows-latest` 上显式运行 `npm run test:coverage`、`npm run test:coverage:assert-full` 和 `npm run prepush:gate`，并已随 PR `#53` 远端通过

### Phase 2：补齐 CLI 的跨平台文档

- [x] 重写 `README.md` 的 Quick start 当前阻塞：文档默认使用 `curl ... | bash`、`nvm`、`cp .env.example .env` 处理目标：把“Node 24 安装”和“.env 初始化”改成跨平台表述，而不是只给 bash 命令涉及文件：`tiangong-lca-cli/README.md` 验收标准：一个 Windows 用户不需要自行翻译 shell 命令，也能按文档完成安装并执行 `node ./bin/tiangong.js --help` 已完成：README 已改成“任意平台可用的 Node 24 安装方式 + `npm ci` + `npm run build` + 用编辑器/文件管理器复制 `.env.example`”的主路径，并去掉了 `curl|bash` / `nvm` / `cp` 作为默认入口

- [x] 重写 `DEV_CN.md` 的安装与初始化段落当前阻塞：开发文档同样默认使用 `bash`、`nvm`、`cp` 处理目标：给出平台中立写法，必要时补 macOS/Linux 和 Windows 两组示例涉及文件：`tiangong-lca-cli/DEV_CN.md` 验收标准：文档中不再把 POSIX shell 命令当作唯一入口已完成：`DEV_CN.md` 已改成平台中立的 Node 24 前提说明，并明确 `.env` 初始化不要求 shell 命令翻译

- [x] 统一公开推荐的执行方式处理目标：明确推荐哪几个入口是跨平台稳定入口，例如： `npm exec tiangong -- ...` `node ./bin/tiangong.js ...` `node ./dist/src/main.js ...` 涉及文件：`tiangong-lca-cli/README.md` 涉及文件：`tiangong-lca-cli/DEV_CN.md` 验收标准：README 与开发文档对稳定入口的说法一致已完成：README 与 `DEV_CN.md` 都把 `npm exec tiangong -- ...`、`node ./bin/tiangong.js ...`、`node ./dist/src/main.js ...` 收口为主入口；`npm start -- ...` 降级为开发便利脚本

### Phase 3：清理 skills 仓库里的 Python 治理残留

- [x] 移除 `AGENTS.md` 中对 `init_skill.py` 的依赖性表述当前阻塞：治理文档仍要求“新 skill 优先使用 `init_skill.py` 初始化目录与模板”，但仓库里并不存在这个文件处理目标：改成基于 `skill-creator` 的流程，或改成仓库内真实存在的模板 / 脚本流程涉及文件：`tiangong-lca-skills/AGENTS.md` 验收标准：skills 作者不再需要假设 Python 初始化脚本存在已完成：`AGENTS.md` 已改成 `skill-creator` + 手工目录模板流程，不再要求任何 Python 初始化器

- [x] 扩充 `validate-skills.mjs` 的文档守卫当前已有守卫：`quick_validate.py`、`run_lifecyclemodel_review.py` 处理目标：补上对 `init_skill.py` 这类明确失效引用的检查注意：不要粗暴禁止所有 `python_bin` 字样；“已移除 legacy 字段”的说明可以保留涉及文件：`tiangong-lca-skills/scripts/validate-skills.mjs` 验收标准：新的失效 Python 引用会被校验脚本直接拦住已完成：`validate-skills.mjs` 已补 `AGENTS.md` / README / assets / historical-doc 守卫，并允许保留明确的 removed-legacy 说明

- [x] 重新跑一遍 skills 校验并固定为必过门槛命令：`node scripts/validate-skills.mjs` 涉及文件：`tiangong-lca-skills/scripts/validate-skills.mjs` 验收标准：修完治理文档后，skills 仓库能无告警通过校验已完成：本地执行 `node scripts/validate-skills.mjs` 已通过，结果为 `Validated 11 skill directories, 11 wrapper scripts, 1 targeted smokes, and 16 doc guards.`

### Phase 4：清理 skills 参考文档里的 Python / POSIX 公开残留

- [x] 清理或重写还把 Python 工具写成当前路径的参考文档已知例子：`lifecyclemodel-automated-builder/references/source-analysis.md` 里仍写有 `validate.py` 处理目标：如果只是历史背景，就显式标为“上游历史实现”；如果是当前指引，就改成当前 CLI / SDK 路径涉及文件：`tiangong-lca-skills/lifecyclemodel-automated-builder/references/source-analysis.md` 验收标准：用户不会把这类文档理解成“现在仍要回到 Python 工具链”已完成：文档已把 `validate.py` 改成显式 historical note，并强调当前执行路径仍是 CLI / SDK

- [x] 检查所有 user-facing 示例里的 Unix 临时路径已知例子：`/tmp/...`、`file:///tmp/...` 处理目标：公开示例尽量改成平台中立占位符，如 `<temp-dir>` 或 `<workspace-temp-dir>` 说明：测试代码里的 `/tmp` 字面量可以保留；只修用户会照抄的示例和文档涉及文件：`tiangong-lca-skills/**/assets/*` 涉及文件：`tiangong-lca-skills/README.md` 涉及文件：`tiangong-lca-skills/README.zh-CN.md` 验收标准：公开文档和样例不再暗示只有 Unix 才能运行已完成：README / README.zh-CN 的全局安装路径已改成平台解析说明，公开示例中的 `/tmp` / `file:///tmp` 已换成 `<workspace-temp-dir>` 占位符

- [x] 保留“legacy 已移除”的说明，但压缩到明确的历史兼容段处理目标：像 `python_bin`、`langgraph` 这类内容，只在“已移除字段”一节出现，不在主路径说明中反复出现涉及文件：`tiangong-lca-skills/**/*` 验收标准：读者先看到的是当前 Node / CLI 路径，而不是历史 Python 路径已完成：仓库扫描后，这类词只剩在 `lifecyclemodel-recursive-orchestrator` 的 removed-legacy guardrail 段落中出现，不再占据主路径说明

### Phase 5：移除 CLI 中的 legacy Python 兼容面

- [x] 盘点 CLI 中所有 `python_bin` / `langgraph` 相关类型、解析、测试和文档当前状态：CLI 仍会显式拒绝这些 legacy 字段，但类型与解析层仍把它们读进来涉及文件：`tiangong-lca-cli/src/lib/lifecyclemodel-orchestrate.ts` 涉及文件：`tiangong-lca-cli/test/lifecyclemodel-orchestrate.test.ts` 涉及文件：`tiangong-lca-cli/README.md` 涉及文件：`tiangong-lca-cli/DEV_CN.md` 涉及文件：`tiangong-lca-cli/docs/IMPLEMENTATION_GUIDE_CN.md` 验收标准：所有 `python_bin` / `langgraph` 命中点都被分类到“必须删除的 runtime 兼容面”或“可保留的历史说明”已完成：相关命中点已盘清，并全部转入删除路径；主源码、测试和三份主文档中的显式命中已清零

- [x] 从 runtime、类型和解析层彻底删除 legacy Python 输入面处理目标：删除 `python_bin`、`mode=langgraph` 等 legacy Python 相关字段的类型定义、解析逻辑、兼容归一化和对应测试输入处理原则：不做兼容、不做转换、不做“先解析再报错”的保留层允许保留：仅允许在历史迁移说明中提到“这些字段已被移除”涉及文件：同上验收标准：新的调用方无法再通过当前 request schema 传入 legacy Python 字段；代码里也不再为它们保留专门解析路径已完成：`lifecyclemodel-orchestrate` 的 `process_builder` 已收窄到 CLI-native 字段集合，并在归一化阶段用通用 unsupported-field 校验拒绝额外键；源码里不再保留 legacy Python 专用解析/执行分支

- [x] 收敛“已移除 Python fallback”的公开表述处理目标：README、DEV、实现指南统一使用一套说法，例如：“legacy Python 输入面已删除；当前受支持路径只有 CLI-native Node runtime”涉及文件：`tiangong-lca-cli/README.md` 涉及文件：`tiangong-lca-cli/DEV_CN.md` 涉及文件：`tiangong-lca-cli/docs/IMPLEMENTATION_GUIDE_CN.md` 验收标准：三份文档不再出现互相矛盾或层级不同的表述已完成：README、`DEV_CN.md`、实现指南都统一改成“`process_builder` 只接受 CLI-native 本地构建字段，额外 builder 控制项在归一化阶段直接拒绝”

### Phase 6：补齐跨平台 CI 证据

- [x] 明确 `tiangong-lca-cli` 的 CI 归属当前状态：仓库里没有可见的 repo-local `.github/workflows` 需要先回答：CI 是应该在子仓库内维护，还是在别处统一维护验收标准：这个归属必须写清楚，不能继续处于“默认存在但仓库里看不到”的状态已完成：已在 `tiangong-lca-cli/.github/workflows/quality-gate.yml` 中建立 repo-local 质量门，CLI 的跨平台门禁归属已回到子仓库内可见维护

- [x] 为 `tiangong-lca-cli` 增加或接入 OS matrix 验证最低要求：`ubuntu-latest` + `windows-latest` 推荐要求：`ubuntu-latest` + `windows-latest` + `macos-latest` 最少命令：`npm ci`、`npm run build`、`npm run lint`、`npm test` 必做命令：`npm run test:coverage`、`npm run test:coverage:assert-full` 推荐命令：`npm run prepush:gate` 验收标准：有自动化记录证明 CLI 至少在 Linux + Windows 上通过，并且 100% 覆盖率门在 CI 中真实执行已完成：workflow 已配置 `ubuntu-latest` + `windows-latest` matrix，并补上 CI 内显式 checkout/build `tidas-sdk` 与 `TIANGONG_LCA_TIDAS_SDK_DIR` 注入；本地修复了 coverage summary、路径断言、URL/正则和锁文件边缘测试里的全部 Windows-only 假设；最终 follow-up PR `tiangong-lca/tiangong-cli#53` 已在 `ubuntu-latest` + `windows-latest` 上双绿并合并，CLI 的跨平台自动化证据现已成立

- [x] 扩展 `tiangong-lca-skills` 的 `validate-skills` workflow 为 OS matrix 当前状态：只在 `ubuntu-latest` 运行处理目标：至少补 Windows，证明 wrapper + CLI 委托链在 Windows 上成立涉及文件：`tiangong-lca-skills/.github/workflows/validate-skills.yml` 验收标准：`node scripts/validate-skills.mjs` 在 Linux + Windows 上通过当前进展：workflow 已改成 `ubuntu-latest` + `windows-latest` matrix，并补上 CRLF 兼容的 frontmatter 校验；2026-03-31 已再次本地执行 `node scripts/validate-skills.mjs` 通过，并已随 commit `5fbe073` 推送到 PR `tiangong-lca/skills#39`；失败原因、修复内容和复验结果也已补充记录到 PR 评论；远端 run `23807639148` 已确认 `ubuntu-latest` + `windows-latest` 双绿

### Phase 7：最终审计与关账

- [x] 重新跑代码扫描推荐扫描项： `rg --files -g '*.py' -g '*.sh'` `rg -n 'init_skill\\.py|quick_validate\\.py|run_lifecyclemodel_review\\.py|validate\\.py'` `rg -n 'curl -o-|install\\.sh \\| bash|cp \\.env\\.example \\.env|TIANGONG_LCA_COVERAGE=1'` 验收标准：结果只剩明确允许的历史说明，且不再出现在主路径文档和质量门里已完成：`tiangong-lca-cli` 与 `tiangong-lca-skills` 均未再发现运行时 `.py` / `.sh` 文件；命中项只剩 checklist 自身的历史整改记录，以及 `tiangong-lca-skills/lifecyclemodel-automated-builder/references/source-analysis.md` 中明确标注为 historical upstream note 的 `validate.py` 背景说明

- [x] 重新跑最小 smoke test 推荐命令： `node ./bin/tiangong.js --help` `node ./bin/tiangong.js doctor --json` `node ./scripts/validate-skills.mjs --help` 以及至少两个 representative wrapper 的 `--help` 验收标准：所有入口都只经过 Node / CLI 路径，不再依赖 Python 或 shell shim已完成：`node ./bin/tiangong.js --help`、`node ./bin/tiangong.js doctor --json`、`node ./scripts/validate-skills.mjs --help`、`node ./process-automated-builder/scripts/run-process-automated-builder.mjs --help`、`node ./lifecyclemodel-recursive-orchestrator/scripts/run-lifecyclemodel-recursive-orchestrator.mjs --help` 均已执行，入口链路只经过 Node / CLI

- [x] 只有在所有验收项完成后，再更新迁移结论处理目标：把“基本完成”改回“完全脱离”验收标准：这一步必须是最后一步，不能提前写结论已完成：现在可以重新使用“迁移已全部完成”与“已经彻底脱离 Python 和无法跨平台 shell”这类表述

## 5. 文件级工作面

### 5.1 `tiangong-lca-cli`

- [x] `package.json`
- [x] `.env.example`
- [x] `README.md`
- [x] `DEV_CN.md`
- [x] `docs/IMPLEMENTATION_GUIDE_CN.md`
- [x] `src/lib/lifecyclemodel-orchestrate.ts`
- [x] `src/lib/env.ts`
- [x] `src/lib/llm.ts`
- [x] `src/lib/kb-search.ts`
- [x] `src/lib/unstructured.ts`
- [x] `test/lifecyclemodel-orchestrate.test.ts`
- [x] `scripts/*` 中新增跨平台辅助脚本（如需要）
- [x] `.github/workflows/*` 或等价 CI 位置（如由该仓库维护）

### 5.2 `tiangong-lca-skills`

- [x] `AGENTS.md`
- [x] `README.md`
- [x] `README.zh-CN.md`
- [x] `scripts/validate-skills.mjs`
- [x] `lifecyclemodel-automated-builder/references/source-analysis.md`
- [x] 各 skill `assets/` 下的 user-facing 示例文件
- [x] `.github/workflows/validate-skills.yml`

## 6. 已经做完但不应回退的项

下面这些已经是完成态，不应该在整改过程中倒退：

- [x] skills wrapper 继续保持 Node `.mjs`
- [x] skills wrapper 继续保持薄调用，不回到私有 transport / CRUD / env parsing
- [x] CLI 继续保持统一命令树，不回到多套 skill 私有 runtime
- [x] 新能力仍然必须优先落成原生 `tiangong <noun> <verb>` 命令
- [x] 不为了解决跨平台问题重新引入 shell shim
- [x] 不为了解决文档问题重新引入 Python fallback

## 7. 一句话标准

只问这一句：

> 一个 agent 要完成工作时，是否只需要知道 `tiangong` 命令树，并且在 macOS / Linux / Windows 上都能按文档和质量门执行，而不需要知道 skills 内部的 Python、MCP、shell 兼容层细节？

当前答案已经是“是”。
