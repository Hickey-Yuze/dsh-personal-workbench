# docs/plan.md — 决策追踪

## 一句话需求

给 DSH 加一个「个人工作台」插件：侧栏入口放在**定时任务下面**，面板内是八个模块卡片
（项目总览 / 待办事项 / 文件归档 / 日常管理 / 音乐平台 / 影视平台 / 娱乐平台 / 知识库），
点卡片内嵌 Yuze Workbench 对应页面。

## ① 需求捕获（已确认）

| 问题 | 结论 | 来源 |
|---|---|---|
| 参考图 | 用户提供 9 张截图：1 张 DSH 界面（标出入口位置）+ 8 张 Yuze Workbench 各模块页面 | 用户附件 2026-10-02 |
| 「放在定时任务下面」 | **不是** Yuze Workbench 的侧栏，而是 DSH 侧栏里 dsh-cron-board（定时任务）入口的下方 | 用户选择 |
| 形态 | 侧栏新增入口 + 页内八个模块的卡片式聚合面板 | 用户选择 |
| 卡片行为 | 面板内 iframe 嵌入 Yuze Workbench 对应页面 | 用户选择 |

> 参考图处理方式：本会话模型不支持图像输入，改用 macOS Vision（ObjC + clang）本地 OCR
> 提取图上的文字与版式，据此确认 8 张图分别是 `/overview`、`/`、`/archive`、`/schedule`、
> `/music`、`/film`、`/entertainment`、`/knowledge`，与插件模块表一致。

## ② 形态与分发决策

- 形态：`bundle-client`（Node half + 浏览器 client）
- 分发：本地目录 + `link:` 挂载进 desktop profile（与 dsh-cron-board 同一约定）
- 构建：tsc（Node half，ESM）+ esbuild（client bundle，CJS 包进 ModuleLoader wrapper）

## ③ 能力面 → 配方

| 能力面 | 落地 |
|---|---|
| HTTP 接口 | `POST /api/personal-workbench/probe`（只读探测，无副作用） |
| 中央面板 | `ctx.slots.inject('main')` + `register({ name: 'main', key: 'dsh-personal-workbench' })` |
| 侧栏入口 | DOM 注入（对齐 dsh-cron-board 的 sidebar-entry 模式），锚点优先「定时任务」按钮 |
| 设置 | 暂未做 `settings.section`（配置经 patch 的 `config` 提供），留待需要图形化时再补 |

## ④ 本地验证记录

| 检查 | 结果 |
|---|---|
| `pnpm run build` | ✓ tsc + esbuild（client bundle 34KB） |
| `npx tsc -p tsconfig.client.json --noEmit` | ✓ 无类型错误 |
| `pnpm run gates` | ✓ 12 项全过（包名/patch id/client id、exports、React 未打入） |
| `node scripts/smoke.mjs` | ✓ 产物导出齐备；探测 `http://127.0.0.1:61111` → 200 · 18ms · 「Yuze Workbench」 |
| 挂载 desktop profile | ✓ `link:` 安装成功，既有 17 个插件依赖完好（逐项校验） |

## ⑤ 待办 / 待确认

- [ ] **用户重启宿主**后确认：侧栏入口出现在「定时任务」下方、面板可打开、iframe 正常加载
- [ ] 内嵌体验优化：iframe 目前会显示 Yuze Workbench 自身的侧栏，可加 `?embed=1` 参数
      让 Workbench 在嵌入模式隐藏自己的导航（需要改 Yuze Workbench 的 Layout）
- [ ] 是否需要 `settings.section` 图形化配置页
- [ ] 是否发布到 git / npm（当前为本地挂载）

## 风险与约束

- Node half 变更需重启宿主；client half 变更需重新 build + 强刷
- 绝不代为重启用户的桌面应用（用户自行选择时机）
- 插件不落盘、不写宿主数据；探测仅限本机回环地址

---

# 方向调整（用户指令：不要链接外部，直接做功能）

## 触发

iframe 方案上线后，面板在 Yuze Workbench 桌面应用未运行时提示
「未连接到 http://127.0.0.1:61111」——功能可用性被外部应用的有无绑架。
用户决定：**去掉外链，功能直接做进插件**。

## 变更

| 项 | 旧 | 新 |
|---|---|---|
| 模块实现 | iframe 嵌入 Yuze Workbench 页面 | 插件内原生 React 视图 |
| 依赖 | 外部应用必须运行 | 零外部依赖，全部本机运行 |
| 数据 | 由 Workbench 持有 | 插件自有 JSON 存储 + 知识库只读代理 |
| Host 侧 | 在线探测（probe） | JSON 存储（原子写）+ Obsidian REST 客户端 |
| 端点 | `personal-workbench/probe` | `store/read`、`store/write`、`kb/list`、`kb/read`、`kb/search` |
| 已删除 | `src/probe.ts`、`workbenchUrl` / `probeTimeoutMs` 配置 | — |

## 交付（本轮）

- 项目总览、待办事项、日常管理、知识库 四个模块原生可用；
- 文件归档、音乐、影视、娱乐 四个模块显示「下一步说明」而非假数据；
- 一切外链、探测、iframe 相关代码全部移除。

## 待用户拍板

- **音乐 / 影视**：内容源怎么定？现有 Yuze Workbench 用的是自有接口
  （`yuze-yingshi-jiekou.pages.dev`、酷我搜索/解析、`jsnknpg4.pages.dev` 代理），
  这些属于外部服务，与「不要外链」的要求冲突，需明确是否允许调用、或改用别的方式。
- **文件归档**：归档根目录选哪个（本机路径），确认后接 Host 侧文件读取。
- **娱乐平台**：要做哪几个纯离线小工具。
