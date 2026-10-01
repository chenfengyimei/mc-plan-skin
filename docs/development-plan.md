# Skin 开发计划

状态：Active（受限准备方向）

当前里程碑：F3 Skin 纵向链路；开始条件是正式提供商基准 ADR，以及 Core、Community 所需预发布契约可用。

提前准备：依据 Foundation ADR-0009（`MCP-F1-FOUNDATION-004` 登记），F1 期间允许受限的 Standalone 准备方向——工程骨架（`MCP-F1-SKIN-001`，已完成）与不依赖 Core、Community、Keycloak 的最小纵向链路（`MCP-F1-SKIN-002` 及后续）。本提前准备不改变 F3 的开始条件，不绑定正式厂商、3D 库，不实现 Official 集成。

## 固定顺序

1. 用有效皮肤率、编辑一致性、延迟、成本、地区和数据条款完成提供商基准与 ADR。
2. 初始化同一代码库的 Next.js/NestJS、PostgreSQL/Prisma、Redis/BullMQ、对象存储适配器和测试基线。
3. 先完成 Standalone 纵向链路：对话 → 适配器 → 渲染任务 → 候选隔离存储 → 64×64 校验 → 预览与下载。
4. 完成三次渲染限制、重试/取消/退款语义、30 天对话和 24 小时候选真实清理。
5. 单独建立 Official/Core 工作流，实现登录、验证状态、年龄门槛、每日权益和积分消费。
6. 单独建立 Community 发布工作流，实现用户授权、上传、审核、确认后自动公开和发布结果。
7. 完成双模式端到端、契约、失败恢复、自部署和隐私行为验收。

## 契约与辅助组合

- Standalone 核心：Skin 为主，Contracts 可作辅助；Core、Community 和 Keycloak 必须可完全缺失。
- Official 权益阶段：Skin 为主，Contracts + Core 为两个辅助仓库。
- Community 发布阶段：Skin 为主，Contracts + Community 为两个辅助仓库。
- 两个集成阶段不得合成同时写 Core 与 Community 的四仓工作流。
- Ops 只在镜像和健康检查真实存在后进入独立部署工作流。

## 验收命令

工程骨架已建立（`MCP-F1-SKIN-001`），以下命令真实存在且已实际运行通过；双模式启动与保留清理测试命令在对应工作流交付时补充。

```powershell
pnpm install               # 依赖安装（pnpm@11.19.0，Node >=24.15）
pnpm format:check           # Prettier
pnpm lint                   # ESLint
pnpm typecheck              # 全部包 tsc --noEmit（严格模式）
pnpm build                  # 全部 apps 与 packages 构建
pnpm test:unit              # Vitest 单元测试
pnpm contract:check         # 契约一致性（从已发布 0.1.0-draft 重新生成并比对）
pnpm fixtures:validate      # Minecraft 皮肤 fixture 校验（有效/无效样本判别）
pnpm test:integration       # testcontainers：真实 PostgreSQL 迁移/就绪 + Redis/BullMQ
pnpm test:e2e               # Playwright 冒烟（真实启动 PostgreSQL 容器、API 与 Web）
pnpm check                  # format + build + lint + typecheck + 单测 + 契约 + fixture
pnpm check:full             # check + 集成测试 + Playwright 冒烟（需要 Docker）
```

其中集成测试与 Playwright 冒烟需要 Docker Desktop 运行；首次运行浏览器冒烟前执行 `npx playwright install chromium`。

## 完成条件

- Standalone 在所有私有服务不可用时仍可生成、预览和下载。
- Official 的登录、额度、公开告知、校验、审核和自动发布不可绕过且幂等。
- Java 64×64、Steve/Alex 和双层皮肤使用真实解码与固定 fixture 验证。
- 数据保留、删除、日志脱敏、退款和提供商故障路径有自动化证据。
- 同一构建产物通过配置选择模式，不存在 Official 私有源码分支。

## 不得提前实现

不得在基准 ADR 前绑定厂商，不得硬编码额外会话价格，不得让 Standalone 依赖私有源码，也不得保存用户主档、全局积分或社区互动。
