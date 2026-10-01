import { z } from 'zod';

/**
 * 结构化皮肤设计 v3。
 *
 * 设计值保持有界且易于 LLM 生成；渲染器负责把材质、光照和图案安全地映射到
 * Minecraft Java 64x64 UV 布局，因此模型无法产生越界或结构非法的皮肤。
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const materialSchema = z.enum(['smooth', 'cloth', 'denim', 'leather', 'metal', 'weathered']);

const patternSchema = z.object({
  part: z.enum(['head', 'torso', 'arm', 'leg']),
  kind: z.enum([
    'solid',
    'stripe',
    'pinstripe',
    'checker',
    'diagonal',
    'gradient',
    'border',
    'panel',
    'chevron',
    'speckle',
  ]),
  placement: z.enum(['all', 'front', 'sides', 'back']).default('all'),
  color: hexColor,
  secondary_color: hexColor.nullable().default(null),
  scale: z.number().int().min(1).max(4).default(2),
});

export const skinDesignSchema = z.object({
  palette: z.object({
    skin: hexColor,
    hair: hexColor,
    head_overlay: hexColor.nullable(),
    shirt: hexColor,
    shirt_overlay: hexColor.nullable(),
    sleeve: hexColor,
    arm_overlay: hexColor.nullable(),
    pants: hexColor,
    leg_overlay: hexColor.nullable(),
    boots: hexColor,
    scarf: hexColor.nullable(),
    belt: hexColor.nullable(),
    accent: hexColor,
    secondary: hexColor,
    eyes: hexColor,
    eyebrows: hexColor,
  }),
  hair: z
    .object({
      style: z.enum(['short', 'with_bangs', 'long']),
      fringe_rows: z.number().int().min(0).max(3).default(2),
      highlights: z.boolean().default(true),
      part: z.enum(['left', 'center', 'right']).default('left'),
    })
    .default({ style: 'short', fringe_rows: 2, highlights: true, part: 'left' }),
  face: z
    .object({
      eye_style: z.enum(['round', 'narrow', 'bright']).default('round'),
      expression: z.enum(['neutral', 'soft_smile', 'serious']).default('neutral'),
      freckles: z.boolean().default(false),
    })
    .default({ eye_style: 'round', expression: 'neutral', freckles: false }),
  clothing: z
    .object({
      outerwear: z.enum(['none', 'jacket', 'robe', 'armor']).default('none'),
      collar: z.enum(['none', 'round', 'high']).default('none'),
      scarf: z.boolean().default(false),
      belt: z.boolean().default(false),
      cuffs: z.boolean().default(false),
      gloves: z.boolean().default(false),
      knee_pads: z.boolean().default(false),
      boots: z.boolean().default(true),
      boot_height: z.number().int().min(2).max(5).default(3),
      sleeve_length: z.enum(['short', 'long']).default('long'),
    })
    .default({
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
    }),
  texture: z
    .object({
      skin: z.enum(['smooth', 'freckled']).default('smooth'),
      hair: z.enum(['solid', 'layered', 'streaked']).default('layered'),
      upper: materialSchema.default('cloth'),
      lower: materialSchema.default('denim'),
      intensity: z.number().min(0).max(0.35).default(0.16),
    })
    .default({
      skin: 'smooth',
      hair: 'layered',
      upper: 'cloth',
      lower: 'denim',
      intensity: 0.16,
    }),
  patterns: z.array(patternSchema).max(10).default([]),
});

export type SkinDesign = z.infer<typeof skinDesignSchema>;
export type SkinMaterial = z.infer<typeof materialSchema>;
export type SkinPattern = z.infer<typeof patternSchema>;
