---
title: CLI Auth Session Redesign RFC
docType: design
scope: repo
status: historical
authoritative: false
owner: cli
language: zh-CN
whenToUse:
  - when you need historical context for the CLI API-key-to-session redesign
whenToUpdate:
  - only when correcting historical context or explicitly reopening this design record
checkPaths:
  - docs/TEMP_CLI_AUTH_SESSION_REDESIGN_CN.md
  - src/lib/user-api-key.ts
  - src/lib/supabase-session.ts
  - src/lib/supabase-client.ts
lastReviewedAt: 2026-06-02
lastReviewedCommit: 9bdc6e905d93b4bab9bb33972f7eedb5e9a447a6
related:
  - ../AGENTS.md
  - ../.docpact/config.yaml
  - ../DEV_CN.md
  - ./agents/repo-architecture.md
---

# CLI 认证与 Session 临时改造方案

更新时间：2026-04-06

用途：

- 这是一份临时 RFC。
- 在 `tiangong-lca-cli` 正式实现新的认证链之前，这份文件作为后续实现、测试和文档同步的工作底稿。
- 在方案正式落地前，不把这里的内容视为对外稳定 contract。
- 2026-05-13 复核：`dataset references rewrite --commit` 与 `lifecyclemodel save-draft --commit` 继续复用现有用户 session 链，不新增认证 env 或 alternate bearer 模式。

## 1. 已确认事实

### 1.1 `TIANGONG_LCA_API_KEY` 的真实语义

当前 `tiangong-lca-next` 的“Generate API Key”不是生成 Supabase project key，也不是生成 JWT。

现有实现是：

1. 用户在 Account 页面输入当前密码。
2. 前端先用当前邮箱 + 当前密码做一次 `login` 校验。
3. 校验通过后，把 `{ email, password }` 做 `JSON.stringify(...)`。
4. 再对 JSON 字符串执行 `btoa(...)`。
5. 最终得到展示给用户复制的 API Key。

因此，当前 `TIANGONG_LCA_API_KEY` 的实际含义是：

- 用户 API Key
- 可逆
- 本质上是 `base64(JSON{ email, password })`
- 安全级别等同于用户密码本身

### 1.2 Edge Functions 的现有消费方式

当前 `tiangong-lca-edge-functions` 已经支持两类用户认证：

- Supabase JWT：`Authorization: Bearer <access_token>`
- User API Key：`Authorization: Bearer <TIANGONG_LCA_API_KEY>`

其中 User API Key 这条链路会：

1. 对 bearer 值执行 `atob(...)`
2. 解析出 `email/password`
3. 服务端调用 `auth.signInWithPassword(...)`
4. 成功后把请求视为该用户的请求

这条链路已存在并已被前端账户页的“Generate API Key”功能实际依赖。

### 1.3 CLI 当前 direct Supabase 设计的问题

当前 `tiangong-lca-cli` 把同一个 `TIANGONG_LCA_API_KEY` 同时用于：

- `createClient(projectUrl, supabaseKey)` 的 project key
- `Authorization: Bearer ...`
- `apikey: ...`

这与现有系统真实语义不一致。

`TIANGONG_LCA_API_KEY` 不是 Supabase publishable key，也不是 service role key。

## 2. 设计结论

### 2.1 保留 `TIANGONG_LCA_API_KEY` 的输入语义，但不再作为 CLI 的运行时 bearer

`TIANGONG_LCA_API_KEY` 仍表示：

- 前端账户页生成的用户 API Key
- 可逆得到 `email/password`

但在新的 CLI 设计里，它的职责收敛为：

- 本地 bootstrap 凭证
- session 获取 / 重建输入

它不再作为 CLI 的统一运行时 bearer 被直接发送到 Edge Functions 或 direct Supabase。

### 2.2 CLI 内部统一成“一条 session 链”

新的设计目标不是保留两套运行时认证链，而是：

- 所有 authenticated CLI 请求统一先解析用户 session
- 所有 authenticated CLI 请求统一使用 `access_token`

也就是说：

