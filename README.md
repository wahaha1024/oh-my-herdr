# Oh My Herdr

一个给 [Herdr](https://herdr.dev) 用的工作台布局：侧栏按目录分组、每个空间固定配色，右侧可收起的抽屉装文件与会话，底部一条状态栏常驻指标。默认主题月白（qingci），另带深色玄墨（xuanmo）与纸墨（zhi）：桌面 → 羊皮纸侧栏 → 撕边纸页 → 墨字四层叠起来的一套纸感外观。

英文说明见 [README.en.md](README.en.md)。

![月白](preview.png)
![玄墨](preview-dark.png)

> 两张图是按布局比例画的示意图，不是截图。

---

## 改了什么

- **侧栏按目录分组**：组头（像素文件夹 + 计数 + 分隔线）、空间行、终端行三层缩进。空间前面不是数字徽章，而是 8×8 像素小图案（15 个可选，按名字分配同一个，Alt+点击换下一个），颜色自动分配并记住，切主题只换明暗不换色相。
- **像素图标**：项目行、空间行是同一套 8×8 格律（GPUI 矩形逐格画，边缘是硬的，不是缩放糊掉的矢量图）；`programs.json` 让 OMP 用 Codex 的像素图标；顶栏一个像素铃铛，只在有智能体等你时出现（待处理，或你不在时已完成），带数量，点一下跳到最急的那个。
- **侧栏可折叠**：拖到 44px 变成图标轨，只剩彩色徽章；拖回来恢复。
- **顶栏重排**：标签放大到 30px 高；右侧面板按钮带中文名；左侧一个小色点标出当前空间的颜色。
- **五个抽屉页**：文件（`inkstone-files`）、变更、驾驶舱、会话、收藏，默认收起。文件页支持关键字检索（`git ls-files` / `jj file list` 优先）、行尾与预览顶栏一键复制 `@path`、以及 `jj` / `git` 变更标记；会话页无需 Python，支持关键字搜索、来源筛选药丸、当前目录直扫、远程机器扫描与一键复制恢复命令，已在终端跑着的标「已打开」，点一下直接切过去。
- **状态栏**：CPU 与内存、监听端口数、等你处理的智能体数（点开名单）、审查入口。
- **终端右键直接粘贴**：不弹菜单。

## 安装

### 用脚本（Windows PowerShell）

```powershell
.\install.ps1 -DryRun     # 先看会写什么
.\install.ps1             # 不覆盖已有文件；programs.json 只加缺失的 omp 条目
```

### 用脚本（macOS / Linux / WSL）

```sh
./install.sh --dry-run    # 先看会写什么
./install.sh              # 不覆盖已有文件；--force 覆盖
./install.sh --target=DIR # 装到别的配置目录
```

仅 `install.sh` 在自动合并 `programs.json` 时需要 `python3`（或 `python`）；没有时它会把要加的 `omp` 条目直接打印出来，你手动加。布局和 14 个 mod 本身运行时不依赖 Python。

`pixel-icons/` 与 `programs.json` 一起装：后者只往你的程序表里加一条 `omp`（图标指向 `pixel-icons/codex.svg`，`tint: false`）；已经有 `omp` 条目时原样保留，只提示一句。

### 多台电脑

同一个仓库装到第二台机器（Windows / macOS / Linux）：clone 下来跑对应脚本就行，布局、mod、主题完全一致。**不随仓库走的**有三样——空间配色与收藏（在 `shared.json`）、字体和外观（在 `settings.json`，本包不带）、以及每台机器自己的空间与会话记录（`view.json`、`~/.omp` / `~/.codex` / `~/.claude` / `~/.pi`）。所以第二台机器上空间会重新分配颜色、收藏是空的，功能本身不受影响。

每台机器需要的是：Herdr 自带的 `changes` / `workspace-status` / `pane` 基础 mod（安装 Herdr 就有，另复用 `mods/files/*.svg` 图标）、`git`（或可选 `jj`，显示分支与改动），以及你用到的对话 CLI（`omp` / `codex` / `claude` / `pi` / `opencode` 在 `PATH` 中，点击历史会话时才会用到）。

### 手动

1. `layouts/oh-my-herdr.json` → `~/.config/herdr-app/layouts/`（Windows：`C:\Users\<你>\.config\herdr-app\layouts\`）。
2. `mods/` 下每个文件夹 → 配置目录的 `mods/`。
3. `themes/qingci.json`、`themes/xuanmo.json` → 配置目录的 `themes/`。
4. 切过去：

```sh
herdr-app check mods/inkstone-workbench     # 每个 mod 都值得 check 一次
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
```

切回来是 `ctrl-shift-l`；不想要了就删掉这些文件。

### 依赖

Herdr 自带的 `changes`、`workspace-status`、`pane`（及 `mods/files/*.svg` 图标）；`inkstone-files` 用 `git`（或可选 `jj`）加 PowerShell / `sh` 列目录并建索引；`inkstone-sessions` 用 PowerShell（Windows）或 `sh` + `awk`（macOS / Linux / 远程机器）扫 OMP / Codex / Claude Code / Pi / 项目归档（有 `sqlite3` 时附带 OpenCode）会话目录（哪个不存在就跳过，不报错）；`inkstone-metrics` 用系统自带计数器；`inkstone-ports` 在 Windows 用 `Get-NetTCPConnection`，在 macOS / Linux 用 `lsof`（或 `ss`）。全部只在本机或已连远程机器跑，不额外联网，不依赖 Python。

## 配色

七个空间色按「用得最少的序号」分配，存的是序号不是十六进制：`shared("inkstone.spaceColors")` = `{spaceId: 0..6}`。浅色档对月白底 4.82–5.69:1，深色档对玄墨底 6.39–11.26:1。

| # | 浅色档 | 深色档 | 色相 |
|---|---|---|---|
| 0 | `#a84a50` | `#f08a8a` | 砖红 |
| 1 | `#8a5619` | `#f2a46a` | 赭橙 |
| 2 | `#7d640c` | `#e8c76a` | 芥黄 |
| 3 | `#357041` | `#7ecf86` | 竹绿 |
| 4 | `#34618f` | `#6fb3ea` | 靛蓝 |
| 5 | `#5f5399` | `#9a8ce6` | 青莲 |
| 6 | `#805083` | `#c98ae6` | 紫藤 |

调色板在 `mods/inkstone-workbench/main.js` 和 `mods/inkstone-tabs/main.js` 各存一份（mod 之间不能互相 import），改色要同时改两个文件。

## 主题

`themes/qingci.json`（月白：底 `#e8f0ec`、字 `#2b333e`、强调 `#126e82`）和 `themes/xuanmo.json`（玄墨：底 `#14131a`、字 `#d4cec4`、强调 `#619ac3`），都是完整 16 色 ANSI + 语义色槽。布局里 `theme: { "light": "qingci", "dark": "xuanmo" }`，跟随 `settings.json` 的 `appearance` 自动选。

`themes/zhi.json`（纸墨：纸底 `#f8f5ee`、桌面色 `#dad1bf`、墨字 `#2a2420`、荧光笔 `#f8dc4c`、蓝铅笔括号 `#2c4f9e`）是**可选的第三套**，默认不启用：`herdr-app do app.theme '{"name":"zhi"}'` 或在偏好里切。它多带 11 个自定义色槽（`paper` / `desk` / `ink` / `pencil` / `rule` / `stroke` / `mark` / `bracket` / `up` / `down` / `seal`），mod 只按「有没有 `paper` 槽」判断纸感，不认识主题名——所以任何主题只要定义了 `paper` 就能借用这套外观，没定义的（月白、玄墨）自动退回普通 GPUI 几何，不留浅色纸边。

`preview.png` / `preview-dark.png` 由 `preview.svg` + `mkprev.py` 按两个主题文件生成：

```sh
python mkprev.py    # 读 themes/*.json，重画两张预览图
```

## 限制

- 侧栏宽度、抽屉开合、折叠状态是运行态（`layouts/.state/`），重启不一定保留；布局文件里的 272/380 是初始值。
- 状态栏四块是固定宽度，改内容长度要同步改 `layouts/oh-my-herdr.json` 里的 `px`。
- 会话实况识别优先匹配启动参数（`argv` / `foreground.argv`）里的会话 ID，其次用终端 OSC 标题前 24 字与目录匹配；若标题被手动改写且未带参数启动，会当成新会话开一个。
- 抽屉的「驾驶舱」页依赖 `cockpit` mod 自己的数据结构，单独拷走会退化。
- 侧栏分组按 cwd 前缀推出来，目录很深时会合并显示。

## 文件

```
layouts/oh-my-herdr.json     布局
layouts/oh-my-herdr.png      布局预览（同 preview.png）
preview.svg                  示意图源文件（两个主题共用，颜色按主题替换）
mkprev.py                    生成 preview.png / preview-dark.png
mods/inkstone-chrome         品牌条 + 底部三行（footer props）
mods/inkstone-workbench      目录/空间/终端列表，图标轨，8×8 像素图案（sprites.js）
mods/inkstone-tabs           标签栏 + 面板按钮 + 窗口按钮
mods/inkstone-edge           纸页四边的撕边切片（仅在定义了 paper 槽的主题下渲染）
mods/inkstone-pane           自绘窗格头：程序名 / 目录 / 状态徽章 / 悬停出分裂·缩放·关闭
mods/inkstone-files          文件树、索引搜索、@path 引用与 jj/git 状态
mods/inkstone-sessions       多源会话抽屉（搜索 / 筛选 / 远程 / 复制命令）
mods/inkstone-favorites      收藏抽屉
mods/inkstone-inbox          待处理状态块 + overlay
mods/inkstone-metrics        CPU/内存块
mods/inkstone-ports          端口块
mods/inkstone-review         审查块
mods/inkstone-settings       偏好浮层
mods/inkstone-paste          终端右键直接粘贴
mods/inkstone-menu           工作台右键与标准终端中文菜单
mods/cockpit                 驾驶舱抽屉
themes/qingci.json           月白（默认）
themes/xuanmo.json           玄墨
themes/zhi.json              纸墨（可选：羊皮纸侧栏 + 撕边纸页 + 荧光笔选中）
pixel-icons/codex.svg        OMP 用的 Codex 像素图标（8×8）
programs.json                程序表补丁：omp → pixel-icons/codex.svg
install.ps1 / install.sh     安装（Windows / macOS·Linux）
refresh.ps1                  反向同步（把配置目录的最新文件抓回包）
RECIPE.md                    从零重建的说明书（给你的 agent 用）
```
