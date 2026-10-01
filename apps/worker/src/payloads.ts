import { z } from 'zod';

import type { FinalizeJobPayload, RenderJobPayload } from '@mc-plan/skin-core';

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

export function parseRenderJobPayload(input: unknown): RenderJobPayload {
  return renderJobPayloadSchema.parse(input);
}

export function parseFinalizeJobPayload(input: unknown): FinalizeJobPayload {
  return finalizeJobPayloadSchema.parse(input);
}
