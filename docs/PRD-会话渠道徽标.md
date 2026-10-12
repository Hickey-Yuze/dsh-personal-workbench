# PRD：会话渠道徽标（Channel Badge）

> 版本：v0.1（2026-10-12）｜ 归属仓库：`/Users/yuze/dsh-personal-workbench` ｜ 状态：待评审
> 一句话：让「我们自己的会话」在宿主侧栏行首带上可控的渠道徽标，**不依赖第三方插件、不改会话标题**。

---

## 1. 背景与问题

派活给员工后，宿主侧栏会出现形如 `office-npc-1-1791800171653` 的会话（`src/rpc.ts` 的 `officeSpawnAgent` 创建）。最近发现这些行首出现了一个橙色「建筑 + 加号」徽标，标题也被写成 `AI Office · 小周`。逆向结论：**这不是我们画的**，而是第三方插件 `@xmanrui/dsh-im` v4.36.1 的「渠道标识」能力（详见附录 B）。触发条件是**我们自己的会话 id 前缀 `office-`** 命中了它的渠道正则。

由此暴露四个问题：

| # | 问题 | 后果 |
|---|---|---|
| P1 | 能力不由我们掌控 | 换/禁用 dsh-im，徽标消失；它的规则变了我们就变样 |
| P2 | 标题被污染 | 它把标题改成 `AI Office · <名>`，与我们「标题 = 员工名」的设计叠加；双击重命名会把前缀一起编辑 |
| P3 | 无法覆盖我们的其它会话 | 「AI 助手」「全员群聊」等同样是我们产生的，但拿不到标识 |
| P4 | 行为不可预期 | 它的渠道表固定（12 个渠道）、颜色/图标写死，我们无法调 |

目标是把这项能力**收回自研**：用宿主官方扩展点渲染，标题保持干净，且与 dsh-im 共存时不出双标。

---

## 2. 现状（能力基线）

### 2.1 宿主提供的官方扩展点（已核实到源码）

| 事实 | 出处 |
|---|---|
| 行首 seat 是 root 作用域的 `list` 子 slot：`sidebar.session.row.leading`，由 WorkspaceBrowser 声明 | `…/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`（`ctx.slots.inject("sidebar.workspaces", … children: { "sidebar.session.row.leading": { kind: "list", scope: "root" } }`） |
| 渲染条件：`!row.archived && !row.blank && (showStatus ? <SessionStatusDots/> : renderSlot("sidebar.session.row.leading", { sessionId: node.id }))`；`showStatus = statuses[0].state !== "idle"` | 同上（行渲染函数内） |
| seat 只接收行的 Session 身份（`{ sessionId }`），占用方据此读自己的数据 | `…/dsh-client-ui-workspace/README.zh.md`「理解实现」 |
| seat 是**只读标识**：不是按钮、无 Tab stop、点击其区域不打开整行 | 同上「活动 Schedule 标识」 |
| Session 作用域 seat 会**强制建立 Session 绑定**（激活并保留列表中每个 Session） | 同上 |
| 同族扩展点：`sidebar.session.row.hover`（悬浮卡片打开时挂载）、`sidebar.workspaces.session.menu.item`（"…" 菜单）、`sidebar.workspaces.session.row.action`（行尾悬停按钮） | 同上 |
| 官方占用方示例：ui-schedule 的「活动定时任务」时钟标记 | `…/dsh-client-ui-schedule/lib/client.js` |

### 2.2 我们现有可用的数据

| 数据 | 位置 |
|---|---|
| 派活会话 id（`office-<npcId>-<时间戳>`）随 `office/agents` 一起返回 | 宿主 `src/rpc.ts`（`office/agents` GET，`list = [...officeAgents].map(([npcId, slot]) => ({ npcId, ...slot.entry }))`），客户端字段 `AgentRow.sessionId`（`client/src/office/agentClient.ts`） |
| 会话标题由我们钉成员工名 | `src/rpc.ts` `officeAdoptSession` → `ctx.get('sessionTitle').rename(session, name)` |
| 客户端已有注册 slot 的现成写法 | `client/src/entry.tsx`：`ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key: PANEL_ID, inject: () => ({ rpc }) }, WorkbenchPanel))` |

