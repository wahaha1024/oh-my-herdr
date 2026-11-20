# Oh My Herdr
> **开发分支专用（`dev`）**：本文件随 `dev` 分支跟踪，用来让两台电脑共享关键代码位置、改动记录与排查步骤。`main` 上另有一份**公开版** `RECIPE.md`——那是布局商店读取并整页渲染的配方；这里的内容不进 `main`，`RECIPE.zh.md` 也只留在 `dev`。合并方式见文末「合并到 main」。改完后**不要自动 push 到 `origin`**，等口头同意再推。公开仓库放 `mods/`、`themes/`、`layouts/`、`pixel-icons/`、`programs.json`、安装脚本、中英 README、公开 `RECIPE.md` 与 LICENSE。
>

一扇给自己用的工作台：左边按「机器 → 目录 → 空间 → 终端」分层，终端右侧有 380px 抽屉（文件、会话、收藏），底部是 28px 状态栏。默认亮色月白（qingci），另带玄墨（xuanmo）与可选的纸墨（zhi）。

![](preview.png)

[English RECIPE](RECIPE.md)

## 下一步（2026-11-20）

给另一台电脑接手用，按优先级排；每条都写清要动的文件。

### 1. 界面中英文切换

现在的文案是写死的中文，散在 18 个 mod 里：`cockpit`、`inkstone-agents`、`inkstone-chrome`、`inkstone-favorites`、`inkstone-files`、`inkstone-history`、`inkstone-inbox`、`inkstone-menu`、`inkstone-metrics`、`inkstone-pane`、`inkstone-ports`、`inkstone-review`、`inkstone-sessions`、`inkstone-settings`、`inkstone-tabs`、`inkstone-workbench`，外加各 `mod.json` 的 `title`。平台没有现成钩子：`settings()` 的类型是 `Record<string, unknown>`，gpui-kit 不暴露界面语言（`EditorState` 的 `language` 是语法高亮模式）。

- **一处存、处处读。** `shared("inkstone.lang")` = `"zh" | "en"`，默认 `"zh"`；在 `inkstone-settings` 的偏好浮层里切换，其余 mod 只读。mod 之间不能互相 import，所以每个 mod 在 `main.js` 顶部自带一张表。
- **表的结构。** `const STR = { zh: {…}, en: {…} }; const L = () => STR[shared("inkstone.lang") ?? "zh"] ?? STR.zh;` 键名固定；缺键一律回落到中文，不能渲染出 `undefined`。
- **要翻的：** 状态词（`待处理 / 运行中 / 已完成 / 空闲`、`等你决定 / 全部就绪`）、面板标题（`驾驶舱`、`系统资源`、`待处理`、`目录收藏`、`文件`、`历史发言`、`偏好`、`审查`、`会话`、`收藏`）、空态、tooltip、`accessibility_label`、`notify()` 标题、`inkstone-menu` 的右键菜单项、相对时间（`刚刚 / 分钟 / 小时 / 天`）、窗格头的 `待你处理`。
- **不要翻的：** 来自 app 或智能体的内容——空间名、智能体标题、Git 输出、文件路径，以及 Herdr 自己画的标签。
- **翻完改宽度。** 英文更长，重新看 268px 侧栏、380px 抽屉、84px 待处理块、`inkstone-menu` 的 248px 浮层；用 `truncate()` 截断，别去撑大固定宽度的块。
- **验收。** 切 `en` → 重启 → 依次走侧栏、状态栏、三个抽屉页、右键菜单、偏好、待处理、系统资源、驾驶舱、审查、会话；切回 `zh` 确认没有残留英文。

### 2. 上架后的公开面

- `main` 上已有公开 `RECIPE.md`，布局商店把它当详情页整页渲染；访客需要知道的事要同时写在它和 README 里。
- `preview.png` 是 1600×1000，因为商店卡片按 16:10 + `object-fit: cover` 裁切。改完 `preview.svg` 用 `python mkprev.py` 重新生成（脚本自动找 Edge/Chrome，也可设 `HERDR_PREVIEW_BROWSER`），再把结果复制到 `layouts/oh-my-herdr.png`。
- `screenshot.png` 与 `screenshot-paper.png` 早于「智能体栏」和窗格头的历史按钮，发版前在本机重拍，让 README 与实机一致。
- 仓库 description 上限 350 字符（GitHub 限制），画廊卡片摘要就是它截断后的结果。
- `OiAnthony/oh-my-herdr` 是另一个布局，仓库名撞车。若画廊里两者仍难区分，就改我们的仓库名，并同步 README、`RECIPE.md` 与安装命令。

