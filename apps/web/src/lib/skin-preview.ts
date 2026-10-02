import type { ArmModel } from '@mc-plan/skin-core';

export type SkinFaceName = 'top' | 'bottom' | 'left' | 'front' | 'right' | 'back';

export interface SkinUvRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SkinFaceSet = Record<SkinFaceName, SkinUvRect>;

export interface SkinPartDefinition {
  id: 'head' | 'torso' | 'right-arm' | 'left-arm' | 'right-leg' | 'left-leg';
  width: number;
  height: number;
  depth: number;
  centerX: number;
  centerY: number;
  base: SkinFaceSet;
  overlay: SkinFaceSet;
}

export interface SkinPreviewRotation {
  yaw: number;
  pitch: number;
}

export type SkinAnimationName = 'idle' | 'walk' | 'run' | 'fly';

export interface SkinAnimationDefinition {
  label: string;
  description: string;
  baseDurationSeconds: number;
}

export const SKIN_ANIMATIONS: Record<SkinAnimationName, SkinAnimationDefinition> = {
  idle: { label: '待机', description: '轻微呼吸与重心起伏', baseDurationSeconds: 2.8 },
  walk: { label: '行走', description: '自然交替摆动四肢', baseDurationSeconds: 0.92 },
  run: { label: '跑步', description: '更大幅度的快速步态', baseDurationSeconds: 0.5 },
  fly: { label: '飞行', description: '前倾飞行并展开四肢', baseDurationSeconds: 1.15 },
};

export const DEFAULT_SKIN_ROTATION: SkinPreviewRotation = { yaw: -28, pitch: -8 };

const FACE_NAMES: SkinFaceName[] = ['top', 'bottom', 'left', 'front', 'right', 'back'];

type RectTuple = [x: number, y: number, width: number, height: number];

function faceSet(
  rects: [RectTuple, RectTuple, RectTuple, RectTuple, RectTuple, RectTuple],
): SkinFaceSet {
  return Object.fromEntries(
    rects.map(([x, y, width, height], index) => [FACE_NAMES[index], { x, y, width, height }]),
  ) as SkinFaceSet;
}

const HEAD_BASE = faceSet([
  [8, 0, 8, 8],
  [16, 0, 8, 8],
  [0, 8, 8, 8],
  [8, 8, 8, 8],
  [16, 8, 8, 8],
  [24, 8, 8, 8],
]);
const HEAD_OVERLAY = faceSet([
  [40, 0, 8, 8],
  [48, 0, 8, 8],
  [32, 8, 8, 8],
  [40, 8, 8, 8],
  [48, 8, 8, 8],
  [56, 8, 8, 8],
]);
const TORSO_BASE = faceSet([
  [20, 16, 8, 4],
  [28, 16, 8, 4],
  [16, 20, 4, 12],
  [20, 20, 8, 12],
  [28, 20, 4, 12],
  [32, 20, 8, 12],
]);
const TORSO_OVERLAY = faceSet([
  [20, 32, 8, 4],
  [28, 32, 8, 4],
  [16, 36, 4, 12],
  [20, 36, 8, 12],
  [28, 36, 4, 12],
  [32, 36, 8, 12],
]);

function armFaces(armModel: ArmModel, left: boolean, overlay: boolean): SkinFaceSet {
  const width = armModel === 'alex' ? 3 : 4;
  const topX = left ? (overlay ? 52 : 36) : 44;
  const topY = left ? 48 : overlay ? 32 : 16;
  const sideX = left ? (overlay ? 48 : 32) : 40;
  const sideY = left ? 52 : overlay ? 36 : 20;
  return faceSet([
    [topX, topY, width, 4],
    [topX + width, topY, width, 4],
    [sideX, sideY, 4, 12],
    [sideX + 4, sideY, width, 12],
    [sideX + 4 + width, sideY, 4, 12],
    [sideX + 8 + width, sideY, width, 12],
  ]);
}

