import { z } from 'zod';

/**
 * 结构化皮肤设计 v4。
 *
 * LLM 直接编写各身体部件正反面的像素网格；渲染器不再推断发型、表情或服装。
 * 这样设计自由度来自模型画出的像素，而不是代码内置的角色模板。
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const paletteSymbol = z.string().regex(/^[A-P]$/);
const paletteSchema = z
  .record(paletteSymbol, hexColor)
  .refine((palette) => Object.keys(palette).length >= 6, '调色板至少需要 6 种颜色')
  .refine((palette) => Object.keys(palette).length <= 16, '调色板最多允许 16 种颜色');

const componentNames = ['head', 'torso', 'right_arm', 'left_arm', 'right_leg', 'left_leg'] as const;

export type SkinComponentName = (typeof componentNames)[number];
export type PixelGrid = string[];

const dimensions: Record<SkinComponentName, { width: number; height: number }> = {
  head: { width: 8, height: 8 },
  torso: { width: 8, height: 12 },
  right_arm: { width: 4, height: 12 },
  left_arm: { width: 4, height: 12 },
  right_leg: { width: 4, height: 12 },
  left_leg: { width: 4, height: 12 },
};

function gridSchema(component: SkinComponentName, transparent: boolean) {
  const { width, height } = dimensions[component];
  const alphabet = transparent ? /^[A-P.]+$/ : /^[A-P]+$/;
  return z.array(z.string().length(width).regex(alphabet)).length(height);
}

function layerSchema(transparent: boolean) {
  return z.object({
    head: gridSchema('head', transparent),
    torso: gridSchema('torso', transparent),
    right_arm: gridSchema('right_arm', transparent),
    left_arm: gridSchema('left_arm', transparent),
    right_leg: gridSchema('right_leg', transparent),
    left_leg: gridSchema('left_leg', transparent),
  });
}

const basesSchema = z.object({
  head: paletteSymbol,
  torso: paletteSymbol,
  right_arm: paletteSymbol,
  left_arm: paletteSymbol,
  right_leg: paletteSymbol,
  left_leg: paletteSymbol,
});

function usedSymbols(value: {
  base: Record<SkinComponentName, string>;
  front: Record<SkinComponentName, PixelGrid>;
  back: Record<SkinComponentName, PixelGrid>;
  overlay_front: Record<SkinComponentName, PixelGrid>;
  overlay_back: Record<SkinComponentName, PixelGrid>;
}): Set<string> {
  const symbols = new Set(Object.values(value.base));
  for (const layer of [value.front, value.back, value.overlay_front, value.overlay_back]) {
    for (const grid of Object.values(layer)) {
      for (const row of grid) {
        for (const symbol of row) {
          if (symbol !== '.') symbols.add(symbol);
        }
      }
    }
  }
  return symbols;
}

function layerSymbols(layer: Record<SkinComponentName, PixelGrid>, component: SkinComponentName) {
  return new Set(layer[component].join(''));
}

const skinDesignBaseSchema = z.object({
  version: z.literal(4),
  concept: z.object({
    silhouette: z.string().min(3).max(80),
    outfit: z.string().min(3).max(120),
    signature_details: z.array(z.string().min(2).max(80)).min(3).max(5),
  }),
  palette: paletteSchema,
  base: basesSchema,
  front: layerSchema(false),
  back: layerSchema(false),
  overlay_front: layerSchema(true),
  overlay_back: layerSchema(true),
});

/** 尺寸、字符与调色板合法，但尚未经过像素细节质量门槛的草图。 */
export const skinDesignDraftSchema = skinDesignBaseSchema.superRefine((value, context) => {
  for (const symbol of usedSymbols(value)) {
    if (!(symbol in value.palette)) {
      context.addIssue({
        code: 'custom',
        path: ['palette'],
        message: `像素符号 ${symbol} 未在 palette 中定义`,
      });
    }
  }
});

export const skinDesignSchema = skinDesignDraftSchema.superRefine((value, context) => {
  for (const component of componentNames) {
    const frontSymbols = layerSymbols(value.front, component);
    const minimum = component === 'head' || component === 'torso' ? 3 : 2;
    if (frontSymbols.size < minimum) {
      context.addIssue({
        code: 'custom',
        path: ['front', component],
        message: `${component} 正面至少需要使用 ${minimum} 种颜色来表达结构`,
      });
    }
    const minimumUniqueRows = component === 'head' ? 5 : component === 'torso' ? 6 : 2;
    if (new Set(value.front[component]).size < minimumUniqueRows) {
      context.addIssue({
        code: 'custom',
        path: ['front', component],
        message: `${component} 正面至少需要 ${minimumUniqueRows} 种不同的像素行，不能用大块横条代替细节`,
      });
    }
  }

  const visibleSymbols = new Set(
    [value.front, value.back]
      .flatMap((layer) => Object.values(layer))
      .flatMap((grid) => grid)
      .join(''),
  );
  if (visibleSymbols.size < 6) {
    context.addIssue({
      code: 'custom',
      path: ['front'],
      message: '基础皮肤可见像素至少需要实际使用 6 种调色板颜色',
    });
  }

  let overlayPixels = 0;
  const overlayComponents = new Set<SkinComponentName>();
  for (const layer of [value.overlay_front, value.overlay_back]) {
    for (const component of componentNames) {
      const count = layer[component].join('').replaceAll('.', '').length;
      overlayPixels += count;
      if (count > 0) overlayComponents.add(component);
    }
  }
  if (overlayPixels < 12) {
    context.addIssue({
      code: 'custom',
      path: ['overlay_front'],
      message: 'overlay 至少需要 12 个非透明像素',
    });
  }
  if (overlayComponents.size < 2) {
    context.addIssue({
      code: 'custom',
      path: ['overlay_front'],
      message: 'overlay 至少需要覆盖 2 个身体部件',
    });
  }
});

export type SkinDesign = z.infer<typeof skinDesignSchema>;

export const skinComponentDimensions = dimensions;
export const skinComponentNames = componentNames;
