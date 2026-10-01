import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

/**
 * 生成确定性的 Minecraft 皮肤测试 fixture。
 * 输出为字节稳定的 PNG（固定调色、无随机性），因此 sha256 可用于完整性校验。
 * 重新生成：pnpm --filter @mc-plan/skin-test-fixtures build
 */

const packageRoot = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(packageRoot, '..', 'assets');
const manifestDir = join(packageRoot, '..', 'src');

const PALETTE = {
  skin: [232, 190, 152, 255],
  hair: [61, 43, 28, 255],
  shirt: [42, 98, 178, 255],
  pants: [52, 60, 76, 255],
  hatOverlay: [200, 60, 60, 255],
  jacketOverlay: [60, 160, 200, 255],
  sleeveOverlay: [90, 200, 90, 255],
  pantsOverlay: [200, 200, 90, 255],
  slimArm: [180, 130, 200, 255],
};

function makeCanvas(width, height) {
  const image = new PNG({ width, height });
  image.data.fill(0);
  return image;
}

function paint(image, regions) {
  for (const region of regions) {
    for (let y = region.y; y < region.y + region.h && y < image.height; y += 1) {
      for (let x = region.x; x < region.x + region.w && x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4;
        const [r, g, b, a] = region.color;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = a;
      }
    }
  }
}

/** 64×64 布局的基础部件区域（Java 版）。armWidth 为 4（Steve）或 3（Alex）。 */
function baseRegions(armWidth) {
  const armColor = armWidth === 3 ? PALETTE.slimArm : PALETTE.skin;
  return [
    // 头
    { x: 8, y: 0, w: 8, h: 8, color: PALETTE.hair },
    { x: 16, y: 0, w: 8, h: 8, color: PALETTE.hair },
    { x: 0, y: 8, w: 8, h: 8, color: PALETTE.skin },
    { x: 8, y: 8, w: 8, h: 8, color: PALETTE.skin },
    { x: 16, y: 8, w: 8, h: 8, color: PALETTE.skin },
    { x: 24, y: 8, w: 8, h: 8, color: PALETTE.skin },
    // 身体
    { x: 20, y: 16, w: 8, h: 4, color: PALETTE.shirt },
    { x: 28, y: 16, w: 8, h: 4, color: PALETTE.shirt },
    { x: 16, y: 20, w: 8, h: 12, color: PALETTE.shirt },
    { x: 20, y: 20, w: 8, h: 12, color: PALETTE.shirt },
    { x: 28, y: 20, w: 8, h: 12, color: PALETTE.shirt },
    { x: 32, y: 20, w: 8, h: 12, color: PALETTE.shirt },
    // 右臂
    { x: 44, y: 16, w: armWidth, h: 4, color: armColor },
    { x: 40, y: 20, w: armWidth, h: 12, color: armColor },
    { x: 44, y: 20, w: armWidth, h: 12, color: armColor },
    { x: 48, y: 20, w: armWidth, h: 12, color: armColor },
    { x: 52, y: 20, w: armWidth, h: 12, color: armColor },
    // 右腿
    { x: 4, y: 16, w: 4, h: 4, color: PALETTE.pants },
    { x: 0, y: 20, w: 4, h: 12, color: PALETTE.pants },
    { x: 4, y: 20, w: 4, h: 12, color: PALETTE.pants },
    { x: 8, y: 20, w: 4, h: 12, color: PALETTE.pants },
    { x: 12, y: 20, w: 4, h: 12, color: PALETTE.pants },
    // 左腿
    { x: 20, y: 48, w: 4, h: 4, color: PALETTE.pants },
    { x: 16, y: 52, w: 4, h: 12, color: PALETTE.pants },
    { x: 20, y: 52, w: 4, h: 12, color: PALETTE.pants },
    { x: 24, y: 52, w: 4, h: 12, color: PALETTE.pants },
    { x: 28, y: 52, w: 4, h: 12, color: PALETTE.pants },
    // 左臂
    { x: 36, y: 48, w: 4, h: 4, color: armColor },
    { x: 32, y: 52, w: 4, h: 12, color: armColor },
    { x: 36, y: 52, w: 4, h: 12, color: armColor },
    { x: 40, y: 52, w: 4, h: 12, color: armColor },
    { x: 44, y: 52, w: 4, h: 12, color: armColor },
  ];
}

/** 第二层（overlay）区域：与 skin-validator 的 SECOND_LAYER_REGIONS 一致，
 *  并额外覆盖正面 overlay（帽子/外套/袖子/裤腿正面），供 2D 预览合成测试使用。 */
