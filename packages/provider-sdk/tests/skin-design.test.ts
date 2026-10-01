import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { validateSkinImage } from '@mc-plan/skin-validator';

import {
  renderSkinDesign,
  skinDesignSchema,
  skinDesignSha256,
  type SkinDesign,
} from '../src/skin-design.js';

const richDesign: SkinDesign = skinDesignSchema.parse({
  palette: {
    skin: '#D9A17A',
    hair: '#3A261F',
    head_overlay: '#6E879B',
    shirt: '#315B78',
    shirt_overlay: '#89A9BA',
    sleeve: '#315B78',
    arm_overlay: '#89A9BA',
    pants: '#283746',
    leg_overlay: '#536B7B',
    boots: '#4A3027',
    scarf: '#B8473D',
    belt: '#4A3027',
    accent: '#E2BE67',
    secondary: '#1E3D52',
    eyes: '#4D82A8',
    eyebrows: '#3A261F',
  },
  hair: { style: 'with_bangs', fringe_rows: 2, highlights: true, part: 'left' },
  face: { eye_style: 'bright', expression: 'soft_smile', freckles: true },
  clothing: {
    outerwear: 'jacket',
    collar: 'high',
    scarf: true,
    belt: true,
    cuffs: true,
    gloves: true,
    knee_pads: true,
    boots: true,
    boot_height: 4,
    sleeve_length: 'long',
  },
  texture: {
    skin: 'freckled',
    hair: 'streaked',
    upper: 'cloth',
    lower: 'denim',
    intensity: 0.22,
  },
  patterns: [
    {
      part: 'torso',
      kind: 'panel',
      placement: 'front',
      color: '#183346',
      secondary_color: null,
      scale: 2,
    },
    {
      part: 'arm',
      kind: 'stripe',
      placement: 'all',
      color: '#7FA8BE',
      secondary_color: '#315B78',
      scale: 3,
    },
    {
      part: 'leg',
      kind: 'diagonal',
      placement: 'sides',
      color: '#506779',
      secondary_color: '#283746',
      scale: 2,
    },
    {
      part: 'leg',
      kind: 'speckle',
      placement: 'all',
      color: '#7891A0',
      secondary_color: null,
      scale: 1,
    },
  ],
});

function opaqueColors(bytes: Uint8Array): Set<string> {
  const image = PNG.sync.read(Buffer.from(bytes));
  const colors = new Set<string>();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    colors.add(`${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]}`);
  }
  return colors;
}

describe('SkinDesign v3', () => {
  it('校验材质、服装细节与多尺度图案，并拒绝越界复杂度', () => {
    expect(richDesign.texture.upper).toBe('cloth');
    expect(richDesign.patterns).toHaveLength(4);
    expect(
      skinDesignSchema.safeParse({
        ...richDesign,
        texture: { ...richDesign.texture, intensity: 0.5 },
      }).success,
    ).toBe(false);
    expect(
      skinDesignSchema.safeParse({
        ...richDesign,
        patterns: Array.from({ length: 11 }, () => richDesign.patterns[0]),
      }).success,
    ).toBe(false);
  });

  it.each(['steve', 'alex'] as const)('%s 布局合法且包含第二层', (armModel) => {
    const png = renderSkinDesign(richDesign, { armModel });
    const report = validateSkinImage(png, { armModel });
    expect(report.valid).toBe(true);
    expect(report.secondLayer).toBe(true);
  });

  it('同一设计确定性输出相同字节与设计哈希', () => {
    const first = renderSkinDesign(richDesign);
    const second = renderSkinDesign(richDesign);
    expect([...first]).toEqual([...second]);
    expect(skinDesignSha256(richDesign)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('材质化丰富设计产生显著高于平滑基线的局部色阶', () => {
    const baseline = skinDesignSchema.parse({
      ...richDesign,
      palette: {
        ...richDesign.palette,
        head_overlay: null,
        shirt_overlay: null,
        arm_overlay: null,
        leg_overlay: null,
        scarf: null,
        belt: null,
      },
      hair: { style: 'short', fringe_rows: 1, highlights: false, part: 'left' },
      face: { eye_style: 'narrow', expression: 'neutral', freckles: false },
      clothing: {
        outerwear: 'none',
        collar: 'none',
        scarf: false,
        belt: false,
        cuffs: false,
        gloves: false,
        knee_pads: false,
        boots: true,
        boot_height: 3,
        sleeve_length: 'long',
      },
      texture: {
        skin: 'smooth',
        hair: 'solid',
        upper: 'smooth',
        lower: 'smooth',
        intensity: 0,
      },
      patterns: [],
    });
    const baselineCount = opaqueColors(renderSkinDesign(baseline)).size;
    const richCount = opaqueColors(renderSkinDesign(richDesign)).size;
    expect(richCount).toBeGreaterThan(baselineCount + 35);
    expect(richCount).toBeGreaterThan(90);
  });
});