1. `TIANGONG_LCA_API_KEY` 只负责换 session
2. Edge Function 请求使用 `Authorization: Bearer <access_token>`
3. direct Supabase 请求使用 `publishable key + access_token`

服务端是否继续保留 `USER_API_KEY` 兼容能力，不影响 CLI 内部运行时统一成 access token。

### 2.3 所有 authenticated CLI 请求都改成“用户 session 链”

CLI 的正确路径应为：

1. 从 `TIANGONG_LCA_API_KEY` 解出 `email/password`
2. 用 `signInWithPassword(...)` 换取用户 session
3. 从 session 中拿 `access_token` / `refresh_token`
4. Edge Function 请求统一使用 `Authorization: Bearer <access_token>`
5. direct Supabase 请求统一使用 `publishable key + access_token`

### 2.4 应支持 refresh token，但不做后台定时刷新

结论：

- 应支持 refresh token
- 不做后台常驻的“定时刷新线程”
- 采用“本地 session cache + 按需 refresh + 失败时回退 re-login”的 CLI 方案

原因：

- CLI 是短生命周期进程，不是浏览器，也不是常驻 daemon。
- 周期性后台刷新对绝大多数单次命令没有收益。
- direct Supabase 的长耗时命令仍可能跨过 access token 生命周期，因此需要 refresh 支持。
- 频繁重复 `signInWithPassword(...)` 会增加登录请求次数，也会放大限流与稳定性风险。

## 3. 新的 env 设计

### 3.1 对外 env contract

统一保留：

```bash
TIANGONG_LCA_API_BASE_URL=
TIANGONG_LCA_API_KEY=
TIANGONG_LCA_REGION=us-east-1
```

新增 authenticated CLI 专用：

```bash
TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY=
```

新增可选 session cache 控制项：

```bash
TIANGONG_LCA_SESSION_FILE=
TIANGONG_LCA_DISABLE_SESSION_CACHE=false
TIANGONG_LCA_FORCE_REAUTH=false
```

### 3.2 env 语义说明

- `TIANGONG_LCA_API_KEY`
  - 用户 API Key
  - 来源于前端账户页
  - 只作为本地 bootstrap 输入
  - 供 CLI 在本地解码出 `email/password`

- `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`
  - Supabase project publishable key / anon key
  - 供 CLI 获取 / 刷新用户 session
  - 供 direct Supabase 请求使用
  - 在统一 access token 模式下，所有 authenticated CLI 命令都需要它

- `TIANGONG_LCA_SESSION_FILE`
  - 可选
  - 显式指定 session cache 文件位置

- `TIANGONG_LCA_DISABLE_SESSION_CACHE`
  - 可选
  - 设为 `true` 时，禁用本地 session cache
  - direct Supabase 每次都重新走登录

- `TIANGONG_LCA_FORCE_REAUTH`
  - 可选
  - 设为 `true` 时，忽略现有 session cache
  - 强制重新走 `signInWithPassword(...)`

## 4. 命令级认证边界

### 4.1 所有 authenticated 命令

在统一 access token 模式下，这些命令都需要：

- `TIANGONG_LCA_API_BASE_URL`
- `TIANGONG_LCA_API_KEY`
- `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`
- 用户 session/access token（由 CLI 在运行时自动解析）

### 4.2 走 Edge Functions 的 authenticated 命令

这些命令后续不再直接透传 `TIANGONG_LCA_API_KEY`，而是统一使用：

- `Authorization: Bearer <access_token>`

当前典型命令：

- `search flow`
- `search process`
- `search lifecyclemodel`
- `admin embedding-run`

### 4.3 走 direct Supabase 的 authenticated 命令

这些命令继续使用：

- `apikey = publishable key`
- `Authorization = Bearer <access_token>`

当前典型命令：

- `process get`
- `flow get`
- `flow list`
- `flow publish-version`
- `flow publish-reviewed-data --commit`
- `process identity-preflight --remote-candidates`
- `flow identity-preflight --remote-candidates`
- `lifecyclemodel build-resulting-process`（当 request 开启 remote lookup）
- 其他所有 direct Supabase 读写 helper

### 4.4 纯本地命令

纯本地命令保持不变，不需要 session 解析：

