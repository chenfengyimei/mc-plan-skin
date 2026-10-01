# 状态

阶段：F1 受限 Standalone 准备方向（ADR-0009）

实现：工程骨架已建立（MCP-F1-SKIN-001）；业务纵向链路未开始

F0 状态：文档基线已完成（仅本地；业务实现未开始）

工程骨架：pnpm workspace（apps/web Next.js 16、apps/api NestJS 12、apps/worker BullMQ 6；packages/config、contracts、skin-core、skin-validator、provider-sdk、test-fixtures）。TypeScript 严格模式、ESLint/Prettier、结构化日志（pino）、私有健康探针、环境变量 Schema 验证、Prisma 7/PostgreSQL 基线迁移、Vitest 单测、testcontainers 集成测试、Playwright 冒烟、契约类型生成（0.1.0-draft）与 Minecraft 皮肤 fixture 校验均已实际运行通过。

已确定：Java 64×64 范围、Steve/Alex、最多三次渲染、确认后自动发布、Official/Standalone、远程适配器策略和保留期限。

待决：正式 AI 厂商（Q-001）、3D 预览库（Q-011）、结构化创作意图字段（Q-012）、模型成本与额外会话积分价格（Q-013）。

下一步：MCP-F1-SKIN-002 实现 Standalone 最小纵向链路的可独立部分；候选预览、最终下载、会话详情与匿名安全模式的契约缺口记录后，顺序开 Contracts 工作流补全。
