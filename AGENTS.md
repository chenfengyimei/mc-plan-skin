# MC Plan Skin Agent Guide

Skin 拥有创作对话、渲染任务、临时候选、皮肤验证、模型适配器和 Official/Standalone 行为。

任何写操作前必须使用 `$mc-plan-development`，确认 Skin 是活动工作流的唯一主仓库或可写辅助仓库，并从工作区根目录运行协调预检。没有 Tracking ID、活动记录或通过的预检时不得编辑。

工作前阅读 Foundation 的 Skin 设计、数据流、隐私规则、额度规则与相关 ADR，再阅读本仓库局部架构和锁定的 Skin/Community/Core 契约。

不可保存用户主档、全局积分、社区互动或平台密码。Standalone 的核心生成与下载不能依赖私有源码。Official 与 Standalone 必须保持同一代码库，不允许复制分叉。

公共接口或 Schema 先改 Contracts。阶段拆分与辅助组合以 `docs/development-plan.md` 为准。

## 当前授权与边界

依据 Foundation ADR-0009（`MCP-F1-FOUNDATION-004` 登记），本仓库当前处于 F1 中受限的 Standalone 准备方向：允许工程骨架与不依赖 Core、Community、Keycloak 的最小纵向链路；不得绑定正式 AI 厂商、3D 预览库，不得实现 Official 登录、额度、积分或自动发布。公共契约缺口先记录，再顺序开 Contracts 主仓库工作流。

## 真实验收命令

以下命令必须真实存在且通过；禁止用文档中的其他命令名替代（standard：`testing.md`）。

```powershell
# 全量校验（不含 Docker 集成与浏览器冒烟）
pnpm install
pnpm check

# 完整校验（需要 Docker Desktop 运行；首次还需 npx playwright install chromium）
pnpm check:full
```

`pnpm check` 依次运行：`format:check` → `build`（全部包先构建）→ `lint` → `typecheck` → `test:unit` → `contract:check` → `fixtures:validate`。
`pnpm check:full` 追加：`test:integration`（testcontainers PostgreSQL + Redis）→ `test:e2e`（Playwright 冒烟，真实启动 PostgreSQL 容器、API dist 与 Web）。

单项命令（在工作区根目录）：

```powershell
pnpm lint                  # ESLint（typescript-eslint + next 插件）
pnpm format:check          # Prettier
pnpm typecheck             # 所有包 tsc --noEmit（严格模式）
pnpm test:unit             # Vitest 单元测试
pnpm test:integration      # Vitest + testcontainers（真实 PostgreSQL/Redis）
pnpm test:e2e              # Playwright 冒烟（e2e/smoke.spec.ts）
pnpm build                 # 全部 apps 与 packages 构建（pnpm workspace 拓扑序）
pnpm contract:check        # 契约一致性：从 mc-plan-contracts 重新生成并比对
pnpm contract:gen          # 从已发布契约重新生成客户端类型
pnpm fixtures:build        # 重新生成 Minecraft 皮肤 fixture（含 manifest）
pnpm fixtures:validate     # 用 skin-validator 校验全部 fixture 的预期行为
pnpm prisma:validate       # Prisma schema 校验
pnpm migration:validate    # schema 校验 + 迁移目录完整性
```

注意事项：

- 集成与 e2e 测试需要 Docker（testcontainers、Playwright globalSetup 启动真实容器）。
- API 的 e2e/集成测试针对编译后的 `apps/api/dist` 运行；修改源码后先 `pnpm --filter @mc-plan/skin-api build`。
- Nest 12 的 `NestFactory.create` 不再自动初始化：独立引导时必须显式 `await app.init()` 或 `listen()`。
- Fixture 与契约生成物是提交内容：修改后运行 `pnpm fixtures:build` / `pnpm contract:gen` 并提交。