- `doctor`
- 本地 build / review / validation / artifact 命令
- 未启用 remote candidate search 的 `process identity-preflight` / `flow identity-preflight`
- 任何不访问 remote 的命令

## 5. Session cache 设计

### 5.1 存储目标

缓存内容只保存 session，不保存明文密码。

建议结构：

```json
{
  "schema_version": 1,
  "supabase_url": "https://<project>.supabase.co",
  "publishable_key_fingerprint": "sha256:...",
  "user_api_key_fingerprint": "sha256:...",
  "user_email": "user@example.com",
  "access_token": "<redacted>",
  "refresh_token": "<redacted>",
  "expires_at": 1700000000,
  "updated_at_utc": "2026-04-06T00:00:00.000Z"
}
```

关键约束：

- 不把解码后的 `password` 落盘
- 用 `user_api_key_fingerprint` 绑定当前 API Key
- 用 `supabase_url` / `publishable_key_fingerprint` 绑定当前 project
- 任何指纹不匹配都视为 cache miss

### 5.2 默认存储路径

优先级建议：

1. `TIANGONG_LCA_SESSION_FILE`
2. `$XDG_STATE_HOME/tiangong-lca-cli/session.json`
3. `~/.local/state/tiangong-lca-cli/session.json`
4. macOS: `~/Library/Application Support/tiangong-lca-cli/session.json`
5. Windows: `%LOCALAPPDATA%/tiangong-lca-cli/session.json`

### 5.3 文件安全要求

- POSIX 下 session 文件权限应收敛到 `0600`
- 父目录权限应为当前用户私有
- 写入必须走临时文件 + 原子 rename
- refresh / rewrite 过程要有单写保护

## 6. Refresh token 策略

### 6.1 设计结论

CLI 应实现 refresh token 支持，但实现方式是：

- 按需刷新
- 非后台定时刷新
- 同进程内复用一份已解析 session

### 6.2 单次命令内的会话解析顺序

direct Supabase 命令启动后，统一调用 `resolveSupabaseUserSession()`：

1. 先看进程内 memoized session
2. 再看磁盘 session cache
3. 如 access token 仍有效且离过期还有安全窗口，则直接使用
4. 如 access token 即将过期或已过期，则尝试 `refreshSession(...)`
5. 如 refresh 失败，则回退到 `signInWithPassword(...)`
6. 如 re-login 也失败，则返回 auth error，提示用户重新生成 API Key 或检查账户状态

建议安全窗口：

- 默认在 `expires_at - 300s` 前就触发 refresh

### 6.3 长耗时命令内的刷新策略

对可能长于 1 小时的 authenticated 任务：

- 在每个分页批次、worker 批次或重试边界前检查一次 `expires_at`
- 如果已经进入安全窗口，则先 refresh，再继续执行

### 6.4 401/鉴权失败重试策略

若 direct Supabase 请求返回：

- JWT expired
- invalid JWT
- 401 / 403 且可判断为 session 失效

则执行：

1. refresh 一次
2. 刷新成功后原请求只重试一次
3. 仍失败则原样报错

禁止：

- 无上限自动重试
- 在 auth failure 上静默循环登录

### 6.5 并发与 refresh token rotation 风险

refresh token 是轮换的。

因此需要显式处理多进程并发风险：

- 两个 CLI 进程不能同时用同一 refresh token 做刷新
- session cache 更新必须加文件锁或等价单写保护
- refresh 成功后必须立刻落盘新的 access/refresh token 对

建议实现：

- `session.json.lock` 锁文件
- refresh / rewrite 只允许一个进程进入
- 其他进程等待锁释放后重新读取 session 文件，而不是继续使用旧 refresh token

## 7. 运行时 client 设计

### 7.1 Auth client

用于登录/刷新 session 的 auth client：

- 使用 `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`
- `persistSession: false`
- `autoRefreshToken: false`
- `detectSessionInUrl: false`

用途：

- `signInWithPassword(...)`
- `refreshSession(...)`

### 7.2 Edge Function client

用于 authenticated Edge Function 调用的 client / request builder：

