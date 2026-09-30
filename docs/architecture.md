# Skin 局部架构

## 模块

- `conversation`：消息、结构化创作意图、会话状态和 30 天保留。
- `entitlement-client`：Official 模式向 Core 幂等消费会话；Standalone 使用部署者策略。
- `provider-adapter`：厂商无关的候选生成接口、用量、错误与安全结果。
- `render-job`：Redis/BullMQ 异步任务、重试、取消、死信和状态。
- `candidate`：隔离存储、预览授权、尝试次数和 24 小时清理。
- `skin-validator`：PNG 解码、64×64、Steve/Alex、双层布局、哈希和媒体类型。
- `finalization`：确认候选、最终校验和不可重复的成品创建。
- `community-client`：用户 OAuth 授权、上传会话、资源版本和发布结果。
- `web`：Next.js 对话、3D 预览、明确发布提示和账号状态。

## 模式边界

模式由部署配置决定并在启动时验证。Official 缺少 Core/Community/Keycloak 配置时拒绝启动；Standalone 不应因为这些配置缺失而失败。

Official 后端代表用户调用 Community，并保留用户主体与最小 scope。Standalone 浏览器使用 PKCE 获取用户授权，不接受部署者共享的社区管理员令牌。

## 提供商接口

提供商适配器只暴露结构化请求、候选字节、用量、调用 ID、安全结果和标准错误。提示工程、厂商参数与响应转换留在适配器内。业务层按标准错误决定重试，不能通过厂商错误文本做逻辑判断。

## 数据保留

候选对象键与公开对象空间隔离。过期任务清理数据库引用和对象文件；对话 30 天、候选和失败文件 24 小时。清理失败必须进入指标与重试队列。
