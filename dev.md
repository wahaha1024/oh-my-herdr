# Oh My Herdr 开发记录

> **只留在 `dev` 分支**：这里记关键代码位置、改动历史与排查步骤，供维护者在多台电脑之间共享。`main` 上的 `RECIPE.md` 是布局商店读取并整页渲染的**公开描述**，本文件的内容不进 `main`。改完后不自动 push，等明确同意再推。

一扇给自己用的工作台：左边按「机器 → 目录 → 空间 → 终端」分层，终端右侧有 380px 抽屉（文件、会话、收藏），底部是 28px 状态栏。默认亮色月白（qingci），另带玄墨（xuanmo）与可选的纸墨（zhi）。

![](preview.png)

## 2026-11-23 拉取安装与三处加载错误

另一台机器推到 `3e4e7c0`（21 个提交：`pick` 中英切换、项目归组与字母头像、标签状态色、安装器安全升级与 `-Source`、CodeBuddy 识别、抽屉线稿图标）。本机 `git fetch` 只跟踪 `main`（`remote.origin.fetch` 只有 `+refs/heads/main:...` 一行），所以 `origin/dev` 一直停在旧值 `3e50bb5`；拉 `dev` 要显式 `git fetch origin refs/heads/dev:refs/remotes/origin/dev`，或者先把 refspec 补成两条。

安装远程 `3e4e7c0`（`install.ps1 -Force`，写入 1352 个文件）后发现两个 mod 因语法错误无法加载，另有几处显示不对；修复已提交到 dev：`1f1c436`。

- **`inkstone-chrome` 多一个括号**：`renderWelcome()` 结尾 `.child(div().flex_1()))));` 比需要多一层 `)`，qjs 报 `expecting ';'`，整个品牌条、底部按钮和引导卡都不渲染。删到 `...flex_1())));`。
- **`inkstone-settings` 两处**：`left(t, cx) {` 连写两遍（qjs 报 `Unexpected token '{'`，位置在第二个方法签名上）；`right()` 里 `.child(v_flex().w_full().gap(5)` 少一个闭合 `)`，错误落到下一行的 `.when(...)`（`missing ) after argument list`）。偏好浮层因此完全不加载，改完两个方法都恢复正常。
- **侧栏段标题写死英文**：`inkstone-agents` 的 `Needs you` / `In flight` / `Done` / `all clear` / `nothing running` / `nothing yet` 和标题 `Agents`，`inkstone-workbench` 的 `Spaces`，都绕过 `pick`，中文界面下混着英文。改成 `pick("待你处理", "Needs you")` 这一类，用词与 `STATUS()` 的 `待处理 / 运行中 / 已完成 / 空闲` 对齐。
- **引导卡装不下**：`openOverlay` 的 `height: 300`（`inkstone-chrome` 两处、`inkstone-settings` 一处）放不下三条说明加按钮，底部「打开偏好」被裁；统一改成 `372`。

验证：`node --check` 跑遍 40 个 `mods/*/main.js` 全部通过；`herdr-app status` 的 `errors` 为空；截图确认侧栏「空间 / 智能体」、三段「待你处理 / 进行中 / 已完成」与空态全中文。此前无法核实的引导卡也用 Cua Driver 实测：窗口为 480×372，三条说明与「打开偏好」按钮完整可见；操作后已关引导卡、恢复此前前台应用，并将 Herdr 恢复到原先最小化状态。

Windows 的 `node` 不认 MSYS 路径，`node --check /e/...` 会被解释成 `C:\e\...`，把文件临时复制到 mod 目录再用相对名。`herdr-app shot` 只拍主窗口，不含 overlay；`status.overlays` 有条目也不等于截图能看到。Windows GUI 操作改用 Cua Driver（见下节），不再用 PowerShell `mouse_event` 模拟点击。

### Cua Driver（Windows 操作默认走后台）

