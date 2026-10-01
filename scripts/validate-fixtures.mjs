import { SKIN_FIXTURES, loadFixtureBytes } from '../packages/test-fixtures/dist/index.js';
import { validateSkinImage } from '../packages/skin-validator/dist/index.js';

/**
 * Minecraft 皮肤 fixture 校验（真实命令，不由 README 代替）。
 * 对每个 fixture 应用 skin-validator 的完整规则：
 * 有效样本必须通过并携带正确元数据；无效样本必须以声明的错误码被拒绝。
 */

let failures = 0;
let validated = 0;

for (const fixture of SKIN_FIXTURES) {
  const bytes = await loadFixtureBytes(fixture.name);
  // 统一执行默认策略（requireSecondLayer=true）：
  // 无效样本的失败码正是由该策略判定的，不能按样本期望关闭检查。
  const report = validateSkinImage(bytes, { armModel: fixture.armModel });

  if (fixture.expectValid) {
    if (!report.valid) {
      failures += 1;
      console.error(
        `✗ ${fixture.name} 应当有效，但被拒绝: ${report.issues.map((i) => i.code).join(', ')}`,
      );
      continue;
    }
    if (report.sha256 !== fixture.sha256) {
      failures += 1;
      console.error(`✗ ${fixture.name} sha256 与清单不一致`);
      continue;
    }
    if (report.metadata?.arm_model !== fixture.armModel || report.metadata?.second_layer !== true) {
      failures += 1;
      console.error(`✗ ${fixture.name} 元数据与清单不一致`);
      continue;
    }
    validated += 1;
    console.log(
      `✓ ${fixture.name}: 64×64 ${fixture.armModel} 双层=${report.secondLayer} sha256=${report.sha256.slice(0, 12)}…`,
    );
  } else {
    if (report.valid) {
      failures += 1;
      console.error(`✗ ${fixture.name} 应当无效（${fixture.invalidCode}），但通过了校验`);
      continue;
    }
    if (!report.issues.some((issue) => issue.code === fixture.invalidCode)) {
      failures += 1;
      console.error(
        `✗ ${fixture.name} 期望错误码 ${fixture.invalidCode}，实际: ${report.issues.map((i) => i.code).join(', ')}`,
      );
      continue;
    }
    validated += 1;
    console.log(`✗-as-expected ${fixture.name}: ${fixture.invalidCode}`);
  }
}

if (failures > 0) {
  console.error(`皮肤 fixture 校验失败：${failures} 项。`);
  process.exit(1);
}

console.log(`皮肤 fixture 校验通过：${validated}/${SKIN_FIXTURES.length} 个样本行为符合预期。`);
