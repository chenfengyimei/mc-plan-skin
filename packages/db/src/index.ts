import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

export { Prisma } from './generated/prisma/client.js';
export type {
  Conversation,
  ConversationMessage,
  RenderJob,
  Candidate,
  FinalizedSkin,
  IdempotencyRecord,
} from './generated/prisma/client.js';
export {
  SkinConversationStatus,
  RenderJobStatus,
  RenderJobKind,
  ArmModel,
  ConversationMessageRole,
} from './generated/prisma/enums.js';

/** 为一个进程创建共享的 Prisma 客户端（API 与 worker 共用同一 schema 与数据库）。 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export { PrismaClient };
