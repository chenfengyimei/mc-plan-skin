import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SKIN_FIXTURES, getSkinFixture, loadFixtureBytes } from '../src/index.js';

describe('皮肤 fixture 清单', () => {
  it('包含有效与无效样本且清单完整', () => {
    const names = SKIN_FIXTURES.map((fixture) => fixture.name);
    expect(names).toContain('valid-steve');
    expect(names).toContain('valid-alex');
    expect(names).toContain('invalid-no-second-layer');
    expect(names).toContain('invalid-32x32');
    expect(names).toContain('invalid-not-png');
    expect(names).toContain('invalid-corrupted');
  });

  it('每个 fixture 文件存在且 sha256 与清单一致', async () => {
    expect(SKIN_FIXTURES.length).toBeGreaterThan(0);
    for (const fixture of SKIN_FIXTURES) {
      const bytes = await loadFixtureBytes(fixture.name);
      expect(bytes.byteLength).toBe(fixture.byteSize);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
    }
  });

  it('有效 fixture 必须声明 Steve/Alex 与双层，无效 fixture 必须声明失败码', () => {
    for (const fixture of SKIN_FIXTURES) {
      if (fixture.expectValid) {
        expect(['steve', 'alex']).toContain(fixture.armModel);
        expect(fixture.secondLayer).toBe(true);
        expect(fixture.invalidCode).toBeUndefined();
      } else {
        expect(typeof fixture.invalidCode).toBe('string');
      }
    }
  });

  it('未知 fixture 名称被拒绝', () => {
    expect(() => getSkinFixture('does-not-exist')).toThrow(/未知/);
  });
});
