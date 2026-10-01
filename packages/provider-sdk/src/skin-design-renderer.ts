import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

import type { SkinDesign, SkinMaterial, SkinPattern } from './skin-design-schema.js';
import {
  baseFaces,
  overlayFaces,
  type Face,
  type Orientation,
  type PartName,
} from './skin-layout.js';

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

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function shadePixel(pixel: Rgba, shade: number): Rgba {
  return [
    clamp(pixel[0] * (1 + shade)),
    clamp(pixel[1] * (1 + shade)),
    clamp(pixel[2] * (1 + shade)),
    pixel[3],
  ];
}

function mixPixel(from: Rgba, to: Rgba, amount: number): Rgba {
  const ratio = Math.max(0, Math.min(1, amount));
  return [
    clamp(from[0] * (1 - ratio) + to[0] * ratio),
    clamp(from[1] * (1 - ratio) + to[1] * ratio),
    clamp(from[2] * (1 - ratio) + to[2] * ratio),
    255,
  ];
}

function hashValue(seed: number, x: number, y: number): number {
  let value = (seed ^ Math.imul(x + 17, 0x45d9f3b) ^ Math.imul(y + 31, 0x119de1f3)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  return (value ^ (value >>> 16)) & 0xff;
}

function writePixel(image: PNG, x: number, y: number, pixel: Rgba): void {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = pixel[0];
  image.data[offset + 1] = pixel[1];
  image.data[offset + 2] = pixel[2];
  image.data[offset + 3] = pixel[3];
}

function readPixel(image: PNG, x: number, y: number): Rgba {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
    image.data[offset + 3] ?? 0,
  ];
}

function materialShade(
  material: SkinMaterial,
  x: number,
  y: number,
  width: number,
  seed: number,
): number {
  const noise = hashValue(seed, x, y) / 255 - 0.5;
  if (material === 'smooth') return noise * 0.14;
  if (material === 'cloth') return (x + y) % 2 === 0 ? 0.22 : -0.16;
  if (material === 'denim') return x % 2 === 0 ? noise * 0.55 + 0.08 : noise * 0.35 - 0.08;
  if (material === 'leather') return noise * 0.75 + (y % 4 === 0 ? -0.16 : 0);
  if (material === 'metal') {
    const centerDistance = Math.abs(x - (width - 1) / 2);
    return centerDistance < 1 ? 0.55 : centerDistance > width / 2 - 1 ? -0.32 : noise * 0.12;
  }
  return noise * 1.2;
}

function paintFace(
  image: PNG,
  face: Face,
  color: Rgba,
  material: SkinMaterial,
  intensity: number,
  seed: number,
  edgeDarken = true,
): void {
  for (let localY = 0; localY < face.h; localY += 1) {
    for (let localX = 0; localX < face.w; localX += 1) {
      const vertical = face.h > 2 ? 0.05 - (localY / (face.h - 1)) * 0.1 : 0;
      const edge =
        edgeDarken &&
        (localX === 0 || localY === 0 || localX === face.w - 1 || localY === face.h - 1)
          ? -0.08
          : 0;
      const texture = materialShade(material, localX, localY, face.w, seed) * intensity;
      writePixel(
        image,
        face.x + localX,
        face.y + localY,
        shadePixel(color, face.shade + vertical + edge + texture),
      );
    }
  }
}

function placementMatches(pattern: SkinPattern, orientation: Orientation): boolean {
  if (pattern.placement === 'all') return true;
  if (pattern.placement === 'front') return orientation === 'front';
  if (pattern.placement === 'back') return orientation === 'back';
  return orientation === 'left' || orientation === 'right';
}

function patternChoice(
  pattern: SkinPattern,
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
): 0 | 1 | 2 {
  const scale = pattern.scale;
  if (pattern.kind === 'solid') return 1;
  if (pattern.kind === 'stripe') return Math.floor(y / scale) % 2 === 0 ? 1 : 2;
  if (pattern.kind === 'pinstripe') return x % (scale + 1) === 0 ? 1 : 0;
  if (pattern.kind === 'checker') {
    return (Math.floor(x / scale) + Math.floor(y / scale)) % 2 === 0 ? 1 : 2;
  }
  if (pattern.kind === 'diagonal') return Math.floor((x + y) / scale) % 2 === 0 ? 1 : 2;
  if (pattern.kind === 'gradient') return y >= Math.floor(height / 3) ? 1 : 0;
  if (pattern.kind === 'border') {
    return x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 1 : 0;
  }
  if (pattern.kind === 'panel') {
    return x >= Math.floor(width / 3) && x < Math.ceil((width * 2) / 3) ? 1 : 0;
  }
  if (pattern.kind === 'chevron') {
    const center = (width - 1) / 2;
    return (Math.abs(x - center) + y) % Math.max(2, scale * 2) < scale ? 1 : 0;
  }
  return hashValue(seed, x, y) < 48 + scale * 12 ? 1 : 0;
}

