import type { components } from '../src/index.js';

type Conversation = components['schemas']['Conversation'];
type Job = components['schemas']['Job'];

const conversationStatuses: Conversation['status'][] = [
  'active',
  'finalizing',
  'completed',
  'expired',
  'cancelled',
];

const jobStatuses: Job['status'][] = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

const jobKind: Job['kind'] = 'render';

export const typeProbes = {
  conversationStatuses,
  jobStatuses,
  jobKind,
  // 编译期验证：finalize 请求体必须包含 candidate_id、title 与 description
  finalizeRequires: ['candidate_id', 'title', 'description'] as const,
};
