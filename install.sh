#!/bin/sh
# Oh My Herdr 安装器：POSIX sh 外壳，JSON 与清单操作使用 Python 标准库。
set -eu

FORCE=0; DRY=0; UNINSTALL=0; RESTORE=""; TARGET=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --restore) shift; [ "$#" -gt 0 ] || { echo "--restore 需要 backup-id" >&2; exit 2; }; RESTORE=$1 ;;
    --restore=*) RESTORE=${1#--restore=} ;;
    --target) shift; [ "$#" -gt 0 ] || { echo "--target 需要目录" >&2; exit 2; }; TARGET=$1 ;;
    --target=*) TARGET=${1#--target=} ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[ "$UNINSTALL" = 0 ] || [ -z "$RESTORE" ] || { echo "--uninstall 与 --restore 不能同时使用" >&2; exit 2; }

SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "$TARGET" ]; then
  if [ -n "${HERDR_APP_HOME:-}" ]; then TARGET=$HERDR_APP_HOME
  elif [ -n "${XDG_CONFIG_HOME:-}" ]; then TARGET=$XDG_CONFIG_HOME/herdr-app
  elif [ -n "${HERDR_CONFIG:-}" ]; then TARGET=$HERDR_CONFIG
  else TARGET=${HOME:?}/.config/herdr-app
  fi
