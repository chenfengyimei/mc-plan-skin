/**
 * 由 mc-plan-contracts schemas/skin/skin-metadata.json（版本 0.1.0-alpha.1）生成。
 * 生成命令：pnpm --filter @mc-plan/skin-contracts gen
 * 禁止手工修改；契约变化先在 mc-plan-contracts 仓库完成。
 */
export interface SkinMetadata {
  edition: 'java';
  width: 64;
  height: 64;
  arm_model: 'steve' | 'alex';
  second_layer: boolean;
}
