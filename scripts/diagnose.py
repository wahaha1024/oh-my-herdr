#!/usr/bin/env python3
"""Oh My Herdr 环境自检诊断。

默认只采集本包相关的事实，stdout 输出预览：
  - 本包版本（VERSION）与包路径类别
  - 操作系统
  - herdr-app / hc 是否可用及版本
  - node / python / sqlite3 是否可用
  - mod 加载错误分类摘要（herdr-app status 的 errors，只给类别与数量）

错误原文一律不转发：不输出路径、token、聊天内容等 payload，只归入
load-error / type-error / parse-error 等类别并计数，附安全的 mod 标识。
不采集环境变量值、聊天内容、完整文件路径。--output FILE 才写文件；默认只打印。
"""

from __future__ import annotations

import argparse
import json
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from omh_assets import repo_root  # noqa: E402


# 版本号只抽取 x.y.z 之类形态，绝不转发命令的原 stderr/stdout。
_VERSION_RE = re.compile(r"\bv?\d+\.\d+(?:\.\d+)?\b")


def run_version(cmd: list[str]) -> str | None:
    """跑 `--version`，只返回抽出的版本号；失败/不可用返回 None。"""
    exe = shutil.which(cmd[0])
    if not exe:
        return None
    try:
        out = subprocess.run([exe, *cmd[1:]], capture_output=True, text=True, timeout=10)
        text = (out.stdout or out.stderr or "").strip().splitlines()
        m = _VERSION_RE.search(text[0]) if text else None
        return m.group(0) if m else "available"
    except (OSError, subprocess.TimeoutExpired):
        return "available"


def app_status_errors() -> list[str]:
    """herdr-app status 的 errors → 安全类别摘要（不透传原文）。

    返回形如 "load-error x2 (inkstone-files)" 的条目；status 不可用或
    输出非 JSON 时返回 ["status: unavailable"]，不谎报 none。
    """
    exe = shutil.which("herdr-app")
    if not exe:
        return ["status: herdr-app not found"]
    try:
        out = subprocess.run([exe, "status"], capture_output=True, text=True, timeout=15)
        if out.returncode != 0:
            return ["status: unavailable"]
    except (OSError, subprocess.TimeoutExpired):
        return ["status: unavailable"]
    try:
        data = json.loads(out.stdout)
    except (json.JSONDecodeError, ValueError):
        return ["status: unavailable"]
    errors = data.get("errors") if isinstance(data, dict) else None
    if not isinstance(errors, list):
        return ["status: unavailable"]
    if not errors:
        return []
    # 类别只认固定允许集：errors[*].type/kind/code 即使被污染为任意字符串
    # （如路径、token）也绝不进入输出，一律归入 other-error。
    KIND_MAP = {
        "load": "load-error", "load-error": "load-error",
        "type": "type-error", "typeerror": "type-error", "type-error": "type-error",
        "parse": "parse-error", "parse-error": "parse-error",
        "json": "parse-error", "syntax": "parse-error",
        "missing": "missing-asset", "missing-asset": "missing-asset",
        "not found": "missing-asset", "notfound": "missing-asset",
    }
    # mod 标识只允许当前发行 mods/ 目录里的精确目录名。
    shipped_mods = {d.name for d in (repo_root() / "mods").iterdir() if d.is_dir()}
    counts: dict[str, int] = {}
    mods: dict[str, int] = {}
    for e in errors:
        # errors 可能是字符串或 {message/type/file/mod} 结构；只提取类别与 mod 标识。
        if isinstance(e, dict):
            raw_kind = e.get("type") or e.get("kind") or e.get("code")
            raw_kind = raw_kind if isinstance(raw_kind, str) else None
            msg = e.get("message") if isinstance(e.get("message"), str) else ""
            raw_mod = e.get("mod") or e.get("name")
        else:
            raw_kind, msg, raw_mod = None, (e if isinstance(e, str) else str(e)), None
        kind = KIND_MAP.get(raw_kind.strip().lower()) if raw_kind else None
        if not kind:
            # 无 type 字段时从 message 推断：只认已知安全词，取不到归 other。
            low = msg.lower()
            for known, label in (("load", "load-error"), ("typeerror", "type-error"),
                                 ("type error", "type-error"), ("parse", "parse-error"),
                                 ("json", "parse-error"), ("missing", "missing-asset"),
                                 ("not found", "missing-asset")):
                if known in low:
                    kind = label
                    break
            kind = kind or "other-error"
        if isinstance(raw_mod, str) and raw_mod in shipped_mods:
            key = kind + " (" + raw_mod + ")"
            mods[key] = mods.get(key, 0) + 1
        else:
            counts[kind] = counts.get(kind, 0) + 1
    lines = [f"{k} x{v}" for k, v in sorted(counts.items())]
    lines += [f"{k} x{v}" for k, v in sorted(mods.items())]
    return lines or []


def collect() -> dict:
    version = (repo_root() / "VERSION").read_text(encoding="utf-8").strip()
    return {
        "package": {"name": "oh-my-herdr", "version": version},
        "os": f"{platform.system()} {platform.release()} ({platform.machine()})",
        "tools": {
            "herdr-app": run_version(["herdr-app", "--version"]),
            "hc": run_version(["hc", "--version"]),
            "node": run_version(["node", "--version"]),
            "python": run_version(["python", "--version"]) or run_version(["python3", "--version"]),
            "sqlite3": run_version(["sqlite3", "--version"]),
        },
        "status_errors": app_status_errors(),
    }


def render(data: dict) -> str:
    lines = [
        f"oh-my-herdr {data['package']['version']}",
        f"os: {data['os']}",
        "tools:",
    ]
    for name, ver in data["tools"].items():
        lines.append(f"  {name}: {ver if ver else 'not found'}")
    if data["status_errors"]:
        lines.append("status errors (categories only, no raw payload):")
        for e in data["status_errors"]:
            lines.append(f"  - {e}")
    else:
        lines.append("status errors: none")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description="oh-my-herdr 环境自检（默认只打印预览）")
    ap.add_argument("--output", metavar="FILE", help="把诊断结果写到文件（默认只输出 stdout）")
    ap.add_argument("--json", action="store_true", help="输出 JSON 结构（配合 --output）")
    args = ap.parse_args()

    data = collect()
    text = json.dumps(data, ensure_ascii=False, indent=2) if args.json else render(data)
    print(text)
    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text + "\n", encoding="utf-8")
        print(f"written: {out}")


if __name__ == "__main__":
    main()
