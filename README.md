# Oh My Herdr

给 [Herdr](https://herdr.dev) 用的一套界面：侧栏按目录分组、每个空间一个固定颜色，右侧抽屉装文件与会话，底部一条常驻状态栏。装上就是一个完整的工作台，装上之前的样子一行也不用改——克隆下来跑一个脚本，不覆盖你已有的文件，删掉即还原。

默认月白（qingci），另带深色玄墨（xuanmo）与可选的纸墨（zhi）。

英文说明见 [README.en.md](README.en.md)。

![月白主题](screenshot.png)
![纸墨主题](screenshot-paper.png)

> 真实渲染截图：侧栏拖成 44px 的图标轨，只留空间徽章；中间是左右分屏的两格终端，各带一个自绘窗格头，四周是撕边纸页；右侧抽屉停在文件页。终端里跑的是一个演示仓库，没有真实数据。深色的玄墨见 `preview-dark.png`（示意图）。

## 为什么用它

- **一屏看清「目录 → 空间 → 终端」**：侧栏按目录分组，一个空间的颜色会跟着它的徽章、标签、终端一路走，扫一眼就知道自己在哪个项目、哪台机器。
- **等待不打断**：只在有智能体等你时冒出一个像素铃铛和数字，点一下跳到最急的那个；文件、变更、会话都在右侧抽屉里，不抢终端。
- **三套主题、一套逻辑**：明暗跟随系统切换；纸墨是另一种观感——桌面色、羊皮纸侧栏、撕边纸页、荧光笔选中。
- **只在本机跑**：目录、会话、端口、内存都读本地文件与系统计数器，不联网、不装 Python 也能用。

## 与原版 Herdr 的不同

| 区域 | 原版 | 装上之后 |
|---|---|---|
| 侧栏 | 空间一列，智能体/终端分栏 | 目录 → 空间 → 终端三层缩进，组头带计数；空间前面是 8×8 像素图案（15 个可选，Alt+点击换下一个），颜色自动分配并记住；拖到 44px 收成图标轨 |
| 顶栏 | 标签条 | 标签放大到 30px；右侧一排中文面板按钮（文件 / 会话 / 收藏 / 驾驶舱 / 变更）；左侧一枚当前空间色点；最小化 / 最大化 / 关闭并入这一行，窗口顶部不再有系统标题栏 |
| 终端窗格 | 默认窗格头 | 自绘窗格头：程序图标 + 名字 + 目录 + 状态（运行中转圈、待你处理徽章、完成打勾），悬停浮出分裂、缩放、关闭 |
| 右侧抽屉 | 内置面板 | 一个 380px 抽屉切换五页：文件、变更、驾驶舱、会话、收藏 |
| 底部状态栏 | 基础状态 | 四块常驻：CPU 与内存、监听端口数、等你处理的智能体数（点开名单）、审查入口 |
| 终端交互 | 右键菜单 | 右键直接粘贴 |
| 主题 | 自带 | 月白、玄墨，外加可选的纸墨：羊皮纸侧栏、终端四周的撕边纸页、荧光笔选中、铅笔分隔线 |

## 新增的功能

- **文件页**：关键字检索（优先 `git ls-files` / `jj file list`）、行尾与预览顶栏一键复制 `@path`、`jj` / `git` 变更标记。
- **会话页**：扫 OMP / Codex / Claude Code / Pi / 项目归档（有 `sqlite3` 时连 OpenCode），支持关键字搜索、来源筛选、当前目录直扫、远程机器扫描，一键复制恢复命令；已经在终端里跑着的标「已打开」，点一下切过去。
- **驾驶舱**：智能体在跑什么、卡在哪、下一步建议，聚在一页。
- **收藏**：常用的空间与终端钉住，不必每次顺目录找。
- **远程空间**：机器连上之后，远端目录、会话、文件与本地一样列出来。

## 主题

- `themes/qingci.json` 月白（默认）：浅青灰底、深墨字、青绿强调。
- `themes/xuanmo.json` 玄墨：深底暖字，跟随系统深色自动切。
- `themes/zhi.json` 纸墨（可选，默认不启用）：纸底、桌面色、墨字、荧光笔、蓝铅笔括号。切法：`herdr-app do app.theme '{"name":"zhi"}'`，或偏好面板里选。

纸墨是唯一需要额外资产的观感（羊皮纸与撕边切片，约 3MB，随包一起装）。侧栏拖到 44px 的图标轨不画羊皮纸，其余主题不受影响。

## 安装

### 脚本（Windows PowerShell）

```powershell
.\install.ps1 -DryRun     # 先看会写什么
.\install.ps1             # 不覆盖已有文件；程序表里只补缺失的 omp 条目
```

### 脚本（macOS / Linux / WSL）

```sh
./install.sh --dry-run    # 先看会写什么
./install.sh              # 不覆盖已有文件；--force 覆盖
./install.sh --target=DIR # 装到别的配置目录
```

### 手动

1. `layouts/oh-my-herdr.json` → `~/.config/herdr-app/layouts/`（Windows：`C:\Users\<你>\.config\herdr-app\layouts\`）。
2. `mods/` 下每个文件夹 → 配置目录的 `mods/`。
3. `themes/` 下的三个主题文件 → 配置目录的 `themes/`。
4. 切过去：`herdr-app do layout.switch '{"name":"oh-my-herdr"}'`；切回来 `ctrl-shift-l`。

### 需要什么

Herdr 自带的 `changes` / `workspace-status` / `pane`（装好 Herdr 就有）、`git`（或可选的 `jj`）。`python3` 只在 `install.sh` 自动合并程序表时用到，没有它会打印出要加的那一条给你手动加。

### 装到第二台机器

同一个仓库 clone 下来跑对应脚本，布局、mod、主题完全一致。不随仓库走的是本机状态：空间配色与收藏、字体与外观设置、每台机器的空间与会话记录。所以第二台机器上空间会重新分配颜色、收藏是空的，其余照用。

已经装过的机器要更新，加 `-Force`（`./install.sh --force`）：脚本默认跳过同名文件，不加的话布局、mod、主题都还是旧版本——典型症状是终端四周没有纸质撕边、侧栏底部没有 NEED YOU / IN FLIGHT 两栏。

## 排查

装完发现某处不对（最典型：终端四周没有纸质撕边、侧栏底部没有 NEED YOU / IN FLIGHT），先在出问题的那台机器上跑这三条：

```powershell
$cfg = "$HOME\.config\herdr-app"
# 1) 布局里有四条纸页边条 → 应为 4
(Select-String -Path "$cfg\layouts\oh-my-herdr.json" -Pattern 'page-left|page-right|page-top|page-bottom').Count
# 2) 撕边 mod 是含青瓷切片的新版 → 应大于 0（旧版里没有这个词）
(Select-String -Path "$cfg\mods\inkstone-edge\main.js" -Pattern 'ink-qingci').Count
# 3) 有没有 mod 加载错误 → 应为空
(herdr-app status | ConvertFrom-Json).errors
```

macOS / Linux 等价写法（`jq` 可省，看第四行说明）：

```sh
cfg="$HOME/.config/herdr-app"
grep -c 'page-left\|page-right\|page-top\|page-bottom' "$cfg/layouts/oh-my-herdr.json"
grep -c 'ink-qingci' "$cfg/mods/inkstone-edge/main.js"
herdr-app status | grep -o '"errors":\[[^]]*\]'
```

| 结果 | 原因 | 处置 |
|---|---|---|
| 1 不是 4，或 2 等于 0 | 之前装过旧版，脚本跳过了同名文件 | `.\install.ps1 -Force`（`./install.sh --force`），然后 `herdr-app do layout.switch '{"name":"oh-my-herdr"}'`，或重启 herdr-app |
| 3 有内容 | herdr 低于 0.1.16，没有 `themes` 导出，撕边 mod 加载失败 | 升级 herdr |
| 三条都正常、仍无撕边 | 当前主题不是亮色：深色主题（玄墨）不画浅色纸边 | `(Get-Content "$cfg\settings.json" -Raw \| ConvertFrom-Json).appearance` 应为 `light`，或直接 `herdr-app do app.theme '{"name":"qingci"}'` |

改完配置要让它重新加载：`layout.switch` 切一次布局，或重启 herdr-app。

## 边界

- 侧栏宽度、抽屉开合、折叠状态是运行态，重启后不一定保留。
- 空间颜色与收藏存在本机，不随仓库同步。
- 侧栏分组按目录前缀推出，目录很深时会合并显示。
