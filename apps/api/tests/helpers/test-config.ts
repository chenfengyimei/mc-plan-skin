import type { ApiConfig } from '@mc-plan/skin-config';

export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    runMode: 'standalone',
    env: 'test',
    logLevel: 'fatal',
    conversationRetentionDays: 30,
    candidateRetentionHours: 24,
    attemptsLimit: 3,
    apiHost: '127.0.0.1',
    apiPort: 4000,
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/mc_plan_skin_test',
    redisUrl: 'redis://127.0.0.1:6379',
    candidateStorageRoot: './data/candidates-test',
    ...overrides,
  };
}
