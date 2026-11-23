// 文件：面向 Oh My Herdr 的项目文件树与只读预览面板（支持远程机器 { on }）。
// 增强能力：
//   - 快速搜索：优先走 git ls-files / jj file list（尊重忽略规则），非仓库退回轻量遍历；
//   - 一键引用：行尾 @ 与预览顶栏「复制 @路径」按钮，直接写入剪贴板（@relative/path）；
//   - 状态标记：同时支持 Git 与 Jujutsu (jj) 变更标记（M / A / D / U）；
//   - 全中文界面，Esc 清空搜索或退出文件预览。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, checking } from "herdr";
import ICONS from "./icons.js";

const LANG = {
  ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js",
  toml: "yaml", jsonc: "json", svelte: "html", vue: "html",
};
const PER_FOLDER = 500;
const TOTAL = 5000;
const INDEX_LIMIT = 4000;

function location() {
  const space = spaces().find((s) => s.active);
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null
    ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null)
    : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || "", on, space: space?.id || "" };
}
const locKey = () => JSON.stringify(location());

async function directory(path, on) {
  const windowsDirectory = async () => {
    const esc = path.replace(/['‘’‚‛]/g, "$&$&");
    const r = await exec("powershell", [
      "-NoProfile", "-Command",
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Where-Object Name -ne '.jj' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + esc + "'",
    ], { on });
    if (r.code !== 0) throw new Error(r.stderr || "无法读取该目录");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] || [ "$name" = .jj ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "无法读取该目录");
  const fields = r.stdout.split("\0");
  const out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

async function scanIndex(cwd, on, vcs) {
  if (vcs === "git") {
    const r = await exec("git", ["--no-optional-locks", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd, on, timeout: 15000 }).catch(() => null);
    if (r?.code === 0) {
      return r.stdout.split("\0").filter(Boolean).slice(0, INDEX_LIMIT);
    }
  }
  if (vcs === "jj") {
    const r = await exec("jj", ["file", "list", "--no-pager", "--ignore-working-copy"], { cwd, on, timeout: 15000 }).catch(() => null);
    if (r?.code === 0) {
      return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, INDEX_LIMIT);
    }
  }
  if (!on && window()?.platform === "windows") {
    const esc = cwd.replace(/['‘’‚‛]/g, "$&$&");
    const cmd = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($root) $skip = '\\\\(\\.git|\\.jj|node_modules|target|dist|\\.next|__pycache__)(\\\\|$)'; Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch $skip } | Select-Object -First ${INDEX_LIMIT} | ForEach-Object { $_.FullName.Substring($root.TrimEnd('\\','/').Length + 1).Replace('\\','/') } } '${esc}'`;
    const r = await exec("powershell", ["-NoProfile", "-Command", cmd], { timeout: 15000 }).catch(() => null);
    if (r?.code === 0) return String(r.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return [];
  }
  const sh = 'cd "$1" 2>/dev/null || exit 1; find . \\( -name .git -o -name .jj -o -name node_modules -o -name target -o -name dist -o -name .next -o -name __pycache__ \\) -prune -o -type f -print 2>/dev/null | sed "s|^\\./||" | head -n ' + INDEX_LIMIT;
  const r = await exec("sh", ["-c", sh, "idx", cwd], { on, timeout: 15000 }).catch(() => null);
  if (r?.code === 0) return String(r.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function normPath(p) {
  return String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
}

// 盘符、UNC、POSIX 根都算绝对路径：show() 直接读，不再拼 root。
const isAbs = (p) => /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(String(p ?? ""));

// 文件/目录图标照 VS Code 的 Material Icon Theme 规则挑：路径规则胜过文件名，文件名胜过扩展名，最长扩展名优先。
const DIR = "mods/inkstone-files";
const bare = (name) => name.replace(/^__(.+)__$/, "$1").replace(/^[._-]/, "");
const openedId = (id) => (id.endsWith("_light") ? `${id.slice(0, -6)}-open_light` : `${id}-open`);
const lookupIcon = (table, key, dark) => (dark ? undefined : ICONS.light[table][key]) ?? ICONS[table][key];

function fileIcon(path, dir, open, dark) {
  const parts = String(path ?? "").toLowerCase().split("/");
  const name = parts[parts.length - 1] ?? "";
  const table = dir ? "folderNames" : "fileNames";
  const find = (key) => lookupIcon(table, key, dark) ?? (dir ? lookupIcon(table, bare(key), dark) : undefined);
  let id;
  for (let i = 0; !id && i < parts.length - 1; i++) id = find(parts.slice(i).join("/"));
  if (dir) {
    id ??= find(name) ?? ICONS.folder;
    return `${DIR}/icons/${open ? openedId(id) : id}.svg`;
  }
  id ??= lookupIcon(table, name, dark);
  for (let dot = name.indexOf("."); !id && dot !== -1; dot = name.indexOf(".", dot + 1)) {
    id = lookupIcon("fileExtensions", name.slice(dot + 1), dark);
  }
  return `${DIR}/icons/${id ?? ICONS.file}.svg`;
}

// 上一层目录：`E:\a\b` → `E:\a`，`E:\a` → `E:\`，`/a/b` → `/a`；到顶返回 null。
function parentOf(path) {
  const p = normPath(path);
  const cut = p.lastIndexOf("/");
  if (cut < 0) return null;
  if (cut === 0) return "/";
  const head = p.slice(0, cut);
  return head.endsWith(":") ? `${head}/` : head;
}

// 搜索框里写 `mods/x/main.js:120`（或 `main.js L9`、`(9,3)`）直接预览到行。
function parseTarget(text) {
  const raw = String(text ?? "")
    .replace(/^[\s"'`([{<]+/, "")
    .replace(/[\s"'`)\]}>]+$/, "")
    .trim();
  if (!raw || raw.length > 500 || /\n/.test(raw)) return null;
  const m = /^(.*?)(?::(\d+)(?::\d+)?|\(\s*(\d+)\s*,\s*\d+\s*\)|(?:[Ll](?:ine)?\s*)(\d+))$/.exec(raw);
  const path = (m ? m[1] : raw).replace(/[,;，；:]+$/, "").trim();
  if (!path) return null;
  if (!/[\\/]/.test(path) && !/\.[A-Za-z0-9]{1,8}$/.test(path)) return null;
  const line = m ? Number(m[2] ?? m[3] ?? m[4]) : 0;
  return { path, line: Number.isFinite(line) && line > 0 ? line : 0 };
}

export default class InkstoneFiles extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.above = null; // 浏览根：null 跟项目目录，否则是上去之后的目录。
    this.entries = new Map();
    this.folders = new Set();
    this.pending = new Set();
    this.marks = {};
    this.vcs = undefined; // 尚在检测；null 才表示普通目录。
    this.index = [];
    this.indexReady = false;
    this.indexLoading = false;
    this.query = "";
    this.copied = null;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "搜索文件或路径…" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      if (this.query.trim() && !this.indexReady && !this.indexLoading) {
        this.loadIndex(cx);
      }
      cx.notify();
    });
    // 回车：整行是路径（可带行号）就直接预览过去；不然照旧只做过滤。
    this.input.on("submit", (_e, cx) => {
      const hit = parseTarget(this.input.value());
      if (!hit) return;
      this.query = "";
      this.input.set_value("");
      const rel = this.mapPath(hit.path);
      if (rel === null) return;
      this.show(rel, cx, hit.line);
      cx.notify();
    });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    if (!checking()) {
      this.refresh(cx);
    }
    cx.timer.every(12000, (cx) => {
      if (!checking()) this.refresh(cx);
    });
  }

  stopWatching() {
    const watching = this.watching;
    this.watching = null;
    watching?.handle?.cancel();
  }

  async close() {
    this.context = null;
    this.stopWatching();
  }

  watch(root, cx) {
    if (this.on || this.watching) return;
    const context = this.context;
    const watching = this.watching = { handle: null };
    cx.spawn(async (cx) => {
      try {
        while (this.watching === watching && this.current(context)) {
          watching.handle = watchFolder(root);
          const changes = await watching.handle;
          if (!changes.length || this.watching !== watching || !this.current(context)) break;
          this.indexReady = false;
          this.refresh(cx);
        }
      } catch {
        // 目录太大或监听不可用：已有定时刷新会补上，下一轮再试。
      } finally {
        if (this.watching === watching) this.watching = null;
      }
    });
  }

  current(context) {
    return this.context === context && locKey() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()]
      .filter(([p]) => p !== path)
      .reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(
      path,
      entries
        .slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used)))
        .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)),
    );
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  loadIndex(cx) {
    const context = this.context;
    if (!context?.cwd || this.indexLoading || this.vcs === undefined) return;
    this.indexLoading = true;
    const vcs = this.vcs;
    cx.spawn(async (cx) => {
      try {
        const list = await scanIndex(context.cwd, context.on, vcs);
        if (!this.current(context) || this.vcs !== vcs) return;
        this.index = list;
        this.indexReady = true;
      } finally {
        if (this.context === context) {
          this.indexLoading = false;
          if (this.current(context) && this.vcs !== vcs) this.loadIndex(cx);
        }
        cx.notify();
      }
    });
  }

  async detectMarks(cwd, on) {
    // 1) Jujutsu (jj) 优先：存在且可执行时解析 Working copy changes。
    const jjRoot = await exec("jj", ["root", "--ignore-working-copy"], { cwd, on, timeout: 4000 }).catch(() => null);
    if (jjRoot?.code === 0) {
      const top = normPath(jjRoot.stdout.trim());
      const marks = {};
      const st = await exec("jj", ["status", "--no-pager", "--ignore-working-copy"], { cwd, on, timeout: 6000 }).catch(() => null);
      if (st?.code === 0) {
        for (const line of st.stdout.split(/\r?\n/)) {
          const m = line.match(/^([MADRC])\s+(.+)$/);
          if (!m) continue;
          const rel = m[2].includes(" => ") ? m[2].split(" => ").pop().trim() : m[2].trim();
          marks[`${top}/${rel}`] = m[1] === "A" ? "A" : m[1] === "D" ? "D" : "M";
        }
      }
      return { vcs: "jj", marks };
    }
    // 2) Git：不写入 .git 锁与 cookie，避免触发文件夹监听死循环。
    const gitTop = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on, timeout: 4000 }).catch(() => null);
    if (gitTop?.code === 0) {
      const top = normPath(gitTop.stdout.trim());
      const marks = {};
      const status = await exec(
        "git",
        ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"],
        { cwd, on, timeout: 8000 },
      ).catch(() => null);
      if (status?.code === 0) {
        for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
          const xy = entry.slice(0, 2);
          marks[`${top}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
        }
      }
      return { vcs: "git", marks };
    }
    return { vcs: null, marks: {} };
  }

  refresh(cx) {
    const { cwd, on } = location();
    const base = this.above ?? cwd;
    const next = locKey();
    if (next !== this.context?.key) {
      this.stopWatching();
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd: base, on };
      this.root = base;
      this.on = on;
      this.entries = new Map();
      this.folders = new Set(saved?.folders);
      this.pending = new Set();
      this.marks = {};
      this.vcs = undefined;
      this.index = [];
      this.indexReady = false;
      this.indexLoading = false;
      this.show(null);
      this.error = null;
      this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async (cx) => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const { vcs, marks } = await this.detectMarks(cwd, on);
        if (!this.current(context)) return;
        if (vcs !== this.vcs) {
          this.vcs = vcs;
          this.index = [];
          this.indexReady = false;
        }
        this.marks = marks;
        this.error = null;
        this.watch(cwd, cx);
        if (!this.indexReady && !this.indexLoading) {
          this.loadIndex(cx);
        }
      } catch (e) {
        if (this.current(context)) this.error = String(e);
      } finally {
        if (this.context === context) this.loading = false;
        cx.notify();
      }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) {
        if (folder === path || folder.startsWith(path + "/")) {
          this.folders.delete(folder);
          this.entries.delete(folder);
        }
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async (cx) => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx, line = 0) {
    this.code?.release();
    this.code = null;
    this.file = path;
    this.fileError = null;
    if (!path || !cx) return;
    const context = this.context;
    const root = this.root;
    const on = this.on;
    const target = isAbs(path) ? path : `${root}/${path}`;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(target, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "该文件已不存在"; return; }
        if (text.includes("\0")) { this.fileError = "二进制文件 · 无法预览文本"; return; }
        const t = theme();
        const ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({
          language: LANG[ext] ?? ext,
          readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n…（文件过大，已截断显示）" : text,
          font_family: settings().font_family,
          font_size: 12,
          syntax: {
            keyword: t.ansi5,
            string: t.ansi2,
            comment: t.dim,
            function: t.ansi4,
            type: t.ansi3,
            number: t.ansi1,
            constant: t.ansi6,
          },
        });
        if (line > 0) this.gotoLine(text, line);
      } catch {
        if (this.file === path && this.current(context)) {
          this.fileError = "无法预览此文件（二进制、过大或无读取权限）";
        }
      } finally {
        cx.notify();
      }
    });
  }

  // 面板根目录下的绝对路径转成相对路径；在外面的原样交给 show 读绝对路径。
  mapPath(path) {
    const full = normPath(path);
    const root = normPath(this.root);
    if (!root || !isAbs(full)) return path;
    if (full === root) return null;
    if (full.startsWith(`${root}/`)) return full.slice(root.length + 1);
    return path;
  }

  // 光标落到第 line 行行首：编辑器拿到焦点就会跟过去。
  gotoLine(text, line) {
    const code = this.code;
    if (!code) return;
    let off = 0;
    for (let n = 1; n < line; n++) {
      const at = text.indexOf("\n", off);
      if (at < 0) { off = text.length; break; }
      off = at + 1;
    }
    try {
      code.set_selected_range({ start: off, end: off });
      code.focus();
    } catch {}
  }

  copyMention(relPath, cx) {
    const clean = normPath(relPath).replace(/^\/+/, "");
    const text = `@${clean}`;
    cx.write_to_clipboard(text);
    this.copied = clean;
    cx.notify();
    cx.spawn(async (cx) => {
      await new Promise((r) => setTimeout(r, 1500));
      if (this.copied === clean) {
        this.copied = null;
        cx.notify();
      }
    });
  }

  markColor(mark, t) {
    if (mark === "A") return t.ansi2;
    if (mark === "D" || mark === "U") return t.ansi1;
    return t.blocked;
  }

  // 换浏览根：`dir` 为 null 表示回到项目目录。
  goTo(dir, cx) {
    if (dir !== null && !dir) return;
    this.above = dir;
    this.stopWatching();
    this.context = null;
    this.folders = new Set();
    this.entries = new Map();
    this.pending = new Set();
    this.marks = {};
    this.vcs = undefined;
    this.index = [];
    this.indexReady = false;
    this.indexLoading = false;
    this.show(null);
    this.refresh(cx);
    cx.notify();
  }

  up(cx) {
    const parent = parentOf(this.root);
    if (parent) this.goTo(parent, cx);
  }

  home(cx) {
    if (this.above !== null) this.goTo(null, cx);
  }

  navButton(id, label, tip, on, t, fn) {
    return div()
      .id(id)
      .px(5)
      .py(2)
      .rounded(4)
      .flex_none()
      .text_size(12)
      .text_color(on ? t.muted : t.dim)
      .when(on, (el) => el
        .cursor_pointer()
        .tooltip(tip)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => fn(cx)))
      .child(label);
  }

  mentionButton(path, idKey, t, cx) {
    const ok = this.copied === path;
    return div()
      .id(idKey)
      .h(18)
      .px(5)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(4)
      .text_size(10)
      .text_color(ok ? t.done : t.dim)
      .cursor_pointer()
      .tooltip(ok ? "已复制" : `复制 @${path}（可粘贴到终端引用）`)
      .accessibility_label(`复制引用 @${path}`)
      .hover((s) => s.bg(t.raised).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.copyMention(path, cx);
      })
      .child(ok ? "✓" : "@");
  }

  rows(prefix, depth, out, t, cx) {
    const dark = Boolean(settings().dark);
    if (out.length >= TOTAL || depth > 40) return out;
    const rootNorm = normPath(this.root);
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const open = this.folders.has(path);
      const mark = this.marks[`${rootNorm}/${path}`];
      out.push(
        h_flex()
          .id(`file-${path}`)
          .h(28)
          .flex_none()
          .pl(8 + depth * 16)
          .pr(6)
          .gap(6)
          .items_center()
          .rounded(6)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => (entry.dir ? this.toggle(path, cx) : this.show(path, cx)))
          .child(entry.dir
            ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim)
            : div().w(12).flex_none())
          .child(image(fileIcon(path, entry.dir, open, dark)).size(14).flex_none())
          .child(div().flex_1().min_w(0).truncate().text_size(12).child(entry.name))
          .when(Boolean(mark), (el) => el.child(div().flex_none().text_size(10).text_color(this.markColor(mark, t)).child(mark)))
          .child(this.mentionButton(path, `file-at-${path}`, t, cx)),
      );
      if (entry.dir && open) this.rows(path, depth + 1, out, t, cx);
    }
    return out;
  }

  searchHits() {
    const words = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const pool = this.indexReady
      ? this.index
      : [...this.entries.entries()].flatMap(([dir, list]) =>
        list.filter((e) => !e.dir).map((e) => (dir ? `${dir}/${e.name}` : e.name)));
    const hits = [];
    for (const rel of pool) {
      const low = rel.toLowerCase();
      if (words.every((w) => low.includes(w))) {
        hits.push(rel);
        if (hits.length >= 160) break;
      }
    }
    return hits;
  }

  searchRows(hits, t, cx) {
    const rootNorm = normPath(this.root);
    return hits.map((path, i) => {
      const parts = path.split("/");
      const name = parts.pop() || path;
      const dir = parts.join("/");
      const mark = this.marks[`${rootNorm}/${path}`];
      return h_flex()
        .id(`fhit-${i}`)
        .h(38)
        .flex_none()
        .px(8)
        .gap(7)
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip(path)
        .on_click((_e, cx) => this.show(path, cx))
        .child(image(fileIcon(path, false, false, Boolean(settings().dark))).size(13).flex_none())
        .child(v_flex()
          .flex_1()
          .min_w(0)
          .gap(0)
          .child(div().w_full().truncate().text_size(12).child(name))
          .when(Boolean(dir), (el) => el.child(div().w_full().truncate().text_size(10).text_color(t.dim).child(dir))))
        .when(Boolean(mark), (el) => el.child(div().flex_none().text_size(10).text_color(this.markColor(mark, t)).child(mark)))
        .child(this.mentionButton(path, `fhit-at-${i}`, t, cx));
    });
  }

  render(cx) {
    if (!checking() && locKey() !== this.context?.key) this.refresh(cx);
    const t = theme();
    const q = this.query.trim();
    const markCount = Object.keys(this.marks).length;
    const hits = q ? this.searchHits() : null;
    const footerLeft = this.vcs
      ? `${this.vcs.toUpperCase()} · ${markCount} 处改动`
      : (this.indexReady ? `已索引 ${this.index.length} 个文件` : (this.root ? "普通目录" : "无目录"));

    return v_flex()
      .id("inkstone-files")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          if (this.typing || this.query) {
            this.query = "";
            this.input.set_value("");
            this.typing = false;
            this.handle.focus();
            cx.stop_propagation();
            cx.notify();
          } else if (this.file) {
            this.show(null);
            cx.stop_propagation();
            cx.notify();
          }
        }
      })
      .child(h_flex()
        .h(34)
        .flex_none()
        .px(12)
        .gap(7)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .when(Boolean(this.file), (el) => el.child(div()
          .id("files-back")
          .px(5)
          .py(2)
          .rounded(4)
          .cursor_pointer()
          .text_size(12)
          .text_color(t.muted)
          .tooltip("返回文件列表")
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.show(null); cx.notify(); })
          .child("←")))
        .when(!this.file, (el) => el.child(image(fileIcon("file.txt", false, false, Boolean(settings().dark))).size(13).flex_none()))
        .when(!this.file, (el) => el
          .child(this.navButton("files-up", "↑", "上级目录", Boolean(parentOf(this.root)), t, (cx) => this.up(cx)))
          .child(this.navButton("files-home", "⌂", "回到项目目录", this.above !== null, t, (cx) => this.home(cx))))
        .when(Boolean(this.file), (el) => el.child(image(fileIcon(this.file, false, false, Boolean(settings().dark))).size(13).flex_none()))
        .child(div().text_size(12).font_semibold().child(this.file ? "预览" : "文件"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.dim)
          .child(this.file ?? this.root?.split(/[\\/]/).filter(Boolean).pop() ?? ""))
        .when(Boolean(this.file), (el) => el.child(div()
          .id("files-copy-preview")
          .px(7)
          .py(2)
          .rounded(5)
          .text_size(11)
          .text_color(this.copied === this.file ? t.done : t.muted)
          .cursor_pointer()
          .tooltip(`复制 @${this.file}`)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.copyMention(this.file, cx))
          .child(this.copied === this.file ? "已复制" : "复制 @路径")))
        .when(!this.file, (el) => el.child(div()
          .id("files-reload")
          .px(6)
          .py(2)
          .rounded(5)
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .tooltip("刷新文件树与变更状态")
          .accessibility_label("刷新文件列表")
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => {
            this.indexReady = false;
            this.refresh(cx);
          })
          .child("刷新"))))
      .when(!this.file, (el) => el
        .child(h_flex()
          .h(32)
          .flex_none()
          .mx(8)
          .mt(6)
          .px(8)
          .gap(6)
          .items_center()
          .rounded(6)
          .bg(t.background)
          .border(1)
          .border_color(this.typing ? t.accent : t.border)
          .cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(svg("mods/inkstone-chrome/search.svg").size(12).flex_none().text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground))
          .when(Boolean(this.query), (el) => el.child(div()
            .id("files-clear")
            .size(16)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(4)
            .text_size(11)
            .text_color(t.dim)
            .cursor_pointer()
            .tooltip("清空搜索")
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => {
              this.query = "";
              this.input.set_value("");
              cx.notify();
            })
            .child("✕"))))
        .child(v_flex()
          .id("files-tree")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .p(6)
          .gap(1)
          .children(q
            ? (hits.length
              ? this.searchRows(hits, t, cx)
              : [div().p(10).text_size(12).text_color(t.dim).child(this.indexLoading ? "正在建立文件索引…" : "没有匹配的文件。")])
            : this.rows("", 0, [], t, cx))
          .when(!q && (Boolean(this.error) || !this.entries.get("")?.length), (el) => el
            .child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "正在读取文件…" : this.root ? "空目录" : "当前空间没有工作目录"))))
          .when(!q && this.limited, (el) => el
            .child(div().p(8).text_size(11).text_color(t.dim).child("单目录上限 500 项，总显示上限 5,000 项")))))
      .when(Boolean(this.file), (el) => el
        .child(v_flex()
          .flex_1()
          .min_h(0)
          .bg(t.background)
          .child(this.code
            ? Editor.new(this.code).flex_1().min_h(0)
            : div().p(12).text_size(12).text_color(t.dim).child(this.fileError || "正在打开文件…"))))
      .child(h_flex()
        .h(24)
        .flex_none()
        .px(10)
        .items_center()
        .justify_between()
        .border_t(1)
        .border_color(t.border)
        .text_size(10)
        .text_color(t.dim)
        .child(div().truncate().child(footerLeft))
        .child(div().flex_none().child(this.file ? "只读预览 · Esc 返回" : "点击预览 · @ 复制路径")));
  }
}