已装 Cua Driver `0.59.4`，路径 `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin`，自动启动任务 `cua-driver-serve` 已注册并运行。下载必须走本机 `http://127.0.0.1:7890`：PowerShell 5.1 包装脚本要同时设置 `[System.Net.WebRequest]::DefaultWebProxy` 与 `HTTP_PROXY` / `HTTPS_PROXY`；可用 `CUA_DRIVER_RS_DOWNLOAD_BASE_URL` 指向本地镜像让官方安装器复用已下载资产。此次 zip 与官方 `SHA256SUMS` 一致，安装器也验证了 staged exe 的 Authenticode；当时没有 `cosign`，所以 Sigstore 只显示 warning，未做 bundle 验签。

- 用户偏好：Windows 下所有电脑 / Herdr 操作默认用 CUA 后台模式，优先 UIA `element_token`，绘制画布才用 `click` 的 `delivery_mode: "background"`；尽量不抢焦点、不移动用户鼠标、不干扰其他应用。禁止把 PowerShell 鼠标事件当默认路径。操作前后读回状态；如果为恢复最小化窗口不得不 `bring_to_front`，先记住返回的 `previous_fg_hwnd`，完成后恢复原前台应用。
- 基本路径：`cua-driver status` → `cua-driver call list_windows '{"app":"Herdr"}'` → `cua-driver call get_window_state '{"pid":PID,"window_id":HWND,"tree_format":"elements"}' --screenshot-out-file state.png` → 使用该快照的 `element_token`，或以同一截图坐标执行 `click`，再 `get_window_state` 回读。
- 本机 Herdr 是 GPUI 自绘界面，UIA 树只暴露原生标题栏的 5 个元素；主界面文字与按钮不在 UIA 中，须按 `get_window_state` 的窗口截图使用窗口局部坐标。坐标不能来自 `herdr-app shot`（该截图路径与屏幕窗口坐标不同）。
- 最小化窗口 `list_windows` 会报告 `minimized: true` 与离屏坐标（本机曾为 `-31993,-32000`）；`set_window_frame` 会明确拒绝最小化目标，要求先恢复窗口。像素后台点击只能在目标可截图时使用。验证欢迎卡时先恢复、移到 `(180,80,1300,900)`，背景点击「引导」`(78,874)`，截图确认 372px 卡片按钮完整，再背景点击关闭 `(860,291)`；最后 CUA 恢复先前的 Chrome 前台进程并把 Herdr 最小化。
- `cua-driver test` 在本机误报“can't use mouse and keyboard / can't see your screen”；以 `doctor`、`check_permissions` 和真实窗口动作判定：daemon 正常、UIA 与 `post_message` 可用，`get_window_state` 成功，后台像素点击确实打开 / 关闭引导卡。若重测仍失败，记录具体 Windows 构建与 daemon 日志，不要改用前台模拟输入绕过。


### 2026-11-23 布局被快照写回（标题栏按钮独占一行 + 右侧常驻「新建空间」）

现象：窗口顶部 − □ × 单独占一行；右边缘常驻 320px「新建空间」面板。

原因：本机 `layouts/oh-my-herdr.json` 被整体改写。顶层 `children` 多了一个 `{ "content": { "mod": "inkstone-space" }, "size": { "px": 320 } }`，把 overlay（`mod.json` 里 `overlay: { width: 470 }`）固化成常驻块；同时 `titlebar: "none"` 与 `traffic_lights: [12, 16]` 被挪进内层 `column`，而 Herdr 只认布局文档最外层的这两个键，内层的被静默忽略，系统标题栏于是重新出现。形态像一次 `layout.set` / `layout.clone` 把运行时活动树写回布局：`content.mod`、`size.px`、内嵌 titlebar 键都是活动树的序列化结果。仓库里的 mod 没有任何 `layout.set` 调用，不是 mod 自动写的。

