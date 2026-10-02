/**
 * 配置 schema（Schemastery）。导出名必须是 `Config`——cordis 运行时按名读取插件配置声明。
 * 全部默认值都指向本机：插件不依赖任何外部服务，也不做任意地址探测。
 */
import Schema from '@deepseek-ai/schemastery';
import * as os from 'node:os';
import * as path from 'node:path';

export interface PersonalWorkbenchConfig {
  /** 插件自有数据目录（待办、日程等 JSON 落盘处）。 */
  dataDir?: string;
  /** 知识库地址（Obsidian Local REST API，本机）。 */
  obsidianUrl: string;
  /** 知识库 API key 文件路径（只在 Host 侧读取，绝不下发浏览器）。 */
  obsidianKeyPath: string;
  /** 知识库请求超时（毫秒）。 */
  obsidianTimeoutMs: number;
}

export const personalWorkbenchSchema = Schema.object({
  dataDir: Schema.string().role('folder').description('数据目录（缺省 $DSH_HOME/personal-workbench）'),
  obsidianUrl: Schema.string().default('http://127.0.0.1:27123').description('知识库地址（本机 Obsidian Local REST API）'),
  obsidianKeyPath: Schema.string().description('知识库 API key 文件（缺省 $DSH_HOME/secrets/obsidian-rest-api.key）'),
  obsidianTimeoutMs: Schema.number().default(4000).description('知识库请求超时（毫秒）'),
}) as unknown as Schema<any, PersonalWorkbenchConfig>;

/** 导出名固定为 Config（cordis 按名读取）。 */
export const Config: Schema<any, PersonalWorkbenchConfig> = personalWorkbenchSchema;

/** $DSH_HOME（缺省 ~/.dsh）。 */
export function resolveHome(): string {
  const dshHome = process.env.DSH_HOME;
  return dshHome !== undefined && dshHome.trim() !== '' ? dshHome.trim() : path.join(os.homedir(), '.dsh');
}

/** 知识库 key 文件：显式配置 > $DSH_HOME/secrets/obsidian-rest-api.key。 */
export function resolveObsidianKeyPath(configured?: string): string {
  if (configured !== undefined && configured.trim() !== '') return configured.trim();
  return path.join(resolveHome(), 'secrets', 'obsidian-rest-api.key');
}

/** 只允许本机回环地址：插件不访问局域网/公网地址。 */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}
