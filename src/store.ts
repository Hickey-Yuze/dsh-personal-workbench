/**
 * 插件自有 JSON 存储：`<dataDir>/<key>.json`（默认 $DSH_HOME/personal-workbench）。
 * - 原子写（同目录 tmp + rename），避免半截文件；
 * - key 白名单校验（防路径穿越）；
 * - 读失败一律回退调用方给的默认值，绝不把异常抛进 UI。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** 只允许小写字母/数字/下划线/短横，长度受限——杜绝 `../` 之类越权路径。 */
const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function resolveDataDir(configured?: string): string {
  if (configured !== undefined && configured.trim() !== '') return configured.trim();
  const dshHome = process.env.DSH_HOME;
  const base = dshHome !== undefined && dshHome.trim() !== '' ? dshHome : path.join(os.homedir(), '.dsh');
  return path.join(base, 'personal-workbench');
}

export class JsonStore {
  constructor(private readonly dir: string) {}

  private fileOf(key: string): string {
    if (!KEY_RE.test(key)) {
      throw Object.assign(new Error(`非法存储键：${key}`), { code: 'bad-key' });
    }
    return path.join(this.dir, `${key}.json`);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async read<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(this.fileOf(key), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return parsed as T;
    } catch {
      return fallback;
    }
  }

  async write(key: string, value: unknown): Promise<{ bytes: number; path: string }> {
    const target = this.fileOf(key);
    await fs.mkdir(this.dir, { recursive: true });
    const text = JSON.stringify(value, null, 2);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, target);
    return { bytes: Buffer.byteLength(text, 'utf8'), path: target };
  }
}