fi
case "$TARGET" in /*) ;; *) TARGET=$(CDPATH= cd -- "$TARGET" 2>/dev/null && pwd || printf '%s/%s' "$PWD" "$TARGET") ;; esac

PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import json,hashlib' >/dev/null 2>&1; then PY=$cand; break; fi
done
[ -n "$PY" ] || { echo "需要 Python 3（python3 或 python）来合并 JSON、维护清单和备份；未写入任何文件。" >&2; exit 1; }

SRC="$SRC" TARGET="$TARGET" FORCE="$FORCE" DRY="$DRY" UNINSTALL="$UNINSTALL" RESTORE="$RESTORE" "$PY" - <<'PY'
import hashlib, json, os, shutil, sys, tempfile
from pathlib import Path

src = Path(os.environ["SRC"]); target = Path(os.environ["TARGET"])
force = os.environ["FORCE"] == "1"; dry = os.environ["DRY"] == "1"
uninstall = os.environ["UNINSTALL"] == "1"; restore_id = os.environ["RESTORE"]
version = (src / "VERSION").read_text(encoding="utf-8").strip()
if not (target / "settings.json").is_file():
    raise SystemExit(f"不是 Herdr 配置目录（缺 settings.json）：{target}")

def digest(p):
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""): h.update(b)
    return h.hexdigest()

def rel_files():
    out=[]
    for top in ("layouts", "themes", "mods", "pixel-icons"):
        base=src/top
        if not base.is_dir(): raise SystemExit(f"安装包缺少 {top}/：{base}")
        for p in sorted(base.rglob("*")):
            if p.is_file() and p.name not in ("gpui-kit.d.ts", "jsconfig.json"):
                out.append((p, Path(top)/p.relative_to(base)))
    return out

omh=target/".omh"; manifest_path=omh/"install.json"
try:
    manifest=json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {"version":version,"files":{}}
except Exception as e: raise SystemExit(f"安装清单无法解析，未写入任何文件：{e}")
if not isinstance(manifest,dict) or not isinstance(manifest.get("files",{}),dict): raise SystemExit("安装清单格式无效，未写入任何文件")

def check_programs():
    try: source=json.loads((src/"programs.json").read_text(encoding="utf-8-sig"))
    except Exception as e: raise SystemExit(f"源 programs.json 无法解析，未写入任何文件：{e}")
    if not isinstance(source,dict) or not isinstance(source.get("programs"),dict): raise SystemExit("源 programs.json 的 programs 必须是对象，未写入任何文件")
    dst=target/"programs.json"
    if not dst.exists(): return source, {"programs":{}}, False
    try: current=json.loads(dst.read_text(encoding="utf-8-sig"))
    except Exception as e: raise SystemExit(f"目标 programs.json 无法解析，未写入任何文件：{e}")
    if not isinstance(current,dict): raise SystemExit("目标 programs.json 根必须是对象，未写入任何文件")
    if "programs" in current and not isinstance(current["programs"],dict): raise SystemExit("目标 programs.json 的 programs 必须是对象，未写入任何文件")
    current.setdefault("programs",{}); return source,current,True

def preflight_install():
    source,current,had=check_programs(); files=rel_files()
    # Validate every source file and destination parent before the first write.
    for p,_ in files:
        if not p.is_file(): raise SystemExit(f"安装包文件不存在：{p}")
    add=[k for k in ("omp","codebuddy") if k not in current["programs"]]
    if add: files.append((None,Path("programs.json")))
    return source,current,had,files,add

def backup_id(): return __import__("datetime").datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")

def preview_entries(entries, action):
    print(f"{action}：{len(entries)} 个登记文件，目标 {target}")
    for e in entries: print(f"  {action}: {e}")

if uninstall or restore_id:
    if not manifest_path.is_file(): raise SystemExit("找不到 .omh/install.json，未写入任何文件")
    entries=manifest["files"] if not restore_id else None
    if restore_id:
        b=omh/"backups"/restore_id/"manifest.json"
        if not b.is_file(): raise SystemExit(f"找不到备份：{restore_id}")
        meta=json.loads(b.read_text(encoding="utf-8")); entries=meta.get("files",{})
    if not isinstance(entries,dict): raise SystemExit("清单 files 格式无效")
    if dry: preview_entries(entries.keys(), "预览"); raise SystemExit(0)
    changed=[]
    for rel,info in entries.items():
        dst=target/rel
        expected=info.get("installed_sha256") if not restore_id else info.get("after_sha256")
        if not dst.is_file() or (expected and digest(dst)!=expected):
            print(f"  保留（已被用户修改）：{rel}"); continue
        prev=info.get("previous",{})
        if prev.get("exists"):
            bp=omh/"backups"/prev.get("backup_id","")/"files"/rel
            if not bp.is_file(): print(f"  保留（缺少备份）：{rel}"); continue
            dst.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(bp,dst)
        else: dst.unlink()
        changed.append(rel)
    if uninstall: manifest_path.unlink(missing_ok=True)
    print(f"完成：处理 {len(changed)} 个文件，修改过的文件已保留")
    raise SystemExit(0)

source,current,had,files,add=preflight_install()
if dry:
    preview_entries([str(rel) for _,rel in files], "预览"); raise SystemExit(0)

run_id=backup_id(); backup=omh/"backups"/run_id; written=[]; records={}
try:
    for p,rel in files:
        dst=target/rel
        if rel==Path("programs.json") and p is None:
            value=current; value["programs"].update({k:source["programs"][k] for k in add})
            data=json.dumps(value,ensure_ascii=False,indent=2)+"\n"; src_hash=None
        else:
            if dst.exists() and not force: print(f"  跳过：{rel}"); continue
            data=p.read_bytes(); src_hash=hashlib.sha256(data).hexdigest()
        prev={"exists":dst.is_file()}
        if dst.is_file():
            prev["sha256"]=digest(dst); prev["backup_id"]=run_id
            (backup/"files"/rel).parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(dst,backup/"files"/rel)
        dst.parent.mkdir(parents=True,exist_ok=True)
        fd,tmp=tempfile.mkstemp(dir=str(dst.parent),prefix=".omh-")
        with os.fdopen(fd,"wb") as f: f.write(data if isinstance(data,bytes) else data.encode())
        os.replace(tmp,dst); written.append(dst)
        records[str(rel).replace("\\","/")]={"installed_sha256":digest(dst),"previous":prev,"backup_id":run_id}
        print(f"  写入：{rel}")
    if records:
        backup.mkdir(parents=True,exist_ok=True)
        (backup/"manifest.json").write_text(json.dumps({"version":version,"files":{k:{**v,"after_sha256":v["installed_sha256"]} for k,v in records.items()}},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        manifest.setdefault("files",{}).update(records); manifest["version"]=version
        omh.mkdir(parents=True,exist_ok=True); manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
except Exception:
    for p in reversed(written):
        info=records.get(str(p.relative_to(target)).replace("\\","/"),{}).get("previous",{})
        if info.get("exists"):
            bp=backup/"files"/p.relative_to(target); p.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(bp,p)
        elif p.exists(): p.unlink()
    shutil.rmtree(backup,ignore_errors=True); raise
print(f"完成：写入 {len(records)} 个文件，配置目录：{target}")
PY