function paintPatterns(
  image: PNG,
  patterns: SkinPattern[],
  part: PartName,
  faces: Face[],
  seed: number,
): void {
  patterns.forEach((pattern, patternIndex) => {
    if (pattern.part !== part) return;
    const primary = hexToRgba(pattern.color);
    const secondary = pattern.secondary_color ? hexToRgba(pattern.secondary_color) : null;
    faces.forEach((face, faceIndex) => {
      if (!placementMatches(pattern, face.orientation)) return;
      for (let y = 0; y < face.h; y += 1) {
        for (let x = 0; x < face.w; x += 1) {
          const choice = patternChoice(
            pattern,
            x,
            y,
            face.w,
            face.h,
            seed + patternIndex * 97 + faceIndex,
          );
          if (choice === 0 || (choice === 2 && !secondary)) continue;
          const target = choice === 2 && secondary ? secondary : primary;
          const amount = pattern.kind === 'gradient' ? (y + 1) / face.h : 0.88;
          const current = readPixel(image, face.x + x, face.y + y);
          writePixel(
            image,
            face.x + x,
            face.y + y,
            shadePixel(mixPixel(current, target, amount), face.shade * 0.35),
          );
        }
      }
    });
  });
}

function paintHair(image: PNG, design: SkinDesign, faces: Face[], seed: number): void {
  const hair = hexToRgba(design.palette.hair);
  const material: SkinMaterial = design.texture.hair === 'solid' ? 'smooth' : 'weathered';
  const intensity =
    design.texture.hair === 'solid' ? design.texture.intensity * 0.35 : design.texture.intensity;
  paintFace(image, faces[0]!, hair, material, intensity, seed + 101, false);

  const front = faces[3]!;
  const partColumn = design.hair.part === 'left' ? 2 : design.hair.part === 'right' ? 5 : 4;
  for (let x = 0; x < front.w; x += 1) {
    let depth = design.hair.fringe_rows;
    if (design.hair.style === 'with_bangs' && Math.abs(x - partColumn) >= 2) depth += 1;
    if (x === partColumn) depth = Math.max(0, depth - 1);
    depth = Math.min(front.h, depth);
    for (let y = 0; y < depth; y += 1) {
      const highlight = design.hair.highlights && (x + y + seed) % 5 === 0 ? 0.16 : 0;
      writePixel(image, front.x + x, front.y + y, shadePixel(hair, highlight - y * 0.025));
    }
  }

  for (const face of [faces[2]!, faces[4]!, faces[5]!]) {
    const rows =
      face.orientation === 'back'
        ? design.hair.style === 'long'
          ? 8
          : 5
        : design.hair.style === 'long'
          ? 7
          : 3;
    for (let y = 0; y < Math.min(rows, face.h); y += 1) {
      for (let x = 0; x < face.w; x += 1) {
        const streak = design.hair.highlights && (x + seed) % 4 === 0 ? 0.13 : 0;
        const texture = design.texture.hair === 'streaked' ? ((x + y) % 3 === 0 ? -0.1 : 0.03) : 0;
        writePixel(image, face.x + x, face.y + y, shadePixel(hair, face.shade + streak + texture));
      }
    }
  }
}

function paintFaceDetails(image: PNG, design: SkinDesign): void {
  const skin = hexToRgba(design.palette.skin);
  const brow = hexToRgba(design.palette.eyebrows);
  const eye = hexToRgba(design.palette.eyes);
  const white: Rgba = [238, 242, 244, 255];
  const cheek = mixPixel(skin, hexToRgba('#C96F72'), 0.42);
  [10, 11, 13, 14].forEach((x) => writePixel(image, x, 10, brow));

  if (design.face.eye_style === 'narrow') {
    writePixel(image, 10, 11, white);
    writePixel(image, 11, 11, eye);
    writePixel(image, 13, 11, eye);
    writePixel(image, 14, 11, white);
  } else {
    for (const start of [10, 13]) {
      writePixel(image, start, 11, white);
      writePixel(
        image,
        start + 1,
        11,
        design.face.eye_style === 'bright' ? shadePixel(eye, 0.3) : eye,
      );
    }
  }

  writePixel(image, 12, 13, shadePixel(skin, -0.13));
  if (design.face.expression === 'serious') {
    [11, 12, 13].forEach((x) => writePixel(image, x, 14, shadePixel(skin, -0.32)));
  } else if (design.face.expression === 'soft_smile') {
    writePixel(image, 11, 14, shadePixel(cheek, -0.18));
    writePixel(image, 12, 15, shadePixel(cheek, -0.12));
    writePixel(image, 13, 14, shadePixel(cheek, -0.18));
  } else {
    writePixel(image, 11, 14, shadePixel(skin, -0.28));
    writePixel(image, 12, 14, shadePixel(skin, -0.28));
  }

  if (design.face.freckles || design.texture.skin === 'freckled') {
    [9, 10, 14, 15].forEach((x, index) =>
      writePixel(image, x, 13 + (index % 2), shadePixel(cheek, -0.2)),
    );
  }
}

