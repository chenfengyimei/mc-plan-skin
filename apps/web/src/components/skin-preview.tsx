'use client';

import { useEffect, useRef } from 'react';

import type { ArmModel } from '@mc-plan/skin-core';

import { PREVIEW_HEIGHT, PREVIEW_WIDTH, decodeSkinForPreview } from '../lib/skin-preview';

/**
 * 皮肤预览组件。当前 renderer 固定为可测试的 2D 像素实现（Q-011 未决，
 * 3D 库在 ADR 决策后通过同一接口替换，不改动调用方）。
 */
export interface SkinPreviewProps {
  /** 已校验的 64×64 PNG 字节。 */
  bytes: Uint8Array;
  armModel: ArmModel;
  /** 像素放大倍数，默认 8（128×256 显示）。 */
  scale?: number;
  renderer?: '2d';
}

export function SkinPreview({ bytes, armModel, scale = 8, renderer = '2d' }: SkinPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || renderer !== '2d') {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    const preview = decodeSkinForPreview(bytes, armModel);
    canvas.width = preview.width * scale;
    canvas.height = preview.height * scale;
    const imageData = new ImageData(
      new Uint8ClampedArray(preview.pixels),
      preview.width,
      preview.height,
    );
    const offscreen = new OffscreenCanvas(preview.width, preview.height);
    const offscreenContext = offscreen.getContext('2d');
    if (!offscreenContext) {
      return;
    }
    offscreenContext.putImageData(imageData, 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
  }, [bytes, armModel, scale, renderer]);

  return (
    <canvas ref={canvasRef} aria-label="皮肤预览" width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} />
  );
}
