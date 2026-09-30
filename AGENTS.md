# MC Plan Skin Agent Guide

Skin 拥有创作对话、渲染任务、临时候选、皮肤验证、模型适配器和 Official/Standalone 行为。

工作前阅读 Foundation 的 Skin 设计、数据流、隐私规则、额度规则与相关 ADR，再阅读本仓库局部架构和锁定的 Skin/Community/Core 契约。

不可保存用户主档、全局积分、社区互动或平台密码。Standalone 的核心生成与下载不能依赖私有源码。Official 与 Standalone 必须保持同一代码库，不允许复制分叉。

公共接口或 Schema 先改 Contracts。当前阶段不得添加业务代码；工程建立后在此补充真实 lint、test、contract-test、e2e 和 skin-fixture validation 命令。
