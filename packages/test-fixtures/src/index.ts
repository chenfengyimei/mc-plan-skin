import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import manifest from './manifest.json' with { type: 'json' };

export interface SkinFixture {
  name: string;
  file: string;
  sha256: string;
  byteSize: number;
  expectValid: boolean;
  armModel: 'steve' | 'alex';
  secondLayer?: boolean;
  invalidCode?: string;
  description: string;
}

/** assets/ 位于包根目录；从 src 与 dist 运行时都以包根为基准解析。 */
const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

export const SKIN_FIXTURES: readonly SkinFixture[] = Object.freeze(
  manifest.fixtures as SkinFixture[],
);

export function getSkinFixture(name: string): SkinFixture {
  const fixture = SKIN_FIXTURES.find((candidate) => candidate.name === name);
  if (!fixture) {
    throw new Error(`未知皮肤 fixture: ${name}`);
  }
  return fixture;
}

export async function loadFixtureBytes(name: string): Promise<Uint8Array> {
  const fixture = getSkinFixture(name);
  const bytes = await readFile(join(assetsDir, fixture.file));
  return new Uint8Array(bytes);
}