### 3. 已知缺口

- 历史发言只读 Windows 本地 OMP 会话；`hc read` 是未公开的依赖，macOS/Linux 路径没测过。
- OpenCode 会话需要那台机器上有 `sqlite3`。
- 安装脚本从不删旧主题，升级后旧的 `inkstone-*` 会留下。加一个 `-Clean` 开关是待办；在那之前 README 里教人手动删。
- `inkstone-settings` 只有 `props().framed` 为真时才画纸卡，内置设置页没有边是设计。

### 合并到 main

`main` 保留公开版 `RECIPE.md`，且不能收到 `RECIPE.zh.md`：

```sh
git switch main
git merge --no-commit dev
git checkout --ours RECIPE.md     # 保留公开版
git rm -f RECIPE.zh.md            # 笔记留在 dev
git commit
```

两个分支的 `.gitignore` 现在只忽略 `RECIPE.zh.md`；`RECIPE.md` 两边都追踪。

## 2026-11-20 审查修复交接

- **数据安全**：历史复制直接用 `cx.write_to_clipboard`，不再写对话明文临时文件。历史、会话、设置均能从比较并交换（CAS）快照冲突中恢复；设置串行写入，只在最新数据上重放本次字段修改。历史尚未对位时不再误报保留 0 行。
- **会话与文件生命周期**：切换上下文或关闭时取消旧监听，丢弃旧空间或旧历史源的迟到结果；搜索先于版本控制探测完成时会重建索引。CLI 探测未命中 60 秒后重试。Windows 批量删除每批至多 50 个路径或 ID，编码负载超过 24000 字符时继续拆分；单条仍超限则明确失败，不执行删除。
- **实时审查**：底栏摘要每 25 秒刷新，按位置缓存子仓库发现结果、逐仓库读取；打开的审查窗口每 5 秒刷新并保留选择。`liveDiff()` 用空树对照覆盖尚无 HEAD 的 SHA-1/SHA-256 仓库，`gitPath()` 处理引号路径，`core.quotePath=false` 保留中文。本机 Unix 的「本轮」读取走 `sh` 位置参数；未跟踪预览失败可重试，并明确 800 行显示上限与宿主 1 MiB 读取上限。不引入差异正文磁盘缓存。
- **进程操作与布局**：资源、端口统一使用「结束」及同样式明确确认；执行失败保留行并显示原因。Linux 将有效的 `lsof` 空结果与失败区分，必要时回落 `ss`。本轮调整的关闭、打开、结束命中区至少 28 逻辑像素；标签只响应横向占优的滚轮。抽屉同步合并到单次任务，不在渲染中发布局命令；工作列窄于抽屉宽度加 432 像素时临时收起，拉宽后恢复原页。
- **安装与同步**：Shell 试运行既不创建目标目录，也不写跳过统计文件。Windows 安装先校验三个源目录，零写入明确警告；程序表兼容 UTF-8 与 BOM。`refresh.ps1` 不将个人程序夹带进发行补丁。保留当前工作树另行加入的 CodeBuddy 注册与程序表仅补缺失项策略。
- **撕边配色适配**：三套内置切片统一为「纸面取该主题底色亮一档 + 折痕用主题 `muted`」。此前 `ink-xuanzhi`、`ink-xuanmo` 的纸面填充与自身底色完全相同、折痕不透明度只有 0.05~0.07，深色下等于没有撕边；玄墨的折痕还是纯黑，在近黑底上没有对比，改为 `muted` `#8b8597`。判定改为 `background` 命中即启用、`muted` 只做精确优先，`xuanzhi-dimmed` 与 `xuanmo-dimmed` 各登记一行。9 份 `PRESETS` 对 9 个主题求值结果完全一致，三套切片按同一比例渲染对照；实机 qingci 与 xuanzhi 已确认可见。
- **新建空间与新建文件夹**：新增 [`inkstone-space`](mods/inkstone-space/main.js)，含两个模式。顶部 `+` 打开 `space` 模式：目录可手输、走系统选择器或点最近项，可选本机/远端机器与启动程序，默认取当前窗格目录。项目头或目录头右键新增「新建文件夹…」「在此新建空间…」（[`inkstone-workbench`](mods/inkstone-workbench/main.js) 传 `{folder, machine}` 给 [`inkstone-menu`](mods/inkstone-menu/main.js) 的 `dir` 分支），`folder` 模式在给定父目录下建子目录并沿用其机器。成功后调 `space.new`、写 `shared("inkstone.recentFolders")`、关闭浮层。两条硬约束：不要在宿主事件回调里 `await exec`——宿主会等回调返回，点击后面板永远停在「创建中…」；把异步流程放进自己的 `make(cx)`，回调立即返回，错误在 `.catch` 里落到 `this.err`。建目录用幂等的 `mkdir -p`（Windows 上由 Git Bash 提供），失败再回落 `cmd /c mkdir`，其「已存在」退出码 1 视为成功；远程机器不代建目录，只提示到那台机器上创建。
- **验证边界**：改动路径均有针对性原生检查与隔离行为探针；本机没有 macOS、远端 Windows，Unix 命令以 Git Bash 验证，不等同原生平台认证；WSL 未安装。远端失败会写明机器及 `sh`/`awk` 前提，不再静默显示空列表。破坏性动作只用可丢弃进程、会话记录验证。
- **Windows 实际界面验证**：通过独立 `HERDR_APP_HOME` 与 `HC_SESSION` 载入工作树，`status.errors=[]`；检查 qingci/xuanmo/zhi、缩窄收起与拉宽恢复文件抽屉，以及设置、会话、资源、端口、历史入口的原生界面。无 HEAD 仓库显示已暂存中文路径，修改该文件后审查窗口无需点击刷新即可更新。测试窗格只运行 PowerShell，历史实际窗口验证的是无对应会话的空态，不冒充交互式 OMP 对话。测试窗口与核心会话用完销毁，不操作用户现有窗口。

