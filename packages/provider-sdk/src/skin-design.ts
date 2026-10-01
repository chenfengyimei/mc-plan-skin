import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { z } from 'zod';

/**
 * 结构化皮肤设计：多模态文本模型输出的中间表示（分区调色板 + 图案），
 * 由本模块的确定性渲染器生成 64×64 PNG。
 * 设计合法性由 schema 保证，像素合法性由渲染器保证——模型无法产生非法布局。
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const skinDesignSchema = z.object({
  palette: z.object({
    head: hexColor,
    head_overlay: hexColor.nullable(),
    torso: hexColor,
    torso_overlay: hexColor.nullable(),
    arm: hexColor,
    arm_overlay: hexColor.nullable(),
    leg: hexColor,
    leg_overlay: hexColor.nullable(),
    accent: hexColor,
    eyes: hexColor,
  }),
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

/** 各部件的正面/侧面/顶底基础面区域（64×64 布局）。 */
const FACES: Record<
  PartName,
  Array<{ x: number; y: number; w: number; h: number; shade: number }>
> = {
  head: [
    { x: 8, y: 0, w: 8, h: 8, shade: 0.1 },
    { x: 16, y: 0, w: 8, h: 8, shade: -0.15 },
    { x: 0, y: 8, w: 8, h: 8, shade: -0.08 },
    { x: 8, y: 8, w: 8, h: 8, shade: 0 },
    { x: 16, y: 8, w: 8, h: 8, shade: -0.08 },
    { x: 24, y: 8, w: 8, h: 8, shade: -0.15 },
  ],
  torso: [
    { x: 20, y: 16, w: 8, h: 4, shade: 0.1 },
    { x: 28, y: 16, w: 8, h: 4, shade: -0.15 },
    { x: 16, y: 20, w: 8, h: 12, shade: -0.08 },
    { x: 20, y: 20, w: 8, h: 12, shade: 0 },
    { x: 28, y: 20, w: 8, h: 12, shade: -0.08 },
    { x: 32, y: 20, w: 8, h: 12, shade: -0.15 },
  ],
  arm: [
    { x: 44, y: 16, w: 4, h: 4, shade: 0.1 },
    { x: 48, y: 16, w: 4, h: 4, shade: -0.15 },
    { x: 40, y: 20, w: 4, h: 12, shade: -0.08 },
    { x: 44, y: 20, w: 4, h: 12, shade: 0 },
    { x: 48, y: 20, w: 4, h: 12, shade: -0.08 },
    { x: 52, y: 20, w: 4, h: 12, shade: -0.15 },
    // 左臂（64×64 布局）
    { x: 36, y: 48, w: 4, h: 4, shade: 0.1 },
    { x: 40, y: 48, w: 4, h: 4, shade: -0.15 },
    { x: 32, y: 52, w: 4, h: 12, shade: -0.08 },
    { x: 36, y: 52, w: 4, h: 12, shade: 0 },
    { x: 40, y: 52, w: 4, h: 12, shade: -0.08 },
    { x: 44, y: 52, w: 4, h: 12, shade: -0.15 },
  ],
  leg: [
    { x: 4, y: 16, w: 4, h: 4, shade: 0.1 },
    { x: 8, y: 16, w: 4, h: 4, shade: -0.15 },
    { x: 0, y: 20, w: 4, h: 12, shade: -0.08 },
    { x: 4, y: 20, w: 4, h: 12, shade: 0 },
    { x: 8, y: 20, w: 4, h: 12, shade: -0.08 },
    { x: 12, y: 20, w: 4, h: 12, shade: -0.15 },
    // 左腿
    { x: 20, y: 48, w: 4, h: 4, shade: 0.1 },
    { x: 24, y: 48, w: 4, h: 4, shade: -0.15 },
    { x: 16, y: 52, w: 4, h: 12, shade: -0.08 },
    { x: 20, y: 52, w: 4, h: 12, shade: 0 },
    { x: 24, y: 52, w: 4, h: 12, shade: -0.08 },
    { x: 28, y: 52, w: 4, h: 12, shade: -0.15 },
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

function applyShade(hex: string, shade: number): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return [clamp(r * (1 + shade)), clamp(g * (1 + shade)), clamp(b * (1 + shade)), 255];
}

/** 部件内确定性伪随机（speckle 图案用），与运行环境无关。 */
function seededValue(seed: string, x: number, y: number): number {
  const hash = createHash('sha256').update(`${seed}:${x}:${y}`).digest();
  return hash[0] ?? 0;
}

function paintPartPattern(
  image: PNG,
  part: PartName,
  pattern: { kind: 'solid' | 'stripe' | 'border' | 'speckle'; color: string },
  accent: string,
): void {
  const patternColor = applyShade(pattern.color, 0);
  const accentPixel = applyShade(accent, 0);
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
          const color = pattern.kind === 'speckle' ? accentPixel : patternColor;
          image.data[offset] = color[0];
          image.data[offset + 1] = color[1];
          image.data[offset + 2] = color[2];
          image.data[offset + 3] = 255;
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
  for (const face of faces) {
    for (let y = face.y; y < face.y + face.h; y += 1) {
      for (let x = face.x; x < face.x + face.w; x += 1) {
        // overlay 只填 1/3 像素（棋盘格），保留基础层可见、符合双层语义
        const offset = (y * image.width + x) * 4;
        if ((x + y) % 2 === 0) {
          image.data[offset] = color[0];
          image.data[offset + 1] = color[1];
          image.data[offset + 2] = color[2];
          image.data[offset + 3] = 255;
        }
      }
    }
  }
}

function paintFace(
  image: PNG,
  face: { x: number; y: number; w: number; h: number; shade: number },
  color: [number, number, number, number],
): void {
  for (let y = face.y; y < face.y + face.h; y += 1) {
    for (let x = face.x; x < face.x + face.w; x += 1) {
      const offset = (y * image.width + x) * 4;
      const shaded = applyShade(
        `#${[color[0], color[1], color[2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`,
        face.shade,
      );
      image.data[offset] = shaded[0];
      image.data[offset + 1] = shaded[1];
      image.data[offset + 2] = shaded[2];
      image.data[offset + 3] = 255;
    }
  }
}

function paintEyes(image: PNG, eyesColor: string, accentColor: string): void {
  const eye = applyShade(eyesColor, 0);
  const white = [240, 240, 240, 255] as [number, number, number, number];
  // 头部正面 (8,8)-(15,15)：眼睛位于 (10,12) 与 (13,12)，各 1×2
  for (const eyeX of [10, 13]) {
    for (const eyeY of [11, 12]) {
      const offset = (eyeY * image.width + eyeX) * 4;
      image.data[offset] = white[0];
      image.data[offset + 1] = white[1];
      image.data[offset + 2] = white[2];
      image.data[offset + 3] = 255;
    }
    const pupilOffset = (12 * image.width + eyeX) * 4;
    image.data[pupilOffset] = eye[0];
    image.data[pupilOffset + 1] = eye[1];
    image.data[pupilOffset + 2] = eye[2];
    image.data[pupilOffset + 3] = 255;
  }
  // 嘴：accent 色 2×1 于 (11,14)
  for (const mouthX of [11, 12]) {
    const offset = (14 * image.width + mouthX) * 4;
    image.data[offset] = accentColor === eyesColor ? 120 : 90;
    image.data[offset + 1] = 70;
    image.data[offset + 2] = 60;
    image.data[offset + 3] = 255;
  }
}

/** 渲染结构化设计为 64×64 PNG（确定性：同设计同输出）。 */
export function renderSkinDesign(design: SkinDesign): Uint8Array {
  const image = new PNG({ width: 64, height: 64 });
  image.data.fill(0);

  const partColors: Record<PartName, string> = {
    head: design.palette.head,
    torso: design.palette.torso,
    arm: design.palette.arm,
    leg: design.palette.leg,
  };

  for (const part of ['head', 'torso', 'arm', 'leg'] as PartName[]) {
    const baseColor = applyShade(partColors[part], 0);
    for (const face of FACES[part]) {
      paintFace(image, face, baseColor);
    }
  }

  for (const pattern of design.patterns) {
    paintPartPattern(image, pattern.part, pattern, design.palette.accent);
  }

  paintEyes(image, design.palette.eyes, design.palette.accent);

  // overlay：palette 提供 overlay 色时填充对应 overlay 面（保证双层语义）
  const overlayPairs: Array<[PartName, string | null]> = [
    ['head', design.palette.head_overlay],
    ['torso', design.palette.torso_overlay],
    ['arm', design.palette.arm_overlay],
    ['leg', design.palette.leg_overlay],
  ];
  for (const [part, overlayColor] of overlayPairs) {
    if (overlayColor) {
      paintOverlayFaces(image, OVERLAY_FACES[part], applyShade(overlayColor, 0));
    }
  }

  return new Uint8Array(PNG.sync.write(image));
}

export function skinDesignSha256(design: SkinDesign): string {
  return createHash('sha256').update(JSON.stringify(design)).digest('hex');
}
