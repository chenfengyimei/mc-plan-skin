import { describe, expect, it } from 'vitest';
import { loadFixtureBytes } from '@mc-plan/skin-test-fixtures';

import { validateSkinImage } from '../src/index.js';

const VALID_FIXTURES = ['valid-steve', 'valid-alex'] as const;
const INVALID_FIXTURES = [
  'invalid-no-second-layer',
  'invalid-32x32',
  'invalid-not-png',
  'invalid-corrupted',
] as const;

describe('validateSkinImage 真实字节校验', () => {
  it.each(VALID_FIXTURES)('%s 通过 64×64 双层校验并产出契约元数据', async (name) => {
    const bytes = await loadFixtureBytes(name);
    const report = validateSkinImage(bytes, { armModel: name.includes('alex') ? 'alex' : 'steve' });
    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.width).toBe(64);
    expect(report.height).toBe(64);
    expect(report.mediaType).toBe('image/png');
    expect(report.secondLayer).toBe(true);
    expect(report.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.byteSize).toBeGreaterThan(0);
    expect(report.metadata).toEqual({
      edition: 'java',
      width: 64,
      height: 64,
      arm_model: name.includes('alex') ? 'alex' : 'steve',
      second_layer: true,
    });
  });

  it.each(INVALID_FIXTURES)('%s 被拒绝', async (name) => {
    const bytes = await loadFixtureBytes(name);
    const report = validateSkinImage(bytes, { armModel: 'steve' });
    expect(report.valid).toBe(false);
    expect(report.metadata).toBeNull();
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it('非 PNG 字节流返回 NOT_PNG 且不做解码', async () => {
    const bytes = await loadFixtureBytes('invalid-not-png');
    const report = validateSkinImage(bytes, { armModel: 'steve' });
    expect(report.issues.map((issue) => issue.code)).toContain('NOT_PNG');
    expect(report.width).toBeNull();
  });

  it('损坏 PNG 返回 DECODE_FAILED（签名有效但字节被截断）', async () => {
    const bytes = await loadFixtureBytes('invalid-corrupted');
    const report = validateSkinImage(bytes, { armModel: 'steve' });
    expect(report.issues.map((issue) => issue.code)).toContain('DECODE_FAILED');
  });

  it('32×32 返回 WRONG_WIDTH 与 WRONG_HEIGHT', async () => {
    const bytes = await loadFixtureBytes('invalid-32x32');
    const report = validateSkinImage(bytes, { armModel: 'steve' });
    const codes = report.issues.map((issue) => issue.code);
    expect(codes).toContain('WRONG_WIDTH');
    expect(codes).toContain('WRONG_HEIGHT');
  });

  it('单层皮肤在默认策略下返回 MISSING_SECOND_LAYER，可用选项关闭', async () => {
    const bytes = await loadFixtureBytes('invalid-no-second-layer');
    const strict = validateSkinImage(bytes, { armModel: 'steve' });
    expect(strict.issues.map((issue) => issue.code)).toContain('MISSING_SECOND_LAYER');
    expect(strict.secondLayer).toBe(false);

    const lenient = validateSkinImage(bytes, {
      armModel: 'steve',
      requireSecondLayer: false,
    });
    expect(lenient.valid).toBe(true);
    expect(lenient.metadata?.second_layer).toBe(false);
  });

  it('未声明合法 armModel 时拒绝（UNKNOWN_ARM_MODEL）', async () => {
    const bytes = await loadFixtureBytes('valid-steve');
    const report = validateSkinImage(bytes, { armModel: 'invalid-model' as never });
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('UNKNOWN_ARM_MODEL');
  });

  it('空字节流被拒绝', () => {
    const report = validateSkinImage(new Uint8Array(0), { armModel: 'steve' });
    expect(report.valid).toBe(false);
    expect(report.byteSize).toBe(0);
    expect(report.issues.map((issue) => issue.code)).toContain('NOT_PNG');
  });
});
