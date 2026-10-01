import { PNG } from 'pngjs';

import type { ArmModel } from '@mc-plan/skin-core';

/**
 * 2D 像素预览的解码与合成（纯函数，浏览器与 Node 均可运行）。
 * 输入为已通过 skin-validator 校验的 64×64 PNG 字节；
 * 输出 16×32 正面视角 RGBA 合成图（含第二层透明合成）。
 * 3D 预览库（Q-011 未决）未来实现时替换本模块的调用方即可，
 * SkinPreview 组件接口保持不变。
 */

export const PREVIEW_WIDTH = 16;
export const PREVIEW_HEIGHT = 32;

/** 64×64 布局的正面区域（x, y, w, h）。 */
const FRONT_FACES = {
  head: { x: 8, y: 8, w: 8, h: 8 },
  body: { x: 20, y: 20, w: 8, h: 12 },
  rightArm: { x: 44, y: 20, w: 4, h: 12 },
  leftArm: { x: 36, y: 52, w: 4, h: 12 },
  rightLeg: { x: 4, y: 20, w: 4, h: 12 },
  leftLeg: { x: 20, y: 52, w: 4, h: 12 },
} as const;

/** 第二层正面区域（与基础部件一一对应）。 */
const OVERLAY_FACES = {
  head: { x: 40, y: 8, w: 8, h: 8 },
  body: { x: 20, y: 36, w: 8, h: 12 },
  rightArm: { x: 44, y: 36, w: 4, h: 12 },
  leftArm: { x: 52, y: 52, w: 4, h: 12 },
  rightLeg: { x: 4, y: 36, w: 4, h: 12 },
  leftLeg: { x: 20, y: 52, w: 4, h: 12 },
} as const;

export interface SkinPreviewData {
  width: number;
  height: number;
  /** 16×32 正面合成 RGBA，预乘不处理，保留原始 alpha。 */
  pixels: Uint8Array;
  armModel: ArmModel;
}

function readPixel(image: PNG, x: number, y: number): [number, number, number, number] {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
    image.data[offset + 3] ?? 0,
  ];
}

function writePixel(
  target: Uint8Array,
  x: number,
  y: number,
  pixel: [number, number, number, number],
): void {
  const offset = (y * PREVIEW_WIDTH + x) * 4;
  target[offset] = pixel[0];
  target[offset + 1] = pixel[1];
  target[offset + 2] = pixel[2];
  target[offset + 3] = pixel[3];
}

/** alpha 透明合成：overlay 像素在 alpha>0 时覆盖基础像素。 */
function blendOver(
  base: [number, number, number, number],
  overlay: [number, number, number, number],
): [number, number, number, number] {
  if (overlay[3] === 0) {
    return base;
  }
  return overlay;
}

/** 解码 64×64 皮肤并合成 16×32 正面预览。尺寸或解码错误直接抛错（上游已校验）。 */
export function decodeSkinForPreview(bytes: Uint8Array, armModel: ArmModel): SkinPreviewData {
  const image = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (image.width !== 64 || image.height !== 64) {
    throw new Error(`预览解码要求 64×64 皮肤，实际 ${image.width}×${image.height}`);
  }

  const pixels = new Uint8Array(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4);
  const armWidth = armModel === 'alex' ? 3 : 4;

  const drawPart = (
    part: { x: number; y: number; w: number; h: number },
    overlay: { x: number; y: number; w: number; h: number },
    targetX: number,
    targetY: number,
    width: number,
  ): void => {
    for (let row = 0; row < part.h; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const basePixel = readPixel(image, part.x + column, part.y + row);
        const overlayPixel = readPixel(image, overlay.x + column, overlay.y + row);
        writePixel(pixels, targetX + column, targetY + row, blendOver(basePixel, overlayPixel));
      }
    }
  };

  // 正面视角：头（4..11, 0..7）、右臂（0.., 8..19）、身（4..11, 8..19）、
  // 左臂（12.., 8..19）、右腿（4..7, 20..31）、左腿（8..11, 20..31）
  drawPart(FRONT_FACES.head, OVERLAY_FACES.head, 4, 0, 8);
  drawPart(FRONT_FACES.rightArm, OVERLAY_FACES.rightArm, 4 - armWidth, 8, armWidth);
  drawPart(FRONT_FACES.body, OVERLAY_FACES.body, 4, 8, 8);
  drawPart(FRONT_FACES.leftArm, OVERLAY_FACES.leftArm, 12, 8, armWidth);
  drawPart(FRONT_FACES.rightLeg, OVERLAY_FACES.rightLeg, 4, 20, 4);
  drawPart(FRONT_FACES.leftLeg, OVERLAY_FACES.leftLeg, 8, 20, 4);

  return { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, pixels, armModel };
}
