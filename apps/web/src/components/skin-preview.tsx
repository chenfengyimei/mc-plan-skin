'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, TouchEvent } from 'react';

import type { ArmModel } from '@mc-plan/skin-core';

import {
  DEFAULT_SKIN_ROTATION,
  getSkinModelParts,
  rotateSkinPreview,
  rotateSkinPreviewByKey,
} from '../lib/skin-preview';
import type {
  SkinFaceName,
  SkinFaceSet,
  SkinPartDefinition,
  SkinPreviewRotation,
  SkinUvRect,
} from '../lib/skin-preview';

export interface SkinPreviewProps {
  /** 已校验的 64×64 PNG 字节。 */
  bytes: Uint8Array;
  armModel: ArmModel;
  /** 一个 Minecraft 像素对应的 CSS 像素数。 */
  scale?: number;
}

interface DragState {
  input: 'mouse' | 'touch';
  x: number;
  y: number;
}

const FACE_BRIGHTNESS: Record<SkinFaceName, number> = {
  top: 1.12,
  bottom: 0.62,
  left: 0.82,
  front: 1,
  right: 0.9,
  back: 0.72,
};

function facePosition(
  name: SkinFaceName,
  part: SkinPartDefinition,
  scale: number,
): Pick<CSSProperties, 'left' | 'top' | 'transform'> {
  const width = part.width * scale;
  const height = part.height * scale;
  const depth = part.depth * scale;
  switch (name) {
    case 'front':
      return { left: 0, top: 0, transform: `translateZ(${depth / 2}px)` };
    case 'back':
      return { left: 0, top: 0, transform: `rotateY(180deg) translateZ(${depth / 2}px)` };
    case 'left':
      return {
        left: (width - depth) / 2,
        top: 0,
        transform: `rotateY(-90deg) translateZ(${width / 2}px)`,
      };
    case 'right':
      return {
        left: (width - depth) / 2,
        top: 0,
        transform: `rotateY(90deg) translateZ(${width / 2}px)`,
      };
    case 'top':
      return {
        left: 0,
        top: (height - depth) / 2,
        transform: `rotateX(90deg) translateZ(${height / 2}px)`,
      };
    case 'bottom':
      return {
        left: 0,
        top: (height - depth) / 2,
        transform: `rotateX(-90deg) translateZ(${height / 2}px)`,
      };
  }
}

function Face({
  name,
  uv,
  part,
  scale,
  imageUrl,
}: {
  name: SkinFaceName;
  uv: SkinUvRect;
  part: SkinPartDefinition;
  scale: number;
  imageUrl: string;
}) {
  return (
    <span
      className={`skin-face skin-face-${name}`}
      style={{
        ...facePosition(name, part, scale),
        width: uv.width * scale,
        height: uv.height * scale,
        backgroundImage: `url("${imageUrl}")`,
        backgroundSize: `${64 * scale}px ${64 * scale}px`,
        backgroundPosition: `${-uv.x * scale}px ${-uv.y * scale}px`,
        filter: `brightness(${FACE_BRIGHTNESS[name]})`,
      }}
    />
  );
}

function CuboidLayer({
  part,
  faces,
  scale,
  imageUrl,
  overlay,
}: {
  part: SkinPartDefinition;
  faces: SkinFaceSet;
  scale: number;
  imageUrl: string;
  overlay: boolean;
}) {
  const layerStyle: CSSProperties = overlay
    ? {
        transform: `scale3d(${(part.width + 1) / part.width}, ${(part.height + 1) / part.height}, ${(part.depth + 1) / part.depth})`,
      }
    : {};
  return (
    <span
      className={`skin-cuboid-layer${overlay ? ' skin-cuboid-overlay' : ''}`}
      style={layerStyle}
    >
      {(Object.keys(faces) as SkinFaceName[]).map((name) => (
        <Face
          key={name}
          name={name}
          uv={faces[name]}
          part={part}
          scale={scale}
          imageUrl={imageUrl}
        />
      ))}
    </span>
  );
}

