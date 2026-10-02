import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { validateSkinImage } from '@mc-plan/skin-validator';

import {
  enrichSkinDesignDraft,
  renderSkinDesign,
  skinDesignDraftSchema,
  skinDesignSchema,
  skinDesignSha256,
  type SkinDesign,
} from '../src/skin-design.js';

const solid = (symbol: string, width: number, height: number): string[] =>
  Array.from({ length: height }, () => symbol.repeat(width));
const clear = (width: number, height: number): string[] => solid('.', width, height);

function layer(symbol: string) {
  return {
    head: solid(symbol, 8, 8),
    torso: solid(symbol, 8, 12),
    right_arm: solid(symbol, 4, 12),
    left_arm: solid(symbol, 4, 12),
    right_leg: solid(symbol, 4, 12),
    left_leg: solid(symbol, 4, 12),
  };
}

function transparentLayer() {
  return {
    head: clear(8, 8),
    torso: clear(8, 12),
    right_arm: clear(4, 12),
    left_arm: clear(4, 12),
    right_leg: clear(4, 12),
    left_leg: clear(4, 12),
  };
}

function blueprint(variant: 'portrait' | 'emblem' = 'portrait'): SkinDesign {
  const front = layer('D');
  const back = layer('E');
  const overlayFront = transparentLayer();
  const overlayBack = transparentLayer();

  front.head = [
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBAAABB',
    'BBAAAABB',
    'AACACCAA',
    'AAAAAAAA',
    'AAFAFAAA',
    'AAAAAAAA',
  ];
  front.torso =
    variant === 'portrait'
      ? [
          'DDDDDDDD',
          'DFFFFFFD',
          'DDFDDFDD',
          'DDFFDDDD',
          'DDDFFDDD',
          'DDDDFFDD',
          'DDFDDFFD',
          'DFFFFFFD',
          'DDDDDDDD',
          'DDEEEEDD',
          'DDEEEEDD',
          'EEEEEEEE',
        ]
      : [
          'DEDEDEDE',
          'EDEDEDED',
          'DEDEDEDE',
          'EDEFFDED',
          'DEFFFFDE',
          'EDFFFFED',
          'DEFFFFDE',
          'EDEFFDED',
          'DEDEDEDE',
          'EDEDEDED',
          'DEDEDEDE',
          'FFFFEDED',
        ];
  front.right_arm = solid(variant === 'portrait' ? 'D' : 'E', 4, 12);
  front.left_arm = solid(variant === 'portrait' ? 'E' : 'D', 4, 12);
  front.right_arm[0] = 'FFFF';
  front.right_arm[1] = 'AAAA';
  front.left_arm[0] = 'FFFF';
  front.left_arm[1] = 'AAAA';
  front.right_leg[0] = 'FFFF';
  front.right_leg[1] = 'AAAA';
  front.left_leg[0] = 'FFFF';
  front.left_leg[1] = 'AAAA';
  overlayFront.head = [
    'B......B',
    'BB....BB',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ];
  overlayFront.torso[variant === 'portrait' ? 1 : 6] =
    variant === 'portrait' ? '..FFFF..' : '.F....F.';
  overlayBack.head[0] = 'BBBBBBBB';

  return skinDesignSchema.parse({
    version: 4,
    concept: {
      silhouette: '不对称短发与轻盈四肢轮廓',
      outfit: '深紫短斗篷搭配分色长裤',
      signature_details: ['金色胸前徽记', '左右异色袖子', '外层红色发丝'],
    },
    palette: {
      A: '#E6B18D',
      B: '#A52D38',
      C: '#2B5F87',
      D: '#553A76',
      E: '#29283C',
      F: '#F1C85B',
    },
    base: {
      head: 'A',
      torso: 'D',
      right_arm: 'D',
      left_arm: 'D',
      right_leg: 'E',
      left_leg: 'E',
    },
    front,
    back,
    overlay_front: overlayFront,
    overlay_back: overlayBack,
  });
}

function differentOpaquePixels(first: Uint8Array, second: Uint8Array): number {
  const a = PNG.sync.read(Buffer.from(first));
  const b = PNG.sync.read(Buffer.from(second));
  let count = 0;
  for (let offset = 0; offset < a.data.length; offset += 4) {
    if (a.data[offset + 3] === 0 && b.data[offset + 3] === 0) continue;
    if (
      a.data[offset] !== b.data[offset] ||
      a.data[offset + 1] !== b.data[offset + 1] ||
      a.data[offset + 2] !== b.data[offset + 2] ||
      a.data[offset + 3] !== b.data[offset + 3]
    ) {
      count += 1;
    }
  }
  return count;
}

describe('SkinDesign v4 pixel blueprint', () => {
  const portrait = blueprint('portrait');

  it('校验精确网格尺寸、调色板引用和非空第二层', () => {
    expect(portrait.version).toBe(4);

    const malformedRow = structuredClone(portrait);
    malformedRow.front.head[0] = 'AAAAAAA';
    expect(skinDesignSchema.safeParse(malformedRow).success).toBe(false);

    const unknownSymbol = structuredClone(portrait);
    unknownSymbol.front.torso[0] = 'PPPPPPPP';
    expect(skinDesignSchema.safeParse(unknownSymbol).success).toBe(false);

    const noOverlay = structuredClone(portrait);
    noOverlay.overlay_front = transparentLayer();
    noOverlay.overlay_back = transparentLayer();
    expect(skinDesignSchema.safeParse(noOverlay).success).toBe(false);
  });

  it.each(['steve', 'alex'] as const)('%s 布局合法且包含第二层', (armModel) => {
    const png = renderSkinDesign(portrait, { armModel });
    const report = validateSkinImage(png, { armModel });
    expect(report.valid).toBe(true);
    expect(report.secondLayer).toBe(true);
  });

  it('同一逐像素蓝图确定性输出相同字节与设计哈希', () => {
    const first = renderSkinDesign(portrait);
    const second = renderSkinDesign(portrait);
    expect([...first]).toEqual([...second]);
    expect(skinDesignSha256(portrait)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('相同调色板的不同蓝图产生显著不同的结构，而非固定服装模板', () => {
    const first = renderSkinDesign(portrait);
    const second = renderSkinDesign(blueprint('emblem'));
    expect(differentOpaquePixels(first, second)).toBeGreaterThan(80);
  });

  it('通用边界精修能提升平坦草图且不依赖服装语义', () => {
    const flat = structuredClone(portrait);
    flat.front = layer('D');
    flat.overlay_front = transparentLayer();
    flat.overlay_back = transparentLayer();
    const draft = skinDesignDraftSchema.parse(flat);
    const enriched = enrichSkinDesignDraft(draft);

    expect(skinDesignSchema.safeParse(enriched).success).toBe(true);
    expect(new Set(enriched.front.torso).size).toBeGreaterThanOrEqual(6);
    expect(
      Object.values(enriched.overlay_front).join('').replaceAll('.', '').length,
    ).toBeGreaterThanOrEqual(12);
  });
});
