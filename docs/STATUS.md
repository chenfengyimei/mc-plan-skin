# 状态

阶段：F1 受限 Standalone 准备方向（ADR-0009）。当前活动工作流 `MCP-F1-SKIN-008`（逐像素皮肤蓝图与动态 3D 预览）为 **blocked**：真实模型候选未达项目所有者视觉验收（Q-001 未决），技术链路各检查点以 Foundation 工作流记录为准。

实现：Standalone 最小纵向链路（SKIN-002）→ 契约无关硬化（SKIN-003）→ 候选预览接线与 v2/v3 渲染器演进（SKIN-004~007）→ 逐像素蓝图 v4 与第一方 3D 动态预览（SKIN-008 分支 `feat/MCP-F1-SKIN-008-pixel-blueprint-v4`，检查点至 9a06135）。

工程骨架：pnpm workspace（apps/web Next.js 16、apps/api NestJS 12、apps/worker BullMQ 6；packages/config、contracts、skin-core、skin-validator、provider-sdk、test-fixtures、db）。TypeScript 严格模式、ESLint/Prettier、pino 结构化日志、私有健康探针、环境变量 Schema 验证、Prisma 7/PostgreSQL（2 个前向迁移）、Vitest 单测、testcontainers 集成测试、Playwright 冒烟、契约类型生成（0.1.0-draft）与 Minecraft 皮肤 fixture 校验均已实际运行通过。

已实现链路（至 SKIN-008 检查点 9a06135 + 2026-10-05 会话 2 接管增量）：

- 契约四操作（创建会话、请求渲染、确认成品、任务查询）+ 幂等键指纹 + 三次渲染上限（唯一约束并发安全）+ BullMQ 指数退避/死信 + 保留清理（会话 30 天、候选 24 小时，可控时钟验证）。
- 内部 SkinDesign v4：受限调色板、六部件正反面逐像素网格、透明 overlay 网格与非空校验；确定性 UV 渲染器映射 Steve/Alex 64×64 布局（拒绝服装枚举模板分支）。
- 第一方 CSS 3D 预览：六面 UV、基础层/overlay 双层、鼠标/触摸/键盘旋转、重置、idle/walk/run/fly 关节动画、播放/暂停、速度 0.5–2x、缩放 78%–128%、自动旋转（手动拖拽即停），无第三方 3D 运行时。
- Pixel Foundry 工作台：欢迎引导与灵感起点、会话状态/已用渲染次数/到期时间、队列五态与错误码人话反馈、候选切换与并排对比、确认面板、刷新恢复（localStorage 快照 + 既有 GET /v1/jobs 重轮询）、确认后成品 PNG 下载（已通过最终校验的字节，客户端 Blob 下载）、终态（过期/完成）界面闭环与“开始新会话”入口、空/错/加载态、桌面与移动双视口。
- 真实/Fake Provider 显式区分：`pnpm start:real` 强制 LLM Provider，缺少 `SKIN_LLM_BASE_URL/API_KEY/MODEL` 时启动即失败，绝不静默回退 fixture；`pnpm start:demo` 仅固定样例演示；界面三处标注当前模式。
- 本地候选预览路由 `apps/web/src/app/demo-preview/`（.gitignore 授权的仅本地演示工具，不入库；2026-10-05 在 Mac 迁移后按原语义重建）。公共候选字节端点仍属契约缺口，待契约补全后替代。

2026-10-05 会话 2 接管增量（008 范围内离线网站完善）：刷新恢复、确认后下载入口、候选并排对比、终态闭环与任务 404 语义；Playwright 扩展为桌面（1280×720）+ 移动（390×844）双视口完整 创建→调整→对比→预览→刷新恢复→确认→下载 流程并逐步截图。

契约缺口（已记录，待顺序以 mc-plan-contracts 为主仓库补全 0.1.0-draft）：候选预览字节端点、Standalone 最终下载端点、会话详情与消息列表、用户提前删除会话、匿名安全模式语义。

已确定：Java 64×64 范围、Steve/Alex、最多三次渲染、确认后自动发布（Official）、Official/Standalone 双模式同库、远程适配器策略和保留期限。

待决：正式 AI 厂商（Q-001）、3D 预览库（Q-011，当前为第一方实现）、结构化创作意图字段（Q-012）、模型成本与额外会话积分价格（Q-013）。

下一步：SKIN-008 解锁等待项目所有者的模型/预算/凭据或 prompt 策略决策（Q-001），其后执行受控真实基准并完成视觉验收；契约缺口按 Contracts 先行顺序另开工作流；Official 权益与 Community 发布阶段见 docs/development-plan.md 固定顺序。
