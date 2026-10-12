/**
 * 自觉工作熔断冒烟：不需要宿主、不碰真 LLM，直接用 dist 产物跑 runRound（经 installOfficeAutopilot + 桩 setInterval）。
 *
 * 用法（两条，第二条验证「模型微任务」那条路）：
 *   node scripts/autopilot-fuse-check.mjs            # 待办队列优先与认领、收尾兜底、每日配额 3 条、连续无产出自动关
 *   DSH_PWB_INVENT=1 node scripts/autopilot-fuse-check.mjs --invent   # 模型微任务：任务重复 → 去重 + 自动关
 *
 * 安全：临时在花名册插入 id=fuse-test 的测试员工、用临时待办文件（DSH_PWB_BACKLOG 指向 ~/.dsh/personal-workbench/fuse-test-待办.md），
 *       结束时**逐字节还原** office_agents.json / office_autopilot.json / 待办文件，并删除测试员工的记忆文件；
 *       若发现真实员工开着自觉开关则直接跳过（避免误关）。
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
const BACKLOG_FILE = `${PW}/fuse-test-待办.md`;
const TEST_ID = 'fuse-test';
const TEST_CHAR = { id: TEST_ID, name: '冒烟测试', role: '测试' };
const inventOnly = process.argv.includes('--invent');

// 待办文件指到临时路径（backlogFile() 每次调用都读 env）
process.env.DSH_PWB_BACKLOG = BACKLOG_FILE;

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

const readIf = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const rosterBackup = readIf(ROSTER_FILE);
const stateBackup = readIf(STATE_FILE);
const backlogBackup = readIf(BACKLOG_FILE);
const restore = () => {
  try {
    if (rosterBackup === null) fs.rmSync(ROSTER_FILE, { force: true });
    else fs.writeFileSync(ROSTER_FILE, rosterBackup);
  } catch { /* ignore */ }
  try {
    if (stateBackup === null) fs.rmSync(STATE_FILE, { force: true });
    else fs.writeFileSync(STATE_FILE, stateBackup);
  } catch { /* ignore */ }
  try {
    if (backlogBackup === null) fs.rmSync(BACKLOG_FILE, { force: true });
    else fs.writeFileSync(BACKLOG_FILE, backlogBackup);
  } catch { /* ignore */ }
  try {
    fs.rmSync(MEMORY_FILE, { force: true });
  } catch { /* ignore */ }
};

console.log(`[fuse-check] ${inventOnly ? '模型微任务去重（DSH_PWB_INVENT=1）' : '待办队列 / 收尾兜底 / 每日配额 / 连续无产出'}`);

const roster = await import(dist('office-roster.js'));
const backlog = await import(dist('office-backlog.js'));
const autopilot = await import(dist('office-autopilot.js'));

const alreadyOn = roster.listAutopilotChars().map((c) => c.id);
if (alreadyOn.length > 0) {
  console.log(`  · 真实员工已开启自觉（${alreadyOn.join('、')}），跳过测试以免误关`);
  process.exit(0);
}

let minted = [];
let dispatched = [];
let writeMemory = true;
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
const resetState = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    delete raw[TEST_ID];
    fs.writeFileSync(STATE_FILE, JSON.stringify(raw));
  } catch { /* ignore */ }
};
const stateOf = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))[TEST_ID];
  } catch {
    return undefined;
  }
};
const autopilotOn = () => roster.listAutopilotChars().some((c) => c.id === TEST_ID);

