import { type DynamicModule, Global, Module } from '@nestjs/common';

import type { ApiConfig } from '@mc-plan/skin-config';
import { APP_CONFIG } from './config.token.js';

@Global()
@Module({})
export class ConfigModule {
  public static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [
        {
          provide: APP_CONFIG,
          useValue: config,
        },
      ],
      exports: [APP_CONFIG],
    };
  }
}