function paintRows(image: PNG, face: Face, from: number, count: number, color: Rgba): void {
  for (let y = Math.max(0, from); y < Math.min(face.h, from + count); y += 1) {
    for (let x = 0; x < face.w; x += 1) writePixel(image, face.x + x, face.y + y, color);
  }
}

function paintClothingDetails(
  image: PNG,
  design: SkinDesign,
  faces: Record<PartName, Face[]>,
): void {
  const p = design.palette;
  const accent = hexToRgba(p.accent);
  const secondary = hexToRgba(p.secondary);
  const skin = hexToRgba(p.skin);
  const boots = hexToRgba(p.boots);
  const torsoFront = faces.torso[3]!;

  if (design.clothing.scarf && p.scarf) {
    const scarf = hexToRgba(p.scarf);
    paintFace(image, faces.head[1]!, scarf, 'cloth', design.texture.intensity, 707, false);
    for (const face of faces.torso.slice(2)) {
      paintRows(image, face, 0, 2, shadePixel(scarf, face.shade));
    }
    writePixel(image, torsoFront.x + 5, torsoFront.y + 2, shadePixel(scarf, -0.12));
    writePixel(image, torsoFront.x + 5, torsoFront.y + 3, shadePixel(scarf, -0.18));
  }

  if (design.clothing.collar === 'high') {
    paintRows(image, torsoFront, 0, 2, secondary);
  } else if (design.clothing.collar === 'round') {
    writePixel(image, torsoFront.x + 2, torsoFront.y, secondary);
    writePixel(image, torsoFront.x + 5, torsoFront.y, secondary);
    writePixel(image, torsoFront.x + 3, torsoFront.y + 1, secondary);
    writePixel(image, torsoFront.x + 4, torsoFront.y + 1, secondary);
  }

  if (design.clothing.outerwear === 'jacket' || design.clothing.outerwear === 'robe') {
    for (let y = 2; y < torsoFront.h; y += 1) {
      writePixel(image, torsoFront.x + 3, torsoFront.y + y, shadePixel(secondary, -0.12));
      writePixel(image, torsoFront.x + 4, torsoFront.y + y, shadePixel(secondary, 0.08));
    }
    for (let y = 3; y < torsoFront.h - 1; y += 3) {
      writePixel(image, torsoFront.x + 5, torsoFront.y + y, accent);
    }
  } else if (design.clothing.outerwear === 'armor') {
    for (let y = 2; y < 8; y += 1) {
      const inset = y < 4 ? 1 : 2;
      for (let x = inset; x < torsoFront.w - inset; x += 1) {
        writePixel(
          image,
          torsoFront.x + x,
          torsoFront.y + y,
          shadePixel(secondary, (x + y) % 2 === 0 ? 0.12 : -0.08),
        );
      }
    }
    writePixel(image, torsoFront.x + 3, torsoFront.y + 4, accent);
    writePixel(image, torsoFront.x + 4, torsoFront.y + 4, accent);
  }

  if (design.clothing.belt && p.belt) {
    const belt = hexToRgba(p.belt);
    for (const face of faces.torso.slice(2)) {
      paintRows(image, face, face.h - 2, 2, shadePixel(belt, face.shade));
    }
    writePixel(image, torsoFront.x + 3, torsoFront.y + torsoFront.h - 2, accent);
    writePixel(image, torsoFront.x + 4, torsoFront.y + torsoFront.h - 2, accent);
  }

  for (const face of faces.arm) {
    if (face.orientation === 'top') continue;
    if (face.orientation === 'bottom') {
      paintRows(image, face, 0, face.h, design.clothing.gloves ? secondary : skin);
      continue;
    }
    const exposedRows = design.clothing.sleeve_length === 'short' ? 7 : 2;
    paintRows(
      image,
      face,
      face.h - exposedRows,
      exposedRows,
      design.clothing.gloves ? secondary : skin,
    );
    if (design.clothing.cuffs) paintRows(image, face, face.h - exposedRows - 1, 1, accent);
    if (design.clothing.gloves) {
      const gloveRows = Math.max(3, exposedRows);
      paintRows(image, face, face.h - gloveRows, gloveRows, shadePixel(secondary, face.shade));
    }
  }

  if (design.clothing.boots) {
    for (const face of faces.leg) {
      const rows = face.orientation === 'bottom' ? face.h : design.clothing.boot_height;
      paintRows(image, face, face.h - rows, rows, shadePixel(boots, face.shade));
      if (face.orientation !== 'top' && face.orientation !== 'bottom') {
        paintRows(image, face, face.h - rows, 1, shadePixel(accent, face.shade - 0.08));
      }
    }
  }

  if (design.clothing.knee_pads) {
    for (const face of faces.leg.filter((candidate) => candidate.orientation === 'front')) {
      paintRows(image, face, 5, 3, shadePixel(secondary, 0.02));
      writePixel(image, face.x + 1, face.y + 6, accent);
      writePixel(image, face.x + face.w - 2, face.y + 6, accent);
    }
  }
}

