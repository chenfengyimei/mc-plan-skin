import type { components, paths } from './generated/skin-api.js';
import type { SkinMetadata } from './generated/skin-metadata.js';
import type { ProblemDetails } from './generated/problem.js';
import meta from './generated/contract-meta.json' with { type: 'json' };

export type { components, paths, SkinMetadata, ProblemDetails };

/** 当前引用的 mc-plan-contracts Skin OpenAPI 版本。 */
export const SKIN_CONTRACT_VERSION: string = meta.version;

/** 契约来源标识，用于日志与启动自检。 */
export const SKIN_CONTRACT_SOURCE: string = `${meta.source_repo}/${meta.skin_openapi}`;
