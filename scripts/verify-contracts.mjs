import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * API 契约一致性检查：
 * 1. 确认 mc-plan-contracts 仓库存在且版本可解析；
 * 2. 在临时目录重新生成契约客户端类型；
 * 3. 与仓库内已提交的生成物逐字节比较，防止契约与客户端类型漂移。
 * 失败时运行：pnpm contract:gen && git add packages/contracts/src/generated
 */

const contractsRoot = resolve(process.env.MC_PLAN_CONTRACTS_DIR ?? '../mc-plan-contracts');
const skinYamlPath = join(contractsRoot, 'openapi', 'skin.yaml');

if (!existsSync(skinYamlPath)) {
  console.error(`缺少契约文件: ${skinYamlPath}`);
  process.exit(1);
}

const skinYaml = readFileSync(skinYamlPath, 'utf8');
const versionMatch = /^\s*version:\s*(\S+)/m.exec(skinYaml);
if (!versionMatch) {
  console.error('无法从 openapi/skin.yaml 解析 info.version');
  process.exit(1);
}
const expectedVersion = versionMatch[1] ?? '';

const generatedDir = resolve('packages/contracts/src/generated');
const metaPath = join(generatedDir, 'contract-meta.json');
if (!existsSync(metaPath)) {
  console.error(`缺少已生成的契约类型: ${metaPath}。请运行 pnpm contract:gen`);
  process.exit(1);
}
const committedMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
if (committedMeta.version !== expectedVersion) {
  console.error(
    `契约版本漂移：本地生成物 ${committedMeta.version}，已发布契约 ${expectedVersion}。` +
      '请运行 pnpm contract:gen 并提交更新后的生成物。',
  );
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), 'skin-contracts-'));
const nodeExecutable = process.execPath;
execFileSync(nodeExecutable, ['scripts/gen.mjs', '--out', tempDir], {
  cwd: resolve('packages/contracts'),
  stdio: 'pipe',
});

const regenerated = readdirSync(tempDir).sort();
const committed = readdirSync(generatedDir).sort();
if (regenerated.join(',') !== committed.join(',')) {
  console.error(
    `契约生成物文件清单不一致。\n生成: ${regenerated.join(', ')}\n提交: ${committed.join(', ')}`,
  );
  process.exit(1);
}

const mismatched = [];
for (const file of regenerated) {
  const fresh = readFileSync(join(tempDir, file), 'utf8');
  const current = readFileSync(join(generatedDir, file), 'utf8');
  if (fresh !== current) {
    mismatched.push(file);
  }
}

if (mismatched.length > 0) {
  console.error(
    `契约生成物与已发布契约不一致: ${mismatched.join(', ')}。\n` +
      '请运行 pnpm contract:gen 并提交 packages/contracts/src/generated 的更新。',
  );
  process.exit(1);
}

console.log(
  `契约一致性检查通过：skin.yaml ${expectedVersion}，${regenerated.length} 个生成物匹配。`,
);