## 2026-11-19 跨机交接

在仓库运行 `git switch dev` 和 `git pull --ff-only origin dev`。如果另一台电脑已经安装过，请先备份 Herdr 配置，再预览安装（Windows：`.\install.ps1 -DryRun -Force`；macOS/Linux：`./install.sh --dry-run --force`），确认后去掉预览参数安装，然后切一次布局或重启。默认安装会跳过同名文件并提示，`-Force` / `--force` 才会覆盖布局、模块和主题；现有 `programs.omp` 与 `programs.codebuddy` 仍保留。`refresh.ps1` 的方向相反：它把实机配置同步回仓库，程序表仅合并这两个白名单键并保留仓库其他项，不用它安装远端更新。不要跨机复制 `data/` 缓存或 OMP 会话日志。

### 历史发言与阅读窗口（`d41c014`、`4459530`）

- **入口与操作**：本地 Windows 的 OMP 窗格头时钟按钮打开面板（[`inkstone-pane`](mods/inkstone-pane/main.js)）。[`inkstone-history`](mods/inkstone-history/main.js) 的 `rounds()` 按用户消息组轮，将回复、工具和压缩记录归位；`firstKeptEntryId` 要能对到该轮的用户或助手消息。搜索覆盖提问、回复、工具；方向键选轮，Enter、双击或箭头回到终端；「阅读」或 `r` 打开宽 62%、高 86% 的窗口。阅读窗通过 `shared("inkstone.history.read")` 复用已解析内容和跳转位置，不再扫日志。圆点表示尚未对上终端回滚区，不代表丢了会话记录。不要用剪贴板模拟 `/tree`：OMP 会把粘贴后回车的文本当作普通提问，也没有指定树节点的恢复参数。
- **读取与刷新**：`load()` 先按 `pane.cwd` 和标题定位文件（`FOUND` 的命中有效期 120 秒），有缓存就先画列表。`readMessages()` 优先用 Node 子进程，从 `seen` 字节起读；`seen` 必须落在最后一个完整换行之后，半行留给下一次，文件比偏移短则回到 0。Node 不可用时用 PowerShell 全量读取；两条路径都先筛消息和压缩记录，再把精简 JSON 交回界面，不能用 `readTextFile` 读整个会话。`follow()` 只保留一个可取消的 `watchFolder` 句柄，将目录事件合并到 2 秒后刷新；标题或目录变化后丢弃旧读取并重启监听，15 秒检查也负责监听失效后的重试。`syncAlign()` 在回滚行数和对位长度没变时复用结果，需读时使用 `hc read` 的 1500 毫秒缓存。
- **落盘**：`PARSED` 最多 4 个会话；`${appHome()}/data/inkstone-history-cache.json` 按路径保存 `{v:1, entries:{…}}`，最多保留最新 3 个；`utf8Bytes()` 按整份序列化文本的 UTF-8 字节数限制到 900000，中文与 emoji 也不会突破 `readTextFile` 的 1 MiB 上限。刷新写入至少间隔 5000 毫秒，关窗尝试补写。`writeTextFile(path, text, expected)` 的 `expected` 必须是读取到的磁盘原文，`null` 只用于新建；冲突时重新读取并合并重试一次，只在成功后推进快照。
- **样式**：改 `FS`、`sectionLabel()`、`row()`、`markRow()` 和 `renderRead()`。选中项/跳转用 `accent`，有回复用 `done`，工具用 `working`；纸墨保留荧光笔选中底，搜索底用 `popover`。保持系统默认字体和三套主题的颜色槽，别给 GPUI 传 `bg("transparent")`。
- **接手验证**：在实际配置目录跑 `herdr-app check mods/inkstone-history`，并看 `herdr-app status` 的 `errors`。打开有长回复和压缩点的 OMP 会话，检查搜索、Esc 清搜索、`r` 开大窗和 Esc 关闭，以及箭头只出现在已对位的行；分别看 `qingci`、`xuanmo`、`zhi`。旧机约 40 MB 日志的解析探针是 421 毫秒全量、103 毫秒空尾读，不是首屏耗时。要比较另一台电脑的速度，分别计无缓存首开、有磁盘缓存重启后首开和同进程重开；验证半行时用日志副本，不改原会话。