- 不再直接发送 `TIANGONG_LCA_API_KEY`
- 统一发送 `Authorization: Bearer <access_token>`
- 继续使用 `TIANGONG_LCA_API_BASE_URL`

收益：

- CLI 只维护一种运行时用户身份
- 不再在服务端为 CLI 请求走 `USER_API_KEY -> decode -> signInWithPassword` 分支
- 避免每个请求都传递密码等价物

### 7.3 Data client

用于 direct Supabase 读写的数据 client：

- `createClient(projectUrl, publishableKey, ...)`
- `global.headers.Authorization = Bearer <access_token>`
- `apikey = publishableKey`

注意：

- `TIANGONG_LCA_API_KEY` 不能再直接作为 `createClient(..., key)` 的第二个参数
- `TIANGONG_LCA_API_KEY` 也不能再直接作为 direct Supabase 的 `Authorization`

## 8. CLI 内部模块拆分建议

### 8.1 新增模块

- `src/lib/user-api-key.ts`
  - decode
  - validate
  - fingerprint
  - redact helpers

- `src/lib/supabase-session.ts`
  - session file path resolution
  - load/save cache
  - lock handling
  - sign-in bootstrap
  - refresh helper
  - retry-once auth recovery

### 8.2 重构模块

- `src/lib/supabase-client.ts`
  - 去掉“`TIANGONG_LCA_API_KEY` 直接充当 Supabase key”的实现
  - direct Supabase 只接收 `publishableKey + accessToken`

- `src/lib/env.ts`
  - 新增 `TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY`
  - 新增 session cache 控制项

- `src/lib/remote.ts`
  - 切换到 access token 模式
  - 不再直接透传 `TIANGONG_LCA_API_KEY`

## 9. 分阶段落地计划

### Phase 1：认证底座

- 新增 `user-api-key.ts`
- 新增 `supabase-session.ts`
- 重构 `supabase-client.ts`
- 更新 `doctor` 报告中的 env / auth 诊断

### Phase 2：先切统一 session 解析与 Edge Function 链

- `remote.ts`
- `search flow`
- `search process`
- `search lifecyclemodel`
- `admin embedding-run`

### Phase 3：切 direct Supabase 读路径

- `process get`
- `flow get`
- `flow list`
- `lifecyclemodel build-resulting-process` remote lookup

### Phase 4：切 direct Supabase 写路径

- `flow publish-version`
- `flow publish-reviewed-data --commit`
- `supabase-json-ordered-write` 相关调用方

### Phase 5：补 auth 辅助命令

优先复用当前 planned surface：

- `auth whoami`
- `auth doctor-auth`

建议先不新增 `auth login` 命令，除非后续确认需要显式管理本地 session cache。

## 10. 测试要求

### 10.1 新增测试

- User API Key decode 成功
- 非 base64 key
- 非 JSON key
- 缺 email
- 缺 password
- session cache miss / hit
- access token 仍有效
- access token 即将过期触发 refresh
- refresh token 无效时回退 re-login
- refresh 成功后落盘新 token 对
- 锁竞争下的单写行为

### 10.2 回归测试

- direct Supabase 请求头不再使用 `TIANGONG_LCA_API_KEY` 作为 `apikey`
- direct Supabase 请求头使用 `publishable key + access token`
- Edge Function 请求统一发送 `Bearer <access_token>`
- dry-run 输出中不泄露 email/password/access_token/refresh_token

## 11. 非目标

当前这轮不做：

- 修改前端账户页生成 API Key 的协议
- 修改 Edge Functions 的 User API Key 协议
- 在 CLI 内引入 service role key
- 在 CLI 内做后台常驻 session refresh daemon
- 维持“CLI remote 请求继续直接发送 `TIANGONG_LCA_API_KEY`”这一旧行为
- 在文档正式对外发布前扩散为稳定公开 contract

## 12. 后续正式同步范围

当实现真正落地后，再同步这些正式文件：

- `README.md`
- `DEV_CN.md`
- `docs/IMPLEMENTATION_GUIDE_CN.md`
- `.env.example`
- `src/cli.ts` help text
- `doctor` 输出与测试

在此之前，以本临时文件为实现底稿。