恢复：`.omh/backups/<run>/files/layouts/oh-my-herdr.json` 每次 `install.ps1` 覆盖前都会留一份正确结构；用它覆盖 `layouts/oh-my-herdr.json`，把坏文件移到 `.omh/backups/oh-my-herdr.json.broken-<date>` 留证，再 `layout.switch main` → `layout.switch oh-my-herdr`。验证点：− □ × 回到 42px 标签行右端、右侧没有常驻「新建空间」、`herdr-app status` 的 `errors` 为空。

预防：不要对个人布局直接执行 `layout.set` / `layout.clone` 后保存；「新建空间」是 overlay，入口在侧栏「+」和右键菜单，不应出现在布局树里。再遇到同样形态，先比对顶层 `children` 数量与最外层 `titlebar` 键，再决定恢复。

## 2026-11-24 布局结构契约、标题里的 Nerd Font 图标与字体登记

### 标题符号：终端能画、界面画成豆腐块

智能体标题由 OMP 写成 `π - <card icon> <CODE>: <title> - <cwd>`（`π -` 来自 `~/.omp/agent/extensions/orca-titlebar-spinner.ts`，卡片是 `@oh-my-pi/pi-coding-agent` 的 `title-card`）。图标按 `title.icons: nf+emoji` 选：有 Nerd Font 字形就用字形，否则用 emoji，所以本机标题里是私用区码位（本次是 U+F056E，补面 15）。

终端区能画出来，是因为 Herdr 自带 `Symbols Nerd Font` 做终端的符号回退；**mod 文本没有这层回退**：它用 `settings().ui_font_family` 指定的字体，字体不存在就退回 Geist，私用区码位直接画成豆腐块。实测 `.font_family("…")` 选中不了系统没加载的家族：名字不存在时静默退回，且不会触发按码位的回退。Herdr 匹配字体名和别名（`fonts()` 只列一个规范名，`ui_font` 用字体内部的另一个名字也能命中，例如 `JetBrainsMono NF` ↔ `JetBrainsMono Nerd Font`）；但如果字体本身没被系统加载，任何名字都命不中——这次就是这种情况。

根因是字体登记，不是布局或 mod：用户字体表 `HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts` 里三个 JBM 只写了文件名（`JBM-Regular.ttf`），没写绝对路径。用户字体目录是 `%LOCALAPPDATA%\Microsoft\Windows\Fonts`，只写文件名时系统会去 `C:\Windows\Fonts` 找，找不到就不加载；文件还在，但 DirectWrite / GDI / Herdr 都枚举不到这个家族。证据：修复前 `[Windows.Media.Fonts]::SystemFontFamilies` 与 mod 里的 `fonts()` 都没有该家族；`herdr-app` 的字体表里只有 Herdr 自带的四个（Geist / Geist Mono / JetBrains Mono / Symbols Nerd Font）。

修复与验证：把三条登记改成绝对路径，`AddFontResourceEx` 加载并广播 `WM_FONTCHANGE`，重启 app 窗口（`herdr-app` 只是 UI，`hc` 里的终端不受影响）。重启后 `fonts()` = 155，含 `JetBrainsMono Nerd Font`；标签、智能体面板、窗格头的 `󰕮` 正常渲染，`ui_font` 仍是 `JetBrainsMono NF`（按别名命中）。同一台机器上 `Symbols Nerd Font` 的登记也补成了绝对路径。

防复发：
- `scripts/diagnose.py` 新增 `font_registry_problems()` / `font_registry_errors()`：用户字体表里出现相对路径记 `fonts: relative-registry-path xN`，绝对路径指向不存在的文件记 `fonts: registered-file-missing xN`；只报计数，不透传字体名或路径。修完后本机输出 `fonts: registered`。
- 手动自检：mod 里 `fonts()` 的结果可以写进 `shared.json` 回读；改字体后必须重开窗口，`fonts()` 在启动时建表，热重载不会重建。

### 布局结构契约（`scripts/check.py`）

