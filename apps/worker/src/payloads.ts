import { z } from 'zod';

import type {
  FinalizeJobPayload,
  ObjectCleanupJobPayload,
  RenderJobPayload,
} from '@mc-plan/skin-core';

export const renderJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  conversationId: z.string().uuid(),
  attempt: z.number().int().min(1),
  armModel: z.enum(['steve', 'alex']),
  prompt: z.string().min(1).max(4000),
});

export const finalizeJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  conversationId: z.string().uuid(),
  candidateId: z.string().uuid(),
  title: z.string().min(1).max(120),
  description: z.string().max(4000),
});

/** 会话级删除路径的对象清理重试任务：只允许非空对象键列表。 */
export const objectCleanupPayloadSchema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(100),
});

export function parseRenderJobPayload(input: unknown): RenderJobPayload {
  return renderJobPayloadSchema.parse(input);
}

export function parseFinalizeJobPayload(input: unknown): FinalizeJobPayload {
  return finalizeJobPayloadSchema.parse(input);
}

export function parseObjectCleanupPayload(input: unknown): ObjectCleanupJobPayload {
  return objectCleanupPayloadSchema.parse(input);
}
