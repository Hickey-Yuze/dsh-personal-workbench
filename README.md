# dsh-personal-workbench · 个人工作台

给 DeepSeek Harness（DSH）加一个**个人工作台**面板：侧栏入口贴在「定时任务」（dsh-cron-board）正下方，面板内是八个模块。

**所有功能由插件本体实现**——没有 iframe、不依赖任何外部应用或页面；数据全部留在本机。

```
侧栏                        中央面板
┌──────────────┐           ┌──────────────────────────────────────────┐
│ 新会话        │           │ 个人工作台                                │
│ 定时任务      │  ──点击──▶│ 待办 · 日程 · 知识库 · 更多模块，本机运行  │
│ 个人工作台  ◀ │           │ ┌────────┐┌────────┐┌────────┐┌────────┐ │
└──────────────┘           │ │项目总览││待办事项││文件归档││日常管理│ │
                           │ └────────┘└────────┘└────────┘└────────┘ │
                           │ ┌────────┐┌────────┐┌────────┐┌────────┐ │
                           │ │音乐平台││影视平台││娱乐平台││ 知识库 │ │
                           │ └────────┘└────────┘└────────┘└────────┘ │
                           └──────────────────────────────────────────┘
```

## 模块现状

| 模块 | 状态 | 数据来源 |
|---|---|---|
| 项目总览 | ✅ 已实现 | 聚合待办 / 日程 / 知识库计数 |
| 待办事项 | ✅ 已实现 | 插件自有存储 `<dataDir>/todos.json` |
| 日常管理 | ✅ 已实现 | 插件自有存储 `<dataDir>/events.json`（月历 + 当日清单） |
| 知识库 | ✅ 已实现 | 本机 Obsidian Local REST API（只读代理，key 不出 Host） |
| 文件归档 | ⏳ 待接入 | 需确认归档根目录（本机路径） |
| 音乐平台 | ⏳ 待接入 | 需确认内容源 |
| 影视平台 | ⏳ 待接入 | 需确认内容源 |
| 娱乐平台 | ⏳ 待接入 | 计划做成纯离线小工具 |

未接入的模块点开会显示**下一步说明**，不展示假数据。

## 数据与安全

- **存储**：`$DSH_HOME/personal-workbench/<key>.json`，原子写（tmp + rename）；键名白名单校验，`../` 之类越权路径直接拒绝。
- **知识库**：Host 侧持有 API key（`$DSH_HOME/secrets/obsidian-rest-api.key`），只经 Host 代理访问，**浏览器拿不到 key**；仅允许本机回环地址；只读。
- **无外链**：面板不嵌入任何外部页面，不探测外部服务；仅访问 `127.0.0.1`。

## 安装（本机 desktop profile）

```bash
ln -sfn ~/dsh-personal-workbench ~/.dsh/personal-workbench-src
# profile 的 package.json 里加两处：dependencies 的 link: 依赖 + dsh.profile.bundles 条目
cd ~/.dsh/profiles/desktop && pnpm install
# 重启宿主（Node half 走 ESM 缓存，必须重启）
```

> 禁止 `dsh plugin add`（会净移除依赖）；一律手动 patch 挂载。

## 配置

```yaml
- insert:
    - id: dsh-personal-workbench
      name: dsh-personal-workbench
      config:
        dataDir: "/Users/yuze/.dsh/personal-workbench"
        obsidianUrl: "http://127.0.0.1:27123"
        obsidianKeyPath: "/Users/yuze/.dsh/secrets/obsidian-rest-api.key"
        obsidianTimeoutMs: 4000
```

## 开发与验证

```bash
pnpm run build      # tsc(Node half) + esbuild(client bundle)
pnpm run typecheck  # 两端类型检查
pnpm run gates      # 合同一致性门禁：包名/patch id/client id、exports、React 未打入
node scripts/smoke.mjs   # 冒烟：产物导出 + 存储真实读写 + 知识库连通性
```

改 Node half（`src/`）→ 重启宿主；改 client half（`client/src/`）→ 重新 `pnpm run build` 后强刷页面。

## 结构

```
src/                 Node half
  index.ts           apply：装配存储与知识库客户端
  config.ts          Config schema + 路径解析 + 本机地址校验
  contract.ts        Host↔Client 类型契约（仅类型，构建期擦除）
  store.ts           插件自有 JSON 存储（原子写 + 键名校验）
  knowledge.ts       Obsidian Local REST API 只读客户端
  rpc.ts             POST /api/personal-workbench/<endpoint>
client/src/          browser half（esbuild → dist/client.js）
  entry.tsx          侧栏入口 DOM 注入 + main 面板注册
  panel.tsx          模块网格 ↔ 模块视图
  modules.ts         八个模块的事实源（顺序、配色、图标、实现状态）
  store.ts           useKv（乐观更新 + 防抖落盘）/ useKnowledge
  theme.ts           样式（跟随宿主 --dsw-alias-* 令牌）
  i18n.ts            zh/en 字典
  views/             TodoView · ScheduleView · KnowledgeView · OverviewView
scripts/             build-client.mjs · gates.mjs · smoke.mjs
```

## 行为约定

- **入口顺序恒定**：「定时任务」入口晚于本入口出现时，MutationObserver 会把本入口重贴到它下面，之后立即停止（不与 cron-board 的 observer 互斗）。
- **只降级不崩溃**：webServer 缺失时 API 延迟补挂；存储目录不可写、知识库未运行时插件照常加载，只在对应模块内提示。
- **hooks 全在 early return 之前**：面板与视图组件无提前返回分支。

MIT © Yuze
