/**
 * dsh-personal-workbench — 个人工作台插件（持久组合插件）。
 *
 * 八个模块全部由插件本体提供，**不依赖任何外部应用或页面**：
 *   项目总览 / 待办事项 / 文件归档 / 日常管理 / 音乐平台 / 影视平台 / 娱乐平台 / 知识库
 *
 * Host 半区职责：
 * - 插件自有 JSON 存储（待办、日程…）：<dataDir>，原子写；
 * - 知识库只读代理：本机 Obsidian Local REST API，API key 只留在 Host 侧；
 * - 一个 HTTP 端点族：POST /api/personal-workbench/<endpoint>。
 *
 * 只降级不崩溃：存储目录不可写或 key 缺失时，插件照常加载，端点按需返回业务错误。
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, resolveObsidianKeyPath, type PersonalWorkbenchConfig } from './config.js';
import { JsonStore, resolveDataDir } from './store.js';
import { KnowledgeClient } from './knowledge.js';
import { registerRpc } from './rpc.js';

export const name = 'dsh-personal-workbench';

/** 无可选硬依赖：webServer 经 ctx.get 软探测 + internal/service 补挂。 */
export const inject: string[] = [];

/** 配置 schema：导出名必须是 `Config`（cordis 运行时按名读取）。 */
export { Config };

export async function apply(ctx: Context, config: PersonalWorkbenchConfig): Promise<void> {
  const log = {
    debug: (m: string) => ctx.logger.debug(m),
    info: (m: string) => ctx.logger.info(m),
    warn: (m: string) => ctx.logger.warn(m),
    error: (m: string) => ctx.logger.error(m),
  };

  const dataDir = resolveDataDir(config.dataDir);
  // 回填解析后的路径，供设置页/排障查看
  (config as { dataDir: string }).dataDir = dataDir;

  const store = new JsonStore(dataDir);
  try {
    await store.init();
  } catch (err) {
    // 目录不可写：降级为「存储不可用」，端点会返回错误，但宿主照常启动
    log.error(`[personal-workbench] 数据目录不可写：${dataDir}（${err instanceof Error ? err.message : String(err)}）`);
  }

  const knowledge = new KnowledgeClient(
    config.obsidianUrl,
    resolveObsidianKeyPath(config.obsidianKeyPath),
    config.obsidianTimeoutMs,
  );

  try {
    registerRpc(ctx, { config, store, knowledge, log });
    log.info(`[personal-workbench] 已加载，数据目录 ${dataDir}`);
  } catch (err) {
    log.error(`[personal-workbench] 初始化失败（插件降级）: ${err instanceof Error ? err.message : String(err)}`);
  }
}
