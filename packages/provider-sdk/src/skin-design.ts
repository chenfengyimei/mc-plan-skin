import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { z } from 'zod';

/**
 * 结构化皮肤设计 v2：多模态文本模型输出的中间表示。
 * v2 升级：发型系统、脸部细节（眉/眼/嘴）、服装层次（围巾/腰带/靴子）、
 * 每面边缘着色与顶部提亮。由确定性渲染器生成 64×64 PNG——
 * 模型无法产生非法布局，格式合法性由 schema 与渲染器保证。
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

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
    eyes: hexColor,
    eyebrows: hexColor,
  }),
  hair: z
    .object({
      style: z.enum(['short', 'with_bangs', 'long']),
      fringe_rows: z.number().int().min(0).max(2).default(2),
    })
    .default({ style: 'short', fringe_rows: 2 }),
  face: z
    .object({
      eye_style: z.enum(['round', 'narrow']).default('round'),
      mouth: z.boolean().default(true),
    })
    .default({ eye_style: 'round', mouth: true }),
  clothing: z
    .object({
      scarf: z.boolean().default(false),
      belt: z.boolean().default(false),
      boots: z.boolean().default(true),
      sleeve_length: z.enum(['short', 'long']).default('long'),
    })
    .default({ scarf: false, belt: false, boots: true, sleeve_length: 'long' }),
  patterns: z
    .array(
      z.object({
        part: z.enum(['head', 'torso', 'arm', 'leg']),
        kind: z.enum(['solid', 'stripe', 'border', 'speckle']),
        color: hexColor,
      }),
    )
    .max(8)
    .default([]),
});

export type SkinDesign = z.infer<typeof skinDesignSchema>;

type PartName = 'head' | 'torso' | 'arm' | 'leg';

type Face = { x: number; y: number; w: number; h: number; shade: number };

/** 各部件的基础面区域（64×64 布局）与着色深度。 */
const FACES: Record<PartName, Face[]> = {
  head: [
    { x: 8, y: 0, w: 8, h: 8, shade: 0.12 },
    { x: 16, y: 0, w: 8, h: 8, shade: -0.18 },
    { x: 0, y: 8, w: 8, h: 8, shade: -0.1 },
    { x: 8, y: 8, w: 8, h: 8, shade: 0 },
    { x: 16, y: 8, w: 8, h: 8, shade: -0.1 },
    { x: 24, y: 8, w: 8, h: 8, shade: -0.18 },
  ],
  torso: [
    { x: 20, y: 16, w: 8, h: 4, shade: 0.12 },
    { x: 28, y: 16, w: 8, h: 4, shade: -0.18 },
    { x: 16, y: 20, w: 8, h: 12, shade: -0.1 },
    { x: 20, y: 20, w: 8, h: 12, shade: 0 },
    { x: 28, y: 20, w: 8, h: 12, shade: -0.1 },
    { x: 32, y: 20, w: 8, h: 12, shade: -0.18 },
  ],
  arm: [
    { x: 44, y: 16, w: 4, h: 4, shade: 0.12 },
    { x: 48, y: 16, w: 4, h: 4, shade: -0.18 },
    { x: 40, y: 20, w: 4, h: 12, shade: -0.1 },
    { x: 44, y: 20, w: 4, h: 12, shade: 0 },
    { x: 48, y: 20, w: 4, h: 12, shade: -0.1 },
    { x: 52, y: 20, w: 4, h: 12, shade: -0.18 },
    { x: 36, y: 48, w: 4, h: 4, shade: 0.12 },
    { x: 40, y: 48, w: 4, h: 4, shade: -0.18 },
    { x: 32, y: 52, w: 4, h: 12, shade: -0.1 },
    { x: 36, y: 52, w: 4, h: 12, shade: 0 },
    { x: 40, y: 52, w: 4, h: 12, shade: -0.1 },
    { x: 44, y: 52, w: 4, h: 12, shade: -0.18 },
  ],
  leg: [
    { x: 4, y: 16, w: 4, h: 4, shade: 0.12 },
    { x: 8, y: 16, w: 4, h: 4, shade: -0.18 },
    { x: 0, y: 20, w: 4, h: 12, shade: -0.1 },
    { x: 4, y: 20, w: 4, h: 12, shade: 0 },
    { x: 8, y: 20, w: 4, h: 12, shade: -0.1 },
    { x: 12, y: 20, w: 4, h: 12, shade: -0.18 },
    { x: 20, y: 48, w: 4, h: 4, shade: 0.12 },
    { x: 24, y: 48, w: 4, h: 4, shade: -0.18 },
    { x: 16, y: 52, w: 4, h: 12, shade: -0.1 },
    { x: 20, y: 52, w: 4, h: 12, shade: 0 },
    { x: 24, y: 52, w: 4, h: 12, shade: -0.1 },
    { x: 28, y: 52, w: 4, h: 12, shade: -0.18 },
  ],
};

