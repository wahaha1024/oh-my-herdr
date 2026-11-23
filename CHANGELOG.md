# Changelog

## 0.2.0 — 2026-11-23

本次发布新增可运行的发行流程与配套工具；安装器与界面代码见对应提交。

### 新增

- **发行包**：`python scripts/release.py` 按严格白名单打 `oh-my-herdr-<版本>.zip` 并生成 `SHA256SUMS`。白名单：`programs.json`、`install.ps1`、`install.sh`、`VERSION`、`LICENSE`、`README.md`、`README.zh-CN.md`、`layouts/`、`mods/`、`themes/`、`pixel-icons/`，`CHANGELOG.md`、`preview.png`、`screenshot.png`、`screenshot-paper.png`（README 引用），`docs/` 与 `scripts/diagnose.py`、`scripts/omh_assets.py` 有则带。排除类型垫片（`gpui-kit.d.ts`、`jsconfig.json`）、`__pycache__`、`.git` 与系统缓存文件。zip 条目用固定时间戳，可复现。
- **发行静态检查**：`python scripts/check.py` 校验全部发行 JSON 可解析、layout 引用的 mod 与主题存在、静态 svg 引用与 `icons.js` 图标表都有对应文件、`programs.json` 只含 `omp`/`codebuddy`、无向上/包外/家目录相对路径、无敏感文件与私人绝对路径、白名单齐全。只扫发行白名单内的文件，开发文档（`dev.md`）不在包内，其历史路径不会误报。
- **安装器测试**：`python tests/test_install.py` 在临时目录冒烟测试安装器（覆盖缺 `settings.json` 拒装、正常落位、垫片不装、二次安装跳过、`programs.json` 合并等场景）。
- **环境诊断**：`python scripts/diagnose.py` 输出本包版本、OS、herdr-app/hc/node/python/sqlite3 可用性与版本号、`herdr-app status` 的错误类别摘要。默认只打印预览；`--output FILE` 才写文件。错误只按类别（load-error/type-error 等）与数量输出，附安全的 mod 标识，不透传任何原始 payload；版本只抽取版本号，不转发命令原文。
- **GitHub CI**（`.github/workflows/quality.yml`）：Windows/macOS/Linux 三平台跑 `check.py` 与 `tests/test_install.py`；仅 `v*` tag 触发发布，先核对 tag 与 `VERSION` 一致，再打包含校验和并上传 Release 附件。
- **Issue 模板**：`.github/ISSUE_TEMPLATE/bug_report.yml` 引导先运行诊断脚本并预览脱敏输出，再粘贴。
- `VERSION` 单行版本文件（`0.2.0`），发布流程以它为版本事实来源。

### 限制

- CI 的 Release 步骤上传 `SHA256SUMS`，其中只含 zip 的哈希；`SHA256SUMS` 自身的哈希在打包时打印到日志，无法自包含。
- `check.py` 的私人路径扫描带一份显式白名单（`PRIVATE_PATH_ALLOWED`）：mods/inkstone-space 输入框提示里的文档化示例占位符（一个短用户名路径）放行；其他任何 Unix 家目录、Windows 用户目录形态的路径（含注释里）都会报错。
- `check.py` 的 svg 引用核对只覆盖静态字符串；动态模板（如 `` `mods/inkstone-chrome/${name}.svg` ``）引用的具体文件名无法静态枚举，靠 `icons.js` 与 `mods/inkstone-files/icons/` 的键值核对补足文件图标一类。
- Windows 上跑 `install.sh`（如 WSL）与 `install.ps1` 的换行符行为由 `.gitattributes` 决定（`.sh` 强制 LF、`.ps1` 强制 CRLF）；测试只断言文件落位，不比较换行。
- 诊断脚本读 `herdr-app status` 的 JSON 输出做错误类别摘要；若 `herdr-app` 未安装、status 非零退出或输出非 JSON，显示 `status: unavailable`（不谎报 none）。类别推断只认已知安全词，未知错误归 `other-error`。
