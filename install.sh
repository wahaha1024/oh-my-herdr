#!/bin/sh
# 把 Oh My Herdr 装进 Herdr 的配置目录（macOS / Linux / WSL）。
# 用法： ./install.sh                    # 不覆盖已有文件
#        ./install.sh --force            # 覆盖同名文件
#        ./install.sh --target DIR       # 装到别处
#        ./install.sh --dry-run          # 只显示要写入的路径
set -e

TARGET="${HERDR_CONFIG:-$HOME/.config/herdr-app}"
FORCE=0
DRY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    --target=*) TARGET="${1#--target=}" ;;
    --target) shift; TARGET="$1" ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

SRC=$(cd "$(dirname "$0")" && pwd)

if [ ! -f "$TARGET/settings.json" ]; then
  echo "not a Herdr config directory: $TARGET" >&2
  echo "start herdr-app once, or pass --target=DIR" >&2
  exit 1
fi

# 一个文件都没有时才复制；--force 时覆盖。
# 跳过的会记到临时文件里，末尾整体提示一次——升级时最容易被这一点坑到。
if [ -z "$DRY" ]; then
  SKIPS=$(mktemp "${TMPDIR:-/tmp}/oh-my-herdr-skip.XXXXXX")
  trap 'rm -f "$SKIPS"' EXIT
fi
put() {
  from=$1; to=$2
  if [ -e "$to" ] && [ "$FORCE" = 0 ]; then
    echo "  skip $to"
    [ -n "$DRY" ] || echo x >> "$SKIPS"
    return 0
  fi
  if [ -z "$DRY" ]; then
    mkdir -p "$(dirname "$to")"
    cp "$from" "$to"
  fi
  echo "  write $to"
}

echo "layouts/"
put "$SRC/layouts/oh-my-herdr.json" "$TARGET/layouts/oh-my-herdr.json"
put "$SRC/layouts/oh-my-herdr.png"  "$TARGET/layouts/oh-my-herdr.png"

echo "themes/"
put "$SRC/themes/qingci.json" "$TARGET/themes/qingci.json"
put "$SRC/themes/xuanmo.json" "$TARGET/themes/xuanmo.json"
put "$SRC/themes/zhi.json" "$TARGET/themes/zhi.json"

echo "mods/"
for d in "$SRC"/mods/*/; do
  name=$(basename "$d")
  [ -d "$d" ] || continue
  echo " $name"
  (cd "$d" && find . -type f | sed 's|^\./||') | while read -r f; do
    put "$d$f" "$TARGET/mods/$name/$f"
  done
done

echo "pixel-icons/"
if [ -d "$SRC/pixel-icons" ]; then
  (cd "$SRC/pixel-icons" && find . -type f | sed 's|^\./||') | while read -r f; do
    put "$SRC/pixel-icons/$f" "$TARGET/pixel-icons/$f"
  done
fi

PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import json' >/dev/null 2>&1; then
    PY="$cand"
    break
  fi
done

echo "programs.json"
if [ -z "$PY" ]; then
  echo "  no python found — copy pixel-icons/ beside herdr-app, then merge these into \"programs\" (add only the keys you are missing):"
  echo '  "omp": { "icon": "pixel-icons/codex.svg", "tint": false }'
  echo '  "codebuddy": { "name": "CodeBuddy", "icon": "icons/agent.svg", "tint": true, "tile": "#1c1d21", "color": "#d6d8db", "run": ["codebuddy"],'
  echo '               "match": ["codebuddy-code", "cbc", "codebuddy.cmd", "codebuddy-code.cmd", "cbc.cmd", "codebuddy.ps1", "codebuddy-code.ps1", "cbc.ps1"] }'
else
  PROG_SRC="$SRC/programs.json" PROG_DST="$TARGET/programs.json" DRY="$DRY" FORCE="$FORCE" PYTHONIOENCODING=utf-8 "$PY" -B - <<'PY'
import json, os, shutil, sys

src, dst = os.environ["PROG_SRC"], os.environ["PROG_DST"]
dry = os.environ.get("DRY")
KEYS = ("omp", "codebuddy")

with open(src, encoding="utf-8-sig") as f:
    ours = json.load(f)["programs"]
cur = {}
if os.path.exists(dst):
    try:
        with open(dst, encoding="utf-8-sig") as f:
            cur = json.load(f)
    except Exception as e:
        sys.exit(f"  {dst} is not valid JSON ({e}) — left alone")
    if not isinstance(cur, dict):
        sys.exit(f"  {dst} is not an object — left alone")

progs = cur.setdefault("programs", {})
if not isinstance(progs, dict):
    sys.exit(f"  {dst}: programs is not an object — left alone")

add = []
for k in KEYS:
    if k in progs:
        print(f"  skip {k} (already {json.dumps(progs[k], ensure_ascii=False)})")
    else:
        add.append(k)
if not add:
    sys.exit(0)
print(f"  add {', '.join(add)}")
if dry:
    print(f"  would write {dst}")
    sys.exit(0)
if os.path.exists(dst):
    shutil.copyfile(dst, dst + ".bak")
for k in add:
    progs[k] = ours[k]
with open(dst, "w", encoding="utf-8") as f:
    json.dump(cur, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"  wrote {dst}" + (" (backup: programs.json.bak)" if os.path.exists(dst + ".bak") else ""))
PY
fi

SKIPPED=0
if [ -z "$DRY" ]; then
  SKIPPED=$(wc -l < "$SKIPS" | tr -d ' ')
fi

echo
if [ "$SKIPPED" -gt 0 ] && [ "$FORCE" = 0 ] && [ -z "$DRY" ]; then
  echo "note: $SKIPPED files were left as they were (old versions)."
  echo "      if this machine already had Oh My Herdr, update it with --force:"
  echo "        ./install.sh --force"
  echo
fi
echo "done. switch to it:"
echo "  herdr-app do layout.switch '{\"name\":\"oh-my-herdr\"}'"
echo "back is ctrl-shift-l."
