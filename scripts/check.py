#!/usr/bin/env python3
"""Oh My Herdr 发行静态检查（不运行任何 mod，只读文件）。

检查项：
  1. 全部发行 JSON 可解析（layout、themes、programs.json、各 mod.json）。
  2. layout 引用的 mod 都在包里（Herdr 内置 mod 如 workspace-status 除外）；
     主题名指向包里的 themes/*.json。
  3. mod.json / main.js / icons.js 引用的 svg 都存在；icons.js 的每个键
     在 mods/inkstone-files/icons/ 有对应文件。
  4. programs.json 只含 omp / codebuddy，codebuddy 的 match 无同名冲突。
  5. 相对路径安全（无 ..、绝对盘符、家目录引用指向包外）。
  6. 无会话/日志/密钥类敏感文件；无 gpui-kit.d.ts、jsconfig.json 垫片与缓存。
  7. 白名单必需文件齐全；VERSION 与 dist 包名一致。

不会误报开发文档历史路径：只扫描发行白名单内的文件，dev.md 不在包里。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
from omh_assets import (  # noqa: E402
    SENSITIVE_NAME,
    load_icons_js,
    load_json,
    pack_plan,
    redact,
    repo_root,
)

# 代码里写 svg 引用的模式：mods/<mod>/<path>.svg 或 mods/<mod>/<sub>/<name>.svg。
SVG_REF = re.compile(r"""["'`](mods/[a-zA-Z0-9_/-]+?\.svg)["'`]""")

# 相对路径安全：拒绝盘符、家目录、向上跳出包根。
UNSAFE_PATH = re.compile(
    r"(?i)(?:\b[a-z]:[\\/]|^[/\\]|(?:^|[/\\])\.\.(?:[/\\]|$)|^~(?:/|\\|$))"
)

# 源码里泄漏私人绝对路径（注释也算——发出去就是公开泄露）。
# 尾斜杠可有可无：/home/alice/project 与 /home/alice/ 都要抓。
PRIVATE_PATH = re.compile(
    r"(?:\b[A-Za-z]:\\(?:Users|Documents and Settings)\\[A-Za-z][^\"'`)\s]*"
    r"|(?<![A-Za-z0-9])(?:/Users|/home)/[A-Za-z0-9_.@-]+)",
)

# 文档化示例占位符（不是真实路径）：mods/inkstone-space 的输入框提示文案。
# 白名单按 (相对路径, 精确命中串) 放行；真实用户路径（/home/alice 等）仍会报。
PRIVATE_PATH_ALLOWED: dict[str, set[str]] = {
    "mods/inkstone-space/main.js": {"/home/me"},
}


def fail(msg: str) -> str:
    return f"FAIL {msg}"


def check_json_files(root: Path, files: list[str]) -> list[str]:
    """所有发行 JSON 可解析。"""
    problems: list[str] = []
    for rel in files:
        if not rel.endswith(".json") or rel == "mods/inkstone-files/icons.js":
            continue
        try:
            load_json(root / rel)
        except Exception as e:
            problems.append(fail(f"{rel} JSON 解析失败: {redact(str(e))}"))
    return problems


def collect_mod_names(files: list[str]) -> set[str]:
    return {PurePosixPath(rel).parts[1] for rel in files if rel.startswith("mods/")}


# Herdr 内置 mod：实机存在、仓库从不打包，layout 引用它们是合法的。
BUILTIN_MODS = frozenset({"workspace-status"})


def check_layout(root: Path, files: list[str]) -> list[str]:
    """layout 引用的 mod 与主题都实际存在于包里（Herdr 内置 mod 除外）。"""
    problems: list[str] = []
    layout_path = root / "layouts/oh-my-herdr.json"
    try:
        load_json(layout_path)
    except Exception as e:
        return [fail(f"layouts/oh-my-herdr.json 解析失败: {e}")]
    text = layout_path.read_text(encoding="utf-8")
    mods = collect_mod_names(files)
    for ref in set(re.findall(r'"mod"\s*:\s*"([^"]+)"', text)):
        if ref not in mods and ref not in BUILTIN_MODS:
            problems.append(fail(f"layout 引用的 mod 不在包里: {ref}"))
    themes = {PurePosixPath(rel).stem for rel in files if rel.startswith("themes/") and rel.endswith(".json")}
    for name in set(re.findall(r'"(?:light|dark)"\s*:\s*"([^"]+)"', text)):
        if name not in themes:
            problems.append(fail(f"layout 的 light/dark 主题不在包里: {name}"))
    return problems


def check_theme_slots(root: Path, files: list[str]) -> list[str]:
    """每个主题 JSON 若声明 paper 槽（纸感用），槽内颜色值应是合法 hex。"""
    problems: list[str] = []
    for rel in files:
        if not rel.startswith("themes/") or not rel.endswith(".json"):
            continue
        try:
            theme = load_json(root / rel)
        except Exception as e:
            print(f"note: {rel} 无法读 paper 槽: {redact(str(e))}", file=sys.stderr)
            continue
        paper = theme.get("paper")
        if isinstance(paper, dict):
            for key, val in paper.items():
                if isinstance(val, str) and val.startswith("#") and not re.fullmatch(r"#[0-9a-fA-F]{6,8}", val):
                    problems.append(fail(f"{rel} paper.{key} 不是合法 hex: {val}"))
    return problems


def check_svg_refs(root: Path, files: list[str]) -> list[str]:
    """main.js / mod.json / icons.js 里写的 svg 路径在包里都存在。

    动态模板（如 `mods/inkstone-chrome/${name}.svg`）抽不到具体名字，
    只检查静态写死的；icons.js 的键值另有专门核对。
    """
    problems: list[str] = []
    present = set(files)
    for rel in files:
        if not (rel.startswith("mods/") and rel.endswith((".js", ".json"))):
            continue
        p = root / rel
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            problems.append(fail(f"{rel} 不是 UTF-8"))
            continue
        for m in SVG_REF.finditer(text):
            ref = m.group(1)
            if ref not in present:
                problems.append(fail(f"{rel} 引用的 svg 不在包里: {ref}"))
    return problems


def check_icons_js(root: Path, files: list[str]) -> list[str]:
    """icons.js 每个图标名在 mods/inkstone-files/icons/ 有 <name>.svg。"""
    problems: list[str] = []
    try:
        data = load_icons_js(root / "mods/inkstone-files/icons.js")
    except Exception as e:
        return [fail(f"icons.js 解析失败: {redact(str(e))}")]
    icons_dir = root / "mods/inkstone-files/icons"
    present = {p.stem for p in icons_dir.glob("*.svg")}
    names: set[str] = set()

    def walk(node):
        if isinstance(node, str):
            names.add(node)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(data)
    missing = sorted(n for n in names if n not in present)
    for n in missing[:20]:
        problems.append(fail(f"icons.js 引用的图标缺失: icons/{n}.svg"))
    if len(missing) > 20:
        problems.append(fail(f"icons.js 引用的图标缺失共 {len(missing)} 个，只列出前 20"))
    return problems


def check_programs(root: Path, files: list[str]) -> list[str]:
    """程序表只允许 omp / codebuddy；必要字段齐全。"""
    problems: list[str] = []
    try:
        data = load_json(root / "programs.json")
    except Exception as e:
        return [fail(f"programs.json 解析失败: {e}")]
    progs = data.get("programs")
    if not isinstance(progs, dict):
        return [fail("programs.json 缺 programs 对象")]
    allowed = {"omp", "codebuddy"}
    extra = sorted(set(progs) - allowed)
    if extra:
        problems.append(fail(f"programs.json 出现了白名单外的程序项: {', '.join(extra)}"))
    codebuddy = progs.get("codebuddy")
    if isinstance(codebuddy, dict):
        for field in ("name", "icon", "match"):
            if field not in codebuddy:
                problems.append(fail(f"programs.codebuddy 缺字段 {field}"))
        match = codebuddy.get("match")
        if not isinstance(match, list) or not all(isinstance(x, str) for x in match):
            problems.append(fail("programs.codebuddy.match 不是字符串数组"))
        elif "codebuddy" in match:
            problems.append("WARN programs.codebuddy.match 含 key 本身 'codebuddy'，resolve() 已按 key 命中，冗余")
    omp = progs.get("omp")
    if isinstance(omp, dict) and not omp.get("icon"):
        problems.append(fail("programs.omp 缺 icon"))
    return problems


def check_path_safety(root: Path, files: list[str]) -> list[str]:
    """发行文件内的相对路径引用安全；无包外/绝对/家目录引用。"""
    problems: list[str] = []
    for rel in files:
        p = root / rel
        if not p.is_file():
            continue
        if rel.endswith((".js", ".json", ".sh", ".ps1", ".md")):
            try:
                text = p.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for m in re.finditer(r"""["'`](\.\.?/[^"'`]{1,200})["'`]""", text):
                if UNSAFE_PATH.search(m.group(1)):
                    problems.append(fail(f"{rel} 含向上/包外相对路径: {redact(m.group(1))}"))
    return problems


def check_sensitive(root: Path, files: list[str]) -> list[str]:
    """敏感文件名、垫片、缓存、私人绝对路径一律不许进包。"""
    problems: list[str] = []
    for rel in files:
        name = PurePosixPath(rel).name
        if SENSITIVE_NAME.search(rel):
            problems.append(fail(f"敏感文件不进包: {rel}"))
        if name in ("gpui-kit.d.ts", "jsconfig.json", "__pycache__", ".DS_Store", "Thumbs.db"):
            problems.append(fail(f"垫片/缓存不进包: {rel}"))
        if rel.endswith((".js", ".json", ".sh", ".ps1", ".py", ".md")):
            p = root / rel
            try:
                text = p.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for m in PRIVATE_PATH.finditer(text):
                if m.group(0) in PRIVATE_PATH_ALLOWED.get(rel, ()):
                    continue
                problems.append(fail(f"{rel} 含私人绝对路径: {redact(m.group(0))}"))
    return problems


def check_version(root: Path, files: list[str]) -> list[str]:
    problems: list[str] = []
    if "VERSION" not in files:
        return [fail("缺 VERSION")]
    version = (root / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        problems.append(fail(f"VERSION 不是 x.y.z: {version!r}"))
    return problems


def check_required_assets(root: Path, files: list[str]) -> list[str]:
    """必要运行资产：每个 mod 有 mod.json+main.js；icons.js 存在。"""
    problems: list[str] = []
    if "mods/inkstone-files/icons.js" not in files:
        problems.append(fail("缺 mods/inkstone-files/icons.js（运行时图标表）"))
    mods = collect_mod_names(files)
    for mod in sorted(mods):
        for needed in (f"mods/{mod}/mod.json", f"mods/{mod}/main.js"):
            if needed not in files:
                problems.append(fail(f"mod 缺必需文件: {needed}"))
    return problems


def run_checks(root: Path) -> tuple[list[str], list[str]]:
    files, problems = pack_plan(root)
    if problems:
        return [fail(p) for p in problems], files
    checks = (
        check_json_files,
        check_layout,
        check_theme_slots,
        check_svg_refs,
        check_icons_js,
        check_programs,
        check_path_safety,
        check_sensitive,
        check_version,
        check_required_assets,
    )
    all_problems: list[str] = []
    for fn in checks:
        all_problems.extend(fn(root, files))
    return all_problems, files


def main() -> None:
    root = repo_root()
    ap = argparse.ArgumentParser(description="oh-my-herdr 发行静态检查")
    ap.add_argument("--root", help="检查指定目录（默认仓库根）")
    args = ap.parse_args()
    if args.root:
        root = Path(args.root).resolve()
    problems, files = run_checks(root)
    print(f"checked {len(files)} files under {root.name}/")
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} problem(s)")
        raise SystemExit(1)
    print("check passed")


if __name__ == "__main__":
    main()