const OVERLAY_FACES: Record<
  'head' | 'torso' | 'arm' | 'leg',
  Array<{ x: number; y: number; w: number; h: number }>
> = {
  head: [{ x: 32, y: 0, w: 32, h: 16 }],
  torso: [{ x: 16, y: 32, w: 24, h: 16 }],
  arm: [
    { x: 40, y: 32, w: 16, h: 16 },
    { x: 48, y: 48, w: 16, h: 16 },
  ],
  leg: [
    { x: 0, y: 48, w: 16, h: 16 },
    { x: 16, y: 48, w: 16, h: 16 },
  ],
};

function hexToRgba(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, 255];
}

function shadePixel(
  pixel: [number, number, number, number],
  shade: number,
): [number, number, number, number] {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return [
    clamp(pixel[0] * (1 + shade)),
    clamp(pixel[1] * (1 + shade)),
    clamp(pixel[2] * (1 + shade)),
    pixel[3],
  ];
}

/** 部件内确定性伪随机（speckle 图案用），与运行环境无关。 */
function seededValue(seed: string, x: number, y: number): number {
  const hash = createHash('sha256').update(`${seed}:${x}:${y}`).digest();
  return hash[0] ?? 0;
}

function paintFace(
  image: PNG,
  face: Face,
  color: [number, number, number, number],
  edgeDarken = true,
): void {
  const base = shadePixel(color, face.shade);
  for (let y = face.y; y < face.y + face.h; y += 1) {
    for (let x = face.x; x < face.x + face.w; x += 1) {
      const offset = (y * image.width + x) * 4;
      const isEdge =
        edgeDarken &&
        (x === face.x || y === face.y || x === face.x + face.w - 1 || y === face.y + face.h - 1);
      const pixel = isEdge ? shadePixel(base, -0.12) : base;
      image.data[offset] = pixel[0];
      image.data[offset + 1] = pixel[1];
      image.data[offset + 2] = pixel[2];
      image.data[offset + 3] = 255;
    }
  }
}

function paintPartPatterns(image: PNG, design: SkinDesign, part: PartName): void {
  const accent = hexToRgba(design.palette.accent);
  for (const pattern of design.patterns) {
    if (pattern.part !== part) {
      continue;
    }
    const color = hexToRgba(pattern.color);
    for (const face of FACES[part]) {
      for (let y = face.y; y < face.y + face.h; y += 1) {
        for (let x = face.x; x < face.x + face.w; x += 1) {
          const localX = x - face.x;
          const localY = y - face.y;
          let apply = false;
          if (pattern.kind === 'solid') {
            apply = true;
          } else if (pattern.kind === 'stripe') {
            apply = localY % 4 < 2;
          } else if (pattern.kind === 'border') {
            apply = localX === 0 || localY === 0 || localX === face.w - 1 || localY === face.h - 1;
          } else if (pattern.kind === 'speckle') {
            apply = seededValue(`${part}:${pattern.color}`, localX, localY) % 5 === 0;
          }
          if (apply) {
            const offset = (y * image.width + x) * 4;
            const pixel = pattern.kind === 'speckle' ? accent : color;
            image.data[offset] = pixel[0];
            image.data[offset + 1] = pixel[1];
            image.data[offset + 2] = pixel[2];
            image.data[offset + 3] = 255;
          }
        }
      }
    }
  }
}

