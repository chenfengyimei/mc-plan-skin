import 'dotenv/config';
import pino, { type Logger } from 'pino';

import { loadWorkerConfig } from '@mc-plan/skin-config';
import { SystemClock, FileSystemObjectStorage } from '@mc-plan/skin-core';
import { createPrismaClient } from '@mc-plan/skin-db';
import {
  FakeProvider,
  FixedImageClient,
  FixedVisionClient,
  ImageConceptSkinProvider,
  LlmStructuredSkinProvider,
  OpenAiCompatImageClient,
  OpenAiCompatLlmClient,
  OpenAiCompatVisionClient,
  type ProviderAdapter,
} from '@mc-plan/skin-provider-sdk';
import { loadFixtureBytes } from '@mc-plan/skin-test-fixtures';

import {
  createFinalizeWorker,
  createRenderWorker,
  createRetentionQueue,
  createRetentionWorker,
} from './worker-factory.js';
import type { WorkerContext } from './worker-context.js';

const config = loadWorkerConfig(process.env);

const logger: Logger = pino({
  level: config.logLevel,
  base: { service: 'skin-worker', environment: config.env, run_mode: config.runMode },
  redact: {
    paths: [
      'SKIN_DATABASE_URL',
      'SKIN_REDIS_URL',
      'password',
      'llm.apiKey',
      'llmBaseUrl',
      'llmApiKey',
      'image.apiKey',
      'imageApiKey',
      'vision.apiKey',
      'visionApiKey',
    ],
    censor: '[REDACTED]',
  },
  messageKey: 'event',
});

const db = createPrismaClient(config.databaseUrl);
const storage = new FileSystemObjectStorage(config.candidateStorageRoot);
const clock = new SystemClock();

function createProvider(): ProviderAdapter {
  if (config.provider === 'llm' && config.llm) {
    logger.info({
      event: 'provider_selected',
      result: 'success',
      provider: 'llm-structured',
      llm_model: config.llm.model,
      llm_timeout_ms: config.llmTimeoutMs,
      ...(config.llmReasoningEffort ? { llm_reasoning_effort: config.llmReasoningEffort } : {}),
    });
    return new LlmStructuredSkinProvider({
      environment: config.env,
      client: new OpenAiCompatLlmClient({
        baseUrl: config.llm.baseUrl,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        defaultTimeoutMs: config.llmTimeoutMs,
        ...(config.llmReasoningEffort ? { reasoningEffort: config.llmReasoningEffort } : {}),
      }),
    });
  }
  if (config.provider === 'image' && config.image && config.vision) {
    // 概念桥接 Provider：图像客户端与视觉提取客户端都可通过显式 fixture 路径
    // 注入固定输入（仅演示/测试，SKIN_ENV=production 在适配器构造时拒绝实例化）；
    // 未注入时必须使用完整远程连接配置，绝不静默回退 Fake Provider。
    const imageClient = config.imageFixturePath
      ? new FixedImageClient({ path: config.imageFixturePath })
      : new OpenAiCompatImageClient({
          baseUrl: config.image.baseUrl,
          apiKey: config.image.apiKey,
          model: config.image.model,
          defaultTimeoutMs: config.imageTimeoutMs,
        });
    const visionClient = config.visionFixturePath
      ? new FixedVisionClient({ path: config.visionFixturePath })
      : new OpenAiCompatVisionClient({
          baseUrl: config.vision.baseUrl,
          apiKey: config.vision.apiKey,
          model: config.vision.model,
          defaultTimeoutMs: config.visionTimeoutMs,
          ...(config.visionReasoningEffort
            ? { reasoningEffort: config.visionReasoningEffort }
            : {}),
        });
    logger.info({
      event: 'provider_selected',
      result: 'success',
      provider: 'image-concept',
      image_model: config.imageFixturePath ? 'fixed-fixture' : config.image.model,
      image_timeout_ms: config.imageTimeoutMs,
      ...(config.imageSize ? { image_size: config.imageSize } : {}),
      vision_model: config.visionFixturePath ? 'fixed-fixture' : config.vision.model,
      ...(config.visionReasoningEffort
        ? { vision_reasoning_effort: config.visionReasoningEffort }
        : {}),
      ...(config.imageFixturePath
        ? { image_fixture: config.imageFixturePath.split('/').pop() }
        : {}),
      ...(config.visionFixturePath
        ? { vision_fixture: config.visionFixturePath.split('/').pop() }
        : {}),
    });
    return new ImageConceptSkinProvider({
      environment: config.env,
      imageClient,
      visionClient,
      ...(config.imageSize ? { imageSize: config.imageSize } : {}),
      imageTimeoutMs: config.imageTimeoutMs,
      visionTimeoutMs: config.visionTimeoutMs,
    });
  }
  // Fake Provider 仅在开发/测试环境可用（ADR-0009：生产模式禁止实例化）；
  // 正式厂商适配器在基准 ADR（Q-001）决定后接入同一接口。
  return new FakeProvider({
    environment: config.env,
    resolveFixture: async (request) =>
      loadFixtureBytes(request.armModel === 'alex' ? 'valid-alex' : 'valid-steve'),
  });
}

const provider = createProvider();

const ctx: WorkerContext = {
  db,
  storage,
  provider,
  clock,
  logger,
  candidateRetentionHours: config.candidateRetentionHours,
};

const connection = { url: config.redisUrl };

const renderWorker = createRenderWorker(ctx, connection);
const finalizeWorker = createFinalizeWorker(ctx, connection);
const retentionWorker = createRetentionWorker(ctx, connection);
const retentionQueue = createRetentionQueue(connection);
await retentionQueue.upsertJobScheduler(
  'retention-hourly',
  { every: 60 * 60 * 1000 },
  {
    name: 'retention',
    data: {},
  },
);

logger.info({
  event: 'worker_starting',
  result: 'success',
  queues: ['skin-render', 'skin-finalize', 'skin-retention-cleanup'],
  provider: config.provider,
  retry: { attempts: 3, backoff: 'exponential(2000ms)' },
  retention: {
    conversation_days: config.conversationRetentionDays,
    candidate_hours: config.candidateRetentionHours,
  },
});

const shutdown = async (): Promise<void> => {
  logger.info({ event: 'worker_stopping', result: 'success' });
  await renderWorker.close();
  await finalizeWorker.close();
  await retentionWorker.close();
  await retentionQueue.close();
  await db.$disconnect();
};

process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
