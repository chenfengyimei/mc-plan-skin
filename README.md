# MC Plan Skin

开源的 AI Minecraft 皮肤创作网站，使用同一代码库支持：

- `standalone`：不连接 MC Plan 也能对话生成、预览和下载；社区发布是用户授权后的可选集成。
- `official`：要求 MC Plan 登录与统一额度，用户确认成品且机器审核通过后自动发布到社区。

首版只支持 Minecraft Java 版 64×64 PNG、Steve/Alex 手臂模型和双层皮肤。模型厂商通过适配器接入，仓库不绑定单一提供商。

## 当前状态

仅建立产品、架构、自部署和验收文档，不包含业务代码。见 `docs/`。公共接口以 `mc-plan-contracts/openapi/skin.yaml` 为准。

## 许可

本仓库采用 [GNU AGPL-3.0](LICENSE)。通过标准 API 与 Skin 集成的独立服务保持各自许可；对本程序的修改及网络部署义务以 AGPL 正式文本为准。
