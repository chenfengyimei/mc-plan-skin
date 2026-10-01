import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from 'json-schema-to-typescript';
import openapiTS, { astToString } from 'openapi-typescript';

/**
 * 从 mc-plan-contracts 生成 Skin 客户端类型。
 * 生成物禁止手工修改；公共契约变化必须先在 mc-plan-contracts 仓库完成，
 * 然后运行 `pnpm contract:gen` 重新生成并通过 `pnpm contract:check` 校验一致性。
 */

function parseArgs(argv) {
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex >= 0 ? resolve(argv[outIndex + 1]) : resolve('src/generated');
  return { outDir };
}

const contractsRoot = resolve(process.env.MC_PLAN_CONTRACTS_DIR ?? '../../../mc-plan-contracts');

const skinOpenApiPath = join(contractsRoot, 'openapi', 'skin.yaml');
const skinMetadataSchemaPath = join(contractsRoot, 'schemas', 'skin', 'skin-metadata.json');
const problemSchemaPath = join(contractsRoot, 'schemas', 'common', 'problem.json');

for (const required of [skinOpenApiPath, skinMetadataSchemaPath, problemSchemaPath]) {
  if (!existsSync(required)) {
    console.error(
      `缺少契约文件: ${required}\n` +
        '请确认 mc-plan-contracts 仓库位于工作区，或设置 MC_PLAN_CONTRACTS_DIR。',
    );
    process.exit(1);
  }
}

const { outDir } = parseArgs(process.argv.slice(2));
await mkdir(outDir, { recursive: true });

const skinYaml = await readFile(skinOpenApiPath, 'utf8');
const versionMatch = /^\s*version:\s*(\S+)/m.exec(skinYaml);
if (!versionMatch) {
  console.error('无法从 openapi/skin.yaml 解析 info.version');
  process.exit(1);
}
const contractVersion = versionMatch[1] ?? '';

const provenance = (source) =>
  `/**\n * 由 mc-plan-contracts ${source}（版本 ${contractVersion}）生成。\n` +
  ' * 生成命令：pnpm --filter @mc-plan/skin-contracts gen\n' +
  ' * 禁止手工修改；契约变化先在 mc-plan-contracts 仓库完成。\n */\n';

const apiAst = await openapiTS(pathToFileURL(skinOpenApiPath).href);
const apiTypes = provenance('openapi/skin.yaml') + astToString(apiAst) + '\n';
await writeFile(join(outDir, 'skin-api.d.ts'), apiTypes);

const skinMetadataSchema = JSON.parse(await readFile(skinMetadataSchemaPath, 'utf8'));
const skinMetadataTypes =
  provenance('schemas/skin/skin-metadata.json') +
  (await compile(skinMetadataSchema, 'SkinMetadata', {
    additionalProperties: false,
    bannerComment: '',
    style: { singleQuote: true, semi: true },
  }));
await writeFile(join(outDir, 'skin-metadata.ts'), skinMetadataTypes);

const problemSchema = JSON.parse(await readFile(problemSchemaPath, 'utf8'));
const problemTypes =
  provenance('schemas/common/problem.json') +
  (await compile(problemSchema, 'ProblemDetails', {
    additionalProperties: false,
    bannerComment: '',
    style: { singleQuote: true, semi: true },
  }));
await writeFile(join(outDir, 'problem.ts'), problemTypes);

const meta = {
  source_repo: 'mc-plan-contracts',
  skin_openapi: 'openapi/skin.yaml',
  version: contractVersion,
};
await writeFile(join(outDir, 'contract-meta.json'), JSON.stringify(meta, null, 2) + '\n');

console.log(`已生成契约客户端类型 → ${outDir}（版本 ${contractVersion}）`);
