import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';

/**
 * S3 兼容对象存储的端口抽象。生产实现对接 S3 兼容存储；本地开发与测试使用
 * 文件系统或内存实现。候选对象必须写入隔离前缀，键不可预测，避免通过猜测
 * URL 访问其他用户的候选。
 */
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<ObjectRecord>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export interface ObjectRecord {
  key: string;
  byteSize: number;
  sha256: string;
  contentType: string;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertSafeKey(key: string): void {
  if (key.length === 0) {
    throw new Error('对象键不能为空');
  }
  if (key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error('对象键包含非法路径片段');
  }
}

/**
 * 候选隔离存储键。使用候选 ID（UUID）作为键的一部分，不编码任何用户或会话
 * 标识；候选前缀与未来公开对象空间严格分离。
 */
export function candidateStorageKey(candidateId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateId)) {
    throw new Error('candidateId 必须是 UUID');
  }
  return `candidates/${candidateId}.png`;
}

/** 文件系统对象存储实现（本地开发与测试）。 */
export class FileSystemObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const path = join(this.root, key);
    const normalized = normalize(path);
    if (!normalized.startsWith(normalize(this.root) + sep) && normalized !== normalize(this.root)) {
      throw new Error('对象键解析越界');
    }
    return normalized;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<ObjectRecord> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return { key, byteSize: bytes.byteLength, sha256: sha256Hex(bytes), contentType };
  }

  async get(key: string): Promise<Uint8Array> {
    const bytes = await readFile(this.resolve(key));
    return new Uint8Array(bytes);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

/** 内存对象存储实现（单元测试）。 */
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<ObjectRecord> {
    assertSafeKey(key);
    this.objects.set(key, { bytes, contentType });
    return { key, byteSize: bytes.byteLength, sha256: sha256Hex(bytes), contentType };
  }

  async get(key: string): Promise<Uint8Array> {
    const record = this.objects.get(key);
    if (!record) {
      throw new Error('对象不存在');
    }
    return record.bytes;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
}

/** 生成不可预测的候选 ID。 */
export function newCandidateId(): string {
  return randomUUID();
}
