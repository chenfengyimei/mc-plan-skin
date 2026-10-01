# 状态

阶段：F1 受限 Standalone 准备方向（ADR-0009）

实现：Standalone 最小纵向链路已实现（MCP-F1-SKIN-002）；预览与下载待契约补全

工程骨架：pnpm workspace（apps/web Next.js 16、apps/api NestJS 12、apps/worker BullMQ 6；packages/config、contracts、skin-core、skin-validator、provider-sdk、test-fixtures、db）。TypeScript 严格模式、ESLint/Prettier、结构化日志（pino）、私有健康探针、环境变量 Schema 验证、Prisma 7/PostgreSQL 基线迁移、Vitest 单测、testcontainers 集成测试、Playwright 冒烟、契约类型生成（0.1.0-draft）与 Minecraft 皮肤 fixture 校验均已实际运行通过。

已实现链路（MCP-F1-SKIN-002）：契约四操作（创建会话、请求渲染、确认成品、任务查询）+ 幂等键指纹 + 三次渲染上限（唯一约束并发安全）+ Fake Provider 渲染处理器（校验 64×64/双层 → 隔离存储 → 候选行）+ 确认处理器（重校验 → 成品存储 → 会话完成）+ 保留清理（24 小时候选/30 天会话，可控时钟验证）+ Web 最小流程（创建→渲染→轮询→确认）。Playwright 端到端冒烟在真实 PostgreSQL/Redis 容器上通过。

契约缺口（已记录，待顺序 Contracts 工作流补全 0.1.0-draft）：候选预览字节端点、Standalone 最终下载端点、会话详情/消息、匿名安全模式语义。

已确定：Java 64×64 范围、Steve/Alex、最多三次渲染、确认后自动发布、Official/Standalone、远程适配器策略和保留期限。

待决：正式 AI 厂商（Q-001）、3D 预览库（Q-011）、结构化创作意图字段（Q-012）、模型成本与额外会话积分价格（Q-013）。

下一步：顺序创建以 mc-plan-contracts 为唯一主仓库的工作流补全契约缺口，再开新 Skin 工作流（MCP-F1-SKIN-003）实现候选预览、最终下载与完整 Web 流程。
