import { describe, expect, it } from 'vitest';
import { loadFixtureBytes } from '@mc-plan/skin-test-fixtures';

import { PREVIEW_HEIGHT, PREVIEW_WIDTH, decodeSkinForPreview } from '../src/lib/skin-preview';

function pixelAt(data: Uint8Array, x: number, y: number): [number, number, number, number] {
  const offset = (y * PREVIEW_WIDTH + x) * 4;
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0];
}

describe('2D 预览解码与合成', () => {
  it('Steve fixture 合成 16×32 正面视图，基础部件正确落位', async () => {
    const bytes = await loadFixtureBytes('valid-steve');
    const preview = decodeSkinForPreview(bytes, 'steve');
    expect(preview.width).toBe(PREVIEW_WIDTH);
    expect(preview.height).toBe(PREVIEW_HEIGHT);
    expect(preview.pixels).toHaveLength(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4);

    // 头部正面 (9,9) → 合成 (5,1)：皮肤色（帽子 overlay 涂在 (6..9,2..5)，不覆盖此处）
    expect(pixelAt(preview.pixels, 5, 1)).toEqual([232, 190, 152, 255]);
    // 身体正面 (21,24) → 合成 (5,12)：衬衫色（外套 overlay 恰好涂在 (21,37)，避开）
    expect(pixelAt(preview.pixels, 5, 12)).toEqual([42, 98, 178, 255]);
    // 右腿正面 (6,28) → 合成 (6,28)：裤色（裤子 overlay 涂在 y22..24，不覆盖）
    expect(pixelAt(preview.pixels, 6, 28)).toEqual([52, 60, 76, 255]);
  });

  it('正面 overlay 覆盖基础像素：帽子、外套与右袖渲染第二层颜色', async () => {
    const bytes = await loadFixtureBytes('valid-steve');
    const preview = decodeSkinForPreview(bytes, 'steve');

    // 帽子正面 (42,10) → 合成头 (6,2)：红色 overlay
    expect(pixelAt(preview.pixels, 6, 2)).toEqual([200, 60, 60, 255]);
    // 外套正面 (22,38) → 合成身 (6,10)：蓝色 overlay
    expect(pixelAt(preview.pixels, 6, 10)).toEqual([60, 160, 200, 255]);
    // 右袖正面 (44,38) → 合成右臂 (0,10)（Steve armWidth=4）
    expect(pixelAt(preview.pixels, 0, 10)).toEqual([90, 200, 90, 255]);
  });

  it('Alex 手臂 3px：右臂槽外侧列为透明；Steve 同列为不透明', async () => {
    const alexBytes = await loadFixtureBytes('valid-alex');
    const steveBytes = await loadFixtureBytes('valid-steve');
    const alex = decodeSkinForPreview(alexBytes, 'alex');
    const steve = decodeSkinForPreview(steveBytes, 'steve');

    const alexOuter = pixelAt(alex.pixels, 0, 10);
    expect(alexOuter[3]).toBe(0);
    const steveOuter = pixelAt(steve.pixels, 0, 10);
    expect(steveOuter[3]).toBe(255);
  });

  it('非 64×64 输入被拒绝', async () => {
    const bytes = await loadFixtureBytes('invalid-32x32');
    expect(() => decodeSkinForPreview(bytes, 'steve')).toThrow(/64×64/);
  });
});
