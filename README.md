# MC Plan Skin

开源的 AI Minecraft 皮肤创作网站，使用同一代码库支持：

- `standalone`：不连接 MC Plan 也能对话生成、预览和下载；社区发布是用户授权后的可选集成。
- `official`：要求 MC Plan 登录与统一额度，用户确认成品且机器审核通过后自动发布到社区。

首版只支持 Minecraft Java 版 64×64 PNG、Steve/Alex 手臂模型和双层皮肤。模型厂商通过适配器接入，仓库不绑定单一提供商。

## 当前状态

工程骨架已建立（依据 Foundation ADR-0009，F1 中受限的 Standalone 准备方向，Tracking ID `MCP-F1-SKIN-001`）：可安装、可构建、可启动、可验证的 pnpm workspace，包含 Next.js Web、NestJS API、BullMQ Worker 与六个内部包。公共接口以 `mc-plan-contracts/openapi/skin.yaml`（0.1.0-draft）为准，客户端类型由契约生成，禁止手工复制契约类型。

```powershell
pnpm install
pnpm check         # format/lint/typecheck/单测/契约一致性/fixture 校验
pnpm check:full    # 追加 testcontainers 集成测试与 Playwright 冒烟（需要 Docker）
```

详见 [AGENTS.md](AGENTS.md) 的真实验收命令与 [docs/STATUS.md](docs/STATUS.md)。

## 许可

本仓库采用 [GNU AGPL-3.0](LICENSE)。通过标准 API 与 Skin 集成的独立服务保持各自许可；对本程序的修改及网络部署义务以 AGPL 正式文本为准。
