#!/bin/sh
# 把 Oh My Herdr 装进 Herdr 的配置目录（macOS / Linux / WSL）。
# 用法： ./install.sh                    # 不覆盖已有文件
#        ./install.sh --force            # 覆盖同名文件
#        ./install.sh --target DIR       # 装到别处
set -e

TARGET="${HERDR_CONFIG:-$HOME/.config/herdr-app}"
FORCE=0

for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    --target=*) TARGET="${a#--target=}" ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

SRC=$(cd "$(dirname "$0")" && pwd)

if [ ! -f "$TARGET/settings.json" ]; then
  echo "not a Herdr config directory: $TARGET" >&2
  echo "start herdr-app once, or pass --target=DIR" >&2
  exit 1
fi

# 一个文件都没有时才复制；--force 时覆盖。
put() {
  from=$1; to=$2
  if [ -e "$to" ] && [ "$FORCE" = 0 ]; then
    echo "  skip $to"
    return 0
  fi
  mkdir -p "$(dirname "$to")"
  if [ -n "$DRY" ]; then
    echo "  write $to"
  else
    cp "$from" "$to"
    echo "  write $to"
  fi
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
  echo "  no python found — copy pixel-icons/ beside herdr-app, then add this under \"programs\" by hand:"
  echo '  "omp": { "icon": "pixel-icons/codex.svg", "tint": false }'
else
  PROG_SRC="$SRC/programs.json" PROG_DST="$TARGET/programs.json" DRY="$DRY" "$PY" - <<'PY'
import json, os, shutil, sys

src, dst = os.environ["PROG_SRC"], os.environ["PROG_DST"]
dry = os.environ.get("DRY")

ours = json.load(open(src, encoding="utf-8"))["programs"]["omp"]
cur = {}
if os.path.exists(dst):
    try:
        cur = json.load(open(dst, encoding="utf-8"))
    except Exception as e:
        sys.exit(f"  {dst} is not valid JSON ({e}) — left alone")
    if not isinstance(cur, dict):
        sys.exit(f"  {dst} is not an object — left alone")

progs = cur.setdefault("programs", {})
if "omp" in progs:
    print(f"  skip omp (already {json.dumps(progs['omp'], ensure_ascii=False)})")
else:
    progs["omp"] = ours
    if dry:
        print(f"  would write {dst}")
    else:
        if os.path.exists(dst):
            shutil.copyfile(dst, dst + ".bak")
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(cur, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"  wrote {dst}" + (" (backup: programs.json.bak)" if os.path.exists(dst + ".bak") else ""))
PY
fi

echo
echo "done. switch to it:"
echo "  herdr-app do layout.switch '{\"name\":\"oh-my-herdr\"}'"
echo "back is ctrl-shift-l."
