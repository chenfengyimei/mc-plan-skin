import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

import {
  skinComponentNames,
  type PixelGrid,
  type SkinComponentName,
  type SkinDesign,
} from './skin-design-schema.js';
import { baseFaces, overlayFaces, type Face, type PartName } from './skin-layout.js';

type Rgba = [number, number, number, number];

export interface RenderSkinDesignOptions {
  armModel?: 'steve' | 'alex';
}

function hexToRgba(hex: string): Rgba {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

function writePixel(image: PNG, x: number, y: number, pixel: Rgba): void {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = pixel[0];
  image.data[offset + 1] = pixel[1];
  image.data[offset + 2] = pixel[2];
  image.data[offset + 3] = pixel[3];
}

function facesFor(allFaces: Record<PartName, Face[]>, component: SkinComponentName): Face[] {
  if (component === 'head') return allFaces.head;
  if (component === 'torso') return allFaces.torso;
  if (component === 'right_arm') return allFaces.arm.slice(0, 6);
  if (component === 'left_arm') return allFaces.arm.slice(6, 12);
  if (component === 'right_leg') return allFaces.leg.slice(0, 6);
  return allFaces.leg.slice(6, 12);
}

function colorFor(design: SkinDesign, symbol: string): Rgba {
  const hex = design.palette[symbol];
  if (!hex) throw new Error(`缺少调色板符号 ${symbol}`);
  return hexToRgba(hex);
}

function fillFace(image: PNG, face: Face, color: Rgba): void {
  for (let y = 0; y < face.h; y += 1) {
    for (let x = 0; x < face.w; x += 1) {
      writePixel(image, face.x + x, face.y + y, color);
    }
  }
}

function sampleColumn(grid: PixelGrid, row: number, faceX: number, faceWidth: number): string {
  const sourceWidth = grid[0]?.length ?? 1;
  const sourceX = faceWidth <= 1 ? 0 : Math.round((faceX / (faceWidth - 1)) * (sourceWidth - 1));
  return grid[row]?.[sourceX] ?? grid[row]?.[0] ?? '.';
}

function paintGrid(image: PNG, face: Face, grid: PixelGrid, design: SkinDesign): void {
  for (let y = 0; y < face.h; y += 1) {
    for (let x = 0; x < face.w; x += 1) {
      const symbol = sampleColumn(grid, y, x, face.w);
      if (symbol === '.') continue;
      writePixel(image, face.x + x, face.y + y, colorFor(design, symbol));
    }
  }
}

function edgeSymbol(grid: PixelGrid, row: number, edge: 'left' | 'right'): string {
  const value = grid[row] ?? '';
  return edge === 'left' ? (value[0] ?? '.') : (value.at(-1) ?? '.');
}

/**
 * 将正反面边缘延展到侧面。这里不创造服装或花纹，只让模型画出的轮廓在立方体上连续。
 */
function paintSideContinuity(
  image: PNG,
  face: Face,
  front: PixelGrid,
  back: PixelGrid,
  side: 'left' | 'right',
  design: SkinDesign,
): void {
  const frontEdge = side === 'left' ? 'left' : 'right';
  const backEdge = side === 'left' ? 'right' : 'left';
  for (let y = 0; y < face.h; y += 1) {
    for (let x = 0; x < face.w; x += 1) {
      const useFront = x < Math.ceil(face.w / 2);
      const symbol = useFront ? edgeSymbol(front, y, frontEdge) : edgeSymbol(back, y, backEdge);
      if (symbol === '.') continue;
      writePixel(image, face.x + x, face.y + y, colorFor(design, symbol));
    }
  }
}

function paintComponent(
  image: PNG,
  design: SkinDesign,
  component: SkinComponentName,
  faces: Face[],
  overlay: boolean,
): void {
  const front = overlay ? design.overlay_front[component] : design.front[component];
  const back = overlay ? design.overlay_back[component] : design.back[component];

  if (!overlay) {
    const baseColor = colorFor(design, design.base[component]);
    for (const face of faces) fillFace(image, face, baseColor);
  }

  const frontFace = faces.find((face) => face.orientation === 'front');
  const backFace = faces.find((face) => face.orientation === 'back');
  const leftFace = faces.find((face) => face.orientation === 'left');
  const rightFace = faces.find((face) => face.orientation === 'right');
  if (!frontFace || !backFace || !leftFace || !rightFace) {
    throw new Error(`部件 ${component} 缺少标准 UV 面`);
  }

  paintGrid(image, frontFace, front, design);
  paintGrid(image, backFace, back, design);
  paintSideContinuity(image, leftFace, front, back, 'left', design);
  paintSideContinuity(image, rightFace, front, back, 'right', design);
}

/** 渲染模型直接编写的像素蓝图为合法 Minecraft Java 64×64 PNG。 */
export function renderSkinDesign(
  design: SkinDesign,
  options: RenderSkinDesignOptions = {},
): Uint8Array {
  const armModel = options.armModel ?? 'steve';
  const base = baseFaces(armModel);
  const overlays = overlayFaces(armModel);
  const image = new PNG({ width: 64, height: 64 });
  image.data.fill(0);

  for (const component of skinComponentNames) {
    paintComponent(image, design, component, facesFor(base, component), false);
    paintComponent(image, design, component, facesFor(overlays, component), true);
  }

  return new Uint8Array(PNG.sync.write(image));
}

export function skinDesignSha256(design: SkinDesign): string {
  return createHash('sha256').update(JSON.stringify(design)).digest('hex');
}