### 侧栏、审查和会话抽屉

- **空间 / 智能体**（`de3c9a5`、`d41c014`）：[`sidebar-lists`](layouts/oh-my-herdr.json) 中空间和智能体权重 5:4、间距 0；[`inkstone-workbench`](mods/inkstone-workbench/main.js) 按机器 → 目录 → 空间分组，[`inkstone-agents`](mods/inkstone-agents/main.js) 单列待处理、运行中、已完成。两张卡接缝靠 `EDGE_B` / `EDGE_TOP` 各裁到 8px；别只改外层间距。终端边条在 [`artDir()`](mods/inkstone-edge/main.js)：有 `paper` 走原纸边；否则按 `background` 命中 `ink-qingci`、`ink-xuanzhi`、`ink-xuanmo` 三套切片，`muted` 只在同背景多档时做精确优先，`*-dimmed` 变体各登记一行。
- **审查**（`3963819`、`d41c014`）：[`inkstone-review`](mods/inkstone-review/main.js) 从底栏打开，Git 改动以实时 `git diff HEAD` 为主，未跟踪文件的正文点开才读；支持统一和左右对照。`turnEdits()` / `turnPaths()` 从最新用户消息边界提取 `edit` / `write` / `apply_patch` 的路径，只用来发现仓库和置顶该轮文件，不替代 Git 状态。排查「本轮为空」时，先查 Windows 路径是否按 UTF-8 返回、尾部窗口是否读到用户边界。`tailLines()` 在子进程里滤出用户和 `tool_execution_start` 行，别把完整尾部跨 IPC 送回（`exec` 输出上限 8 MiB）。
- **会话抽屉**（`d41c014`）：[`inkstone-sessions`](mods/inkstone-sessions/main.js) 支持 CodeBuddy、本地/远程扫描和独立的列表缓存 `data/inkstone-sessions-cache.json`（45 秒有效期）。维护删除功能时，只用测试记录验证单条/批量确认：它删除的是实际会话记录，不只是隐藏列表项。右侧抽屉只有文件、会话、收藏；变更走底栏审查，驾驶舱走顶栏弹出层。双语 README 保持面向用户，排障细节留在 RECIPE。


