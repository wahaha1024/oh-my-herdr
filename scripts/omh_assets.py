#!/usr/bin/env python3
"""Oh My Herdr 发行资产的公共白名单与工具函数。

release.py（打 zip）与 check.py（静态发行检查）共用这里的白名单、
JSON 读取和路径脱敏逻辑，保证"打出来的"和"查的"是同一份清单。
纯标准库，Python 3.9+。
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

# 顶层运行文件：严格白名单，不在此列的一律不进发行包。
TOP_FILES = (
    "programs.json",
    "install.ps1",
    "install.sh",
    "VERSION",
    "LICENSE",
    "README.md",
    "README.zh-CN.md",
    "CHANGELOG.md",
    "preview.png",
    "screenshot.png",
    "screenshot-paper.png",
)
# 顶层运行目录。
TOP_DIRS = ("layouts", "mods", "themes", "pixel-icons")
# 有则带的辅助内容：docs/ 文档；scripts/ 下只带诊断/安装辅助两个脚本
# （diagnose.py 依赖 omh_assets.py，需一起进包才能在解包后运行）。
OPTIONAL_DOCS_DIR = "docs"
OPTIONAL_SCRIPTS = ("diagnose.py", "omh_assets.py")

# SafeInstall may ship small POSIX/PowerShell helpers here; include only the
# deliberately named install* files, never arbitrary scripts.
OPTIONAL_INSTALL_GLOB = "install*"

# 语言服务在 mods/ 下生成的类型垫片与各系统缓存文件，均不属于 mod 内容。
# 注意 icons.js 虽由 tools/build-icons.mjs 生成，但它是运行时必需的图标表，
# 必须随包分发，不在排除之列。
EXCLUDED_NAMES = {"gpui-kit.d.ts", "jsconfig.json", ".DS_Store", "Thumbs.db", "desktop.ini"}
EXCLUDED_DIR_PARTS = {"__pycache__", ".git", ".state", "node_modules"}
EXCLUDED_SUFFIXES = (".pyc", ".pyo")

# 发行包内不应出现的文件名模式（会话、密钥、凭据与备份/日志残留）。
SENSITIVE_NAME = re.compile(
    r"(?:^|[/\\])(?:\.env(?:\.|$)|secrets?\.[a-z]+|credentials|id_(?:rsa|ed25519|ecdsa|dsa))"
    r"|\.(?:pem|key|p12|pfx|log|bak)$",
    re.IGNORECASE,
)

# zip 条目用固定时间戳，保证同一内容打出可复现的包。
FIXED_ZIP_DATE = (2020, 2, 2, 0, 0, 0)


def repo_root() -> Path:
    """仓库根目录：scripts/ 的上一级。"""
    return Path(__file__).resolve().parent.parent


def is_excluded(path: Path) -> bool:
    """语言垫片、缓存与系统垃圾文件，一律不进包。"""
    if path.name in EXCLUDED_NAMES or path.suffix in EXCLUDED_SUFFIXES:
        return True
    return any(part in EXCLUDED_DIR_PARTS for part in path.parts)


def pack_plan(root: Path):
    """发行白名单文件清单。

    返回 (files, problems)：files 是相对 root 的 POSIX 路径列表（已排序）；
    problems 是缺失的必需文件/目录说明。docs/ 与 scripts/install* 存在才带。
    """
    root = Path(root)
    files: list[str] = []
    problems: list[str] = []

    for name in TOP_FILES:
        if (root / name).is_file():
            files.append(name)
        else:
            problems.append(f"缺少必需文件: {name}")

    for d in TOP_DIRS:
        base = root / d
        if not base.is_dir():
            problems.append(f"缺少必需目录: {d}/")
            continue
        for path in sorted(base.rglob("*")):
            if path.is_file() and not is_excluded(path):
                files.append(path.relative_to(root).as_posix())

    docs = root / OPTIONAL_DOCS_DIR
    if docs.is_dir():
        for path in sorted(docs.rglob("*")):
            if path.is_file() and not is_excluded(path):
                files.append(path.relative_to(root).as_posix())

    scripts = root / "scripts"
    if scripts.is_dir():
        for name in OPTIONAL_SCRIPTS:
            if (scripts / name).is_file():
                files.append(f"scripts/{name}")
        for path in sorted(scripts.glob(OPTIONAL_INSTALL_GLOB)):
            if path.is_file() and not is_excluded(path):
                files.append(path.relative_to(root).as_posix())

    files.sort()
    return files, problems


def load_json(path: Path):
    """读 JSON（容忍 BOM——programs.json 可能带签名头）。解析失败抛 ValueError。"""
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def load_icons_js(path: Path) -> dict:
    """解析 mods/inkstone-files/icons.js（export default {...}）为 dict。"""
    text = Path(path).read_text(encoding="utf-8")
    marker = "export default"
    i = text.index(marker)
    body = text[i + len(marker):].strip().rstrip(";").strip()
    data = json.loads(body)
    if not isinstance(data, dict):
        raise ValueError("icons.js 的 export default 不是对象")
    return data


def strip_js_comments(text: str) -> str:
    """剥掉 JS 的块注释与行注释（字符串里的 // 按 "//" 以外的 :// 保留）。"""
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.DOTALL)
    return re.sub(r"(?<!:)//.*$", " ", text, flags=re.MULTILINE)


def strip_hash_comments(text: str) -> str:
    """剥掉 shell / PowerShell 的 # 注释（只剥行首与空白后的 #，避开 ${...}）。"""
    return re.sub(r"(?:^|\s)#(?!\!).*$", " ", text, flags=re.MULTILINE)


# —— 路径脱敏（diagnose.py 用于命令输出；check.py 的源码扫描另用更窄的模式）——

_HOME = os.path.expanduser("~")

_REDACTIONS = (
    # Windows 用户目录与 Unix 家目录的绝对路径。
    (re.compile(r"[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s\"'`）)]*"), "<path>"),
    (re.compile(r"/(?:Users|home)/[A-Za-z0-9_.@-]+(?:/[^\s\"'`]*)?"), "<path>"),
    # ISO 时间戳与长十六进制串（会话/日志里常见的 id）。
    (re.compile(r"\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b"), "<time>"),
    (re.compile(r"[0-9a-f]{32,}", re.IGNORECASE), "<id>"),
)


def redact(text: str, home: str | None = None) -> str:
    """把绝对路径、时间戳与长 id 换成占位符，用于对外展示的脱敏摘要。"""
    out = str(text)
    home = _HOME if home is None else home
    if home and len(home) > 3 and home != "/":
        for variant in (home, home.replace("\\", "/")):
            out = out.replace(variant, "<path>")
    for pattern, repl in _REDACTIONS:
        out = pattern.sub(repl, out)
    return out