---

## 3. 目标与非目标

**目标**

- G1（P0）：办公室派活会话在侧栏行首显示 **AI 办公室渠道徽标**（16px 橙色建筑），hover 有渠道名提示。
- G2（P0）：**不改会话标题**（重命名、导出、标题事件里都不出现渠道前缀）。
- G3（P1）：渠道表可由我们配置（`office` / `assistant` / `group` …），图标全部内联 SVG（遵守「不用外部链接」）。
- G4（P1）：与 dsh-im 共存时**同一行不出双标**。
- G5（P2）：会话运行中（状态点占位）时徽标仍可见（见 §7.2 方案 B）。

**非目标**

- N1 不做渠道消息收发（那是 dsh-im 的领域），本能力只有「标识」。
- N2 不改会话 id 生成规则（`office-` 前缀保留：它是我们与 dsh-im 互通时的天然渠道标记，且跳转兜底依赖它）。
- N3 不接管非本插件创建的会话（其它插件的 `office-<uuid>` 会话按同渠道识别，属可接受）。
- N4 不做跨机/跨 profile 同步。

---

## 4. 用户故事

- US1 作为用户，我在侧栏一眼认出「这行是办公室员工干的活」。
- US2 作为用户，会话标题就是员工名，**不该被塞渠道前缀**，双击重命名也只改名字。
- US3 作为用户，员工正在干活（行首显示运行状态点）时，我依然能看出它属于哪个渠道。
- US4 作为用户，我把某个渠道关掉后，徽标立刻消失，标题不受影响（可逆）。

---

## 5. 能力定义

### 5.1 渠道（Channel）

```ts
type OfficeChannel = {
  id: string;          // 渠道 id，同时是会话 id 前缀，如 'office'
  zh: string;          // 中文名：AI 办公室
  en: string;          // 英文名：AI Office
  color: string;       // 品牌色，如 '#FB923C'
  logo: string;        // 内联 SVG path（24×24 viewBox，禁用外链）
};
```

内置渠道表（v1 建议）：

| id | 名称 | 色值 | 图标 | 归属来源 |
|---|---|---|---|---|
| `office` | AI 办公室 | `#FB923C` | 两栋楼（复用模块图标 `client/src/modules.ts` 的 office path） | 派活会话 |
| `assistant` | AI 助手 | `#00D26A` | 四宫格（复用 `client/src/entry.tsx` 的 `ICON_SVG`） | 办公室右栏 AI 助手（如日后建会话） |
| `group` | 全员群聊 | `#38BDF8` | 多人 | 群聊（同上） |

### 5.2 归属判定（优先级从高到低）

1. **精确**：宿主内存/落盘记录里的 `entry.sessionId`（`office/agents` 已返回；宿主重启后为空）。
2. **兜底**：会话 id 前缀 `^<channelId>-(?:\w+-)*\d{10,}$`（覆盖重启后仍能标；与 dsh-im 的 `^(weixin|…|office)-.+` 兼容）。
3. 未来可选：显式登记端点。

命中即渲染徽标；未命中返回 `null`（零 UI、零开销）。

---

## 6. 交互与视觉规范

| 项 | 规范 |
|---|---|
| 位置 | 行首 seat（`sidebar.session.row.leading`），16×16，右边距 6px，`flex-shrink:0` |
| 只读性 | 不是按钮、无 Tab stop、点击不打开整行（与官方时钟标记一致）；不拦截行的点击/拖拽/双击重命名 |
| 提示 | `title="AI 办公室会话"`；悬浮卡片（`sidebar.session.row.hover`）可显示「渠道 · 员工名 · 状态」 |
| 主题 | 徽标用渠道色；暗色主题下亮度不低于 3:1 对比度；不引入生硬白/蓝装饰 |
| 可逆 | 只注册/注销 slot，不写标题、不写 localStorage 之外的状态；禁用插件后行恢复原样 |
| 无网络 | 图标内联；不新增任何外部请求 |

---

## 7. 技术方案

### 7.1 方案 A（P0，推荐）：官方行首 seat

