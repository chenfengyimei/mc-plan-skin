import { describe, expect, it } from 'vitest';
import { ConfigError, loadApiConfig, loadWorkerConfig, type ApiConfig } from '../src/index.js';

function validApiEnv(): NodeJS.ProcessEnv {
  return {
    SKIN_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/skin',
    SKIN_REDIS_URL: 'redis://127.0.0.1:6379',
  };
}

describe('api 配置', () => {
  it('缺失 DATABASE_URL 时以包含字段名的消息失败', () => {
    expect(() => loadApiConfig({})).toThrow(ConfigError);
    try {
      loadApiConfig({});
      expect.unreachable('应当抛出 ConfigError');
    } catch (error) {
      const configError = error as ConfigError;
      expect(configError.message).toContain('SKIN_DATABASE_URL');
    }
  });

  it('配置错误消息不回显环境变量中的敏感值', () => {
    try {
      loadApiConfig({
        SKIN_DATABASE_URL: 'mysql://secret-user:secret-password@127.0.0.1:3306/skin',
      });
      expect.unreachable('非法协议应当失败');
    } catch (error) {
      const configError = error as ConfigError;
      expect(configError.message).toContain('SKIN_DATABASE_URL');
      expect(configError.message).not.toContain('secret-user');
      expect(configError.message).not.toContain('secret-password');
    }
  });

  it('standalone 模式在缺失 Core 配置时可以启动', () => {
    const config = loadApiConfig(validApiEnv());
    expect(config.runMode).toBe('standalone');
    expect(config.officialCoreBaseUrl).toBeUndefined();
  });

  it('official 模式缺失 SKIN_OFFICIAL_CORE_BASE_URL 时失败并给出修复提示', () => {
    try {
      loadApiConfig({ ...validApiEnv(), SKIN_RUN_MODE: 'official' });
      expect.unreachable('official 模式缺少 Core 基址应当失败');
    } catch (error) {
      const configError = error as ConfigError;
      expect(configError.message).toContain('SKIN_OFFICIAL_CORE_BASE_URL');
      expect(configError.message).toContain('standalone');
    }
  });

  it('official 模式提供 Core 基址后通过校验', () => {
    const config = loadApiConfig({
      ...validApiEnv(),
      SKIN_RUN_MODE: 'official',
      SKIN_OFFICIAL_CORE_BASE_URL: 'https://core.example.invalid',
    });
    expect(config.runMode).toBe('official');
    expect(config.officialCoreBaseUrl).toBe('https://core.example.invalid');
  });

  it('非 postgresql 协议的数据库连接串被拒绝', () => {
    expect(() =>
      loadApiConfig({ SKIN_DATABASE_URL: 'mysql://user:pass@127.0.0.1:3306/skin' }),
    ).toThrow(/postgresql/);
  });

  it('API 配置缺失 REDIS_URL 时失败', () => {
    expect(() =>
      loadApiConfig({
        SKIN_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/skin',
      }),
    ).toThrow(/SKIN_REDIS_URL/);
  });

  it('非法端口与非法保留期被拒绝', () => {
    expect(() => loadApiConfig({ ...validApiEnv(), SKIN_API_PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadApiConfig({ ...validApiEnv(), SKIN_CANDIDATE_RETENTION_HOURS: '0' })).toThrow(
      ConfigError,
    );
    expect(() =>
      loadApiConfig({ ...validApiEnv(), SKIN_CONVERSATION_RETENTION_DAYS: '-1' }),
    ).toThrow(ConfigError);
  });

  it('应用安全默认值：30 天对话、24 小时候选、最多三次渲染', () => {
    const config: ApiConfig = loadApiConfig(validApiEnv());
    expect(config.conversationRetentionDays).toBe(30);
    expect(config.candidateRetentionHours).toBe(24);
    expect(config.attemptsLimit).toBe(3);
    expect(config.apiPort).toBe(4000);
    expect(config.logLevel).toBe('info');
    expect(config.env).toBe('development');
  });
});

describe('worker 配置', () => {
  it('缺失 REDIS_URL 时失败', () => {
    expect(() =>
      loadWorkerConfig({
        SKIN_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/skin',
      }),
    ).toThrow(/SKIN_REDIS_URL/);
  });

  it('非 redis 协议被拒绝', () => {
    expect(() =>
      loadWorkerConfig({
        SKIN_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/skin',
        SKIN_REDIS_URL: 'http://127.0.0.1:6379',
      }),
    ).toThrow(/redis/);
  });

  it('完整 worker 配置通过并包含存储根', () => {
    const config = loadWorkerConfig({
      SKIN_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/skin',
      SKIN_REDIS_URL: 'redis://127.0.0.1:6379',
    });
    expect(config.redisUrl).toBe('redis://127.0.0.1:6379');
    expect(config.candidateStorageRoot).toBe('./data/candidates');
  });

  it('LLM 调用超时默认 30 秒且可通过 SKIN_LLM_TIMEOUT_MS 调整', () => {
    const base = {
      SKIN_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/skin',
      SKIN_REDIS_URL: 'redis://127.0.0.1:6379',
    };
    expect(loadWorkerConfig(base).llmTimeoutMs).toBe(30_000);
    expect(loadWorkerConfig({ ...base, SKIN_LLM_TIMEOUT_MS: '180000' }).llmTimeoutMs).toBe(180_000);
    expect(() => loadWorkerConfig({ ...base, SKIN_LLM_TIMEOUT_MS: '100' })).toThrow(ConfigError);
    expect(() => loadWorkerConfig({ ...base, SKIN_LLM_TIMEOUT_MS: '700000' })).toThrow(ConfigError);
  });

  it('SKIN_LLM_REASONING_EFFORT 默认不设置且可透传', () => {
    const base = {
      SKIN_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/skin',
      SKIN_REDIS_URL: 'redis://127.0.0.1:6379',
    };
    expect(loadWorkerConfig(base).llmReasoningEffort).toBeUndefined();
    expect(loadWorkerConfig({ ...base, SKIN_LLM_REASONING_EFFORT: 'low' }).llmReasoningEffort).toBe(
      'low',
    );
    expect(() => loadWorkerConfig({ ...base, SKIN_LLM_REASONING_EFFORT: '' })).toThrow(ConfigError);
  });
});

describe('image provider 配置（fake|llm|image 第三类 Provider）', () => {
  const base = {
    SKIN_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/skin',
    SKIN_REDIS_URL: 'redis://127.0.0.1:6379',
  };
  const imageTrio = {
    SKIN_IMAGE_BASE_URL: 'https://image.example.invalid/v1',
    SKIN_IMAGE_API_KEY: 'local-image-secret',
    SKIN_IMAGE_MODEL: 'image-model-x',
  };
  const llmTrio = {
    SKIN_LLM_BASE_URL: 'https://llm.example.invalid/v1',
    SKIN_LLM_API_KEY: 'local-llm-secret',
    SKIN_LLM_MODEL: 'vision-model-y',
  };
  const visionTrio = {
    SKIN_VISION_BASE_URL: 'https://vision.example.invalid/v1',
    SKIN_VISION_API_KEY: 'local-vision-secret',
    SKIN_VISION_MODEL: 'vision-model-z',
  };

  it('SKIN_PROVIDER=image 缺图像与视觉配置时以字段名失败且不回显密钥值', () => {
    try {
      loadWorkerConfig({ ...base, SKIN_PROVIDER: 'image' });
      expect.unreachable('缺配置应当失败');
    } catch (error) {
      const configError = error as ConfigError;
      const fields = configError.issues.map((issue) => issue.field);
      expect(fields).toContain('SKIN_IMAGE_BASE_URL');
      expect(fields).toContain('SKIN_IMAGE_API_KEY');
      expect(fields).toContain('SKIN_IMAGE_MODEL');
      expect(fields).toContain('SKIN_VISION_BASE_URL');
      expect(configError.message).not.toContain('image.example');
      expect(configError.message).not.toContain('secret');
    }
  });

  it('图像三件套 + 复用 SKIN_LLM_* 通道通过，视觉配置逐项继承', () => {
    const config = loadWorkerConfig({ ...base, SKIN_PROVIDER: 'image', ...imageTrio, ...llmTrio });
    expect(config.image?.baseUrl).toBe(imageTrio.SKIN_IMAGE_BASE_URL);
    expect(config.image?.model).toBe(imageTrio.SKIN_IMAGE_MODEL);
    expect(config.vision?.baseUrl).toBe(llmTrio.SKIN_LLM_BASE_URL);
    expect(config.vision?.apiKey).toBe(llmTrio.SKIN_LLM_API_KEY);
    expect(config.vision?.model).toBe(llmTrio.SKIN_LLM_MODEL);
    expect(config.llm).toBeNull();
  });

  it('SKIN_VISION_* 独立配置优先于 SKIN_LLM_* 复用', () => {
    const config = loadWorkerConfig({
      ...base,
      SKIN_PROVIDER: 'image',
      ...imageTrio,
      ...llmTrio,
      ...visionTrio,
    });
    expect(config.vision?.baseUrl).toBe(visionTrio.SKIN_VISION_BASE_URL);
    expect(config.vision?.model).toBe(visionTrio.SKIN_VISION_MODEL);
  });

  it('SKIN_VISION_REASONING_EFFORT 覆盖继承自 SKIN_LLM_REASONING_EFFORT 的默认', () => {
    const config = loadWorkerConfig({
      ...base,
      SKIN_PROVIDER: 'image',
      ...imageTrio,
      ...llmTrio,
      SKIN_LLM_REASONING_EFFORT: 'high',
      SKIN_VISION_REASONING_EFFORT: 'low',
    });
    expect(config.visionReasoningEffort).toBe('low');
    const inherited = loadWorkerConfig({
      ...base,
      SKIN_PROVIDER: 'image',
      ...imageTrio,
      ...llmTrio,
      SKIN_LLM_REASONING_EFFORT: 'high',
    });
    expect(inherited.visionReasoningEffort).toBe('high');
  });

  it('图像与视觉超时：图像默认 120 秒，视觉缺省回落 LLM 超时', () => {
    const config = loadWorkerConfig({
      ...base,
      SKIN_PROVIDER: 'image',
      ...imageTrio,
      ...llmTrio,
    });
    expect(config.imageTimeoutMs).toBe(120_000);
    expect(config.visionTimeoutMs).toBe(30_000);
    const tuned = loadWorkerConfig({
      ...base,
      SKIN_PROVIDER: 'image',
      ...imageTrio,
      ...llmTrio,
      SKIN_IMAGE_TIMEOUT_MS: '300000',
      SKIN_VISION_TIMEOUT_MS: '180000',
      SKIN_LLM_TIMEOUT_MS: '90000',
    });
    expect(tuned.imageTimeoutMs).toBe(300_000);
    expect(tuned.visionTimeoutMs).toBe(180_000);
  });

  it('SKIN_IMAGE_SIZE 必须是 宽x高 形式', () => {
    const env = { ...base, SKIN_PROVIDER: 'image', ...imageTrio, ...llmTrio };
    expect(loadWorkerConfig({ ...env, SKIN_IMAGE_SIZE: '1024x1024' }).imageSize).toBe('1024x1024');
    expect(() => loadWorkerConfig({ ...env, SKIN_IMAGE_SIZE: 'big' })).toThrow(ConfigError);
    expect(() => loadWorkerConfig({ ...env, SKIN_IMAGE_SIZE: '0x0' })).toThrow(ConfigError);
  });

  it('固定概念图/蓝图 fixture 路径豁免连接配置（显式演示/测试注入点）', () => {
    const config = loadWorkerConfig({
      ...base,
      SKIN_PROVIDER: 'image',
      SKIN_IMAGE_FIXTURE_PATH: '/absolute/concept.png',
      SKIN_VISION_FIXTURE_PATH: '/absolute/blueprint.json',
    });
    expect(config.imageFixturePath).toBe('/absolute/concept.png');
    expect(config.visionFixturePath).toBe('/absolute/blueprint.json');
    expect(config.image?.baseUrl).toBe('');
  });

  it('视觉通道不完整时仍失败：只给 SKIN_LLM_BASE_URL 不构成可复用通道', () => {
    try {
      loadWorkerConfig({
        ...base,
        SKIN_PROVIDER: 'image',
        ...imageTrio,
        SKIN_LLM_BASE_URL: llmTrio.SKIN_LLM_BASE_URL,
      });
      expect.unreachable('视觉通道不完整应当失败');
    } catch (error) {
      const configError = error as ConfigError;
      expect(configError.issues.map((issue) => issue.field)).toContain('SKIN_VISION_API_KEY');
      expect(configError.issues.map((issue) => issue.field)).not.toContain('SKIN_IMAGE_BASE_URL');
    }
  });
});

describe('跨配置规则', () => {
  it('official 模式对 API 与 worker 一致要求 Core 基址', () => {
    const env = {
      SKIN_RUN_MODE: 'official',
      SKIN_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/skin',
      SKIN_REDIS_URL: 'redis://127.0.0.1:6379',
    };
    expect(() => loadApiConfig(env)).toThrow(/SKIN_OFFICIAL_CORE_BASE_URL/);
    expect(() => loadWorkerConfig(env)).toThrow(/SKIN_OFFICIAL_CORE_BASE_URL/);
    const fixed = { ...env, SKIN_OFFICIAL_CORE_BASE_URL: 'https://core.example.invalid' };
    expect(loadApiConfig(fixed).runMode).toBe('official');
    expect(loadWorkerConfig(fixed).runMode).toBe('official');
  });
});
