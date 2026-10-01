import { Global, Module } from '@nestjs/common';

import type { ApiConfig } from '@mc-plan/skin-config';
import { FileSystemObjectStorage } from '@mc-plan/skin-core';
import { APP_CONFIG } from '../config/config.token.js';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** 候选与成品对象存储（本地开发使用文件系统实现；生产替换为 S3 兼容驱动）。 */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      useFactory: (config: ApiConfig) => new FileSystemObjectStorage(config.candidateStorageRoot),
      inject: [APP_CONFIG],
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