function legFaces(left: boolean, overlay: boolean): SkinFaceSet {
  const topX = left ? (overlay ? 4 : 20) : 4;
  const topY = left ? 48 : overlay ? 32 : 16;
  const sideX = left ? (overlay ? 0 : 16) : 0;
  const sideY = left ? 52 : overlay ? 36 : 20;
  return faceSet([
    [topX, topY, 4, 4],
    [topX + 4, topY, 4, 4],
    [sideX, sideY, 4, 12],
    [sideX + 4, sideY, 4, 12],
    [sideX + 8, sideY, 4, 12],
    [sideX + 12, sideY, 4, 12],
  ]);
}

/** Minecraft Java 64×64 皮肤的六个可旋转部件及基础/第二层 UV。 */
export function getSkinModelParts(armModel: ArmModel): SkinPartDefinition[] {
  const armWidth = armModel === 'alex' ? 3 : 4;
  const armCenter = 4 + armWidth / 2;
  return [
    {
      id: 'head',
      width: 8,
      height: 8,
      depth: 8,
      centerX: 0,
      centerY: -12,
      base: HEAD_BASE,
      overlay: HEAD_OVERLAY,
    },
    {
      id: 'torso',
      width: 8,
      height: 12,
      depth: 4,
      centerX: 0,
      centerY: -2,
      base: TORSO_BASE,
      overlay: TORSO_OVERLAY,
    },
    {
      id: 'right-arm',
      width: armWidth,
      height: 12,
      depth: 4,
      centerX: -armCenter,
      centerY: -2,
      base: armFaces(armModel, false, false),
      overlay: armFaces(armModel, false, true),
    },
    {
      id: 'left-arm',
      width: armWidth,
      height: 12,
      depth: 4,
      centerX: armCenter,
      centerY: -2,
      base: armFaces(armModel, true, false),
      overlay: armFaces(armModel, true, true),
    },
    {
      id: 'right-leg',
      width: 4,
      height: 12,
      depth: 4,
      centerX: -2,
      centerY: 10,
      base: legFaces(false, false),
      overlay: legFaces(false, true),
    },
    {
      id: 'left-leg',
      width: 4,
      height: 12,
      depth: 4,
      centerX: 2,
      centerY: 10,
      base: legFaces(true, false),
      overlay: legFaces(true, true),
    },
  ];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** 根据播放速度返回 CSS 动画周期，避免零速和异常输入。 */
export function getSkinAnimationDurationSeconds(
  animation: SkinAnimationName,
  speed: number,
): number {
  const safeSpeed = clamp(Number.isFinite(speed) ? speed : 1, 0.25, 2);
  return SKIN_ANIMATIONS[animation].baseDurationSeconds / safeSpeed;
}

/** 将指针位移转换成稳定旋转；俯仰限幅，水平旋转不截断。 */
export function rotateSkinPreview(
  current: SkinPreviewRotation,
  deltaX: number,
  deltaY: number,
): SkinPreviewRotation {
  return { yaw: current.yaw + deltaX * 0.55, pitch: clamp(current.pitch - deltaY * 0.4, -32, 32) };
}

/** 无指针设备使用的方向键旋转。 */
export function rotateSkinPreviewByKey(
  current: SkinPreviewRotation,
  key: string,
): SkinPreviewRotation {
  switch (key) {
    case 'ArrowLeft':
      return { ...current, yaw: current.yaw - 12 };
    case 'ArrowRight':
      return { ...current, yaw: current.yaw + 12 };
    case 'ArrowUp':
      return { ...current, pitch: clamp(current.pitch + 8, -32, 32) };
    case 'ArrowDown':
      return { ...current, pitch: clamp(current.pitch - 8, -32, 32) };
    case 'Home':
      return { ...DEFAULT_SKIN_ROTATION };
    default:
      return current;
  }
}
