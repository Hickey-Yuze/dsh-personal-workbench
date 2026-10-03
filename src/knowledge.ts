/**
 * 知识库客户端：Obsidian Local REST API（本机 127.0.0.1:27123）。
 * - API key 只在 Host 侧读取（$DSH_HOME/secrets/obsidian-rest-api.key），
 *   绝不下发到浏览器、绝不写日志；
 * - 只访问本机回环地址（isLocalHost 校验），超时可控，只读、不改动 vault。
 */
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isLocalHost } from './config.js';

export interface KbEntry {
  /** 条目名（目录以 / 结尾）。 */
  name: string;
  /** vault 内相对路径。 */
  path: string;
  kind: 'file' | 'dir';
}

export interface KbSearchHit {
  path: string;
  score: number;
  matches: number;
  /** 命中片段（已去空白、截断）。 */
  snippet: string;
}

interface RawResponse {
  status: number;
  text: string;
}

export class KnowledgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly keyPath: string,
    private readonly timeoutMs: number,
  ) {}

  /** 读取 API key（失败返回 undefined，调用方据此给出「未配置」提示，而不是报错）。 */
  private async apiKey(): Promise<string | undefined> {
    try {
      const raw = await fs.readFile(this.keyPath, 'utf8');
      const key = raw.trim();
      return key === '' ? undefined : key;
    } catch {
      return undefined;
    }
  }

  private request(pathname: string, init?: { method?: string; body?: string; contentType?: string }): Promise<RawResponse> {
    return new Promise<RawResponse>((resolve, reject) => {
      let target: URL;
      try {
        target = new URL(this.baseUrl);
      } catch {
        reject(Object.assign(new Error('知识库地址不合法'), { code: 'bad-url' }));
        return;
      }
      if (!isLocalHost(target.hostname)) {
        reject(Object.assign(new Error('知识库仅允许本机地址'), { code: 'bad-host' }));
        return;
      }
      const agent = target.protocol === 'https:' ? https : http;
      const req = agent.request(
        {
          hostname: target.hostname,
          port: target.port === '' ? (target.protocol === 'https:' ? 443 : 80) : Number(target.port),
          path: pathname,
          method: init?.method ?? 'GET',
          timeout: this.timeoutMs,
          headers: {
            ...(init?.contentType !== undefined ? { 'content-type': init.contentType } : {}),
          },
          ...(target.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
          );
        },
      );
      req.on('timeout', () => {
        req.destroy();
        reject(Object.assign(new Error(`知识库请求超时（>${this.timeoutMs}ms）`), { code: 'timeout' }));
      });
      req.on('error', (err: Error) => reject(Object.assign(new Error(err.message), { code: 'unreachable' })));
      // API key 注入点：不放进 URL、不放进日志
      void this.apiKey().then((key) => {
        if (key !== undefined) req.setHeader('authorization', `Bearer ${key}`);
        if (init?.body !== undefined) req.write(init.body);
        req.end();
      });
    });
  }

  /** 目录列表：GET /vault/<dir>/ → { files: ["a.md", "sub/"] } */
  async list(dir: string): Promise<{ entries: KbEntry[]; total: number }> {
    const clean = normalizeVaultPath(dir);
    const suffix = clean === '' ? '' : `${clean}/`;
    const res = await this.request(`/vault/${encodeURI(suffix)}`);
    if (res.status === 401) throw Object.assign(new Error('知识库 API key 无效或未授权'), { code: 'unauthorized' });
    if (res.status === 404) throw Object.assign(new Error(`目录不存在：${clean || '/'}`), { code: 'not-found' });
    if (res.status !== 200) throw Object.assign(new Error(`知识库返回 ${res.status}`), { code: 'upstream' });
    let parsed: { files?: unknown };
    try {
      parsed = JSON.parse(res.text) as { files?: unknown };
    } catch {
      throw Object.assign(new Error('知识库返回格式异常'), { code: 'bad-json' });
    }
    const files = Array.isArray(parsed.files) ? parsed.files.filter((f): f is string => typeof f === 'string') : [];
    const entries: KbEntry[] = files.map((name) => {
      const isDir = name.endsWith('/');
      const bare = isDir ? name.slice(0, -1) : name;
      return {
        name: bare,
        path: clean === '' ? bare : `${clean}/${bare}`,
        kind: isDir ? 'dir' : 'file',
      };
    });
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'zh') : a.kind === 'dir' ? -1 : 1));
    return { entries, total: entries.length };
  }

  /** 读笔记：GET /vault/<path> */
  async read(notePath: string): Promise<{ path: string; content: string; bytes: number }> {
    const clean = normalizeVaultPath(notePath);
    if (clean === '') throw Object.assign(new Error('缺少笔记路径'), { code: 'bad-request' });
    const res = await this.request(`/vault/${encodeURI(clean)}`);
    if (res.status === 404) throw Object.assign(new Error(`笔记不存在：${clean}`), { code: 'not-found' });
    if (res.status !== 200) throw Object.assign(new Error(`知识库返回 ${res.status}`), { code: 'upstream' });
    return { path: clean, content: res.text, bytes: Buffer.byteLength(res.text, 'utf8') };
  }

  /** 写笔记：PUT /vault/<path>（Obsidian REST 覆盖写；204/200 视为成功） */
  async write(notePath: string, content: string): Promise<{ path: string; bytes: number }> {
    const clean = normalizeVaultPath(notePath);
    if (clean === '') throw Object.assign(new Error('缺少笔记路径'), { code: 'bad-request' });
    const res = await this.request(`/vault/${encodeURI(clean)}`, { method: 'PUT', contentType: 'text/markdown', body: content });
    if (res.status === 401) throw Object.assign(new Error('知识库 API key 无效或未授权'), { code: 'unauthorized' });
    if (res.status !== 200 && res.status !== 204) throw Object.assign(new Error(`保存失败（知识库返回 ${res.status}）`), { code: 'upstream' });
    return { path: clean, bytes: Buffer.byteLength(content, 'utf8') };
  }

  /** 全文搜索：POST /search/simple/?query=... */
  async search(query: string): Promise<{ hits: KbSearchHit[]; total: number }> {
    const q = query.trim();
    if (q === '') return { hits: [], total: 0 };
    const res = await this.request(`/search/simple/?query=${encodeURIComponent(q)}&contextLength=90`, {
      method: 'POST',
    });
    if (res.status === 401) throw Object.assign(new Error('知识库 API key 无效或未授权'), { code: 'unauthorized' });
    if (res.status !== 200) throw Object.assign(new Error(`知识库返回 ${res.status}`), { code: 'upstream' });
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      throw Object.assign(new Error('知识库返回格式异常'), { code: 'bad-json' });
    }
    const rows = Array.isArray(parsed) ? parsed : [];
    const hits: KbSearchHit[] = rows.slice(0, 40).map((row) => {
      const r = row as { filename?: unknown; score?: unknown; matches?: unknown };
      const matches = Array.isArray(r.matches) ? r.matches : [];
      const first = matches[0] as { context?: unknown } | undefined;
      const ctx = typeof first?.context === 'string' ? first.context : '';
      return {
        path: typeof r.filename === 'string' ? r.filename : '',
        score: typeof r.score === 'number' ? Math.round(r.score * 100) / 100 : 0,
        matches: matches.length,
        snippet: ctx.replace(/\s+/g, ' ').slice(0, 160),
      };
    }).filter((h) => h.path !== '');
    return { hits, total: hits.length };
  }
}

/** vault 路径规范化：去首尾斜杠、压掉重复斜杠、拒绝 .. 越权。 */
export function normalizeVaultPath(input: string): string {
  const parts = input
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p !== '' && p !== '.');
  for (const p of parts) {
    if (p === '..') throw Object.assign(new Error('路径不允许包含 ..'), { code: 'bad-path' });
  }
  return parts.join('/');
}