- 新增 `client/src/channelBadge.tsx`：渠道表 + `<ChannelBadge sessionId>`（内部：命中判定 → 渲染 16px SVG；未命中 `null`）。
- `client/src/entry.tsx` 的 `apply(ctx)` 中注册（与现有 `main` 注册同风格）：

```ts
const disposeBadge = ctx.slots.inject('sidebar.session.row.leading', () =>
  ctx.slots.register(
    { name: 'sidebar.session.row.leading', key: CHANNEL_BADGE_KEY, inject: () => ({ rpc }) },
    ChannelBadge,
  ),
);
```

- 会话 id 来源：`inject` 里挂一个轻量缓存——客户端已轮询 `office/agents`（1.5s），把 `AgentRow.sessionId → { npcId, name }` 存进模块级 Map，`ChannelBadge` 直接查；未命中再走前缀判定。

**代价与风险**：Session 作用域 seat 会激活并保留列表中每个 Session（官方明确说明）。缓解：只在命中渠道时渲染 UI；上线前用 50+ 会话实测滚动与内存。

### 7.2 方案 B（P1，增强）：运行中也可见

`showStatus`（`statuses[0].state !== 'idle'`）为真时，行首 seat 被宿主自己的状态点取代，徽标不可见——而员工干活时恰恰是运行中。选做其一：

- **B1（推荐，可逆）**：客户端 DOM 装饰——命中渠道的行，取其标题 span（`[data-row-key="session:<id>"]` 内的标题元素）加 `data-pwb-channel="office"`，用我们自己的 CSS `::before` 画徽标、`::after`/`text-indent` 让位。**只加属性与样式，绝不改标题文本**（卸载即恢复，且不产生标题事件）。
- **B2**：同时注册 `sidebar.session.row.hover`，在悬浮卡片里显示渠道名（seat 被状态点取代时仍可查）。

### 7.3 与 dsh-im 共存（G4）

- 检测：标题以 `AI Office · ` 开头 = dsh-im 已认领该行。
- 默认策略「**让位**」：该行不由我们渲染（避免双徽标）。我们自己的 DOM 装饰方案 B1 也要跳过。
- 可选策略「**接管**」：不推荐（跨插件 CSS 打架，且 dsh-im 升级即失效）。
- 长期收敛：我们的渠道 id/标签与它的表对齐（`office = "AI Office"`），并保持前缀判定幂等，确保任何一方都只加一次。

---

## 8. 数据与状态

- 新增持久化：无（渠道表是编译期常量；`AgentRow.sessionId` 来自既有端点）。
- 可选：`localStorage['dsh-pwb:office_channels_v1']` 存「渠道开关」，默认全开。
- 不新增宿主端点；不需要改 `src/rpc.ts`（本能力纯客户端）。

---

## 9. 边界与异常

| 场景 | 期望行为 |
|---|---|
| 宿主重启后 `office/agents` 为空 | 前缀兜底仍渲染徽标 |
| 行被归档 / 空白会话 | 宿主本来就不渲染该 seat；我们无需处理 |
| slot 不存在（旧宿主/未声明） | `slots.inject` 静默不注册，其它功能不受影响 |
| 会话标题被用户双击重命名 | 徽标不受影响；标题里永远没有我们的前缀 |
| dsh-im 在装 | 让位，不双标（§7.3） |
| 命中前缀但不是我们的会话（如 dsh-im 自建的 `office-<uuid>`） | 仍按 `office` 渠道渲染（同一品牌，可接受） |

---

## 10. 验收标准

| ID | 验收点 | 判定方式 |
|---|---|---|
| AC1 | 派活后新会话行首出现橙色建筑徽标，标题为「小周」 | 截图 + `grep` 会话日志确认无渠道前缀标题事件 |
| AC2 | 会话运行中徽标仍可见（方案 B1 落地后） | 派活中截图 |
| AC3 | 非命中行、空白行、归档行不出现徽标 | 截图 |
| AC4 | 双击重命名会话，标题不含渠道前缀 | 操作 + 日志核对 |
| AC5 | 停用插件后徽标消失、标题不变（可逆） | 禁用重载后截图 + 标题事件比对 |
| AC6 | dsh-im 同时存在时无双徽标 | 截图（两插件都开） |
| AC7 | 未命中渠道时不产生额外渲染开销 | 代码审查 + 50 会话滚动实测 |
| AC8 | 产物校验 | `pnpm run typecheck` / `pnpm run build` / `pnpm run gates` 全 0；`dist/client.js` 断言含 `sidebar.session.row.leading` 与渠道表 |
| AC9 | 部署 | 纯客户端改动 → 强刷（Cmd+Shift+R）即可，无需重启宿主 |