function overlayRegions() {
  return [
    { x: 34, y: 2, w: 6, h: 6, color: PALETTE.hatOverlay },
    { x: 18, y: 34, w: 6, h: 6, color: PALETTE.jacketOverlay },
    { x: 42, y: 34, w: 6, h: 6, color: PALETTE.sleeveOverlay },
    { x: 50, y: 50, w: 6, h: 6, color: PALETTE.sleeveOverlay },
    { x: 2, y: 50, w: 6, h: 6, color: PALETTE.pantsOverlay },
    { x: 18, y: 50, w: 6, h: 6, color: PALETTE.pantsOverlay },
    { x: 42, y: 10, w: 4, h: 4, color: PALETTE.hatOverlay },
    { x: 22, y: 38, w: 4, h: 4, color: PALETTE.jacketOverlay },
    { x: 44, y: 38, w: 3, h: 3, color: PALETTE.sleeveOverlay },
    { x: 52, y: 54, w: 3, h: 3, color: PALETTE.sleeveOverlay },
    { x: 4, y: 54, w: 3, h: 3, color: PALETTE.pantsOverlay },
    { x: 20, y: 54, w: 3, h: 3, color: PALETTE.pantsOverlay },
  ];
}

function toBytes(image) {
  return new Uint8Array(PNG.sync.write(image));
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const manifest = [];

function addFixture(name, file, bytes, entry) {
  manifest.push({
    name,
    file,
    sha256: sha256Hex(bytes),
    byteSize: bytes.byteLength,
    ...entry,
  });
}

await mkdir(assetsDir, { recursive: true });
await mkdir(manifestDir, { recursive: true });

// 有效：Steve（4px 手臂 + 第二层）
{
  const image = makeCanvas(64, 64);
  paint(image, baseRegions(4));
  paint(image, overlayRegions());
  const bytes = toBytes(image);
  await writeFile(join(assetsDir, 'valid-steve-64x64.png'), bytes);
  addFixture('valid-steve', 'valid-steve-64x64.png', bytes, {
    expectValid: true,
    armModel: 'steve',
    secondLayer: true,
    description: 'Steve 4px 手臂模板 + 双层布局',
  });
}

// 有效：Alex（3px 手臂 + 第二层）
{
  const image = makeCanvas(64, 64);
  paint(image, baseRegions(3));
  paint(image, overlayRegions());
  const bytes = toBytes(image);
  await writeFile(join(assetsDir, 'valid-alex-64x64.png'), bytes);
  addFixture('valid-alex', 'valid-alex-64x64.png', bytes, {
    expectValid: true,
    armModel: 'alex',
    secondLayer: true,
    description: 'Alex 3px 手臂模板 + 双层布局',
  });
}

// 无效：单层（缺少第二层像素）
{
  const image = makeCanvas(64, 64);
  paint(image, baseRegions(4));
  const bytes = toBytes(image);
  await writeFile(join(assetsDir, 'invalid-no-second-layer-64x64.png'), bytes);
  addFixture('invalid-no-second-layer', 'invalid-no-second-layer-64x64.png', bytes, {
    expectValid: false,
    armModel: 'steve',
    invalidCode: 'MISSING_SECOND_LAYER',
    description: '基础部件完整但没有 overlay 像素',
  });
}

// 无效：错误尺寸 32×32
{
  const image = makeCanvas(32, 32);
  paint(image, [
    { x: 8, y: 0, w: 8, h: 8, color: PALETTE.hair },
    { x: 0, y: 8, w: 8, h: 8, color: PALETTE.skin },
    { x: 8, y: 8, w: 8, h: 8, color: PALETTE.skin },
    { x: 16, y: 8, w: 8, h: 8, color: PALETTE.skin },
    { x: 24, y: 8, w: 8, h: 8, color: PALETTE.skin },
  ]);
  const bytes = toBytes(image);
  await writeFile(join(assetsDir, 'invalid-32x32.png'), bytes);
  addFixture('invalid-32x32', 'invalid-32x32.png', bytes, {
    expectValid: false,
    armModel: 'steve',
    invalidCode: 'WRONG_WIDTH',
    description: '旧版 32×32 布局，尺寸不满足 Java 64×64',
  });
}

// 无效：非 PNG 字节流
{
  const bytes = new TextEncoder().encode('this is definitely not a png image file');
  await writeFile(join(assetsDir, 'invalid-not-png.png'), bytes);
  addFixture('invalid-not-png', 'invalid-not-png.png', bytes, {
    expectValid: false,
    armModel: 'steve',
    invalidCode: 'NOT_PNG',
    description: '扩展名是 .png 但字节流不是 PNG（媒体类型不能只看扩展名）',
  });
}

// 无效：损坏 PNG（有效签名但被截断）
{
  const image = makeCanvas(64, 64);
  paint(image, baseRegions(4));
  paint(image, overlayRegions());
  const full = toBytes(image);
  const truncated = full.slice(0, Math.floor(full.byteLength * 0.4));
  await writeFile(join(assetsDir, 'invalid-corrupted.png'), truncated);
  addFixture('invalid-corrupted', 'invalid-corrupted.png', truncated, {
    expectValid: false,
    armModel: 'steve',
    invalidCode: 'DECODE_FAILED',
    description: 'PNG 签名有效但数据被截断，真实解码失败',
  });
}

manifest.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(
  join(manifestDir, 'manifest.json'),
  JSON.stringify({ fixtures: manifest }, null, 2) + '\n',
);

console.log(`已生成 ${manifest.length} 个皮肤 fixture → ${assetsDir}`);