function SkinPart({
  part,
  scale,
  imageUrl,
}: {
  part: SkinPartDefinition;
  scale: number;
  imageUrl: string;
}) {
  return (
    <span
      className={`skin-cuboid skin-cuboid-${part.id}`}
      style={{
        width: part.width * scale,
        height: part.height * scale,
        left: `calc(50% + ${(part.centerX - part.width / 2) * scale}px)`,
        top: `calc(50% + ${(part.centerY - part.height / 2) * scale}px)`,
      }}
    >
      <CuboidLayer
        part={part}
        faces={part.base}
        scale={scale}
        imageUrl={imageUrl}
        overlay={false}
      />
      <CuboidLayer part={part} faces={part.overlay} scale={scale} imageUrl={imageUrl} overlay />
    </span>
  );
}

export function SkinPreview({ bytes, armModel, scale = 6 }: SkinPreviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState<SkinPreviewRotation>(DEFAULT_SKIN_ROTATION);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragState | null>(null);
  const parts = useMemo(() => getSkinModelParts(armModel), [armModel]);

  useEffect(() => {
    const data = Uint8Array.from(bytes).buffer as ArrayBuffer;
    const nextUrl = URL.createObjectURL(new Blob([data], { type: 'image/png' }));
    setImageUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [bytes]);

  const rotate = (deltaX: number, deltaY: number) => {
    setRotation((current) => rotateSkinPreview(current, deltaX, deltaY));
  };

  const beginDrag = (input: DragState['input'], x: number, y: number) => {
    drag.current = { input, x, y };
    setDragging(true);
  };

  const continueDrag = (input: DragState['input'], x: number, y: number) => {
    const current = drag.current;
    if (!current || current.input !== input) return;
    rotate(x - current.x, y - current.y);
    drag.current = { input, x, y };
  };

  const endDrag = (input: DragState['input']) => {
    if (drag.current?.input === input) {
      drag.current = null;
      setDragging(false);
    }
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    beginDrag('mouse', event.clientX, event.clientY);
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    continueDrag('mouse', event.clientX, event.clientY);
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (touch) beginDrag('touch', touch.clientX, touch.clientY);
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (touch) continueDrag('touch', touch.clientX, touch.clientY);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = rotateSkinPreviewByKey(rotation, event.key);
    if (next !== rotation) {
      event.preventDefault();
      setRotation(next);
    }
  };

  return (
    <div className="skin-preview-shell">
      <div className="skin-preview-label">
        <span>3D 实时预览</span>
        <small>{armModel === 'alex' ? 'Alex · 3px 手臂' : 'Steve · 4px 手臂'}</small>
      </div>
      <div
        className={`skin-preview-stage${dragging ? ' is-dragging' : ''}`}
        data-testid="skin-preview-3d"
        data-yaw={rotation.yaw.toFixed(1)}
        data-pitch={rotation.pitch.toFixed(1)}
        role="img"
        tabIndex={0}
        aria-label="3D 皮肤预览，可拖拽或使用方向键旋转"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => endDrag('mouse')}
        onMouseLeave={() => endDrag('mouse')}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => endDrag('touch')}
        onTouchCancel={() => endDrag('touch')}
        onKeyDown={handleKeyDown}
      >
        {imageUrl && (
          <div
            className="skin-model"
            style={{ transform: `rotateX(${rotation.pitch}deg) rotateY(${rotation.yaw}deg)` }}
          >
            {parts.map((part) => (
              <SkinPart key={part.id} part={part} scale={scale} imageUrl={imageUrl} />
            ))}
          </div>
        )}
        <div className="skin-preview-platform" aria-hidden="true" />
      </div>
      <div className="skin-preview-controls" aria-label="预览旋转控制">
        <button type="button" aria-label="向左旋转" onClick={() => rotate(-24, 0)}>
          ←
        </button>
        <span>拖动查看全身</span>
        <button type="button" aria-label="向右旋转" onClick={() => rotate(24, 0)}>
          →
        </button>
        <button
          type="button"
          className="skin-preview-reset"
          aria-label="重置预览视角"
          onClick={() => setRotation({ ...DEFAULT_SKIN_ROTATION })}
        >
          重置
        </button>
      </div>
    </div>
  );
}