## 看到什么
从上到下、从左到右：

+ **侧栏 284px**（可拖动，最小 44px 收缩成图标轨）：顶部 44px 品牌条，中间按 5:4 分给空间列表和智能体列表，底部 40px；布局和边条参数见上面的跨机交接。
+ **顶部 42px**：`inkstone-tabs` 画标签、文件/会话/收藏按钮、驾驶舱弹出入口和窗口按钮，右侧有空间色点。
+ **中间**：终端，间距 8，圆角 10。
+ **右侧抽屉 380px**（默认隐藏）：文件、会话和收藏三页。
+ **底部 28px**：`status-text` 占满剩余，右侧依次 `inkstone-metrics`（CPU/内存）、`inkstone-ports`（端口数）、`inkstone-inbox`（待处理数）、`inkstone-review`（审查）。
+ **纸墨（zhi）下多出四层**：桌面（`canvas` `#dad1bf`）→ 羊皮纸侧栏（brand / workbench / footer 三块各画同一张 `parchment-*.svg` 的一段，拼成一整页）→ 纸页（终端四周 `inkstone-edge` 撕边、自绘 `inkstone-pane` 窗格头、标签条底边用 `rule-h.svg` 裁 2px 铅笔线）→ 墨字。选中态不是实色底而是荧光笔 `#f8dc4c`（四角不等圆角），组头下面一条铅笔线，工作树左侧一条竖铅笔线，git 只在异常时留 `↑n` / `↓n`。切回月白/玄墨，所有 `PAPER ? … : …` 都走 fallback，退回原有 GPUI 几何。

