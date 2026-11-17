# Oh My Herdr

一个给 [Herdr](https://herdr.dev) 用的工作台布局：左边按目录分组列空间、每个空间自带颜色；顶部是标签与面板开关；右侧一个可收起的抽屉装文件、变更、会话；底部一条状态栏常驻 CPU、端口、待处理、审查。配色两套——月白（qingci）和玄墨（xuanmo）。

英文说明见 [README.en.md](README.en.md)。

![Oh My Herdr](preview.png)

---

## 为什么做这个

用 Herdr 开十几个空间之后，默认侧栏有两个问题：一是所有空间长得一模一样，眼睛找不到落点；二是「切空间」和「开文件」要来回按快捷键、找面板。这个布局做三件事：

1. **让每个空间变成一条有颜色的记录**——彩色的数字徽章 + 彩色的名字，颜色按空间固定、跟着空间走，切主题只换明暗不换色相。
2. **让侧栏说清层级**——目录组、空间、终端是三层不同的字号和缩进，组与组之间有分隔线；侧栏可以拖到 44px 缩成一列图标徽章。
3. **把常用的东西固定在边上**——文件、变更、会话、收藏、驾驶舱五个抽屉页，状态栏常驻系统指标。不用记快捷键也能点。

---

## 布局形状

```
┌──────────────┬────────────────────────────────────────────────────────────┐
│ Oh My Herdr  │  ⊞ tabs:  π  π DISK: 服务器空间  ×      +  ⎇ master  ▣ ⋯ ⚙ ─ □ ✕│ 42px
├──────────────┼────────────────────────────────────────────────────────────┤
│              │                                                            │
│  工作台  2 智能体                                                   ┌─────┐ │
│  ▾ DSH                                       1/1                   │     │ │
│    ❶ DSH              (空间，彩色徽章+彩名)                          │ 抽屉 │ │
│      π 终端行                                                       │ 380 │ │
│  ────────────────────────────────  (组间分隔线)                      │     │ │
│  ▾ projects                                  6/6                   │     │ │
│    ❶ 服务器          (组色 = 组内首个空间色)                          │     │ │
│      π DISK: 服务器空间                                             │     │ │
│    ❷ Magpie                                                        └─────┘ │
│  ▸ 二维码 (折叠的目录)                                                      │
│              │                                                            │
│  (272px)     │  终端：间距 8，圆角 10                                        │
├──────────────┴────────────────────────────────────────────────────────────┤
│ server82 ⎇ master · 2 agents     Ctrl+Shift+P commands │ CPU 10% 10.6 GB │ 27 │ 无待办 │ 审查 │ 28px
└────────────────────────────────────────────────────────────────────────────┘
│ OMH 偏好 / Herdr 设置 / 添加机器  (侧栏底部 120px，footer 模式)               │
└────────────────────────────────────────────────────────────────────────────┘
```

| 区域 | 尺寸 | 内容 |
|---|---|---|
| 侧栏 `sidebar` | 272px，可拖，44–420 | 品牌条 46 + `inkstone-workbench` 列表 + 底部 120 |
| 顶部 `inkstone-tabs` | 42px | 标签、面板按钮、空间色点、窗口按钮 |
| 终端区 `panel-body` | 填充 | 终端（`terminal_padding` 14/12，divider 1px） |
| 抽屉 `panel` | 380px，可拖，280–620 | 五页 stack，默认收起 |
| 状态栏 | 28px | `workspace-status` + 指标 + 端口 + 待处理 + 审查 |

---

## 有什么

### 侧栏

**目录组**：一行 27px，11px chevron、13px 的 `folder.svg`（颜色取组内第一个空间的颜色）、13px 半粗名字、10px 的「已展开/总数」计数。组与组之间一条 1px 分隔线。

**空间行**：30px 高、圆角 7，`pl(10) pr(8) gap(6)`。

- 徽章：16×16、圆角 4、9px 半粗。选中时**实心填充 + 反色字**（深色底用 `#f7faf8`，浅色底用 `#14131a`），平时是 15% 透明度的同色底 + 同色字。
- 名字：14px，颜色就是空间色；选中的那条加粗。
- 后面跟着 11px 的 git 分支名和 7px 状态点。
- 选中行的背景是空间色 10% 透明度的淡底。

**终端行 / 智能体行**：24px，缩进 38px（对齐名字而不是徽章），11px。

- 有智能体在跑的空间，展开后是智能体行：程序图标（16px，有配色 tint 就用 tint）+ 名字 + 状态点/旋转图标。
- 普通终端是终端行：`terminal.svg` 或程序的图标 + 名字。
- 空空间显示一行「还没有终端」。
- 点击：已经在显示的那个不发任何命令（每次 `space.select`/`tab.select` 都会重建终端视图、重放整段 scrollback，能不切就不切）。

**状态形状编码**（不只靠颜色）：

| 状态 | 形状 |
|---|---|
| `blocked` | 实心小方块（圆角 1） |
| `done` | 实心圆 |
| `working` | 2px 圆环 + 旋转的 `spinner.svg`（12px，900ms） |
| `idle` | 1.5px 空心圆 |

**图标轨（侧栏 < 160px）**：空间只剩彩色数字徽章（tooltip 带名字、终端数、状态），目录只剩 folder 图标，头部只剩「+」并居中。点击行为不变。

### 顶栏

- 标签 30px、14px 字、最多 200px 宽，`π` 前缀表示智能体在跑，关闭按钮 hover 才显现。
- 面板按钮：26px 高、14px 图标 + 11px 中文名（文件 / 会话 / 收藏 / 驾驶舱 / 变更），当前抽屉页高亮。**Git 关闭时「变更」整个不出现**（`shared("inkstone.git")`）。
- 最右侧一个 7px 的圆点，颜色是当前空间色（tooltip 显示空间名）——一眼知道这扇窗是哪个空间。
- 窗口按钮（最小化/最大化/关闭）用矢量画，`titlebar: "none"` 下自己接管；侧栏宽于 160px 时折叠按钮也在这一行。

### 抽屉（右侧 380px）

| 页 | mod | 内容 |
|---|---|---|
| 文件 | 自带 `files` | 当前目录树 |
| 变更 | 自带 `changes` | git 状态 |
| 驾驶舱 | `cockpit` | 空间/终端总览 |
| 会话 | `inkstone-sessions` | omp 会话列表，**已在终端里开着的点一下就切过去** |
| 收藏 | `inkstone-favorites` | `[{name, folder}]`，一条一键开空间 |

**会话抽屉**解决的具体问题：点一条历史会话时 `omp --resume` 会重新渲染整段历史（看起来像「从头滚到底」）。所以点之前先认人——读本机所有终端的标题，如果某条终端的标题包含了这条会话标题的前 24 个字符、且 cwd 对得上，就直接 `space.select` + `tab.select` + `pane.focus` 切过去，不发 resume。同一标题有多条历史记录时只认最新的那条，避免认错。

**收藏抽屉**：`shared("inkstone.favorites")` 存 `[{name, folder}]`。「收藏当前」把当前空间所在目录存进去；行上的「已打开」表示那个目录已经有空间开着。

**右键即粘贴**：`terminal_menu: "inkstone-paste"`。终端里右键不弹菜单——它先把焦点交回被右键的那个终端，再把剪贴板内容直接打进去，然后自己关掉，所以右键到粘贴只差一次点击。

### 状态栏

`status-text`（自带，占满剩余）+ 四个固定宽度的块：

| 块 | 宽 | 内容 |
|---|---|---|
| `inkstone-metrics` | 152 | CPU %、内存 GB |
| `inkstone-ports` | 64 | 监听端口数 |
| `inkstone-inbox` | 84 | 待处理智能体数，点开 400×320 的列表 |
| `inkstone-review` | 88 | 审查入口 |

---

## 安装

### 用脚本（Windows PowerShell）

```powershell
.\install.ps1 -DryRun     # 先看会写什么
.\install.ps1             # 不覆盖已有文件；keys.json 只加缺的键，冲突只报不改
```

### 用脚本（macOS / Linux / WSL）

```sh
./install.sh --dry-run    # 先看会写什么
./install.sh              # 不覆盖已有文件；--force 覆盖
./install.sh --target=DIR # 装到别的配置目录
```

`install.sh` 合并 `keys.json` 需要一个能用的 `python3`（或 `python`）；都没有时它会把要加的键直接打印出来，你手动加。

### 多台电脑

同一个仓库装到第二台机器：clone 下来跑对应脚本就行，布局、mod、主题完全一致。**不随仓库走的**有三样——空间配色与收藏（在 `shared.json`）、字体和外观（在 `settings.json`，本包不带）、以及每台机器自己的空间与会话记录（`view.json`、`~/.omp/agent/sessions`）。所以第二台机器上空间会重新分配颜色、收藏是空的，功能本身不受影响。

每台机器需要的是：Herdr 自带的 `files`/`changes`/`workspace-status` 三个 mod（安装 Herdr 就有）、`git`（显示分支）、`omp` 在 PATH（只有会话抽屉需要）。

### 手动

1. `layouts/oh-my-herdr.json` → `~/.config/herdr-app/layouts/`（Windows：`C:\Users\<你>\.config\herdr-app\layouts\`）。
2. `mods/` 下每个文件夹 → 配置目录的 `mods/`。
3. `themes/qingci.json`、`themes/xuanmo.json` → 配置目录的 `themes/`。
4. `keys.json` 里的 `global` 段并进你自己的 `keys.json`（值冲突就自己挑）。
5. 切过去：

```sh
herdr-app check mods/inkstone-workbench     # 每个 mod 都值得 check 一次
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
```

切回来是 `ctrl-shift-l`；不想要了就删掉这些文件。

### 依赖

Herdr 自带的 `files`、`changes`、`workspace-status` 三个 mod；`inkstone-sessions` 读 `~/.omp/agent/sessions`（没有就是空列表，不报错）；`inkstone-metrics` 读系统 CPU/内存；`inkstone-ports` 读监听端口。全部只在本机跑，不联网。

---

## 快捷键

| 键 | 作用 |
|---|---|
| `alt-shift-p` | 偏好（主题、外观） |
| `alt-shift-r` | 审查 |
| `alt-shift-m` | 系统指标 |
| `alt-shift-o` | 端口列表 |
| `alt-shift-i` | 待处理列表 |

---

## 空间配色

七个颜色。浅色主题（月白底）用深色档，深色主题（玄墨底）用亮色档——**同一编号在两个主题里色相相同，只换明暗**：

| # | 浅色档（qingci） | 深色档（xuanmo） | 色相 |
|---|---|---|---|
| 0 | `#a84a50` | `#f08a8a` | 砖红 |
| 1 | `#8a5619` | `#f2a46a` | 赭橙 |
| 2 | `#7d640c` | `#e8c76a` | 芥黄 |
| 3 | `#357041` | `#7ecf86` | 竹绿 |
| 4 | `#34618f` | `#6fb3ea` | 靛蓝 |
| 5 | `#5f5399` | `#9a8ce6` | 青莲 |
| 6 | `#805083` | `#c98ae6` | 紫藤 |

实测对比度：浅色档对 `#e8f0ec` 是 4.82–5.69:1；深色档对 `#14131a` 是 6.39–11.26:1。

存的是**序号**不是十六进制：`shared("inkstone.spaceColors")` = `{spaceId: 0..6}`。新空间自动拿目前用得最少的那个颜色；空间消失后它的颜色会被回收。`luminance(hex)` 用 WCAG 相对亮度公式决定当前主题该用哪一档。

> `inkstone-workbench` 和 `inkstone-tabs` 各自存了一份调色板常量（mod 之间不能互相 import），改配色要同时改两个文件：`mods/inkstone-workbench/main.js` 和 `mods/inkstone-tabs/main.js` 顶部的 `PALETTE_LIGHT` / `PALETTE_DARK`。

---

## 主题

`themes/qingci.json`（月白：底 `#e8f0ec`、字 `#2b333e`、强调 `#126e82`）和 `themes/xuanmo.json`（玄墨：底 `#14131a`、字 `#d4cec4`、强调 `#619ac3`），都是完整 16 色 ANSI + 语义色槽（`surface`/`raised`/`hover`/`border`/`accent`/`blocked`/`done`/`working`/`idle` 等）。布局里 `theme: { "light": "qingci", "dark": "xuanmo" }`，跟随 `settings.json` 的 `appearance` 自动选。

---

## 它读什么、跑什么

| 类型 | 具体 |
|---|---|
| 读文件 | `~/.omp/agent/sessions/**/*.jsonl`（只读头几行拿标题和 cwd）、git 状态 |
| 跑程序 | `git`（`exec`，查分支与 worktree）、`hc`（Herdr 核心查询） |
| 写共享状态 | `inkstone.spaceColors`、`inkstone.favorites`、`inkstone.git`、`sidebar.width` |
| 网络 | 不联网 |

---

## 已知限制

- 侧栏宽度、抽屉开合、折叠状态是 `layout.resize`/点击的运行态，主要在 `layouts/.state/` 里，**重启不一定保留**；布局文件里的 272/380 是初始值。
- 状态栏四块是固定宽度；想改内容长度要同步改 `layouts/oh-my-herdr.json` 里的 `px`。
- 会话识别靠终端标题（omp 把会话标题写进 OSC 标题）。手动 `title` 改掉标题就认不出，会当成新会话开一个。跨机器的会话不在识别范围内。
- 抽屉里的「驾驶舱」页是 `cockpit` mod，依赖它的数据结构；单独拷走会退化。
- 侧栏分组按 cwd 的前缀推出来的层次；目录很深时会合并显示。

---

## 校验与开发

```sh
herdr-app check mods/inkstone-workbench        # → check passed
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
herdr-app status | jq .errors                  # → []
herdr-app shot out.png                         # 截图核对
```

改完 mod 之后，用 `refresh.ps1` 把配置目录里的最新文件抓回这个包：

```powershell
.\refresh.ps1
```

---

## 文件

```
layouts/oh-my-herdr.json     布局
layouts/oh-my-herdr.png      预览（同 preview.png）
mods/inkstone-chrome         品牌条 + 底部三行（footer props）
mods/inkstone-workbench      目录/空间/终端列表，图标轨
mods/inkstone-tabs           标签栏 + 面板按钮 + 窗口按钮
mods/inkstone-sessions       omp 会话抽屉
mods/inkstone-favorites      收藏抽屉
mods/inkstone-inbox          待处理状态块 + overlay
mods/inkstone-metrics        CPU/内存块
mods/inkstone-ports          端口块
mods/inkstone-review         审查块
mods/inkstone-settings       偏好浮层
mods/inkstone-paste          终端右键直接粘贴
mods/cockpit                 驾驶舱抽屉
themes/qingci.json           月白
themes/xuanmo.json           玄墨
keys.json                    五个 alt-shift 快捷键
install.ps1 / install.sh     安装（Windows / macOS·Linux）
refresh.ps1                  反向同步（把配置目录的最新文件抓回包）
RECIPE.md                    从零重建的说明书（给你的 agent 用）
```

## License

MIT
