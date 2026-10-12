/**
 * 自觉工作熔断冒烟：不需要宿主、不碰真 LLM，直接用 dist 产物跑 runRound（经 installOfficeAutopilot + 桩 setInterval）。
 *   ① 每人每日配额 DAILY_MAX=3：第 4 轮跳过且不再派活；
 *   ② 去重：生成任务与近期记忆/上一轮相同 → 跳过并计一次无进展；
 *   ③ 连续 2 轮无进展/重复 → 自动关闭该员工自觉开关（roster 里 autopilot 字段消失）。
 * 安全：临时在花名册插入 id=fuse-test 的测试员工，结束时**逐字节还原** office_agents.json 与 office_autopilot.json，
 *       并删除测试员工的记忆文件；若发现真实员工开着自觉开关则直接跳过（避免误关）。
 * 用法：node scripts/autopilot-fuse-check.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (f) => pathToFileURL(path.join(root, 'dist', f)).href;

const PW = `${process.env.HOME ?? ''}/.dsh/personal-workbench`;
const ROSTER_FILE = `${PW}/office_agents.json`;
const STATE_FILE = `${PW}/office_autopilot.json`;
const MEMORY_FILE = `${PW}/office_memory/fuse-test.json`;
const TEST_ID = 'fuse-test';
const TEST_CHAR = { id: TEST_ID, name: '冒烟测试', role: '测试' };

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

const rosterBackup = fs.existsSync(ROSTER_FILE) ? fs.readFileSync(ROSTER_FILE, 'utf8') : null;
const stateBackup = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf8') : null;
let memoryExisted = fs.existsSync(MEMORY_FILE);

const restore = () => {
  try {
    if (rosterBackup !== null) fs.writeFileSync(ROSTER_FILE, rosterBackup);
  } catch { /* ignore */ }
  try {
    if (stateBackup !== null) fs.writeFileSync(STATE_FILE, stateBackup);
    else fs.rmSync(STATE_FILE, { force: true });
  } catch { /* ignore */ }
  try {
    if (!memoryExisted) fs.rmSync(MEMORY_FILE, { force: true });
  } catch { /* ignore */ }
};

console.log('[fuse-check] 自觉工作熔断');

const roster = await import(dist('office-roster.js'));
const autopilot = await import(dist('office-autopilot.js'));

// 安全闸：真实员工若有开着自觉的，跳过测试
const alreadyOn = roster.listAutopilotChars().map((c) => c.id);
if (alreadyOn.length > 0) {
  console.log(`  · 真实员工已开启自觉（${alreadyOn.join('、')}），跳过测试以免误关`);
  process.exit(0);
}

const tasks = [];
let dispatched = [];
let intervalCb = null;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn) => {
  intervalCb = fn;
  return { unref() {} };
};
const tick = async (ms = 250) => {
  dispatched = [];
  intervalCb();
  await new Promise((r) => realSetInterval(r, ms));
};

try {
  // 插入测试员工 + 打开自觉开关
  const raw = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
  raw.roster = Array.isArray(raw.roster) ? raw.roster : [];
  raw.roster = raw.roster.filter((r) => r?.id !== TEST_ID);
  raw.roster.push(TEST_CHAR);
  fs.writeFileSync(ROSTER_FILE, JSON.stringify(raw));
  roster.setAutopilotFlag(TEST_ID, true);
  check(roster.listAutopilotChars().some((c) => c.id === TEST_ID), '测试员工已进入自觉工作名单');

  const deps = {
    ctx: {
      get: (name) => {
        if (name === 'llm') {
          return {
            stream: () => {
              const text = tasks.length > 0 ? tasks.shift() : '兜底任务';
              return (async function* () {
                yield { type: 'text-delta', text };
              })();
            },
          };
        }
        if (name === 'agentDefaultModel') {
          return { currentSelection: () => ({ provider: 'rrz', model: 'glm-5.3-flash' }) };
        }
        return undefined;
      },
    },
    log: { info: (m) => console.log(`    · ${m}`), warn: (m) => console.log(`    ! ${m}`) },
    isBusy: () => false,
    dispatch: async (_id, _name, _role, task) => {
      dispatched.push(task);
      // 模拟「活干完了、有产出」：派活后写一条工作记录（下一轮据此判定有进展）
      roster.appendMemoryNote(TEST_ID, `【工作记录】完成：${task}`);
    },
  };
  const stop = autopilot.installOfficeAutopilot(deps);
  const stateOf = () => {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))[TEST_ID];
    } catch {
      return undefined;
    }
  };

  // ── ① 每日配额 3 条 ──
  const counts = [];
  for (const t of ['整理交接文档目录', '复核黄金矿工验收报告', '补齐员工档案字段', '再找一个新活']) {
    tasks.push(t);
    await tick();
    counts.push(dispatched.length);
  }
  const st = stateOf();
  check(counts.join(',') === '1,1,1,0', '前 3 轮各派 1 条、第 4 轮被配额闸拦住', `每轮派活数=${counts.join(',')}`);
  check(st?.count === 3, '状态文件记今日已派 3 条', JSON.stringify(st));

  // ── ② 去重 + ③ 连续无进展自动关 ──
  // 清掉当日状态（等价于新的一天）与上一阶段没消费完的任务，验证去重与自动关闭
  tasks.length = 0;
  const raw2 = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  delete raw2[TEST_ID];
  fs.writeFileSync(STATE_FILE, JSON.stringify(raw2));
  roster.setAutopilotFlag(TEST_ID, true);

  tasks.push('写一份本周风险清单');
  await tick();
  check(dispatched.length === 1, '新的一天先正常派 1 条', `${dispatched.length}`);
  // 再连续两轮生成同一条任务（记忆里已有 → 去重命中）
  tasks.push('写一份本周风险清单');
  await tick();
  const stDup = stateOf();
  check(dispatched.length === 0 && stDup?.fails === 1, '重复任务被去重（fails=1）', JSON.stringify(stDup));
  tasks.push('写一份本周风险清单');
  await tick();
  const off = roster.listAutopilotChars().every((c) => c.id !== TEST_ID);
  check(off, '连续 2 轮无进展/重复 → 该员工自觉开关已自动关闭');
  check(stateOf() === undefined, '自动关闭后清理了熔断状态');

  stop();
} catch (err) {
  check(false, `测试异常：${err instanceof Error ? err.message : String(err)}`);
} finally {
  globalThis.setInterval = realSetInterval;
  restore();
}

console.log(failed === 0 ? '[fuse-check] PASS' : `[fuse-check] FAILED（${failed} 项）`);
process.exit(failed === 0 ? 0 : 1);
