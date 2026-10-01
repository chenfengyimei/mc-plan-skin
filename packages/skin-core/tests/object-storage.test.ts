import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileSystemObjectStorage,
  InMemoryObjectStorage,
  candidateStorageKey,
  newCandidateId,
  sha256Hex,
} from '../src/index.js';

const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('对象存储抽象', () => {
  it('内存实现支持 put/get/delete/exists 并计算 SHA-256', async () => {
    const storage = new InMemoryObjectStorage();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const record = await storage.put('candidates/x.png', bytes, 'image/png');
    expect(record.byteSize).toBe(4);
    expect(record.sha256).toBe(sha256Hex(bytes));
    expect(await storage.exists('candidates/x.png')).toBe(true);
    expect(await storage.get('candidates/x.png')).toEqual(bytes);
    await storage.delete('candidates/x.png');
    expect(await storage.exists('candidates/x.png')).toBe(false);
  });

  it('文件系统实现真实落盘且键受沙箱约束', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skin-storage-'));
    tempDirs.push(root);
    const storage = new FileSystemObjectStorage(root);
    const bytes = new Uint8Array([9, 8, 7]);
    const key = candidateStorageKey(newCandidateId());
    await storage.put(key, bytes, 'image/png');
    expect(await storage.exists(key)).toBe(true);
    expect(new Uint8Array(await readFile(join(root, key)))).toEqual(bytes);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it('拒绝路径穿越与非法键', async () => {
    const storage = new InMemoryObjectStorage();
    await expect(storage.put('../escape.png', new Uint8Array(), 'image/png')).rejects.toThrow(
      /非法/,
    );
    await expect(storage.put('', new Uint8Array(), 'image/png')).rejects.toThrow(/不能为空/);
  });

  it('候选存储键必须由合法 UUID 构成且位于 candidates 前缀', () => {
    const id = newCandidateId();
    expect(candidateStorageKey(id)).toBe(`candidates/${id}.png`);
    expect(() => candidateStorageKey('not-a-uuid')).toThrow(/UUID/);
  });
});
