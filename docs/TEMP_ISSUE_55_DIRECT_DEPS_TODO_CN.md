---
title: Issue 55 Direct Dependencies Historical TODO
docType: plan
scope: repo
status: historical
authoritative: false
owner: cli
language: zh-CN
whenToUse:
  - when you need historical context for the Supabase JS and TIDAS SDK dependency migration
whenToUpdate:
  - only when correcting historical context or recording the final workspace integration state for that old issue
checkPaths:
  - docs/TEMP_ISSUE_55_DIRECT_DEPS_TODO_CN.md
  - package.json
  - src/lib/supabase-client.ts
  - src/lib/tidas-sdk-package-validator.ts
  - test/**
lastReviewedAt: 2026-06-02
lastReviewedCommit: 56757053fca9dc5f4c8120225ee35e2b4cc995ef
related:
  - ../AGENTS.md
  - ../.docpact/config.yaml
  - ./SKILLS_TO_CLI_MIGRATION_CHECKLIST_CN.md
---

# Issue #55 临时执行 TODO

关联记录：

- Parent: `tiangong-lca/workspace#40`
- Child: `tiangong-lca/tiangong-cli#55`

目标：

- 用原生 `@supabase/supabase-js` 替换 CLI 当前自维护的 Supabase REST 读写实现。
- 把 `@tiangong-lca/tidas-sdk` 放入 CLI 显式依赖。
- 连带修复测试、文档、CI 和运行时契约，让最终交付可直接通过质量门。

执行规则：

- 每完成一个实际步骤，就更新这份文件。
- 不把“完成”写在前面，只有真实完成后才勾选。
- 直到 repo 级验证、PR、workspace integration 全部完成，才算结束。

当前状态：

- [x] 建立 tracked records：`workspace#40`、`tiangong-cli#55`
- [x] 将 parent / child Project item 移到 `In Progress`
- [x] 创建 CLI 工作分支 `codex/chore-issue-55-direct-deps`
- [x] 创建本临时 TODO 文件
- [x] 梳理现状并确认 `supabase-js` / `tidas-sdk` 的接入边界与改造面
- [x] 将 `@supabase/supabase-js`、`@tiangong-lca/tidas-sdk` 加入 CLI 依赖并更新 lockfile
- [x] 用 `supabase-js` 重写 CLI 的 Supabase 读写适配层，同时保持现有命令语义与报告字段
- [x] 收敛 `tidas-sdk` 的解析/加载路径，移除不再需要的外部工件兜底逻辑
- [x] 更新测试，补齐因接入方式变化而受影响的 mock / helper / 边缘分支覆盖
- [x] 更新 README、DEV_CN、实现文档和 env / 运行前提说明
- [x] 更新 CI，使其匹配新的依赖模型
- [x] 跑通 `npm run lint`
- [x] 跑通 `npm test`
- [x] 跑通 `npm run test:coverage`
- [x] 跑通 `npm run test:coverage:assert-full`
- [x] 跑通 `npm run prepush:gate`
- [x] 提交 CLI 变更、开 PR，并同步 GitHub 记录
- [ ] 合并 CLI PR 后完成 workspace submodule integration

最近更新：

- 2026-05-13：已复核 dataset / lifecyclemodel governance 命令扩展；新增本地 validation、reference rewrite、save-draft 和 graph 路径继续使用当前 `@supabase/supabase-js` 与 `@tiangong-lca/tidas-sdk` 直接依赖模型，不重开 Issue #55 的直接依赖 TODO。
- 2026-04-01：已提交 `7bd8a93`，推送分支 `codex/chore-issue-55-direct-deps` 到 fork，并创建 PR `tiangong-lca/tiangong-cli#56`；child issue `#55` 的执行 TODO 已同步为完成态，parent / child issue 都已补充结构化进展评论。
- 2026-04-01：`npm run prepush:gate` 已通过，包含 `lint`、`test:coverage`、`test:coverage:assert-full` 全绿；repo-local 质量门已全部满足。
- 2026-04-01：已用 Prettier 修复 `test/tidas-sdk-package-validator.test.ts` 的格式问题，当前准备重跑 `npm run prepush:gate`。
- 2026-04-01：首次执行 `npm run prepush:gate` 失败，阻塞点仅为 `test/tidas-sdk-package-validator.test.ts` 的 Prettier 格式检查；coverage 与 full-coverage assert 已无阻塞，下一步只修格式并重跑整套门禁。
- 2026-04-01：`npm run test:coverage:assert-full` 已通过，CLI 当前正式满足“src 范围 lines / statements / functions / branches 全部 100%”这一硬门禁。
- 2026-04-01：`npm run test:coverage` 已重新跑通，当前 repo 覆盖率达到 `Statements 100% / Branches 100% / Functions 100% / Lines 100%`，`supabase-client.ts` 与 `tidas-sdk-package-validator.ts` 的最后缺口已清零。
- 2026-04-01：已补齐 `runSupabaseMutation()` 中 `status === 0 / code === '' / SyntaxError` 的 invalid JSON 映射分支测试，定向执行 `npm test -- --test test/supabase-client.test.ts` 通过，当前继续冲刺 full coverage 质量门。
- 2026-04-01：新增覆盖率测试后已重新跑通 `npm run lint`，包含 `eslint`、`prettier --check`、coverage ignore guard 与 `tsc --noEmit`，当前没有新增格式、类型或覆盖率豁免问题。
- 2026-04-01：已新增 `supabase-client`、`tidas-sdk-package-validator` 专项测试，并补齐 `flow-read`、`flow-publish-version`、`flow-publish-reviewed-data` 的剩余边缘分支；定向执行 `node --import tsx --test` 覆盖本轮新增/修改测试文件，当前全部通过。
- 2026-04-01：README、`DEV_CN.md`、`docs/IMPLEMENTATION_GUIDE_CN.md`、`.env.example`、CLI help 已统一收口到“原生 `@supabase/supabase-js` + 直接依赖 `@tiangong-lca/tidas-sdk`”这一条当前路径。
- 2026-04-01：repo-local `quality-gate.yml` 已匹配新的依赖模型，不再依赖 `.ci/tidas-sdk`、`TIANGONG_LCA_TIDAS_SDK_DIR` 或其他 sibling checkout 注入。
- 2026-04-01：`npm run lint` 已通过；过程中清理了 `supabase-client` 重构后遗留的 2 个未使用 import，并补齐了相关 TS 文件格式化。
- 2026-04-01：`npm test` 已通过；`flow publish-reviewed-data` 的 process commit failure report 已补齐 transport failure 细节保留逻辑，393/393 用例全绿。
- 2026-04-01：`npm run test:coverage` 首次全量执行时虽已跑通，但当时 `npm run test:coverage:assert-full` 仍失败；后续已通过补测把 `src/lib/supabase-client.ts`、`src/lib/tidas-sdk-package-validator.ts` 与受重构影响的 flow helper 分支全部收敛到 100%。
- 当前已确认事实：
  - `package.json` / `package-lock.json` 已显式包含 `@supabase/supabase-js` 与 `@tiangong-lca/tidas-sdk`。
  - CLI 的 Supabase 读写链已切到 `@supabase/supabase-js`，`process get`、`flow get/list`、`publish`、`flow publish-version` 等路径继续保留既有 `source_url` / `source_urls`、冲突处理和错误码语义。
  - `validation run` 不再尝试 sibling repo / `TIANGONG_LCA_TIDAS_SDK_DIR` / parity dist 兜底，而是直接基于 `@tiangong-lca/tidas-sdk` 已公开导出的 schema 在 CLI 内组装包目录校验器。
  - `flow regen-product`、`flow remediate` 等 `core` 使用方已只解析 `@tiangong-lca/tidas-sdk/core` 这个正式依赖入口。
  - 相关测试夹具已迁入 CLI 仓内，不再从 `../tidas-sdk/test-data` 读取示例文件。
  - 已补跑一轮定向测试：
    - `supabase-rest`
    - `flow-read`
    - `supabase-json-ordered-write`
    - `flow-publish-version`
    - `validation`
    - `flow-regen-product`
    - `flow-remediate`
    - `process-* build`
    - `lifecyclemodel-orchestrate`
  - 上述定向测试当前全部通过。
- 下一阶段：
  - 合并 CLI PR
  - merge 后做 workspace integration
