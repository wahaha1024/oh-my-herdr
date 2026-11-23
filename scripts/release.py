#!/usr/bin/env python3
"""打 Oh My Herdr 的 0.2.0 发行 zip 包与 SHA256SUMS。

用法：
    python scripts/release.py                 # 打 oh-my-herdr-<版本>.zip + SHA256SUMS
    python scripts/release.py --out DIR       # 指定输出目录（默认 dist/）
    python scripts/release.py --check         # 只校验已生成的包与校验和，不重打

白名单见 omh_assets.pack_plan：顶层运行文件 + layouts/mods/themes/pixel-icons
（排除 gpui-kit.d.ts、jsconfig.json、缓存），docs/ 与 scripts/install* 有则带，
外加与 VERSION 一致的版本元信息。不读任何 git 信息，本地文件即事实。
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from omh_assets import FIXED_ZIP_DATE, load_json, pack_plan, repo_root  # noqa: E402

DIST_NAME = "oh-my-herdr-{version}.zip"
SUMS_NAME = "SHA256SUMS"


def read_version(root: Path) -> str:
    """VERSION 单行内容；与 layouts/oh-my-herdr.json 里的版本引用无耦合。"""
    text = (root / "VERSION").read_text(encoding="utf-8").strip()
    if not text:
        raise SystemExit("VERSION 是空的")
    if "/" in text or "\\" in text or len(text) > 40:
        raise SystemExit(f"VERSION 内容不像版本号: {text!r}")
    return text


def collect_files(root: Path) -> tuple[list[str], str]:
    """白名单清单 + 版本；缺必需文件直接退出。"""
    version = read_version(root)
    files, problems = pack_plan(root)
    if problems:
        for p in problems:
            print(f"error: {p}", file=sys.stderr)
        raise SystemExit("发行白名单不完整，未打包")
    if not files:
        raise SystemExit("白名单为空，未打包")
    return files, version


def build_zip(root: Path, files: list[str], version: str, dest: Path) -> None:
    """把白名单文件按固定时间戳打进 zip；zip 根目录就是仓库内容本身。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in files:
            src = root / rel
            info = zipfile.ZipInfo(rel.replace("\\", "/"), FIXED_ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if rel in ("install.sh", "install.ps1") else 0o644) << 16
            info.comment = f"oh-my-herdr {version}".encode()
            zf.writestr(info, src.read_bytes())
        # 版本元信息：解包即可核对，无需解压 VERSION。
        zf.comment = f"oh-my-herdr {version}".encode()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_sums(dist: Path, version: str) -> Path:
    """SHA256SUMS 写入 zip 哈希；文件自身哈希只能打印，不能自包含。"""
    zip_path = dist / DIST_NAME.format(version=version)
    sums = dist / SUMS_NAME
    zip_hash = sha256(zip_path)
    lines = [f"{zip_hash}  {zip_path.name}"]
    sums.write_text("\n".join(lines) + "\n", encoding="ascii")
    print(f"SHA256({SUMS_NAME}) = {sha256(sums)}")
    return sums


def verify(dist: Path, version: str) -> bool:
    """核对 zip 与 SHA256SUMS：hash 一致 + 条目与当前白名单一致。"""
    zip_path = dist / DIST_NAME.format(version=version)
    sums = dist / SUMS_NAME
    ok = True
    if not zip_path.is_file() or not sums.is_file():
        print(f"error: 缺 {zip_path.name} 或 {SUMS_NAME}", file=sys.stderr)
        return False
    expect = {}
    for line in sums.read_text(encoding="ascii").splitlines():
        h, _, name = line.partition("  ")
        if name:
            expect[name.strip()] = h.strip()
    got = sha256(zip_path)
    if expect.get(zip_path.name) != got:
        print(f"error: {zip_path.name} hash 不匹配 (SUMS={expect.get(zip_path.name)} 实际={got})")
        ok = False
    root = repo_root()
    files, _ = collect_files(root)
    with zipfile.ZipFile(zip_path) as zf:
        names = [i.filename for i in zf.infolist()]
        meta = zf.comment.decode("utf-8", "replace")
    missing = sorted(set(files) - set(names))
    extra = sorted(set(names) - set(files))
    if missing or extra:
        for m in missing:
            print(f"error: 包里缺 {m}")
        for e in extra:
            print(f"error: 包里多了 {e}")
        ok = False
    if meta != f"oh-my-herdr {version}":
        print(f"error: zip 注释版本 {meta!r} != {version}")
        ok = False
    if ok:
        print(f"OK {zip_path.name} ({len(names)} 个文件) 版本 {version}")
    return ok


def main() -> None:
    root = repo_root()
    ap = argparse.ArgumentParser(description="打 oh-my-herdr 发行 zip + SHA256SUMS")
    ap.add_argument("--out", default="dist", help="输出目录（默认 dist/）")
    ap.add_argument("--check", action="store_true", help="只校验已生成的包")
    args = ap.parse_args()

    version = read_version(root)
    dist = Path(args.out)
    if not dist.is_absolute():
        dist = root / dist

    if args.check:
        raise SystemExit(0 if verify(dist, version) else 1)

    files, version = collect_files(root)
    dest = dist / DIST_NAME.format(version=version)
    build_zip(root, files, version, dest)
    print(f"built {dest} ({len(files)} files, {dest.stat().st_size} bytes) version {version}")
    write_sums(dist, version)
    if not verify(dist, version):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
