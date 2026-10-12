/**
 * 办公室「真实待办」队列：老板手写的待办清单（默认 `AI员工/待办.md`，一行一条）。
 *
 *   - [ ] 复核黄金矿工验收报告 @小黄                        ← 待办；@姓名可省（省 = 谁先认领谁做）
 *   - [x] 整理交接文档目录                                  ← 已完成（跳过）
 *   - [ ] 补齐档案字段 @小周 <!-- 已派 office-npc-1 10-12T23:40 -->   ← 已派过（跳过；删掉注释即可重派）
 *
 * 约定：本模块所有读写静默失败（文件不存在 = 队列空，绝不影响 office 主流程）；
 * 路径可用环境变量 DSH_PWB_BACKLOG 覆盖（默认放到 AI员工 项目目录里，跟着项目走）。
 */
import * as fs from 'node:fs';

const DEFAULT_FILE = `${process.env.HOME ?? ''}/Desktop/Yuze/Yuze Harness work/AI员工/待办.md`;

/** 待办文件绝对路径（DSH_PWB_BACKLOG 优先）。 */
export function backlogFile(): string {
  const custom = process.env.DSH_PWB_BACKLOG;
  return typeof custom === 'string' && custom.trim() !== '' ? custom.trim() : DEFAULT_FILE;
}

/** 一条待办（line 为 1 起的行号，认领回写时用）。 */
export type OfficeBacklogTask = {
  line: number;
  text: string;
  /** `@姓名` 指派的员工名（可省 = 未指派）。 */
  assignee?: string;
};

/** 已完成 / 已认领标记。条目必须顶格写（`- [ ]`），围栏代码块（```）里的示例一律忽略。 */
const ITEM_RE = /^[-*]\s*\[( |x|X)\]\s*(.*)$/;
const CLAIM_RE = /<!--\s*已派/;
const FENCE_RE = /^\s*(```|~~~)/;

/** 读待办：只返回「未打勾 + 未认领」的条目。 */
export function readBacklog(file: string = backlogFile()): OfficeBacklogTask[] {
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: OfficeBacklogTask[] = [];
  const lines = raw.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = ITEM_RE.exec(line);
    if (m === null || m[1] !== ' ') continue;
    if (CLAIM_RE.test(line)) continue;
    const body = (m[2] ?? '').trim();
    if (body === '') continue;
    const at = /(?:^|\s)@([^\s@]{1,16})/.exec(body);
    const text = (at === null ? body : body.replace(at[0], ' ')).replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    out.push(at === null ? { line: i + 1, text } : { line: i + 1, text, assignee: at[1] });
  }
  return out;
}

/** 认领一条待办：在该行尾追加 `<!-- 已派 <who> <日期T时间> -->`（成功 true）。 */
export function claimBacklogTask(file: string, line: number, who: string, at: Date = new Date()): boolean {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const idx = line - 1;
    if (idx < 0 || idx >= lines.length) return false;
    const p = (n: number): string => String(n).padStart(2, '0');
    const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}`;
    lines[idx] = `${lines[idx] ?? ''} <!-- 已派 ${who} ${stamp} -->`;
    fs.writeFileSync(file, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}