`layout.set` / `layout.clone` 会把运行时活动树序列化回布局文件（见上一节）。现在 `check_layout()` 直接校验结构，发布前就能拦住同样的写回：

- 顶层必须有 `titlebar: "none"` 与两个 `traffic_lights`；这两个键出现在任何内层节点都报错。
- 顶层 `children` 只能有一个 `id=root`、`type=row` 的节点；所有节点 `id` 非空且不重复。
- `inkstone-space` 是 overlay-only，序列化成布局 block 时报错。
- `font` 必须包含 `Nerd Font`，保证窗格标题里的智能体私用区图标有字形来源。

`scripts/diagnose.py` 的 `layout_structure_errors()` 对**已安装**的布局做同样的分类检查，输出只有类别名（`layout: titlebar-not-top-level-none`、`layout: overlay-mod-pinned-as-block` 等）。`tests/test_check.py` 与 `tests/test_diagnose.py` 合计 27 项测试覆盖这些规则。

验证命令：`python scripts/check.py`（1364 个文件）、`python -m unittest discover -s tests`、`python scripts/diagnose.py`、`herdr-app status` 的 `errors` 为空。

## 下一步（2026-11-20）

给另一台电脑接手用，按优先级排；每条都写清要动的文件。

### 1. 界面中英文切换（已完成：`7f56ff7`，2026-11-23 补侧栏残留标签）

> 已落地为 `pick(zh, en)`；下面留原始方案，只为解释运行时约定，新的文字照此写即可。

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

`main` 只放公开版 `RECIPE.md`，开发记录 `dev.md` 不进 `main`：

```sh
git switch main
git merge --no-commit dev
git checkout --ours RECIPE.md     # 保留公开版
git rm -f dev.md                  # 开发记录留在 dev
git commit
```

`RECIPE.md` 在两个分支都追踪且内容一致（来自 `main`）；`dev.md` 只在 `dev` 追踪，合并时删掉即可。

## 2026-11-20 审查修复交接

