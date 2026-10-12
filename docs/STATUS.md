# 状态

阶段：F1 受限 Standalone 准备方向（ADR-0009）。工作流 `MCP-F1-SKIN-008`（逐像素皮肤蓝图与动态 3D 预览）已于 2026-10-12 以**工程范围收官**：全部工程交付完成并通过全量门禁——离线 Pixel Foundry 工作台、skin.yaml 0.1.0-alpha.1 匿名窗口生产者、v4 逐像素蓝图协议第 1-6 轮与确定性渲染器。模型视觉验收（Q-001）未由任何候选通过（付费基准 2026-10-10/12：flash+high 四次成功评分 1.5/2/4/1 高方差不可靠；旗舰 glm-5.3 在两把交付 key 上均无配额，error 1113 探测实证，旗舰×新协议组合未获测试窗口），2026-10-12 项目所有者权威决策改选概念图管线，视觉验收连同两路线可比指标口径移交 `MCP-F1-SKIN-009`。各检查点以 Foundation 工作流记录为准。

实现：Standalone 最小纵向链路（SKIN-002）→ 契约无关硬化（SKIN-003）→ 候选预览接线与 v2/v3 渲染器演进（SKIN-004~007）→ 逐像素蓝图 v4 与第一方 3D 动态预览（SKIN-008 分支 `feat/MCP-F1-SKIN-008-pixel-blueprint-v4`）→ 0.1.0-alpha.1 匿名窗口生产者（2026-10-08 所有者授权的范围扩展）。

工程骨架：pnpm workspace（apps/web Next.js 16、apps/api NestJS 12、apps/worker BullMQ 6；packages/config、contracts、skin-core、skin-validator、provider-sdk、test-fixtures、db）。TypeScript 严格模式、ESLint/Prettier、pino 结构化日志、私有健康探针、环境变量 Schema 验证、Prisma 7/PostgreSQL（2 个前向迁移）、Vitest 单测、testcontainers 集成测试、Playwright 冒烟、契约类型生成与 Minecraft 皮肤 fixture 校验均已实际运行通过。

已实现链路（契约八操作，ADR-0012 匿名窗口）：

- 公共表面（0.1.0-alpha.1，生成类型零漂移）：创建会话、请求渲染、确认成品、任务查询（原四操作）+ 会话详情（含时间顺序消息历史，公共角色仅 user/assistant，SYSTEM 过滤）、删除会话（204，级联）、候选预览字节（image/png）、成品下载（image/png）。
- 幂等键指纹 + 三次渲染上限（唯一约束并发安全）+ BullMQ 指数退避/死信 + 保留清理（会话 30 天、候选 24 小时，可控时钟验证）。
- 内部 SkinDesign v4：受限调色板、六部件正反面逐像素网格、透明 overlay 网格与非空校验；确定性 UV 渲染器映射 Steve/Alex 64×64 布局。
- 第一方 CSS 3D 预览：六面 UV、基础层/overlay 双层、鼠标/触摸/键盘旋转、重置、idle/walk/run/fly 关节动画、播放/暂停、速度 0.5–2x、缩放 78%–128%、自动旋转（手动拖拽即停），无第三方 3D 运行时。
- 匿名窗口运行语义：128 位不可猜测 UUID 寻址；错配/未知/过期/已删除统一 404 不区分原因；会话级删除即时级联数据库行（消息/任务/候选/成品）与对象字节，对象清理失败键入队可重试（重试依据保留在任务负载）；在途渲染/确认经外键级联无法复活数据（有集成测试证据）。
- 成功 finalize 的 Job.resource_id 返回本仓 FinalizedSkin ID（公共下载端点的资源标识，不伪装 Community 资源 ID）。
- Pixel Foundry 工作台：欢迎引导与灵感起点、会话状态/已用渲染次数/到期时间、队列五态与错误码人话反馈、候选切换与并排对比、确认面板、刷新恢复（公共详情接口恢复会话与消息 + 既有任务接口重轮询 + 公共预览端点重载候选字节，404 即清除本地快照不复活）、公共端点成品 PNG 下载（Content-Type/64×64 校验在 E2E 断言）、删除入口（删除后刷新不复活）、对话记录面板、空/错/加载态、桌面与移动双视口。
- 真实/Fake Provider 显式区分：`pnpm start:real` 强制 LLM Provider，缺少 `SKIN_LLM_BASE_URL/API_KEY/MODEL` 时启动即失败，绝不静默回退 fixture；`pnpm start:demo` 仅固定样例演示；界面三处标注当前模式。

2026-10-08 范围扩展增量（alpha.1 生产者）：契约类型与 manifest 由已批准的 Contracts skin.yaml 0.1.0-alpha.1（`3006402`，只读源）经 `pnpm contract:gen` 重生成并锁定（contract:check 零漂移）；四个新公共端点、FinalizedSkin 资源引用、匿名窗口/删除级联/保留边界的 producer 集成证据；Web 工作台全部改走公共端点，gitignored 的本地 demo-preview 预览路由已被正式实现取代并移除（不再依赖不入库文件）。

契约状态：skin.yaml 0.1.0-alpha.1 已由 CONTRACTS-003 锁定（Contracts main `3006402`）；本仓为其生产者，未修改任何 Contracts 工件。Official/Community 集成、长期历史、发布链路属后续工作流。

已确定：Java 64×64 范围、Steve/Alex、最多三次渲染、ADR-0012 匿名窗口语义、ADR-0011 消费者拉取投递、Official/Standalone 双模式同库、远程适配器策略和保留期限。

待决：正式 AI 厂商与基准路线（Q-001——2026-10-12 起移交 SKIN-009 的"文本直出 v4 vs 概念图→视觉→v4"两路线可比指标口径）、3D 预览库（Q-011，当前为第一方实现）、结构化创作意图字段（Q-012）、模型成本与额外会话积分价格（Q-013）。

下一步：`MCP-F1-SKIN-009`（图像生成模型 Provider 扩展与概念图视觉桥接）——厂商中立的 fake|llm|image Provider 注册、ImageClient 与视觉提取双抽象、概念图→视觉 LLM→v4 蓝图两跳管线适配器，生产环境在基准 ADR 前继续拒绝非基准适配器实例化；Official 权益与 Community 发布阶段见 docs/development-plan.md 固定顺序；SDK skin 表面扩展待生产者证据。基准与付费 key 事实：所有者交付的两把 key 均为 flash 档配额（付费 key 只经 gitignored `apps/worker/.env` 注入，绝不入 Git/日志；本机该文件存在），旗舰探测两次 1113，受控生成预算（≤10、后设 ≤5）从未耗尽，任何候选均未经所有者视觉验收通过。
