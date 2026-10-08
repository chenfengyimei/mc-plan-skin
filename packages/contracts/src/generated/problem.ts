/**
 * 由 mc-plan-contracts schemas/common/problem.json（版本 0.1.0-alpha.1）生成。
 * 生成命令：pnpm --filter @mc-plan/skin-contracts gen
 * 禁止手工修改；契约变化先在 mc-plan-contracts 仓库完成。
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  trace_id: string;
  errors?: {
    field: string;
    code: string;
    message?: string;
  }[];
  [k: string]: unknown;
}