- **数据安全**：历史复制直接用 `cx.write_to_clipboard`，不再写对话明文临时文件。历史、会话、设置均能从比较并交换（CAS）快照冲突中恢复；设置串行写入，只在最新数据上重放本次字段修改。历史尚未对位时不再误报保留 0 行。
- **会话与文件生命周期**：切换上下文或关闭时取消旧监听，丢弃旧空间或旧历史源的迟到结果；搜索先于版本控制探测完成时会重建索引。CLI 探测未命中 60 秒后重试。Windows 批量删除每批至多 50 个路径或 ID，编码负载超过 24000 字符时继续拆分；单条仍超限则明确失败，不执行删除。
- **实时审查**：底栏摘要每 25 秒刷新，按位置缓存子仓库发现结果、逐仓库读取；打开的审查窗口每 5 秒刷新并保留选择。`liveDiff()` 用空树对照覆盖尚无 HEAD 的 SHA-1/SHA-256 仓库，`gitPath()` 处理引号路径，`core.quotePath=false` 保留中文。本机 Unix 的「本轮」读取走 `sh` 位置参数；未跟踪预览失败可重试，并明确 800 行显示上限与宿主 1 MiB 读取上限。不引入差异正文磁盘缓存。
- **进程操作与布局**：资源、端口统一使用「结束」及同样式明确确认；执行失败保留行并显示原因。Linux 将有效的 `lsof` 空结果与失败区分，必要时回落 `ss`。本轮调整的关闭、打开、结束命中区至少 28 逻辑像素；标签只响应横向占优的滚轮。抽屉同步合并到单次任务，不在渲染中发布局命令；工作列窄于抽屉宽度加 432 像素时临时收起，拉宽后恢复原页。
- **安装与同步**：Shell 试运行既不创建目标目录，也不写跳过统计文件。Windows 安装先校验三个源目录，零写入明确警告；程序表兼容 UTF-8 与 BOM。`refresh.ps1` 不将个人程序夹带进发行补丁。保留当前工作树另行加入的 CodeBuddy 注册与程序表仅补缺失项策略。
- **撕边配色适配**：三套内置切片统一为「纸面取该主题底色亮一档 + 折痕用主题 `muted`」。此前 `ink-xuanzhi`、`ink-xuanmo` 的纸面填充与自身底色完全相同、折痕不透明度只有 0.05~0.07，深色下等于没有撕边；玄墨的折痕还是纯黑，在近黑底上没有对比，改为 `muted` `#8b8597`。判定改为 `background` 命中即启用、`muted` 只做精确优先，`xuanzhi-dimmed` 与 `xuanmo-dimmed` 各登记一行。9 份 `PRESETS` 对 9 个主题求值结果完全一致，三套切片按同一比例渲染对照；实机 qingci 与 xuanzhi 已确认可见。
- **新建空间与新建文件夹**：新增 [`inkstone-space`](mods/inkstone-space/main.js)，含两个模式。顶部 `+` 打开 `space` 模式：目录可手输、走系统选择器或点最近项，可选本机/远端机器与启动程序，默认取当前窗格目录。项目头或目录头右键新增「新建文件夹…」「在此新建空间…」（[`inkstone-workbench`](mods/inkstone-workbench/main.js) 传 `{folder, machine}` 给 [`inkstone-menu`](mods/inkstone-menu/main.js) 的 `dir` 分支），`folder` 模式在给定父目录下建子目录并沿用其机器。成功后调 `space.new`、写 `shared("inkstone.recentFolders")`、关闭浮层。两条硬约束：不要在宿主事件回调里 `await exec`——宿主会等回调返回，点击后面板永远停在「创建中…」；把异步流程放进自己的 `make(cx)`，回调立即返回，错误在 `.catch` 里落到 `this.err`。建目录用幂等的 `mkdir -p`（Windows 上由 Git Bash 提供），失败再回落 `cmd /c mkdir`，其「已存在」退出码 1 视为成功；远程机器不代建目录，只提示到那台机器上创建。
- **项目归组与显式归属**：工作树不再各占一行——`refresh()` 里再用 `git rev-parse --git-common-dir` 认出主仓库，`projectOf()` 把它归到 `.git` 的父目录（裸仓库与 `--separate-git-dir` 直接用该目录），`groupsOf()` 按项目根分组，同时保留每个工作树自己的分支标签。`shared("inkstone.bindings")` 存「空间的归属目录」，右键空间「设置归属目录…」（[`inkstone-menu`](mods/inkstone-menu/main.js) 的 `space` 分支）打开 [`inkstone-space`](mods/inkstone-space/main.js) 的 `bind` 模式；`place()` 先看归属表，只有实时 cwd 与空间目录相同或在其下才采用，智能体 `cd` 到项目外不再把空间拽到别的组。仓库与工作树缓存键都带机器前缀，归属表参与 `refresh()` 的 `key`，切换归属立即重算。新建空间默认继承当前空间的机器，`shared("inkstone.recentFolders")` 改成按机器分档（旧的数组自动视为本机一档）。
- **机器根目录**：`shared("inkstone.roots")` 按机器名记一个目录（`""` 指本机）。右键机器行「设置根目录…」（[`inkstone-menu`](mods/inkstone-menu/main.js) 的 `machine` 分支打开 [`inkstone-space`](mods/inkstone-space/main.js) 的 `root` 模式）把它设成 `E:\DSH` 这样的起点；`machinesView()` 随即在这台机器下面先插一行（`rootRow: true`），即使还没有空间也留位——右键它就是 `dir` 分支，可以直接「新建文件夹…」「在此新建空间…」，不必先有项目。根目录若已被某个项目组占用就不再重复插入。空组不显示 `0/0` 计数，也不加提示行。落在根目录里的项目在 `machinesView()` 里打上 `parent` 与 `pad = PAD`（12），渲染时缩进一级挂在根目录行下面：折叠根目录（`inkstone.folded` 存根路径）连带收起这些子项目，两者之间不画分隔线。子项目行用字母头像（`avatar()` + `toneOf()`，色相取名字字符和），与空间的像素精灵区分；空间标记固定是精灵，原先的「空间标记用头像」开关（`inkstone.spaces.mark`）已删。
- **标签状态色**：标签条与智能体面板共用一套状态色，写在 [`inkstone-tabs`](mods/inkstone-tabs/main.js) 的 `FLOW_RED` / `FLOW_YELLOW` / `FLOW_GREEN`（表达式与 [`inkstone-agents`](mods/inkstone-agents/main.js) 逐字相同，主题缺槽位时落到同一份备用值）。标记：待处理红方块、运行中琥珀黄圆环、已完成绿实心圆，空闲不画；标记放标签最左端，名字再长被 `truncate` 也不会把它挤掉。底色同样跟着状态：`tint(tone, 活动 ? "2e" : "18")`，描边 `aa`/`5c`，非活动标签的文字也用状态色。纸感主题不例外，只有无状态时才回到荧光笔选中那套。状态取该标签内智能体的最高优先级（`RANK`），不能只看 `c.status`：标签级状态常常停在空闲，智能体在跑时它不跟着变。
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
+ **会话右键**：侧栏会话行右键走 `inkstone-menu` 的 `agent` 分支。开关类全走宿主命令，不碰 agent 的输入：「重命名会话」（`tab.rename`，等同原生 `f2`）、「置顶会话／取消置顶」（`terminal.pin`，`pinned` 随终端持久，菜单文字按 `a.pinned` 切换）、「暂存会话」（`tab.settle`，移出列表仍在跑，需要你时回来）、「前移／后移」（`tab.move` 的 `by: "-" / "+"`）、「同空间新标签」（`tab.new`）、「左右分屏／向下分屏」（`pane.split`）、「最大化 / 还原」（`pane.zoom`）、「快速窥视」（`terminal.peek`）、「打开所在目录」（`inkstone.open`，目录取该会话 pane 的 `cwd`，退回空间 `folder`）、「复制终端地址」、「关闭会话」（`tab.close`）。会改变 agent 行为的两条单独隔开：`status === "working"` 时只给「中断当前回合」，停下才给「压缩上下文（/compact）」。斜杠命令收在「更多命令…」的二级视图里（同一菜单内 `this.more` 换列表，不另开浮层，避免「关掉再开」时浮层嵌套失效）：`/fork`、`/compact`、`/context`、`/cost`、`/status`、`/tree`、`/export`、`/rewind`、`/clear`。这些经 `exec("hc", [hc, terminal, text])` 打进会话——`hc send` 是「粘贴 + 回车」，所以必须多点一次；`hc` 在用户 PATH（`HKCU\Environment` 含 `herdr-core`），中断走 `exec("hc", ["interrupt", terminal])`。菜单高度按分支给（会话 480 / 标签 260 / 其它 300，宽 236），少了会被裁掉最后几项。
+ **折叠侧栏**：拖到 44px 自动进入图标轨模式——空间只剩彩色像素图案（tooltip 带名字、终端数、状态），目录只剩像素文件夹，点击照样能展开；macOS 下品牌条让位给交通灯，轨顶部会自动竖排多出一个「展开侧栏」按钮。
+ **文件抽屉**（`inkstone-files`）：全中文界面与只读高亮预览（`Esc` 清空搜索或退出预览），优先用 `git ls-files` / `jj file list` 建立可搜索索引（非仓库跳过 `.git`/`.jj`/`node_modules`/`target`/`dist`/`.next`/`__pycache__`），支持 `jj` 与 `git --no-optional-locks` 变更标记，每行与预览顶栏提供一键复制 `@relative/path`。搜索框还认 `路径:行号`（回车直接预览到该行）；抽屉头部的两个导航按钮（`nav-up.svg` 上级目录、`nav-home.svg` 回到项目目录）是 22×22 方形点击区 + 13px lucide 线稿：只有可用态才挂 `cursor_pointer` / `tooltip` / `hover`，不可用压到 `opacity(0.5)`，不再用 `↑` `⌂` 文字（字号与文件图标不齐）。文件图标本身照 VS Code 的 Material Icon Theme 规则挑。
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
+ **文件图标**：`mods/inkstone-files/icons/`（1184 个 SVG）与 `icons.js` 映射表取自 `material-icon-theme` 5.40.0（MIT，随仓附 `LICENSE-material-icon-theme.txt`），匹配规则与 VS Code 一致：路径规则优先于文件名，文件名优先于扩展名，最长扩展名优先。
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
+ **界面文案走 `pick(zh, en)`，不建字典**：每个 mod 在最后一个 `import` 之后加 `const pick = (zh, en) => (shared("inkstone.lang") === "en" ? en : zh);`，UI 字面量就地换成 `pick("中文", "English")`。`shared` 改动会让所有 mod 重绘，切语言立即生效；设置页再 `run("layout.switch", { name: LAYOUT })` 重建一次，让常驻的设置页自己也换。
+ **`pick` 的常量别叫 `LANG`**：`inkstone-files` 里已有 `const LANG = { ts: "js", … }`（扩展名映射），同名会让 qjs 报 `invalid redefinition of global identifier`，那份用 `LANG_KEY`。
+ **需要跟着语言变的表要写成函数**：设置页 `THEMES` / `STATUS` 若写成模块顶层数组，`pick` 在加载时就固化了，切语言后只有它们停在旧语言；写成 `const THEMES = () => [...]` 并在渲染处 `THEMES().map`。
+ **Spaces 里当前打开的 tab 行底色 = 状态色**：`inkstone-workbench` 的 `agentRow` / `termRow` 在 `s.active && c.active`（agent 行还要 tab 真的 active）时，用 `flowTone(t, st)` + `tint(tone, PAPER?3d:2e)` 染底；`flowTone`/`FLOW_*`/`RANK`/`statusOf` 是从 `inkstone-tabs` 顶栏抄的同一套契约（blocked 红 / working 琥珀 / done 绿），色值与 Agents 面板一致。agent 行的 `idle` 归入绿色档——Agents 面板的 Done 段本来就收 `done || idle`，两边必须同色；`termRow`（无智能体的纯终端）保持空闲不染，免得满屏绿。
+ **`mods/*/jsconfig.json` 关掉 `noImplicitAny`**：这份文件不进仓库（`.gitignore` 有意排除，它是语言服务的垫片），但模板是 `strict: true`，而 mod 的 JS 从不写参数类型 —— pi-lens 会给每个函数参数报 7006，workbench 一个目录就 182 条 error，把真问题全淹了。加 `"noImplicitAny": false`（放在 `"strict": true,` 下一行）后该目录降到 27 条，剩下的是 `#${string}` 颜色参数（`theme()` 的颜色槽是模板字面量类型）与 `shared()` 返回 `unknown` 后直接取属性，属真实类型不精确但运行时无害。换机器后要重做这一步。
+ **别用 `Get-FileHash`，也别假设系统 PowerShell 5.1 是完整的**：这台机器的 PS 5.1 的 `Microsoft.PowerShell.Commands.Utility.dll` 已缺失，`Get-FileHash` 不可用（`pwsh` 7 里才全）。安装器算哈希改用 `[System.Security.Cryptography.SHA256]` 直接读流（`install.ps1` 的 `Hash-File`），结果与 cmdlet 逐字节一致；写 PowerShell 时优先 .NET 类型，少依赖 cmdlet。
+ **嵌入 PowerShell 脚本的中文不翻译**：`inkstone-sessions` / `inkstone-review` 里 `Command` 串中的字面量属于执行用文本，翻译会连错误解析一起改。

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

