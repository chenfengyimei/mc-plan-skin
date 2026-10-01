import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import type { ArmModel } from '@mc-plan/skin-core';
import type { SkinMetadata } from '@mc-plan/skin-contracts';

export const SKIN_MEDIA_TYPE = 'image/png' as const;
export const SKIN_WIDTH = 64;
export const SKIN_HEIGHT = 64;

export type SkinValidationIssueCode =
  | 'NOT_PNG'
  | 'DECODE_FAILED'
  | 'WRONG_WIDTH'
  | 'WRONG_HEIGHT'
  | 'UNKNOWN_ARM_MODEL'
  | 'MISSING_SECOND_LAYER';

export interface SkinValidationIssue {
  code: SkinValidationIssueCode;
  message: string;
}

export interface SkinValidationReport {
  valid: boolean;
  mediaType: typeof SKIN_MEDIA_TYPE;
  width: number | null;
  height: number | null;
  armModel: ArmModel | null;
  secondLayer: boolean;
  sha256: string;
  byteSize: number;
  issues: SkinValidationIssue[];
  /** 与公共契约 SkinMetadata 同构的元数据（valid 时存在）。 */
  metadata: SkinMetadata | null;
}

export interface ValidateSkinImageOptions {
  /** Steve/Alex 必须由调用方显式声明；PNG 字节本身不编码手臂模型。 */
  armModel: ArmModel;
  /** 默认 true：候选链路要求双层布局（Foundation docs/skin-ai.md）。 */
  requireSecondLayer?: boolean;
}

/** PNG 文件签名。媒体类型判定必须基于字节而不是扩展名。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * 64×64 布局中的第二层（覆盖层）区域：帽子、外套、袖子与裤腿的 overlay。
 * 只要任意区域存在非透明像素即判定存在第二层。
 */
const SECOND_LAYER_REGIONS: ReadonlyArray<{
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}> = [
  { name: 'hat', x: 32, y: 0, w: 32, h: 16 },
  { name: 'jacket', x: 16, y: 32, w: 24, h: 16 },
  { name: 'right-sleeve', x: 40, y: 32, w: 16, h: 16 },
  { name: 'left-leg-overlay', x: 0, y: 48, w: 16, h: 16 },
  { name: 'left-arm-overlay', x: 48, y: 48, w: 16, h: 16 },
];

const ARM_MODELS: readonly ArmModel[] = ['steve', 'alex'];

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function hasSecondLayerPixels(image: PNG): boolean {
  for (const region of SECOND_LAYER_REGIONS) {
    for (let y = region.y; y < region.y + region.h; y += 1) {
      for (let x = region.x; x < region.x + region.w; x += 1) {
        const alpha = image.data[(y * image.width + x) * 4 + 3] ?? 0;
        if (alpha > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * 校验候选/成品皮肤字节。规则（Foundation docs/skin-ai.md）：
 * - 必须真实解码为 PNG（媒体类型不得只看扩展名）；
 * - 尺寸严格为 64×64；
 * - Steve/Alex 通过显式元数据声明；
 * - 保存 SHA-256 与字节数；
 * - 双层布局必须存在（可用 requireSecondLayer=false 关闭以支持纯单层皮肤）。
 */
export function validateSkinImage(
  bytes: Uint8Array,
  options: ValidateSkinImageOptions,
): SkinValidationReport {
  const issues: SkinValidationIssue[] = [];
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const byteSize = bytes.byteLength;
  const requireSecondLayer = options.requireSecondLayer ?? true;

  const armModel = ARM_MODELS.includes(options.armModel) ? options.armModel : null;
  if (!armModel) {
    issues.push({
      code: 'UNKNOWN_ARM_MODEL',
      message: 'armModel 必须是 steve 或 alex，不得从字节猜测',
    });
  }

  if (!hasPngSignature(bytes)) {
    issues.push({ code: 'NOT_PNG', message: '字节流缺少 PNG 签名，实际媒体类型不是 image/png' });
    return {
      valid: false,
      mediaType: SKIN_MEDIA_TYPE,
      width: null,
      height: null,
      armModel,
      secondLayer: false,
      sha256,
      byteSize,
      issues,
      metadata: null,
    };
  }

  const declaredSize = readPngSize(bytes);

  let image: PNG;
  try {
    image = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (error) {
    issues.push({
      code: 'DECODE_FAILED',
      message: `PNG 解码失败（截断、损坏或 CRC 错误）：${(error as Error).name}`,
    });
    return {
      valid: false,
      mediaType: SKIN_MEDIA_TYPE,
      width: declaredSize?.width ?? null,
      height: declaredSize?.height ?? null,
      armModel,
      secondLayer: false,
      sha256,
      byteSize,
      issues,
      metadata: null,
    };
  }

  if (image.width !== SKIN_WIDTH) {
    issues.push({
      code: 'WRONG_WIDTH',
      message: `宽度必须严格为 64，实际为 ${image.width}`,
    });
  }
  if (image.height !== SKIN_HEIGHT) {
    issues.push({
      code: 'WRONG_HEIGHT',
      message: `高度必须严格为 64，实际为 ${image.height}`,
    });
  }

  const secondLayer =
    image.width === SKIN_WIDTH && image.height === SKIN_HEIGHT
      ? hasSecondLayerPixels(image)
      : false;
  if (requireSecondLayer && !secondLayer) {
    issues.push({
      code: 'MISSING_SECOND_LAYER',
      message: '未检测到第二层（overlay）像素；双层皮肤布局必须符合模板',
    });
  }

  const valid = issues.length === 0;
  return {
    valid,
    mediaType: SKIN_MEDIA_TYPE,
    width: image.width,
    height: image.height,
    armModel,
    secondLayer,
    sha256,
    byteSize,
    issues,
    metadata:
      valid && armModel
        ? {
            edition: 'java',
            width: SKIN_WIDTH,
            height: SKIN_HEIGHT,
            arm_model: armModel,
            second_layer: secondLayer,
          }
        : null,
  };
}
