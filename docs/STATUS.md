# 状态

阶段：F1 受限 Standalone 准备方向（ADR-0009）。工作流 `MCP-F1-SKIN-008`（逐像素皮肤蓝图与动态 3D 预览）已于 2026-10-12 以**工程范围收官**：全部工程交付完成并通过全量门禁——离线 Pixel Foundry 工作台、skin.yaml 0.1.0-alpha.1 匿名窗口生产者、v4 逐像素蓝图协议第 1-6 轮与确定性渲染器。模型视觉验收（Q-001）未由任何候选通过（付费基准 2026-10-10/12：flash+high 四次成功评分 1.5/2/4/1 高方差不可靠；旗舰 glm-5.3 在两把交付 key 上均无配额，error 1113 探测实证，旗舰×新协议组合未获测试窗口），2026-10-12 项目所有者权威决策改选概念图管线，视觉验收连同两路线可比指标口径移交 `MCP-F1-SKIN-009`（ADR-0015 落档）。各检查点以 Foundation 工作流记录为准。

`MCP-F1-SKIN-009`（图像生成模型 Provider 扩展与概念图视觉桥接）已于 2026-10-13 完成：以厂商中立方式交付图像生成接入能力——WORKER_PROVIDERS 扩为 fake|llm|image（fail-closed 启动校验、密钥进 pino redact）、厂商中立 ImageClient 与视觉提取 VisionClient 双注入式抽象（OpenAI 兼容实现 + 显式演示/测试 Fixed fixture 客户端）、ImageConceptSkinProvider 两跳管线（概念图 → 视觉读图提取 v4 蓝图 → 确定性渲染器，复用既有 JSON 提取/色温守门/行补丁精修/边界兜底，失败类别全映射既有标准错误码，生产环境拒绝实例化）、worker image 分支与 Web 三态徽标、start-demo --provider=image 与全离线 e2e 栈、真实 PostgreSQL 三 Provider 同链一致性测试、Playwright image 全链冒烟、Q-001 两路线可比指标口径文档（引用 ADR-0015，图像路线为能力预留）。本切片不实施受控基准（所有者门槛：预算与凭据授权）；F1 正式收官待概念管线受控基准产生候选并通过所有者视觉验收（ADR-0015 变更条件）。

## 收官记录（MCP-F1-SKIN-009，2026-10-13）

- 分支 `feat/MCP-F1-SKIN-009-concept-bridge` 共 11 个提交已 ff-only 合入 main（基线 `8932395` → `b9f0afa`），实现检查点 `0462b20` 经 Foundation 记录 Continue 校验。
- 交付（厂商中立能力预留）：fake|llm|image Provider 注册与 fail-closed 校验、ImageClient/VisionClient 双注入式抽象（OpenAI 兼容 + Fixed fixture 客户端）、ImageConceptSkinProvider 两跳管线（复用共享 v4 管线：JSON 提取/色温守门/行补丁精修/边界兜底）、worker image 分支、Web 三态 Provider 呈现、`pnpm start:image` 演示入口、全离线 e2e 栈与 image 全链 Playwright 冒烟、三 Provider 真实 PostgreSQL 同链一致性测试、Q-001 两路线可比指标口径文档（引用 ADR-0015）。
- 门禁（最终实现树 `0462b20` 实跑）：build、check（单测 128、契约零漂移、fixtures 6/6）、`SKIN_E2E_API_PORT=4100 SKIN_E2E_WEB_PORT=3200 pnpm check:full`（api 集成 15/15、worker 集成 12/12、Playwright fake 2/2 + image 1/1）、prisma/migration 校验（零新迁移）全绿；台账在 Foundation 工作流记录与本会话输出目录。
- 边界如实：本切片零公共契约/Schema/迁移/SDK 改动；未实施受控基准、未发生任何付费模型调用（生产环境继续拒绝非基准适配器实例化）；F1 正式收官待概念管线受控基准产生候选并通过所有者视觉验收（ADR-0015 变更条件）。

## 收官记录（MCP-F1-SKIN-008，2026-10-12）

- 分支 `feat/MCP-F1-SKIN-008-pixel-blueprint-v4` 共 15 个提交已 ff-only 合入 main（基线 `787bc34` → `4a16eb4`，含 STATUS 收官与 development-plan 治理更正两个 docs 提交），final_commit `8932395`（main 收官记录段）。
- 工程交付：离线 Pixel Foundry 工作台（全链 + 刷新恢复 + 桌面/移动）、skin.yaml 0.1.0-alpha.1 匿名窗口生产者（四公共端点 + 保留/级联真实运行）、v4 协议第 1-6 轮（确定性 UV 渲染器 + 色相守门 + 冷色收紧 + 脸可读/雪白高光规格）。
- 视觉验收（Q-001）未由任何候选通过：flash+high 四次成功评分 1.5/2/4/1；两把交付 key 均无旗舰配额（探测 1113×2）；所有者 2026-10-12 改选概念图管线，视觉验收与两路线可比指标口径移交 `MCP-F1-SKIN-009`。
- 最终树全量门禁执行台账与收官证据以 Foundation 工作流记录（`memory/workstreams/completed/MCP-F1-SKIN-008.json`）与本会话输出目录 `/Users/chenfeng/.codex/outputs/mc-skin009-20261012/` 为准；基准候选原图与报告在 `/Users/chenfeng/.codex/outputs/mc-skin008-benchmark-20261010/`。

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

待决：正式 AI 厂商（Q-001——ADR-0015 已落档路线改选概念图管线，厂商绑定待概念管线受控基准产生候选并通过所有者视觉验收后由新 ADR 决定；两路线可比指标口径见 docs/q-001-route-benchmark.md）、3D 预览库（Q-011，当前为第一方实现）、结构化创作意图字段（Q-012）、模型成本与额外会话积分价格（Q-013）。

下一步：`MCP-F1-SKIN-009` 能力已交付。受控概念管线基准（需所有者授权预算与凭据，key 只经 gitignored `apps/worker/.env` 注入，绝不入 Git/日志；指标口径见 docs/q-001-route-benchmark.md）→ 所有者视觉验收终裁 → 正式厂商绑定由新 ADR 决定（ADR-0015 变更条件）；Official 权益与 Community 发布阶段见 docs/development-plan.md 固定顺序；SDK skin 表面扩展待生产者证据。基准与付费 key 事实：所有者交付的两把 key 均为 flash 档配额，旗舰探测两次 1113，受控生成预算（≤10、后设 ≤5）从未耗尽，任何候选均未经所有者视觉验收通过。
