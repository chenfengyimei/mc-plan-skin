import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

try {
  const entries = await readdir(migrationsDir);
  const migrationDirs = entries.filter((entry) => /^\d{14}_/.test(entry));
  if (migrationDirs.length === 0) {
    console.error(`未发现迁移目录：${migrationsDir}。请先在受控环境中生成基线迁移。`);
    process.exit(1);
  }
  console.log(`发现 ${migrationDirs.length} 个迁移：${migrationDirs.join(', ')}`);
} catch (error) {
  console.error(`无法读取迁移目录 ${migrationsDir}：${error.code ?? error.message}`);
  process.exit(1);
}
