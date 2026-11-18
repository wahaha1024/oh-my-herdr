# Oh My Herdr

一扇给自己用的工作台：左边是「目录 → 空间 → 终端」三层列表，右边终端，右侧一个 380px 的抽屉（文件/变更/驾驶舱/会话/收藏），底部一条 28px 状态栏。空间自带颜色，扫一眼就知道自己在哪个项目、哪台机器。主题两套：月白（qingci）/ 玄墨（xuanmo）。

![Oh My Herdr](preview.png)

## 看到什么

从上到下、从左到右：

- **侧栏 272px**（可拖动，最小 44px 收缩成图标轨）：
  - 顶部 46px 品牌条（`inkstone-chrome`，可拖动窗口，双击最大化）。
  - 中间 `inkstone-workbench`：按目录分组（folder 图标 = 组内第一个空间的颜色，组间一条 1px 分隔线），组内每个空间一行 30px、圆角 7：彩色数字徽章（16×16，选中时实心底 + 反色字）、彩色空间名 14px、分支名 11px、7px 状态点。空间展开后列终端：有智能体的显示「图标 + 名字 + 状态」24px 行，普通终端显示「图标 + 名字」24px 行；空空间显示「还没有终端」。
  - 底部 120px `inkstone-chrome`（footer 模式）：偏好、Herdr 设置、添加机器三行 32px。
- **顶部 42px**：`inkstone-tabs` 画标签（`inkstone-tabs` 自己画窗口按钮，Windows 下用矢量图标），左边一排面板按钮（文件/会话/收藏/驾驶舱/变更），右边空间色点 7px。
- **中间**：终端，间距 8，圆角 10。
- **右侧抽屉 380px**（默认藏起，点顶部面板按钮展开）：`inkstone-files`、`changes`、`cockpit`、`inkstone-sessions`、`inkstone-favorites` 五页。
- **底部 28px**：`status-text` 占满剩余，右侧依次 `inkstone-metrics`（CPU/内存）、`inkstone-ports`（端口数）、`inkstone-inbox`（待处理数）、`inkstone-review`（审查）。

## 怎么用

- **空间颜色**：7 色调色板（浅色档 `#a84a50 #8a5619 #7d640c #357041 #34618f #5f5399 #805083`，深色档换亮版），新空间拿用得最少的那个。切深浅主题时色相不变，只换亮度档。存在 `shared("inkstone.spaceColors")`，值是序号。
- **空间图案**：空间行与图标轨前面是 8×8 像素形象，15 个（`slime ghost cat robot mushroom octopus skull heart potion frog rocket terminal coffee bomb star`），按空间名哈希分到用得最少的那个，存在 `shared("inkstone.sprites")`（`{空间id: 图案名}`，只保留现存空间）。**Alt+点击**图案换成下一个。画法是 `sprites.js` 的 `sprite()` / `glyph()`：把每行同色连续段合成矩形，用 GPUI 矩形逐格拼（`px` 像素/格），**不要换成 svg**——8 单位缩到 14/16px 会被抗锯齿糊成圆角。项目行的文件夹是同一套 `glyph(FOLDER, …)`；OMP 的图标来自 `programs.json`（`omp: { icon: pixel-icons/codex.svg, tint: false }`），标签里必须 `image(...).size(16)`（整数倍）才清晰。
- **顶栏铃铛**：`inkstone-tabs` 的 `waiting()` 只列 `blocked` 与 `done` 的智能体，有才画（`bellGlyph()`，同一个矩形画法）；数字是总数，有 `blocked` 就用 `blocked` 色，否则 `done` 色；点击按 `space.select` → `tab.select` → `pane.focus`（退化 `agent.focus`）跳到最急的那个。
- **点击**：侧栏空间/终端行——已在显示的那个就不发命令（每次切换都会重建终端视图、重放 scrollback）；点智能体行会 `space.select` + `tab.select` + `agent.focus`。
- **折叠侧栏**：拖到 44px 自动进入图标轨模式——空间只剩彩色像素图案（tooltip 带名字、终端数、状态），目录只剩像素文件夹，点击照样能展开；macOS 下品牌条让位给交通灯，轨顶部会自动竖排多出一个「展开侧栏」按钮。
- **文件抽屉**（`inkstone-files`）：全中文界面与只读高亮预览（`Esc` 清空搜索或退出预览），优先用 `git ls-files` / `jj file list` 建立可搜索索引（非仓库跳过 `.git`/`.jj`/`node_modules`/`target`/`dist`/`.next`/`__pycache__`），支持 `jj` 与 `git --no-optional-locks` 变更标记，每行与预览顶栏提供一键复制 `@relative/path`。
- **会话抽屉**（`inkstone-sessions`）：无需 Python，按本地/远程自动切 PowerShell 或 `sh` + `awk`（传 `{ on }` 走已连 SSH），支持关键字实时搜索与来源药丸筛选（OMP / Codex / Claude Code / Pi / OpenCode（需 `sqlite3`）/ 项目归档 `.herdr/conversations`），按当前目录叶名直扫防老项目被挤出；行左带来源徽章，行右支持一键复制恢复命令。点一条——**优先按终端 `argv`/`foreground.argv` 里的会话 ID（回落到 OSC 标题前 24 字 + 目录）识别已开会话并切过去**，否则 `terminal.open` 恢复（`pi` 用 `--session`、`codex` 用 `resume`、`omp`/`claude` 用 `--resume`、`opencode` 用 `-s`）。
- **收藏抽屉**（`inkstone-favorites`）：`shared("inkstone.favorites")` 是 `[{name, folder}]`；「收藏当前」取当前空间的目录，行上「已打开」表示该目录正有空间开着。
- **待处理**（`inkstone-inbox`）：状态栏 84px 紧凑块 + 400×320 overlay，列出 `blocked` 的智能体。
- **右键即粘贴**：`terminal_menu: "inkstone-paste"`，终端里右键不弹菜单，直接把剪贴板打进被右键的终端（先 `pane.focus` 交回焦点，再 `terminal.paste`，最后关掉自己的 overlay）。`init()` 开头 `if (checking()) return`，所以 `herdr-app check` 不会碰剪贴板。
- **快捷键**：

  | 键 | 作用 |
  |---|---|
  | `alt-shift-p` | 偏好面板（主题、外观） |
  | `alt-shift-r` | 审查 |
  | `alt-shift-m` | 指标 |
  | `alt-shift-o` | 端口 |
  | `alt-shift-i` | 待处理 |