function paintOverlays(
  image: PNG,
  design: SkinDesign,
  faces: Record<PartName, Face[]>,
  seed: number,
): void {
  const colors: Record<PartName, string | null> = {
    head: design.palette.head_overlay,
    torso: design.palette.shirt_overlay,
    arm: design.palette.arm_overlay,
    leg: design.palette.leg_overlay,
  };
  (Object.keys(colors) as PartName[]).forEach((part, partIndex) => {
    const value = colors[part];
    if (!value) return;
    const color = hexToRgba(value);
    faces[part].forEach((face, faceIndex) => {
      for (let y = 0; y < face.h; y += 1) {
        for (let x = 0; x < face.w; x += 1) {
          const detail = hashValue(seed + partIndex * 211 + faceIndex, x, y) % 7 === 0;
          const outerFace = face.orientation === 'top' || face.orientation === 'bottom';
          const applies =
            part === 'head'
              ? outerFace ||
                y === 0 ||
                (face.orientation === 'front' && y === 1 && (x < 2 || x >= face.w - 2))
              : part === 'torso'
                ? outerFace ||
                  y === 0 ||
                  y === face.h - 1 ||
                  (face.orientation === 'front' && y < 5 && (x === 1 || x === face.w - 2))
                : part === 'arm'
                  ? outerFace || y < 2 || y >= face.h - 2
                  : outerFace ||
                    (face.orientation === 'front' && y >= 4 && y <= 6 && x > 0 && x < face.w - 1);
          if (!applies && !detail) continue;
          writePixel(
            image,
            face.x + x,
            face.y + y,
            shadePixel(color, face.shade + (detail && !applies ? 0.09 : -0.05)),
          );
        }
      }
    });
  });
}

/** 渲染结构化设计为合法的 Minecraft Java 64x64 PNG。 */
export function renderSkinDesign(
  design: SkinDesign,
  options: RenderSkinDesignOptions = {},
): Uint8Array {
  const armModel = options.armModel ?? 'steve';
  const faces = baseFaces(armModel);
  const overlays = overlayFaces(armModel);
  const image = new PNG({ width: 64, height: 64 });
  image.data.fill(0);
  const seed = Number.parseInt(skinDesignSha256(design).slice(0, 8), 16);
  const palette = design.palette;

  const partSettings: Record<PartName, { color: Rgba; material: SkinMaterial }> = {
    head: { color: hexToRgba(palette.skin), material: 'smooth' },
    torso: { color: hexToRgba(palette.shirt), material: design.texture.upper },
    arm: { color: hexToRgba(palette.sleeve), material: design.texture.upper },
    leg: { color: hexToRgba(palette.pants), material: design.texture.lower },
  };

  (Object.keys(partSettings) as PartName[]).forEach((part, partIndex) => {
    const settings = partSettings[part];
    faces[part].forEach((face, faceIndex) =>
      paintFace(
        image,
        face,
        settings.color,
        settings.material,
        design.texture.intensity,
        seed + partIndex * 313 + faceIndex,
      ),
    );
    paintPatterns(image, design.patterns, part, faces[part], seed + partIndex * 997);
  });

  paintHair(image, design, faces.head, seed);
  paintFaceDetails(image, design);
  paintClothingDetails(image, design, faces);
  paintOverlays(image, design, overlays, seed);

  return new Uint8Array(PNG.sync.write(image));
}

export function skinDesignSha256(design: SkinDesign): string {
  return createHash('sha256').update(JSON.stringify(design)).digest('hex');
}
