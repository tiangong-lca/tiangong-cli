# 项目配置

本项目是 TianGong 的统一 CLI 仓库，运行时基线固定为 Node 24，源码使用 TypeScript，但运行时执行 `dist/` 下的构建产物。

设计原则：

- 统一入口：所有 TianGong 平台能力最终收敛到 `tiangong` 一个命令树
- 原生优先：优先使用 Node 24 原生能力，不默认引入高级包
- 直连 REST：不再以内置 MCP 作为 CLI 传输层
- 文件优先：输入优先走 JSON / JSONL / 本地文件，输出优先走结构化 JSON

当前已落地的命令：

- `tiangong doctor`
- `tiangong search flow`
- `tiangong search process`
- `tiangong search lifecyclemodel`
- `tiangong process auto-build`
- `tiangong lifecyclemodel build-resulting-process`
- `tiangong lifecyclemodel publish-resulting-process`
- `tiangong publish run`
- `tiangong validation run`
- `tiangong admin embedding-run`

## 安装依赖

参考 `tiangong-lca-next/DEV_CN.md`，本项目初始化命令保持一致：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

nvm install
nvm alias default 24
nvm use

npm install

npm update && npm ci
```

## 配置文件

本项目会自动加载仓库根目录下的 `.env` 文件。

初始化：

```bash
cp .env.example .env
```

当前统一 CLI 真正需要的环境变量只有这一组：

```bash
TIANGONG_LCA_API_BASE_URL=
TIANGONG_LCA_API_KEY=
TIANGONG_LCA_REGION=us-east-1
```

不再兼容旧变量名，也不再把 KB、MinerU、OpenAI、MCP 相关 env 预先塞进统一 CLI。

原因很直接：

- 当前 CLI 已实现命令只直连 TianGong LCA 的 REST / Edge Functions
- `publish run` / `validation run` 只做本地契约和执行收口，不新增远程 env
- 知识库、OCR、LLM、远程 MCP 连接目前仍属于 `tiangong-lca-skills` 或 Python workflow 层
- 若未来 CLI 真正落地对应子命令，再按命令面新增 env，而不是提前暴露一整组无实际消费者的配置

## 调试项目

```bash
npm start -- --help
npm start -- doctor
npm start -- doctor --json
npm start -- search flow --input ./request.json --dry-run
npm start -- process auto-build --input ./pff-request.json --json
npm start -- lifecyclemodel build-resulting-process --input ./request.json --json
npm start -- lifecyclemodel publish-resulting-process --run-dir ./runs/example --publish-processes --publish-relations --json
npm start -- publish run --input ./publish-request.json --dry-run
npm start -- validation run --input-dir ./tidas-package --engine auto
npm start -- admin embedding-run --input ./jobs.json --dry-run
```

## process / publish / validation 边界

`tiangong process auto-build` 现在已经承担 `process_from_flow` 主链的第一个 CLI 切片，负责：

- 读取单个 process-from-flow request
- 解析 `flow_file` 指向的 ILCD flow JSON
- 生成兼容旧工作流的 `run_id`
- 创建本地 `artifacts/process_from_flow/<run_id>/` 运行骨架
- 预写 `cache/process_from_flow_state.json`
- 预写 `cache/agent_handoff_summary.json`
- 产出 request / flow / assembly / lineage / invocation / run manifest / report

这个命令当前只负责本地 intake 与 scaffold，不负责继续执行后续工作流阶段。

也就是说，下面这些还没有迁完：

- `tiangong process resume-build`
- `tiangong process publish-build`
- `tiangong process batch-build`

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

- `--engine auto`：优先使用本地 `tidas-sdk` parity validator，找不到时回退到 `uv run tidas-validate --format json`
- `--engine sdk`：只跑 `tidas-sdk`
- `--engine tools`：只跑 `tidas-tools`
- `--engine all`：两边都跑，并给出结构化 comparison

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

- `npm run lint` 会执行 `eslint`、deprecated API 检查、`prettier --check` 和 `tsc`
- `npm run prettier` 用于实际改写格式
- `npm test` 包含普通单元测试和 `bin` / 入口 smoke test
- `npm run test:coverage` 对 `src/**/*.ts` 执行 100% 覆盖率门
- `npm run prepush:gate` 是提交前的完整质量门

## 构建项目

当前 `build` 会把 CLI 源码编译到 `dist/`：

```bash
npm run build
```

## 可执行入口

仓库内有两个稳定入口：

- `npm start -- ...`
- `node ./bin/tiangong.js ...`
- `node ./dist/src/main.js ...`

其中：

- `npm start -- ...` 会先构建再运行
- `node ./bin/tiangong.js ...` 会加载 `dist/src/main.js`
- `package.json` 也声明了 `bin.tiangong`，所以在本仓库内可直接通过 `npm exec tiangong -- ...` 调用

## 与 skills 的联动约定

`tiangong-lca-skills` 后续不再各自维护独立 HTTP/MCP 入口，而是逐步收敛到这个 CLI。

当前建议：

- 轻量远程 skill 直接调用 `tiangong search ...` 或 `tiangong admin ...`
- `process-automated-builder` 已先迁入 `tiangong process auto-build` 本地 scaffold；剩余阶段继续按子命令切片迁移
- 其余重型 workflow 先保留原执行器，但由 `tiangong` 统一调度
- 所有新脚本优先使用统一环境变量名，不再扩散旧变量名

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