## 怎么用
+ **空间颜色**：7 色调色板（浅色档 `#a84a50 #8a5619 #7d640c #357041 #34618f #5f5399 #805083`，深色档换亮版），新空间拿用得最少的那个。切深浅主题时色相不变，只换亮度档。存在 `shared("inkstone.spaceColors")`，值是序号。
+ **空间图案**：空间行与图标轨前面是 8×8 像素形象，15 个（`slime ghost cat robot mushroom octopus skull heart potion frog rocket terminal coffee bomb star`），按空间名哈希分到用得最少的那个，存在 `shared("inkstone.sprites")`（`{空间id: 图案名}`，只保留现存空间）。**Alt+点击**图案换成下一个。画法是 `sprites.js` 的 `sprite()` / `glyph()`：把每行同色连续段合成矩形，用 GPUI 矩形逐格拼（`px` 像素/格），**不要换成 svg**——8 单位缩到 14/16px 会被抗锯齿糊成圆角。项目行的文件夹是同一套 `glyph(FOLDER, …)`；OMP 的图标来自 `programs.json`（`omp: { icon: pixel-icons/codex.svg, tint: false }`），标签里必须 `image(...).size(16)`（整数倍）才清晰。
+ **顶栏铃铛**：`inkstone-tabs` 的 `waiting()` 只列 `blocked` 与 `done` 的智能体，有才画（`bellGlyph()`，同一个矩形画法）；数字是总数，有 `blocked` 就用 `blocked` 色，否则 `done` 色；点击按 `space.select` → `tab.select` → `pane.focus`（退化 `agent.focus`）跳到最急的那个。
+ **点击**：侧栏空间/终端行——已在显示的那个就不发命令（每次切换都会重建终端视图、重放 scrollback）；点智能体行会 `space.select` + `tab.select` + `agent.focus`。
+ **折叠侧栏**：拖到 44px 自动进入图标轨模式——空间只剩彩色像素图案（tooltip 带名字、终端数、状态），目录只剩像素文件夹，点击照样能展开；macOS 下品牌条让位给交通灯，轨顶部会自动竖排多出一个「展开侧栏」按钮。
+ **文件抽屉**（`inkstone-files`）：全中文界面与只读高亮预览（`Esc` 清空搜索或退出预览），优先用 `git ls-files` / `jj file list` 建立可搜索索引（非仓库跳过 `.git`/`.jj`/`node_modules`/`target`/`dist`/`.next`/`__pycache__`），支持 `jj` 与 `git --no-optional-locks` 变更标记，每行与预览顶栏提供一键复制 `@relative/path`。
+ **会话抽屉**（`inkstone-sessions`）：无需 Python，按本地/远程自动切 PowerShell 或 `sh` + `awk`（传 `{ on }` 走已连 SSH），支持关键字实时搜索与来源药丸筛选（OMP / Codex / Claude Code / Pi / OpenCode（需 `sqlite3`）/ 项目归档 `.herdr/conversations`），按当前目录叶名直扫防老项目被挤出；行左带来源徽章，行右支持一键复制恢复命令。点一条——**优先按终端 **`argv`**/**`foreground.argv`** 里的会话 ID（回落到 OSC 标题前 24 字 + 目录）识别已开会话并切过去**，否则 `terminal.open` 恢复（`pi` 用 `--session`、`codex` 用 `resume`、`omp`/`claude` 用 `--resume`、`opencode` 用 `-s`）。
+ **收藏抽屉**（`inkstone-favorites`）：`shared("inkstone.favorites")` 是 `[{name, folder}]`；「收藏当前」取当前空间的目录，行上「已打开」表示该目录正有空间开着。
+ **待处理**（`inkstone-inbox`）：状态栏 84px 紧凑块 + 400×320 overlay，列出 `blocked` 的智能体。
+ **右键即粘贴**：`terminal_menu: "inkstone-paste"`，终端里右键不弹菜单，直接把剪贴板打进被右键的终端（先 `pane.focus` 交回焦点，再 `terminal.paste`，最后关掉自己的 overlay）。`init()` 开头 `if (checking()) return`，所以 `herdr-app check` 不会碰剪贴板。

## 装法
```powershell
.\install.ps1 -DryRun   # Windows：先看会写什么
.\install.ps1           # 不覆盖已有文件；programs.json 只加缺失的 omp 条目
```

```shell
./install.sh --dry-run  # macOS / Linux / WSL
./install.sh
```

装完：

```shell
herdr-app check mods/inkstone-workbench   # 每个 mod 都可以 check 一遍
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
```

## 用到的东西
+ **布局节点**：以 [`layouts/oh-my-herdr.json`](layouts/oh-my-herdr.json) 为准。`root` 下分 `sidebar` 和 `work`；`body` 的 `page` 用 `page-top`、`page-left`、`page-right`、`page-bottom` 四条 12px 切片包围终端。`panel-body` 的窗格头固定 30px，窗格间距 1px；右侧 `panel-stack` 对应文件、会话、收藏三个页面。
+ **自定义模块**：`inkstone-chrome`、`inkstone-workbench`、`inkstone-agents`、`inkstone-tabs`、`inkstone-edge`、`inkstone-pane`、`inkstone-history`、`inkstone-files`、`inkstone-sessions`、`inkstone-favorites`、`inkstone-inbox`、`inkstone-metrics`、`inkstone-ports`、`inkstone-review`、`inkstone-settings`、`inkstone-paste`、`inkstone-menu`、`cockpit`。
+ **用到的 Herdr 自带资产**：`workspace-status`、`pane`（及 `mods/files/*.svg` 图标）。
+ **herdr 函数**：`theme()`、`spaces()`、`panes()`、`terminals()`、`keys()`、`shared()` / `setShared()`、`layout()`、`exec()`、`run()`、`notify()`、`openOverlay()` / `closeOverlay()`、`props()`。
+ **命令**：`space.select`、`tab.select`、`tab.new`、`pane.focus`、`pane.split`、`pane.close`、`pane.zoom`、`agent.focus`、`terminal.open`、`terminal.kill`、`terminal.copy` / `terminal.paste`、`layout.select` / `layout.show` / `layout.hide` / `layout.resize`、`mod.open`、`app.theme`、`window.*`。
+ **读的外部数据**：OMP（`~/.omp/agent/sessions`）、Codex（`~/.codex/sessions`）、Claude Code（`~/.claude/projects`）、Pi（`~/.pi/agent/sessions`）、项目归档（`<cwd>/.herdr/conversations`）的首尾各 25 行，及可选 `sqlite3` 只读 OpenCode（Windows 用 PowerShell，macOS / Linux / 远程机器用 `sh` + `awk`，不依赖 Python）；文件搜索与状态走 `jj` / `git`；系统指标与监听端口在 Windows 走 PowerShell，在 macOS 走 `vm_stat`/`top`/`sysctl`/`lsof`/`open`/`kill`，在 Linux 走 `/proc`、`lsof`/`ss`、`xdg-open`/`kill`；`hc` / `git` 通过 `exec`。

## 注意
+ 侧栏初始宽度 284px；拖动和折叠走 `layout.resize`，调默认宽度要改布局。
+ `inkstone-workbench` 和 `inkstone-tabs` 各存了一份调色板常量（mod 之间不能 import），改配色要同时改两个文件。
+ 状态栏几个块是固定宽度（metrics 152 / ports 64 / inbox 84 / review 148），改内容长度要同步改布局里的 px。
+ 会话实况识别优先匹配启动参数中的会话 ID，其次匹配终端 OSC 标题前 24 字与 cwd；标题被手动改掉且无参数启动时会当成新会话开。
+ 远程空间会在已连机器上通过 `exec(..., { on })` 扫描会话与文件目录。
+ 图案、项目文件夹、铃铛都是 GPUI 矩形拼的，不走 svg；改图案只改 `sprites.js` 里的字符串数组（`.` 透空、`x` 主色、`o` 白、`k` 近黑），每行 8 列。
+ `programs.json` 是可选补丁：当前安装器只补缺失的 `omp`、`codebuddy` 两项，已有条目即使指定 `-Force` / `--force` 也保留；`refresh.ps1` 只合并这两个白名单键，其他程序与顶层设置不动。`pixel-icons/` 必须一起装，否则 OMP 的 `icon` 路径悬空，终端行与标签会退回默认图标。
+ 复制了 `gpui-kit.d.ts` 之外的全部资产；mod 目录里没有 `.d.ts` / `jsconfig.json`，编辑器里没有类型提示，运行不受影响。
+ `inkstone-edge` 的 `mod.json` 必须是 `{ "place": "none" }`：写别的值 Herdr 会把这块自动插进布局，删掉 mod 后布局就坏。
+ `titlebar` 与 `traffic_lights` 必须写在布局文档的最外层节点上（与 `id`、`type`、`children` 同级）。写到里面的 `root` row 上会被静默忽略：系统标题栏照旧浮在布局上方，`window().buttons` 为 `false`，`inkstone-tabs` 那三个 − □ × 永远不渲染。挪到外层后标题栏消失，最小化 / 最大化 / 关闭落在标签条右端「驾驶舱」之后，与面板按钮同一行。
+ 纸感只由「主题里有没有 `paper` 槽」决定（`Boolean(theme().paper)`），mod 从不认主题名。`themes/zhi.json` 多带 11 个自定义槽（`paper` / `desk` / `ink` / `pencil` / `rule` / `stroke` / `mark` / `bracket` / `up` / `down` / `seal`）；没定义 `paper` 的主题自动走 fallback，不会留浅色纸边，也不会去取不存在的羊皮纸档（`nearest()` 取最近档，永不 404）。
+ 撕边不要求 `paper` 槽：内置明暗配色按 `background` 命中 `inkstone-edge` 的 `PRESETS`，`muted` 只用于同背景多档精确优先；实机已有的 `xuanzhi-dimmed`、`xuanmo-dimmed` 各登记一行复用同档切片，其余主题留空。
+ 三套切片的配色要一起改：纸面填充取该主题底色的亮一档（qingci `#edf4ef`、xuanzhi `#fcf8f0`、xuanmo `#1e1d25`），折痕用主题 `muted` 的 0.16 / 0.18 / 0.26，外轮廓 0.26 → 0.34（玄墨保留原 `#050408` 0.65）。只改一个目录会留下「终端有边、侧栏卡片没有」的中间态；改完还要同步 9 份 `PRESETS`（`inkstone-edge` 的 `PRESETS` 与另外 8 个模块的 `EDGE_PRESETS`）。
+ 纸感与撕边资产合计约 3.2MB：`mods/inkstone-chrome/ink/`（39 个文件：羊皮纸 17 档、头像 11、墨线纸片 6、铅笔线 2、徽章 2、LICENSE）、`mods/inkstone-edge/ink/`（8 片撕边 + LICENSE）与 `mods/inkstone-edge/ink-{qingci,xuanzhi,xuanmo}/`（同 8 片的青瓷、宣纸、玄墨配色版），都从 Looseleaf（MIT）搬来；`inkstone-pane` 另有 5 个 22px 图标。
+ **常驻的窗格头按钮要给悬停按钮组留位**：窗格头是 `h_flex` + `gap 8`，四个悬停按钮一出现整行变宽，左侧所有按钮右移 4×22 + 4×8 = 120px。OMP 那枚历史按钮正好在那个位置，点它落到 `close` 上，终端当场被杀。不悬停时要在同样的槽位放四个空的 22px div；合并成一个 88px 不够，因为父级 `gap` 只加在相邻兄弟之间。
+ **旧发言没有箭头时，先看终端保留区**：对当前终端执行 `hc read <term> --lines 20000 --json`；返回 `complete: false` 说明只拿到保留的部分，不代表日志解析失败。不要测同 cwd 下已经结束的兄弟终端。大日志由子进程筛选，`readTextFile` 只读小缓存。
+ **经 `exec` 传给 PowerShell 的命令串里不能有双引号**：Windows 命令行解析会先把 `"` 剥掉，PowerShell 认为语句没结束而挂起等输入，调用只能等超时才返回。所有引号用 `[string][char]34` 拼。命令串前面还要加 `[Console]::OutputEncoding=[Text.Encoding]::UTF8;`，否则中文路径回来是乱码，查找静默失败。
+ **按 `pane.cwd` 定位 OMP 会话，不要全库搜标题**：`~/.omp/agent/sessions/<cwd 里 [:\/] 换成 ->` 目录里只放这个项目的会话；扫全库再退回「最近写过的那个文件」，会在标题还是空的时候把别的项目的对话显示出来。

## 装好了怎么验
```shell
herdr-app check mods/inkstone-workbench    # → check passed
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
herdr-app status | jq .errors              # → []
herdr-app shot out.png                     # 看空间/智能体列表、状态栏和顶部三个抽屉按钮
```

## 排查

装完发现某处不对（最典型：终端四周没有纸质撕边、侧栏下半没有 Agents 三栏），先在出问题的那台机器上跑这三条：

```powershell
$cfg = "$HOME\.config\herdr-app"
# 1) 布局里有四条纸页边条 → 应为 4
(Select-String -Path "$cfg\layouts\oh-my-herdr.json" -Pattern 'page-left|page-right|page-top|page-bottom').Count
# 2) 撕边 mod 是含青瓷切片的新版 → 应大于 0（旧版没有这个词）
(Select-String -Path "$cfg\mods\inkstone-edge\main.js" -Pattern 'ink-qingci').Count
# 3) 有没有 mod 加载错误 → 应为空
(herdr-app status | ConvertFrom-Json).errors
```

macOS / Linux 等价写法：

```sh
cfg="$HOME/.config/herdr-app"
grep -c 'page-left\|page-right\|page-top\|page-bottom' "$cfg/layouts/oh-my-herdr.json"
grep -c 'ink-qingci' "$cfg/mods/inkstone-edge/main.js"
herdr-app status | grep -o '"errors":\[[^]]*\]'
```

| 结果 | 原因 | 处置 |
|---|---|---|
| 1 不是 4，或 2 等于 0 | 之前装过旧版，`install.ps1` / `install.sh` 跳过了同名文件 | `.\install.ps1 -Force`（`./install.sh --force`），然后 `herdr-app do layout.switch '{"name":"oh-my-herdr"}'`，或重启 herdr-app |
| 3 有内容 | herdr 低于 0.1.16，没有 `themes` 导出，撕边 mod 加载失败 | 升级 herdr |
| 三条都正常、仍无撕边 | 当前主题未命中切片的配色 | 用 `herdr-app do app.theme --name qingci` 对照，检查 `inkstone-edge/main.js` 的 `PRESETS` |

改完配置要让它重新加载：`layout.switch` 切一次布局，或重启 herdr-app。

本机部署注意：`refresh.ps1` 只做「本机 → 仓库」单向同步；把仓库的最新提交装回本机要手工反向复制，或跑 `install.ps1 -Force`。反向复制前先备份（例如 `~/.config/herdr-app/.backup-<日期>/`）。