function paintOverlayFaces(
  image: PNG,
  faces: Array<{ x: number; y: number; w: number; h: number }>,
  color: [number, number, number, number],
): void {
  // overlay 棋盘格填充：保留基础层可见、符合双层语义
  for (const face of faces) {
    for (let y = face.y; y < face.y + face.h; y += 1) {
      for (let x = face.x; x < face.x + face.w; x += 1) {
        if ((x + y) % 2 === 0) {
          const offset = (y * image.width + x) * 4;
          image.data[offset] = color[0];
          image.data[offset + 1] = color[1];
          image.data[offset + 2] = color[2];
          image.data[offset + 3] = 255;
        }
      }
    }
  }
}

/** 渲染结构化设计为 64×64 PNG（确定性：同设计同输出）。 */
export function renderSkinDesign(design: SkinDesign): Uint8Array {
  const image = new PNG({ width: 64, height: 64 });
  image.data.fill(0);
  const p = design.palette;

  // 1. 基础面（含深度着色与边缘加深）
  for (const part of ['head', 'torso', 'arm', 'leg'] as PartName[]) {
    const color =
      part === 'head'
        ? hexToRgba(p.skin)
        : part === 'torso'
          ? hexToRgba(p.shirt)
          : part === 'arm'
            ? hexToRgba(p.sleeve)
            : hexToRgba(p.pants);
    for (const face of FACES[part]) {
      paintFace(image, face, color);
    }
  }

  // 2. 图案
  for (const part of ['head', 'torso', 'arm', 'leg'] as PartName[]) {
    paintPartPatterns(image, design, part);
  }

  // 3. 头发：顶面全覆盖 + 正面刘海 + 侧面（long 风格延伸到侧面下半）
  const hair = hexToRgba(p.hair);
  const fringe = Math.min(design.hair.fringe_rows, 2);
  paintFace(image, FACES.head[0]!, hair, false); // 头顶
  const headFront = FACES.head[3]!;
  for (let y = headFront.y; y < headFront.y + fringe; y += 1) {
    for (let x = headFront.x; x < headFront.x + headFront.w; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = hair[0];
      image.data[offset + 1] = hair[1];
      image.data[offset + 2] = hair[2];
      image.data[offset + 3] = 255;
    }
  }
  const headSides = [FACES.head[2]!, FACES.head[4]!];
  const headBack = FACES.head[5]!;
  const sideRows = design.hair.style === 'long' ? 6 : 3;
  for (const side of headSides) {
    for (let y = side.y; y < side.y + sideRows; y += 1) {
      for (let x = side.x; x < side.x + side.w; x += 1) {
        const offset = (y * image.width + x) * 4;
        image.data[offset] = hair[0];
        image.data[offset + 1] = hair[1];
        image.data[offset + 2] = hair[2];
        image.data[offset + 3] = 255;
      }
    }
  }
  for (let y = headBack.y; y < headBack.y + (design.hair.style === 'long' ? 8 : 5); y += 1) {
    for (let x = headBack.x; x < headBack.x + headBack.w; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = hair[0];
      image.data[offset + 1] = hair[1];
      image.data[offset + 2] = hair[2];
      image.data[offset + 3] = 255;
    }
  }

  // 4. 脸部细节（头正面 (8,8)-(15,15)：眉 y=10、眼 y=11..12、嘴 y=14）
  const skin = hexToRgba(p.skin);
  const brow = hexToRgba(p.eyebrows);
  const eye = hexToRgba(p.eyes);
  const white = [240, 240, 240, 255] as [number, number, number, number];
  const writePixel = (x: number, y: number, pixel: [number, number, number, number]) => {
    const offset = (y * image.width + x) * 4;
    image.data[offset] = pixel[0];
    image.data[offset + 1] = pixel[1];
    image.data[offset + 2] = pixel[2];
    image.data[offset + 3] = 255;
  };
  // 眉毛（hair 色的眉毛会与刘海冲突，故用 eyebrow 色）
  writePixel(10, 10, brow);
  writePixel(11, 10, brow);
  writePixel(13, 10, brow);
  writePixel(14, 10, brow);
  // 眼睛：白 + 瞳（round=2×2 双列，narrow=1 列）
  if (design.face.eye_style === 'narrow') {
    writePixel(10, 11, white);
    writePixel(11, 11, eye);
    writePixel(13, 11, eye);
    writePixel(14, 11, white);
  } else {
    writePixel(10, 11, white);
    writePixel(11, 11, eye);
    writePixel(10, 12, white);
    writePixel(11, 12, eye);
    writePixel(13, 11, white);
    writePixel(14, 11, eye);
    writePixel(13, 12, white);
    writePixel(14, 12, eye);
  }
  // 嘴
  if (design.face.mouth) {
    writePixel(11, 14, shadePixel(skin, -0.3));
    writePixel(12, 14, shadePixel(skin, -0.3));
  }

  // 5. 服装层次
  // 围巾：头底面 + 躯干上部两行
  if (p.scarf) {
    const scarf = hexToRgba(p.scarf);
    paintFace(image, FACES.head[1]!, scarf, false); // 头底面（下巴下方）
    for (const face of [FACES.torso[2]!, FACES.torso[3]!, FACES.torso[4]!, FACES.torso[5]!]) {
      for (let y = face.y; y < face.y + 2; y += 1) {
        for (let x = face.x; x < face.x + face.w; x += 1) {
          writePixel(x, y, scarf);
        }
      }
    }
  }
  // 腰带：躯干最底一行
  if (p.belt && design.clothing.belt) {
    const belt = hexToRgba(p.belt);
    for (const face of FACES.torso.slice(2)) {
      for (let x = face.x; x < face.x + face.w; x += 1) {
        writePixel(x, face.y + face.h - 1, belt);
      }
    }
  }
  // 靴子：双腿底部三行
  if (design.clothing.boots) {
    const boots = hexToRgba(p.boots);
    for (const face of FACES.leg) {
      for (let y = face.y + face.h - 3; y < face.y + face.h; y += 1) {
        for (let x = face.x; x < face.x + face.w; x += 1) {
          writePixel(x, y, boots);
        }
      }
    }
  }
  // 短袖：手臂底部四行换成肤色（手）
  if (design.clothing.sleeve_length === 'short') {
    for (const face of FACES.arm) {
      paintFace(image, face, skin, false);
    }
    // 只保留肩部两行为袖色
    for (const face of [FACES.arm[0]!, FACES.arm[1]!, FACES.arm[6]!, FACES.arm[7]!]) {
      paintFace(image, face, hexToRgba(p.sleeve), false);
    }
  }

  // 6. overlay（最外层）：palette 提供 overlay 色时棋盘格填充
  const overlayPairs: Array<[PartName, string | null]> = [
    ['head', p.head_overlay],
    ['torso', p.shirt_overlay],
    ['arm', p.arm_overlay],
    ['leg', p.leg_overlay],
  ];
  for (const [part, overlayColor] of overlayPairs) {
    if (overlayColor) {
      paintOverlayFaces(image, OVERLAY_FACES[part], hexToRgba(overlayColor));
    }
  }

  return new Uint8Array(PNG.sync.write(image));
}

export function skinDesignSha256(design: SkinDesign): string {
  return createHash('sha256').update(JSON.stringify(design)).digest('hex');
}