## 装法

```powershell
.\install.ps1 -DryRun   # Windows：先看会写什么
.\install.ps1           # 不覆盖已有文件；keys.json 只加缺的键，冲突会列出来
```

```sh
./install.sh --dry-run  # macOS / Linux / WSL
./install.sh
```

装完：

```sh
herdr-app check mods/inkstone-workbench   # 每个 mod 都可以 check 一遍
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
```

## 用到的东西

- **布局节点**：root `row`（`titlebar: "none"`、`traffic_lights: [12,16]`、`theme: {light:"qingci",dark:"xuanmo"}`、`terminal_menu: "inkstone-paste"`、`preview`）→ `sidebar`（column，272，min 44，max 420）+ `work`（column：42px `inkstone-tabs` 块 + body row + 28px 状态栏 row）。body 里 `panel-body` 是 `{tab:"active"}` 的 block，`panel` 是 380px 的 column（`stack` id `panel-stack`，子页 inkstone-files/changes/cockpit/inkstone-sessions/inkstone-favorites）。
- **自己的 mod**（14 个）：`inkstone-chrome`（品牌条 + footer）、`inkstone-workbench`（列表）、`inkstone-tabs`（标签 + 窗口按钮 + 面板按钮）、`inkstone-files`（文件树 + 搜索 + `@path` + `jj`/`git` 标记）、`inkstone-sessions`、`inkstone-favorites`、`inkstone-inbox`、`inkstone-metrics`、`inkstone-ports`、`inkstone-review`、`inkstone-settings`、`inkstone-paste`（右键即粘贴）、`inkstone-menu`（工作台与可选右键菜单）、`cockpit`。
- **用到的 Herdr 自带资产**：`changes`、`workspace-status`、`pane`（及 `mods/files/*.svg` 图标）。
- **herdr 函数**：`theme()`、`spaces()`、`panes()`、`terminals()`、`keys()`、`shared()` / `setShared()`、`layout()`、`exec()`、`run()`、`notify()`、`openOverlay()` / `closeOverlay()`、`props()`。
- **命令**：`space.select`、`tab.select`、`tab.new`、`pane.focus`、`pane.split`、`pane.close`、`pane.zoom`、`agent.focus`、`terminal.open`、`terminal.kill`、`terminal.copy` / `terminal.paste`、`layout.select` / `layout.show` / `layout.hide` / `layout.resize`、`mod.open`、`app.theme`、`window.*`。
- **读的外部数据**：OMP（`~/.omp/agent/sessions`）、Codex（`~/.codex/sessions`）、Claude Code（`~/.claude/projects`）、Pi（`~/.pi/agent/sessions`）、项目归档（`<cwd>/.herdr/conversations`）的首尾各 25 行，及可选 `sqlite3` 只读 OpenCode（Windows 用 PowerShell，macOS / Linux / 远程机器用 `sh` + `awk`，不依赖 Python）；文件搜索与状态走 `jj` / `git`；系统指标与监听端口在 Windows 走 PowerShell，在 macOS 走 `vm_stat`/`top`/`sysctl`/`lsof`/`open`/`kill`，在 Linux 走 `/proc`、`lsof`/`ss`、`xdg-open`/`kill`；`hc` / `git` 通过 `exec`。

## 注意

- 侧栏宽度和折叠状态是 `layout.resize` 的点击状态，存在 `layouts/.state/`，**重启不保留**（布局文件里的 272 才是初始值）。
- `inkstone-workbench` 和 `inkstone-tabs` 各存了一份调色板常量（mod 之间不能 import），改配色要同时改两个文件。
- 状态栏几个块是固定宽度（metrics 152 / ports 64 / inbox 84 / review 88），改内容长度要同步改布局里的 px。
- 会话实况识别优先匹配启动参数中的会话 ID，其次匹配终端 OSC 标题前 24 字与 cwd；标题被手动改掉且无参数启动时会当成新会话开。
- 远程空间会在已连机器上通过 `exec(..., { on })` 扫描会话与文件目录。
- 图案、项目文件夹、铃铛都是 GPUI 矩形拼的，不走 svg；改图案只改 `sprites.js` 里的字符串数组（`.` 透空、`x` 主色、`o` 白、`k` 近黑），每行 8 列。
- `programs.json` 是可选补丁：安装只加 `omp` 一条，已有 `omp` 条目原样保留；`pixel-icons/` 必须一起装，否则 `icon` 路径悬空，终端行与标签会退回默认图标。
- 复制了 `gpui-kit.d.ts` 之外的全部资产；mod 目录里没有 `.d.ts` / `jsconfig.json`，编辑器里没有类型提示，运行不受影响。

## 装好了怎么验

```sh
herdr-app check mods/inkstone-workbench    # → check passed
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
herdr-app status | jq .errors              # → []
herdr-app shot out.png                     # 看侧栏有彩色徽章、状态栏右侧四块、顶部五个面板按钮
```
