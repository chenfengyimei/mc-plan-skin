import type { components, paths } from '../src/index.js';

type Conversation = components['schemas']['Conversation'];
type ConversationDetail = components['schemas']['ConversationDetail'];
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

const messageRoles: ConversationDetail['messages'][number]['role'][] = ['user', 'assistant'];

const conversationDetailRequires = ['conversation_id', 'messages'] as const;

type PathKeys = keyof paths & string;
const paths: PathKeys[] = [
  '/v1/conversations',
  '/v1/conversations/{conversationId}',
  '/v1/conversations/{conversationId}/candidates/{candidateId}/preview',
  '/v1/conversations/{conversationId}/skins/{resourceId}/download',
];

export const typeProbes = {
  conversationStatuses,
  jobStatuses,
  jobKind,
  // 编译期验证：finalize 请求体必须包含 candidate_id、title 与 description
  finalizeRequires: ['candidate_id', 'title', 'description'] as const,
  messageRoles,
  conversationDetailRequires,
  paths,
};