---

## 11. 里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| M1 | 方案 A：渠道表 + seat 注册 + `AgentRow` 缓存 | 0.5 天 |
| M2 | 方案 B1/B2（运行中可见）+ dsh-im 共存策略 | 0.5 天 |
| M3 | 渠道开关 + `docs/交接文档.md` 补章节 | 0.5 天 |

---

## 12. 风险与开放问题

1. **性能**：Session 作用域 seat 会 retain 列表中每个 Session —— 需实测（若明显，则退化为仅 DOM 装饰 B1，不注册 seat）。
2. **`showStatus` 语义**：徽标「常显」的诉求只能靠 B1 满足，需确认是否接受 DOM 依赖（宿主侧栏 DOM 结构变更会失效，需加 `MutationObserver` 兜底）。
3. **是否与 dsh-im 合并渠道表**：若要彻底避免双前缀，需与其作者约定同一 id/标签（现成约定已在 `office`）。
4. **是否给「AI 助手 / 群聊」上标**：取决于这两处日后是否也会创建真实会话。
5. 是否需要在悬浮卡片（`sidebar.session.row.hover`）里补「渠道 + 员工 + 状态」三行信息。

---

## 附录 A：涉及接口与文件

| 用途 | 路径 |
|---|---|
| 宿主：派活会话创建（`office-<npcId>-<ts>`）、`office/agents` | `/Users/yuze/dsh-personal-workbench/src/rpc.ts` |
| 客户端：slot 注册现状 | `/Users/yuze/dsh-personal-workbench/client/src/entry.tsx` |
| 客户端：`AgentRow.sessionId` | `/Users/yuze/dsh-personal-workbench/client/src/office/agentClient.ts` |
| 客户端：跳转兜底（前缀匹配 `office-<npcId>-`） | `/Users/yuze/dsh-personal-workbench/client/src/sessionNav.ts`（调用点同上） |
| 宿主 shell：seat 渲染与 slot 声明 | `…/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js` |
| 官方说明：seat 语义/渲染条件/只读性 | `…/node_modules/@deepseek-ai/dsh-client-ui-workspace/README.zh.md`（「活动 Schedule 标识」「Session 行 action」「理解实现」） |
| 现成占用方参考 | `…/node_modules/@deepseek-ai/dsh-client-ui-schedule/lib/client.js` |

（`…` = `/Users/yuze/Desktop/Yuze/opencode/YuzeHarness/dsh-plugin-desktop/dist/mac-arm64/Yuze Harness.app/Contents/Resources/app`）

## 附录 B：dsh-im 现状机制速查（我们的替代对象）

| 环节 | 实现 |
|---|---|
| 渠道表 | `lib/index.js` `q0`、`lib/client.js` `GLYPHS`：12 个渠道（weixin/feishu/dingtalk/wecom/qq/slack/telegram/discord/whatsapp/imessage/matrix/office），`office: ["AI Office","AI Office"]`、色值 `#f97316` |
| 归属判定 | `ufe = ^(渠道)-steer-<uuid>$`（匹配 `user/message` 的 `source.rpcId`）或 `Knt = ^(渠道)-.+`（匹配会话 id） |
| 标题改写（宿主半边） | 监听会话事件，`Jnt(title, channel)` 幂等补前缀 `${label} · ${title}`，然后 `append("session/title", {…, title})` |
| 徽标渲染（客户端半边） | 找 `[role="treeitem"][aria-selected]` 行内标题 span，标题以 `${label} · ` 开头时打 `data-dsh-im-session-channel` + `data-dsh-im-session-text`，用自己的 `<style>` 以 `::before` 画渠道 SVG、`::after` 写回余下文字 |
| 副作用 | 标题被永久写入前缀；与我们的「标题 = 员工名」冲突；徽标只在它有表时出现 |
