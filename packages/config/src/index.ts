import { z } from 'zod';

export const RUN_MODES = ['standalone', 'official'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const SKIN_ENVS = ['development', 'test', 'production'] as const;
export type SkinEnv = (typeof SKIN_ENVS)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * 配置错误。消息只包含字段名、期望形状和修复提示，绝不回显环境变量的值，
 * 避免把数据库口令、对象存储密钥或其他敏感配置写入日志。
 */
export class ConfigError extends Error {
  readonly issues: ReadonlyArray<{ field: string; message: string }>;

  constructor(issues: ReadonlyArray<{ field: string; message: string }>) {
    const details = issues.map((issue) => `  - ${issue.field}: ${issue.message}`).join('\n');
    super(`Skin 配置校验失败（${issues.length} 项）：\n${details}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const runModeSchema = z.enum(RUN_MODES).default('standalone');
const envSchema = z.enum(SKIN_ENVS).default('development');
const logLevelSchema = z.enum(LOG_LEVELS).default('info');
const portSchema = z.coerce.number().int().min(1).max(65535);

/**
 * 每个会话默认最多三次实际渲染（Foundation `docs/skin-ai.md`）。允许部署者调整，
 * 但必须有界，防止误配成无限渲染。
 */
const conversationAttemptsLimitSchema = z.coerce.number().int().min(1).max(10).default(3);

const conversationRetentionDaysSchema = z.coerce.number().int().min(1).max(3650).default(30);

const candidateRetentionHoursSchema = z.coerce.number().int().min(1).max(720).default(24);

/**
 * 单次 LLM 调用超时（毫秒）。默认 30 秒适合快速端点；逐像素蓝图输出体积大、
 * 推理型模型需要更长时间时由部署者按厂商实测调整。
 */
const llmTimeoutMsSchema = z.coerce.number().int().min(1_000).max(600_000).default(30_000);

const baseConfigSchema = z.object({
  SKIN_RUN_MODE: runModeSchema,
  SKIN_ENV: envSchema,
  SKIN_LOG_LEVEL: logLevelSchema,
  SKIN_CONVERSATION_RETENTION_DAYS: conversationRetentionDaysSchema,
  SKIN_CANDIDATE_RETENTION_HOURS: candidateRetentionHoursSchema,
  SKIN_ATTEMPTS_LIMIT: conversationAttemptsLimitSchema,
  /** 仅 official 模式需要；standalone 模式缺失该值是合法的。 */
  SKIN_OFFICIAL_CORE_BASE_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
});

function requireOfficialCoreUrl<
  T extends { SKIN_RUN_MODE?: string; SKIN_OFFICIAL_CORE_BASE_URL?: string | undefined },
>(value: T, ctx: z.RefinementCtx): void {
  if (value.SKIN_RUN_MODE === 'official' && !value.SKIN_OFFICIAL_CORE_BASE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['SKIN_OFFICIAL_CORE_BASE_URL'],
      message:
        'SKIN_RUN_MODE=official 需要 SKIN_OFFICIAL_CORE_BASE_URL（Core API 基址）。' +
        '若本部署不接入 MC Plan，请使用 SKIN_RUN_MODE=standalone。',
    });
  }
}

export const apiConfigSchema = baseConfigSchema
  .extend({
    SKIN_API_HOST: z.string().min(1).default('127.0.0.1'),
    SKIN_API_PORT: portSchema.default(4000),
    SKIN_DATABASE_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        message: '必须是 PostgreSQL 连接串，以 postgresql:// 开头',
      }),
    SKIN_REDIS_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
        message: '必须是 redis:// 或 rediss:// 连接串',
      }),
    SKIN_CANDIDATE_STORAGE_ROOT: z.string().min(1).default('./data/candidates'),
  })
  .superRefine(requireOfficialCoreUrl);

export const WORKER_PROVIDERS = ['fake', 'llm'] as const;
export type WorkerProvider = (typeof WORKER_PROVIDERS)[number];

export const workerConfigSchema = baseConfigSchema
  .extend({
    SKIN_PROVIDER: z.enum(WORKER_PROVIDERS).default('fake'),
    SKIN_DATABASE_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        message: '必须是 PostgreSQL 连接串，以 postgresql:// 开头',
      }),
    SKIN_REDIS_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
        message: '必须是 redis:// 或 rediss:// 连接串',
      }),
    SKIN_CANDIDATE_STORAGE_ROOT: z.string().min(1).default('./data/candidates'),
    SKIN_LLM_BASE_URL: z.string().optional(),
    SKIN_LLM_API_KEY: z.string().optional(),
    SKIN_LLM_MODEL: z.string().optional(),
    SKIN_LLM_TIMEOUT_MS: llmTimeoutMsSchema,
    /** OpenAI o 系列同名的推理力度透传（low/medium/high/max 等，各厂商取值不同，不做枚举约束）。 */
    SKIN_LLM_REASONING_EFFORT: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
  })
  .superRefine((value, ctx) => {
    requireOfficialCoreUrl(value, ctx);
    if (value.SKIN_PROVIDER === 'llm') {
      const missing = (['SKIN_LLM_BASE_URL', 'SKIN_LLM_API_KEY', 'SKIN_LLM_MODEL'] as const).filter(
        (field) => !value[field],
      );
      for (const field of missing) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `SKIN_PROVIDER=llm 需要 ${field}（LLM 连接配置；密钥不会进日志）`,
        });
      }
    }
  });

export type ApiConfig = {
  runMode: RunMode;
  env: SkinEnv;
  logLevel: LogLevel;
  conversationRetentionDays: number;
  candidateRetentionHours: number;
  attemptsLimit: number;
  officialCoreBaseUrl?: string | undefined;
  apiHost: string;
  apiPort: number;
  databaseUrl: string;
  redisUrl: string;
  candidateStorageRoot: string;
};

export type WorkerConfig = {
  runMode: RunMode;
  env: SkinEnv;
  logLevel: LogLevel;
  conversationRetentionDays: number;
  candidateRetentionHours: number;
  attemptsLimit: number;
  officialCoreBaseUrl?: string | undefined;
  databaseUrl: string;
  redisUrl: string;
  candidateStorageRoot: string;
  provider: WorkerProvider;
  llmTimeoutMs: number;
  llmReasoningEffort?: string | undefined;
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
  } | null;
};

function toIssues(error: z.ZodError): ReadonlyArray<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** 解析 API 进程配置。任何缺失或非法配置都会在启动前以清晰消息失败。 */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = apiConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(toIssues(parsed.error));
  }
  const value = parsed.data;
  return {
    runMode: value.SKIN_RUN_MODE,
    env: value.SKIN_ENV,
    logLevel: value.SKIN_LOG_LEVEL,
    conversationRetentionDays: value.SKIN_CONVERSATION_RETENTION_DAYS,
    candidateRetentionHours: value.SKIN_CANDIDATE_RETENTION_HOURS,
    attemptsLimit: value.SKIN_ATTEMPTS_LIMIT,
    officialCoreBaseUrl: value.SKIN_OFFICIAL_CORE_BASE_URL,
    apiHost: value.SKIN_API_HOST,
    apiPort: value.SKIN_API_PORT,
    databaseUrl: value.SKIN_DATABASE_URL,
    redisUrl: value.SKIN_REDIS_URL,
    candidateStorageRoot: value.SKIN_CANDIDATE_STORAGE_ROOT,
  };
}

/** 解析 worker 进程配置。 */
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = workerConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(toIssues(parsed.error));
  }
  const value = parsed.data;
  return {
    runMode: value.SKIN_RUN_MODE,
    env: value.SKIN_ENV,
    logLevel: value.SKIN_LOG_LEVEL,
    conversationRetentionDays: value.SKIN_CONVERSATION_RETENTION_DAYS,
    candidateRetentionHours: value.SKIN_CANDIDATE_RETENTION_HOURS,
    attemptsLimit: value.SKIN_ATTEMPTS_LIMIT,
    officialCoreBaseUrl: value.SKIN_OFFICIAL_CORE_BASE_URL,
    databaseUrl: value.SKIN_DATABASE_URL,
    redisUrl: value.SKIN_REDIS_URL,
    candidateStorageRoot: value.SKIN_CANDIDATE_STORAGE_ROOT,
    provider: value.SKIN_PROVIDER,
    llmTimeoutMs: value.SKIN_LLM_TIMEOUT_MS,
    llmReasoningEffort: value.SKIN_LLM_REASONING_EFFORT,
    llm:
      value.SKIN_PROVIDER === 'llm'
        ? {
            baseUrl: value.SKIN_LLM_BASE_URL ?? '',
            apiKey: value.SKIN_LLM_API_KEY ?? '',
            model: value.SKIN_LLM_MODEL ?? '',
          }
        : null,
  };
}
