import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SKIN_ROTATION,
  SKIN_ANIMATIONS,
  getSkinAnimationDurationSeconds,
  getSkinModelParts,
  rotateSkinPreview,
  rotateSkinPreviewByKey,
} from '../src/lib/skin-preview';

describe('3D 皮肤预览几何', () => {
  it('Steve 使用六个完整部件和规范正反面 UV', () => {
    const parts = getSkinModelParts('steve');
    expect(parts.map((part) => part.id)).toEqual([
      'head',
      'torso',
      'right-arm',
      'left-arm',
      'right-leg',
      'left-leg',
    ]);
    expect(parts.find((part) => part.id === 'head')?.base.front).toEqual({
      x: 8,
      y: 8,
      width: 8,
      height: 8,
    });
    expect(parts.find((part) => part.id === 'head')?.base.back).toEqual({
      x: 24,
      y: 8,
      width: 8,
      height: 8,
    });
    expect(parts.find((part) => part.id === 'torso')?.overlay.front).toEqual({
      x: 20,
      y: 36,
      width: 8,
      height: 12,
    });
  });

  it('Alex 双臂缩为 3px，并维持关于身体中心对称', () => {
    const parts = getSkinModelParts('alex');
    const right = parts.find((part) => part.id === 'right-arm');
    const left = parts.find((part) => part.id === 'left-arm');
    expect(right?.width).toBe(3);
    expect(left?.width).toBe(3);
    expect(right?.centerX).toBe(-5.5);
    expect(left?.centerX).toBe(5.5);
    expect(right?.base.front).toEqual({ x: 44, y: 20, width: 3, height: 12 });
    expect(left?.overlay.back).toEqual({ x: 59, y: 52, width: 3, height: 12 });
  });

  it('所有基础层与第二层 UV 均位于 64×64 图内', () => {
    for (const model of ['steve', 'alex'] as const) {
      for (const part of getSkinModelParts(model)) {
        for (const layer of [part.base, part.overlay]) {
          for (const rect of Object.values(layer)) {
            expect(rect.x).toBeGreaterThanOrEqual(0);
            expect(rect.y).toBeGreaterThanOrEqual(0);
            expect(rect.x + rect.width).toBeLessThanOrEqual(64);
            expect(rect.y + rect.height).toBeLessThanOrEqual(64);
          }
        }
      }
    }
  });
});

describe('3D 皮肤预览旋转', () => {
  it('拖动改变 yaw 并把 pitch 限制在可读范围', () => {
    expect(rotateSkinPreview(DEFAULT_SKIN_ROTATION, 20, -200)).toEqual({ yaw: -17, pitch: 32 });
    expect(rotateSkinPreview(DEFAULT_SKIN_ROTATION, -20, 200)).toEqual({ yaw: -39, pitch: -32 });
  });

  it('方向键可旋转，Home 恢复默认视角', () => {
    const rotated = rotateSkinPreviewByKey(DEFAULT_SKIN_ROTATION, 'ArrowRight');
    expect(rotated.yaw).toBe(-16);
    expect(rotateSkinPreviewByKey(rotated, 'Home')).toEqual(DEFAULT_SKIN_ROTATION);
    expect(rotateSkinPreviewByKey(rotated, 'Enter')).toBe(rotated);
  });
});

describe('3D 皮肤预览动画', () => {
  it('提供待机、行走、跑步与飞行四种动作', () => {
    expect(Object.keys(SKIN_ANIMATIONS)).toEqual(['idle', 'walk', 'run', 'fly']);
    expect(SKIN_ANIMATIONS.walk.description).toContain('四肢');
  });

  it('速度越高周期越短，并把异常速度限制在安全范围', () => {
    expect(getSkinAnimationDurationSeconds('walk', 1)).toBe(0.92);
    expect(getSkinAnimationDurationSeconds('walk', 2)).toBe(0.46);
    expect(getSkinAnimationDurationSeconds('run', 0)).toBe(2);
    expect(getSkinAnimationDurationSeconds('idle', Number.NaN)).toBe(2.8);
  });
});
