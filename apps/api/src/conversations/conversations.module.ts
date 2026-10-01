import { Module } from '@nestjs/common';

import { ConversationsController } from './conversations.controller.js';
import { ConversationService } from './conversation.service.js';
import { IdempotencyService } from './idempotency.service.js';

@Module({
  controllers: [ConversationsController],
  providers: [ConversationService, IdempotencyService],
})
export class ConversationsModule {}