try {
  // 插入测试员工 + 打开自觉开关
  const raw = JSON.parse(rosterBackup ?? '{"roster":[]}');
  raw.roster = Array.isArray(raw.roster) ? raw.roster.filter((r) => r?.id !== TEST_ID) : [];
  raw.roster.push(TEST_CHAR);
  fs.writeFileSync(ROSTER_FILE, JSON.stringify(raw));
  roster.setAutopilotFlag(TEST_ID, true);
  check(autopilotOn(), '测试员工已进入自觉工作名单');

  let closeTask;
  const deps = {
    ctx: {
      get: (name) => {
        if (name === 'llm') {
          return {
            stream: () => {
              const text = minted.length > 0 ? minted.shift() : '兜底微任务';
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
      if (writeMemory) roster.appendMemoryNote(TEST_ID, `【工作记录】完成：${task}`);
    },
    pendingClose: () => closeTask,
  };
  const stop = autopilot.installOfficeAutopilot(deps);

  if (!inventOnly) {
    // ── A. 待办解析：只认未打勾 + 未认领；@姓名 指派 ──
    fs.writeFileSync(
      BACKLOG_FILE,
      [
        '# 测试待办',
        '- [ ] 甲任务 @冒烟测试',
        '- [ ] 乙任务',
        '- [x] 丙任务',
        '- [ ] 丁任务 <!-- 已派 别人 2026-10-12T10:00 -->',
        '```md',
        '- [ ] 围栏代码块里的示例不该被派',
        '```',
        '这行不是条目',
        '',
      ].join('\n'),
    );
    const items = backlog.readBacklog(BACKLOG_FILE);
    check(
      items.length === 2 && items[0].text === '甲任务' && items[0].assignee === '冒烟测试' && items[1].text === '乙任务',
      '待办解析：跳过已完成/已认领/非条目，@姓名 解析正确',
      JSON.stringify(items),
    );

    // ── B. 队列优先 + 认领回写（下一条不会被重复派） ──
    await tick();
    check(dispatched.length === 1 && dispatched[0] === '甲任务', '第 1 轮派出手写待办（含 @自己）', JSON.stringify(dispatched));
    const line1 = fs.readFileSync(BACKLOG_FILE, 'utf8').split('\n')[1] ?? '';
    check(line1.includes('<!-- 已派 冒烟测试'), '认领标签已回写到该行', line1);
    await tick();
    check(dispatched.length === 1 && dispatched[0] === '乙任务', '第 2 轮派出未指派的那条（甲已认领不重复）', JSON.stringify(dispatched));
    resetState();
    await tick();
    check(dispatched.length === 0 && autopilotOn(), '队列空且无待收尾 → 不派活、开关保持', `派活数=${dispatched.length}`);

    // ── C. 收尾兜底：未验收的老板旧活 ──
    closeTask = '收尾复核测试任务';
    await tick();
    check(dispatched.length === 1 && dispatched[0] === '收尾复核测试任务', '待办空时走「未验收旧活收尾」', JSON.stringify(dispatched));
    closeTask = undefined;

    // ── D. 每日配额 3 条 ──
    resetState();
    closeTask = '收尾复核测试任务';
    const counts = [];
    for (const _ of [1, 2, 3, 4]) {
      await tick();
      counts.push(dispatched.length);
    }
    check(counts.join(',') === '1,1,1,0', '前 3 轮各派 1 条、第 4 轮被配额闸拦住', `每轮派活数=${counts.join(',')}`);
    check(stateOf()?.count === 3, '状态文件记今日已派 3 条', JSON.stringify(stateOf()));

    // ── E. 连续两轮无产出 → 自动关开关 ──
    resetState();
    writeMemory = false;
    closeTask = '收尾复核测试任务';
    await tick();
    check(dispatched.length === 1 && stateOf()?.fails === 0, '新一轮先正常派 1 条（还没有无产出记录）', JSON.stringify(stateOf()));
    await tick();
    check(stateOf()?.fails === 1, '上一轮没留下任何记忆 → 记 1 轮无产出', JSON.stringify(stateOf()));
    await tick();
    check(!autopilotOn(), '连续 2 轮无产出 → 该员工自觉开关已自动关闭');
    check(stateOf() === undefined, '自动关闭后清理了熔断状态');
  } else {
    // ── F. 模型微任务：同一条任务重复 → 去重 → 连续 2 轮自动关 ──
    fs.writeFileSync(BACKLOG_FILE, '# 测试待办（空）\n');
    closeTask = undefined;
    writeMemory = false;
    minted = ['写一份本周风险清单', '写一份本周风险清单', '写一份本周风险清单'];
    await tick();
    check(dispatched.length === 1 && dispatched[0] === '写一份本周风险清单', '第 1 轮模型微任务正常派出', JSON.stringify(dispatched));
    await tick();
    check(dispatched.length === 0, '同一条任务再来 → 去重拦住不重复派', JSON.stringify(dispatched));
    check(!autopilotOn(), '去重计一次无产出 + 前一轮无产出 → 连续 2 轮，开关自动关闭');
  }

  stop();
} catch (err) {
  check(false, `测试异常：${err instanceof Error ? err.message : String(err)}`);
} finally {
  globalThis.setInterval = realSetInterval;
  restore();
}

console.log(failed === 0 ? '[fuse-check] PASS' : `[fuse-check] FAILED（${failed} 项）`);
process.exit(failed === 0 ? 0 : 1);
