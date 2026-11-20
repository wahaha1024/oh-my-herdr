// 代码审查：状态栏一个「审查」按钮，点开是全屏差异对话框。
// 取自 AkaraChen/2code 的 Full-screen Diff & Review Dialog：统一 / 分栏两种视图、
// 左侧改动文件导航、每文件 +N −N；本轮（OMP 会话日志）碰过的文件置顶并加粗。
// 差异读 `git diff HEAD`（工作区 + 暂存区），与 shipped 的 changes 模块一样关掉
// fsmonitor 与 index 自动刷新，避免读操作把目录监听搅得反复刷新。
// 长行按宽度截断，悬停看整行——对话框里不做横向滚动，省掉一套滚动条状态。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { panes, spaces, focused, exec, readTextFile, home, props, closeOverlay, openOverlay, theme, settings, window, checking } from "herdr";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "core.quotePath=false"];
const MAX_ROWS = 800;
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));
const tint = (hex, a) => (typeof hex === "string" && hex.length === 7 ? hex + a : hex);
const EDGE_T = 12, EDGE_LONG = 3206, EDGE_TALL = 1794, EDGE_CORNER = 46, EDGE_FOOT = 40;
const EDGE_PRESETS = [
  { bg: "#e8f0ec", muted: "#5f6b67", dir: "ink-qingci" },
  { bg: "#f7f4ed", muted: "#746b5e", dir: "ink-xuanzhi" },
  { bg: "#14131a", muted: "#8b8597", dir: "ink-xuanmo" },
];
let edgeCacheKey = "";
let edgeCacheDir = null;
function artEdgeDir(t) {
  if (t.paper) return "ink";
  const bg = t.background ?? "", muted = t.muted ?? "";
  const key = `${bg}|${muted}`;
  if (key !== edgeCacheKey) {
    edgeCacheKey = key;
    const p = EDGE_PRESETS.find((x) => x.bg === bg && x.muted === muted);
    edgeCacheDir = p ? p.dir : null;
  }
  return edgeCacheDir;
}
function paperCard(view, t, content) {
  const dir = artEdgeDir(t);
  const line = tint(t.accent, "cc");
  if (!dir) return content.rounded(8).border(1).border_color(line);
  const w = Math.max(400, view._cardW ?? 1264);
  const h = Math.max(300, view._cardH ?? 864);
  const sideH = Math.max(0, h - 2 * EDGE_T);
  const art = (name, iw, ih) => image(`mods/inkstone-edge/${dir}/${name}.svg`).absolute().w(iw).h(ih);
  const hEdge = (side) => div().relative().w_full().h(EDGE_T).flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(Math.max(0, w - EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-l`, EDGE_LONG, EDGE_T).left(0).top(0)))
    .child(div().absolute().right(0).top(0).w(Math.min(w, EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-r`, EDGE_CORNER, EDGE_T).right(0).top(0)));
  const vEdge = (side) => div().relative().w(EDGE_T).h_full().flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(EDGE_T).h(Math.max(0, sideH - EDGE_FOOT)).overflow_hidden().child(art(`${side}-t`, EDGE_T, EDGE_TALL).left(0).top(0)))
    .child(div().absolute().left(0).bottom(0).w(EDGE_T).h(Math.min(sideH, EDGE_FOOT)).overflow_hidden().child(art(`${side}-b`, EDGE_T, EDGE_FOOT).left(0).bottom(0)));
  return v_flex().id("rv-card").size_full().min_h(0)
    .on_size_change((sz, cx) => {
      if (Math.abs((view._cardW ?? 0) - sz.width) >= 1 || Math.abs((view._cardH ?? 0) - sz.height) >= 1) {
        view._cardW = sz.width;
        view._cardH = sz.height;
        cx.notify();
      }
    })
    .child(hEdge("top"))
    .child(h_flex().w_full().flex_1().min_h(0)
      .child(vEdge("left"))
      .child(div().flex_1().min_w(0).min_h(0).h_full().overflow_hidden().border(1).border_color(line).child(content))
      .child(vEdge("right")))
    .child(hEdge("bottom"));
}

function location() {
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const space = spaces().find((s) => s.active);
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on: space?.machine ?? null };
}

// 统一视图的行：hunk 头单独一行，其余带旧 / 新行号。
function unifiedRows(lines) {
  let old = 0;
  let next = 0;
  return lines.map((line) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) {
      old = +m[1];
      next = +m[2];
      return { kind: "@", text: line };
    }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") return { kind, number: old++, other: next++, text: untab(line.slice(1)) || " " };
    return { kind: "", text: line };
  });
}

// 分栏视图：删在左、增在右，上下文两侧同排。
function splitRows(rows) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.kind === "@" || r.kind === "") {
      out.push({ kind: "@", text: r.text });
      i++;
      continue;
    }
    if (r.kind === " ") {
      out.push({ kind: " ", text: r.text, l: r.number, r: r.other });
      i++;
      continue;
    }
    if (r.kind !== "-" && r.kind !== "+") { i++; continue; }
    const dels = [];
    const adds = [];
    while (i < rows.length && rows[i].kind === "-") dels.push(rows[i++]);
    while (i < rows.length && rows[i].kind === "+") adds.push(rows[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ kind: "~", left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return out;
}

// quotePath=false 保留 Unicode，但 Git 仍给制表符、引号等字符加 C 风格引号。
function gitPath(raw) {
  if (!raw.startsWith('"')) return raw;
  const escapes = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
  return raw.slice(1, -1).replace(/\\([0-7]{3}|.)/g, (_m, c) => c.length === 3 ? String.fromCharCode(parseInt(c, 8)) : (escapes[c] ?? c));
}

function parseDiff(text) {
  const files = [];
  let cur = null;
  let inHunk = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const paths = line.slice(11);
      const mid = (paths.length - 1) / 2;
      const same = paths.startsWith("a/") && paths.slice(2, mid) === paths.slice(mid + 3) && paths.slice(mid, mid + 3) === " b/";
      const m = /^((?:"a\/(?:[^"\\]|\\.)*"|a\/.*?)) ("b\/(?:[^"\\]|\\.)*"|b\/.*)$/.exec(paths);
      cur = { path: same ? paths.slice(mid + 3) : gitPath(m?.[2] ?? paths).replace(/^b\//, ""), status: "M", add: 0, del: 0, lines: [] };
      inHunk = false;
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("@@ ")) inHunk = true;
    if (!inHunk) {
      if (line.startsWith("new file mode")) { cur.status = "A"; continue; }
      if (line.startsWith("deleted file mode")) { cur.status = "D"; continue; }
      if (line.startsWith("rename to ")) { cur.status = "R"; cur.path = gitPath(line.slice(10)); continue; }
      if (line.startsWith("rename from ")) { cur.status = "R"; continue; }
      if (line.startsWith("+++ ") || line.startsWith("--- ")) {
        const path = gitPath(line.slice(4).replace(/\t$/, ""));
        if (path.startsWith("b/") || (cur.status === "D" && path.startsWith("a/"))) cur.path = path.slice(2);
        continue;
      }
      if (/^(index |similarity index|old mode|new mode|Binary files)/.test(line)) continue;
    }
    if (line.startsWith("+")) cur.add++;
    else if (line.startsWith("-")) cur.del++;
    cur.lines.push(line);
  }
  for (const f of files) {
    const unified = unifiedRows(f.lines).slice(0, MAX_ROWS);
    f.unified = unified;
    f.split = splitRows(unified);
  }
  return files;
}

// —— 本轮改动 ——
// 从 OMP 会话日志尾部找最后一条 user 消息，收集其后 edit/write 的路径；再由路径反查仓库。
// readTextFile 只到 1 MiB，会话文件常有几 MB，所以用 exec 取尾部若干行。
const normPath = (p) => String(p ?? "").replace(/\\/g, "/").toLowerCase();

function sessionKey(cwd) {
  return `--${String(cwd).replace(/[:\\/]/g, "-")}--`;
}

const homes = new Map();
async function homeDir(on) {
  const k = on ?? "";
  if (homes.has(k)) return homes.get(k);
  const r = on
    ? await exec("sh", ["-lc", 'printf %s "$HOME"'], { on }).catch(() => null)
    : await exec("powershell", ["-NoProfile", "-Command", "$env:USERPROFILE"], {}).catch(() => null);
  const v = r?.code === 0 ? r.stdout.trim() : "";
  if (v) homes.set(k, v);
  return v || null;
}

async function newestSession(dir, on) {
  const r = !on && plat() === "windows"
    ? await exec("powershell", ["-NoProfile", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-ChildItem -LiteralPath '${dir.replace(/'/g, "''")}' -Filter *.jsonl -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName`], { timeout: 5000 }).catch(() => null)
    : await exec("sh", ["-lc", 'ls -td "$1"/*.jsonl 2>/dev/null | head -n 1', "sh", dir], { on, timeout: 5000 }).catch(() => null);
  const p = r?.code === 0 ? r.stdout.trim() : "";
  return p || null;
}

async function fileStamp(path, on) {
  const r = !on && plat() === "windows"
    ? await exec("powershell", ["-NoProfile", "-Command", `$f=Get-Item -LiteralPath '${path.replace(/'/g, "''")}' -ErrorAction SilentlyContinue; if($f){"$($f.Length)|$($f.LastWriteTimeUtc.Ticks)"}`], { timeout: 5000 }).catch(() => null)
    : await exec("sh", ["-lc", 'stat -c "%s|%Y" "$1" 2>/dev/null || stat -f "%z|%m" "$1" 2>/dev/null', "sh", path], { on, timeout: 5000 }).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : "";
}

// 会话文件常有十几 MB，而 exec 只给 8 MiB：整段 tail 在长会话里会被截断，
// 丢掉的正是尾部（也就是本轮），于是「本轮」永远为空。只把 user 消息与工具调用
// 两类行取回来，体积从 MB 降到几十 KB，顺序不变。
const KEEP = '"role":"user"|tool_execution_start';

async function tailLines(file, on, n) {
  if (on || plat() !== "windows") {
    const r = await exec("sh", ["-lc", 'tail -n "$2" "$1" 2>/dev/null | grep -E "$3"', "sh", file, String(n), KEEP], { on, timeout: 10000 }).catch(() => null);
    return r?.code === 0 ? r.stdout : "";
  }
  const bytes = Math.min(8 * 1024 * 1024, Math.max(524288, n * 512));
  const esc = file.replace(/'/g, "''");
  const ps = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$p = '${esc}'; $max = ${bytes}`,
    "if (Test-Path -LiteralPath $p) {",
    "  $fs = [System.IO.File]::Open($p, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)",
    "  try {",
    "    $len = $fs.Length; $take = [Math]::Min($len, [int64]$max)",
    "    if ($take -lt $len) { $fs.Seek(-$take, [System.IO.SeekOrigin]::End) | Out-Null }",
    "    $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8, $true)",
    "    while (-not $sr.EndOfStream) {",
    "      $ln = $sr.ReadLine()",
    "      if ($ln -and ($ln.Contains('\"role\":\"user\"') -or $ln.Contains('tool_execution_start'))) { $ln }",
    "    }",
    "  } finally { $fs.Dispose() }",
    "}",
  ].join("\n");
  const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 10000 }).catch(() => null);
  return r?.code === 0 ? r.stdout : "";
}

// 找不到 user 边界说明这一段比尾部窗口更早，调用方加大行数重试。
function turnPaths(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.indexOf('"role"') < 0) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec?.type === "message" && rec.message?.role === "user") {
      start = i;
      break;
    }
  }
  if (start < 0) return { boundary: false, paths: [] };
  const out = new Map();
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.indexOf("tool_execution_start") < 0) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec?.type !== "custom" || rec.customType !== "tool_execution_start") continue;
    const d = rec.data ?? {};
    if (!["edit", "write", "apply_patch"].includes(d.toolName)) continue;
    const p = d.args?.path ?? d.args?.file_path ?? d.args?.filePath ?? null;
    if (typeof p === "string" && p) out.set(p, d.toolName);
  }
  return { boundary: true, paths: [...out.keys()] };
}

function baseOf(path) {
  return (path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path || "~";
}

const plat = () => window()?.platform ?? "windows";
const SKIP_REL = /(^|[\\/])(node_modules|target|dist|__pycache__|\.venv|\.next)([\\/]|$)/;

async function liveDiff(repo, on, args, timeout) {
  const options = { cwd: repo, on, timeout };
  const head = await exec("git", [...READ, "rev-parse", "--verify", "--quiet", "HEAD"], options);
  let base = "HEAD";
  if (head.code === 1) {
    // 无 HEAD 时以空树为基准，一次得到暂存区与工作区的净差异，不写 Git 对象。
    const format = await exec("git", [...READ, "rev-parse", "--show-object-format"], options);
    if (format.code !== 0) throw new Error(format.stderr.trim() || "无法读取 Git 对象格式");
    const name = format.stdout.trim();
    if (name === "sha1") base = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    else if (name === "sha256") base = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";
    else throw new Error(`不支持的 Git 对象格式：${name}`);
  } else if (head.code !== 0) {
    throw new Error(head.stderr.trim() || "无法读取 Git HEAD");
  }
  return exec("git", [...READ, "diff", ...args, base, "--"], options);
}

function parsePorcelainCounts(raw) {
  const parts = String(raw ?? "").split("\u0000");
  let mod = 0, add = 0, del = 0;
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const x = entry[0], y = entry[1];
    const rel = entry.slice(3);
    if (x === "R" || x === "C") i++;
    if (SKIP_REL.test(rel)) continue;
    if (x === "?" && y === "?") add++;
    else if (x === "A" || y === "A") add++;
    else if (x === "D" || y === "D") del++;
    else if (x !== "!" && y !== "!") mod++;
  }
  return { mod, add, del };
}

function parseNumstat(raw) {
  let plus = 0, minus = 0;
  for (const ln of String(raw ?? "").split(/\r?\n/)) {
    if (!ln) continue;
    const [a, d] = ln.split("\t");
    const na = Number(a), nd = Number(d);
    if (Number.isFinite(na)) plus += na;
    if (Number.isFinite(nd)) minus += nd;
  }
  return { plus, minus };
}
export default class Review extends View {
  init(_p, cx) {
    this.files = [];
    this.open = null;
    this.split = false;
    this.loading = false;
    this.stage = "";
    this.error = "";
    this.cwd = null;
    this.repos = [];
    this.turnCount = 0;
    this.reposCache = new Map();
    this.childReposCache = null;
    this.turnCache = { key: null, stamp: "", paths: [] };
    this.summary = { mod: 0, add: 0, del: 0, plusLines: 0, minusLines: 0, repos: [], key: "" };
    this.summaryLoading = false;
    this.reviewKey = null;
    this.filesScroll = ScrollHandle.new();
    this.diffScroll = ScrollHandle.new();
    if (props()?.overlay) {
      this.refresh(cx);
      if (!checking()) cx.timer.every(5000, (cx) => this.refresh(cx, true));
    } else if (!checking()) {
      this.refreshSummary(cx);
      cx.timer.every(25000, (cx) => this.refreshSummary(cx));
    }
  }

  refresh(cx, quiet = false) {
    if (this.loading) return;
    const { cwd, on } = location();
    const key = `${on ?? ""}\0${cwd ?? ""}`;
    if (this.reviewKey !== key) {
      this.reviewKey = key;
      this.files = [];
      this.open = null;
      this.repos = [];
      this.cwd = null;
      this.turnCount = 0;
      this.error = "";
    }
    if (!cwd) {
      if (this.error !== "当前没有目录") {
        this.error = "当前没有目录";
        cx.notify();
      }
      return;
    }
    if (!quiet) {
      this.childReposCache = null;
      this.reposCache.clear();
    }
    this.loading = true;
    this.stage = quiet ? "" : "扫描仓库";
    cx.spawn(async (cx) => {
      const current = () => {
        const active = location();
        return active.cwd === cwd && active.on === on;
      };
      try {
        const { files, repos, turn } = await this.collect(cwd, on, cx, quiet);
        if (!current()) return;
        const previous = this.current();
        this.files = files;
        this.repos = repos;
        this.turnCount = turn.paths.length;
        if (!files.some((f) => f.key === this.open)) this.open = files[0]?.key ?? null;
        this.cwd = repos[0] ?? cwd;
        this.error = files.length ? "" : (repos.length ? "没有未提交的改动" : "当前目录不在 Git 仓库中");
        const cur = this.current();
        if (cur?.unloaded) {
          if (quiet && previous?.key === cur.key && previous.status === "U") {
            cur.loadError = previous.loadError;
            if (!previous.unloaded) {
              cur.unloaded = false;
              cur.add = previous.add;
              cur.lines = previous.lines;
              cur.unified = previous.unified;
              cur.split = previous.split;
            }
          }
          if (!cur.loadError) this.loadUntracked(cur, cx, !cur.unloaded);
        }
      } catch (e) {
        if (current()) this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
        this.stage = "";
        cx.notify();
      }
    });
  }

  // 路径 -> 所属仓库根。缓存两分钟：翻文件时不该反复 rev-parse。
  async repoOf(dir, on) {
    if (!dir) return null;
    this.reposCache = this.reposCache ?? new Map();
    const key = `${on ?? ""}\u0000${dir}`;
    const hit = this.reposCache.get(key);
    if (hit && Date.now() - hit.at < 120000) return hit.repo;
    const r = await exec("git", [...READ, "rev-parse", "--show-toplevel"], { cwd: dir, on }).catch(() => null);
    const repo = r?.code === 0 ? r.stdout.trim() : null;
    this.reposCache.set(key, { at: Date.now(), repo });
    return repo;
  }

  // 当 cwd 本身是工作区根目录（如 E:\DSH）而非仓库时，自动扫出下面 1~2 级子目录里的独立 .git 仓库。
  async childRepos(dir, on) {
    if (!dir) return [];
    const key = `${on ?? ""}\u0000${dir}`;
    if (this.childReposCache?.key === key) return this.childReposCache.repos;
    let found;
    const useWin = !on && plat() === "windows";
    if (useWin) {
      const esc = dir.replace(/'/g, "''");
      const ps = [
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        `$root = '${esc}'`,
        "$skip = @('.git','node_modules','target','dist','.next','__pycache__','.venv')",
        "$out = New-Object System.Collections.Generic.List[string]",
        "if (Test-Path -LiteralPath $root) {",
        "  foreach ($d in (Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue)) {",
        "    if ($skip -contains $d.Name) { continue }",
        "    if (Test-Path -LiteralPath (Join-Path $d.FullName '.git')) { $out.Add($d.FullName); continue }",
        "    foreach ($sub in (Get-ChildItem -LiteralPath $d.FullName -Directory -Force -ErrorAction SilentlyContinue)) {",
        "      if ($skip -contains $sub.Name) { continue }",
        "      if (Test-Path -LiteralPath (Join-Path $sub.FullName '.git')) { $out.Add($sub.FullName) }",
        "      if ($out.Count -ge 16) { break }",
        "    }",
        "    if ($out.Count -ge 16) { break }",
        "  }",
        "}",
        "$out | Select-Object -First 16",
      ].join("\n");
      const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 6000 }).catch(() => null);
      if (r?.code !== 0) return [];
      found = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } else {
      const cmd = 'find "$1" -mindepth 2 -maxdepth 3 \\( -name node_modules -o -name target -o -name dist -o -name .next -o -name __pycache__ -o -name .venv \\) -prune -o -name .git -print 2>/dev/null | head -n 16';
      const r = await exec("sh", ["-c", cmd, "sh", dir], { on, timeout: 6000 }).catch(() => null);
      if (r?.code !== 0) return [];
      found = r.stdout
        .split(/\r?\n/)
        .map((s) => s.trim().replace(/[\\/]\.git$/, ""))
        .filter(Boolean);
    }
    this.childReposCache = { key, repos: found };
    return found;
  }

  async discoverRepos(cwd, on, extraPaths = []) {
    const map = new Map();
    const add = (p) => {
      if (!p) return;
      const k = normPath(p);
      if (!map.has(k)) map.set(k, p);
    };
    const [here, children] = await Promise.all([
      this.repoOf(cwd, on),
      this.childRepos(cwd, on),
    ]);
    add(here);
    for (const c of children) add(c);
    for (const p of extraPaths) {
      const dir = p.replace(/[\\/][^\\/]+$/, "");
      const repo = await this.repoOf(dir, on);
      add(repo);
    }
    return [...map.values()];
  }

  refreshSummary(cx) {
    if (this.summaryLoading || checking()) return;
    const { cwd, on } = location();
    if (!cwd) {
      this.childReposCache = null;
      this.summary = { mod: 0, add: 0, del: 0, plusLines: 0, minusLines: 0, repos: [], key: "" };
      cx.notify();
      return;
    }
    const locKey = `${on ?? ""}|${cwd}`;
    this.summaryLoading = true;
    cx.spawn(async (cx) => {
      try {
        const repos = await this.discoverRepos(cwd, on);
        let mod = 0, add = 0, del = 0, plusLines = 0, minusLines = 0;
        for (const repo of repos) {
          const active = location();
          if (active.cwd !== cwd || active.on !== on) return;
          const [st, ns] = await Promise.all([
            exec("git", [...READ, "status", "--porcelain=v1", "-z", "-uall"], { cwd: repo, on, timeout: 8000 }).catch(() => null),
            liveDiff(repo, on, ["--numstat"], 8000).catch(() => null),
          ]);
          if (st?.code === 0) {
            const c = parsePorcelainCounts(st.stdout);
            mod += c.mod;
            add += c.add;
            del += c.del;
          }
          if (ns?.code === 0) {
            const ls = parseNumstat(ns.stdout);
            plusLines += ls.plus;
            minusLines += ls.minus;
          }
        }
        const active = location();
        if (active.cwd !== cwd || active.on !== on) return;
        this.summary = { mod, add, del, plusLines, minusLines, repos, key: locKey };
      } catch {
      } finally {
        this.summaryLoading = false;
        cx.notify();
      }
    });
  }
  // 本回合改过的文件路径（会话日志尾部；stamp 不变就复用）。
  async turnEdits(cwd, on) {
    this.turnCache = this.turnCache ?? { key: null, stamp: "", paths: [] };
    const h = on ? await homeDir(on) : home();
    if (!h) return { paths: [] };
    const file = await newestSession(`${h}/.omp/agent/sessions/${sessionKey(cwd)}`, on);
    if (!file) return { paths: [] };
    const stamp = await fileStamp(file, on);
    const key = `${on ?? ""}\u0000${file}`;
    if (this.turnCache.key === key && this.turnCache.stamp === stamp && stamp) return { paths: this.turnCache.paths };
    let paths = [];
    for (const n of [1500, 8000, 30000]) {
      const text = await tailLines(file, on, n);
      const res = turnPaths(text);
      if (res.boundary) {
        paths = res.paths;
        break;
      }
    }
    this.turnCache = { key, stamp, paths };
    return { paths };
  }

  // 只在窗口打开时读取实时差异；一次处理一个仓库，避免自动刷新形成进程峰值。
  async collect(cwd, on, cx, quiet = false) {
    const setStage = (s) => {
      if (quiet) return;
      this.stage = s;
      cx?.notify();
    };
    setStage("扫描仓库");
    const turnPromise = new Promise((resolve) => {
      let settled = false;
      if (cx?.timer?.after) {
        cx.timer.after(2500, () => {
          if (!settled) { settled = true; resolve({ paths: [] }); }
        });
      }
      this.turnEdits(cwd, on)
        .then((res) => { if (!settled) { settled = true; resolve(res); } })
        .catch(() => { if (!settled) { settled = true; resolve({ paths: [] }); } });
    });
    const [turn, baseRepos] = await Promise.all([
      turnPromise,
      this.discoverRepos(cwd, on),
    ]);
    setStage(`定位仓库 (${turn.paths.length} 条记录)`);
    const turnSet = new Set(turn.paths.map(normPath));
    const repoMap = new Map(baseRepos.map((p) => [normPath(p), p]));
    const baseList = [...repoMap.keys()];
    const extraDirs = new Set();
    for (const p of turn.paths) {
      const dir = p.replace(/[\\/][^\\/]+$/, "");
      const nd = normPath(dir);
      if (!nd) continue;
      if (baseList.some((b) => nd === b || nd.startsWith(b + "/"))) continue;
      extraDirs.add(dir);
    }
    for (const dir of extraDirs) {
      const repo = await this.repoOf(dir, on);
      if (repo && !repoMap.has(normPath(repo))) repoMap.set(normPath(repo), repo);
    }
    const repos = [...repoMap.values()];
    const files = [];
    for (const repo of repos) {
      const rName = baseOf(repo);
      setStage(`读取 ${rName}`);
      const [r, st] = await Promise.all([
        liveDiff(repo, on, ["--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "-U3"], 10000),
        exec("git", [...READ, "status", "--porcelain=v1", "-z", "-uall"], { cwd: repo, on, timeout: 8000 }).catch(() => null),
      ]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || `无法读取 ${rName} 的 Git 差异`);
      const seenRel = new Set();
      for (const f of parseDiff(r.stdout)) {
        seenRel.add(f.path);
        f.repo = repo;
        f.repoName = rName;
        f.key = `${repo}\u0000${f.path}`;
        f.touched = turnSet.has(normPath(`${repo}/${f.path}`));
        files.push(f);
      }
      const parts = String(st?.stdout ?? "").split("\u0000");
      const untracked = [];
      for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        if (!entry || entry.length < 4) continue;
        const x = entry[0], y = entry[1];
        if (x === "R" || x === "C") { i++; continue; }
        if (x !== "?" || y !== "?") continue;
        const rel = entry.slice(3);
        if (SKIP_REL.test(rel) || seenRel.has(rel)) continue;
        untracked.push(rel);
      }
      const items = untracked.map((rel) => ({
        path: rel,
        status: "U",
        add: 0,
        del: 0,
        lines: [],
        unified: [],
        split: [],
        unloaded: true,
        loadingBody: false,
        on,
        repo,
        repoName: rName,
        key: `${repo}\u0000${rel}`,
        touched: turnSet.has(normPath(`${repo}/${rel}`)),
      }));
      files.push(...items);
    }
    setStage("整理差异行");
    files.sort((a, b) => (a.touched === b.touched ? (a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path)) : a.touched ? -1 : 1));
    return { files, repos, turn };
  }

  current() {
    return this.files.find((f) => f.key === this.open) ?? null;
  }

  loadUntracked(f, cx, reload = false) {
    if (!f || f.status !== "U" || (!f.unloaded && !reload) || f.loadingBody) return;
    f.loadingBody = true;
    if (f.unloaded) cx.notify();
    cx.spawn(async (cx) => {
      const { text, error } = await new Promise((resolve) => {
        let settled = false;
        const finish = (text, error = "") => {
          if (settled) return;
          settled = true;
          resolve({ text, error });
        };
        cx.timer.after(1500, () => finish(null, "读取新文件超时"));
        readTextFile(`${f.repo}/${f.path}`, { on: f.on ?? null })
          .then((text) => finish(text, text === null ? "找不到新文件" : ""))
          .catch((e) => {
            const reason = String(e?.message ?? e);
            finish(null, reason.includes("1 MiB") ? "新文件超过 1 MiB，未显示内容" : `无法预览新文件：${reason}`);
          });
      });
      f.loadingBody = false;
      if (!this.files.includes(f)) return;
      f.loadError = error;
      f.unloaded = text === null;
      if (text === null) {
        f.add = 0;
        f.lines = [];
        f.unified = [];
      } else if (text.includes("\0")) {
        f.add = 0;
        f.lines = [];
        f.unified = [{ kind: "@", text: "二进制文件 · 无文本差异" }];
      } else {
        const lines = text ? text.replace(/\r?\n$/, "").split(/\r?\n/).map((l) => `+${l}`) : [];
        f.lines = lines;
        f.add = lines.length;
        f.unified = unifiedRows(lines.slice(0, MAX_ROWS));
      }
      f.split = splitRows(f.unified);
      cx.notify();
    });
  }

  // 状态栏形态：实时显示当前修改 / 新增 / 删除数量，点开全屏审查对话框。
  compact(t, cx) {
    const { cwd, on } = location();
    const locKey = `${on ?? ""}|${cwd ?? ""}`;
    if (!checking() && cwd && locKey !== this.summary?.key && !this.summaryLoading) {
      this.refreshSummary(cx);
    }
    const s = this.summary ?? { mod: 0, add: 0, del: 0, plusLines: 0, minusLines: 0, repos: [] };
    const hasChange = s.mod + s.add + s.del > 0;
    const repoList = (s.repos ?? []).map(baseOf).join(" · ");
    const tip = hasChange
      ? `未提交变更：${s.mod} 修改 · ${s.add} 新增 · ${s.del} 删除（+${s.plusLines} / −${s.minusLines} 行）\n仓库：${repoList || "当前目录"}\n点击打开审查`
      : (s.repos?.length ? `工作区干净（${repoList}）\n点击打开审查` : "未检测到 Git 仓库\n点击打开审查");
    return h_flex()
      .id("review-compact")
      .size_full()
      .flex_none()
      .px(8)
      .gap(5)
      .items_center()
      .border_l(1)
      .border_color(t.border)
      .cursor_pointer()
      .tooltip(tip)
      .hover((h) => h.bg(t.hover))
      .on_click(() => openOverlay({ mod: "inkstone-review", kind: "dialog", frame: "none", width: 1264, height: 864, props: { review: true, framed: true } }))
      .child(svg("mods/workspace-chrome/git-compare.svg").size(12).flex_none().text_color(hasChange ? t.accent : t.muted))
      .child(div().flex_none().text_size(11).text_color(hasChange ? t.foreground : t.muted).child("审查"))
      .when(hasChange, (el) => el.child(h_flex()
        .flex_1()
        .min_w(0)
        .gap(4)
        .items_center()
        .when(s.mod > 0, (x) => x.child(div().flex_none().text_size(10.5).font_semibold().text_color(t.working).child(`~${s.mod}`)))
        .when(s.add > 0, (x) => x.child(div().flex_none().text_size(10.5).font_semibold().text_color(t.done).child(`+${s.add}`)))
        .when(s.del > 0, (x) => x.child(div().flex_none().text_size(10.5).font_semibold().text_color(t.blocked).child(`−${s.del}`)))))
      .when(!hasChange, (el) => el.child(div().flex_1().truncate().text_size(10).text_color(t.dim).child(s.repos?.length ? "无变更" : "")));
  }

  fileRow(f, t, cx) {
    const multi = (this.repos?.length ?? 0) > 1;
    const label = multi ? `${f.repoName}/${f.path}` : f.path;
    return h_flex()
      .id(`rv-file-${f.key}`)
      .h(28)
      .flex_none()
      .px(9)
      .gap(7)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .when(f.key === this.open, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .tooltip(`${f.repoName}/${f.path}${f.touched ? "\n本轮修改过" : ""}`)
      .on_click((_e, cx) => {
        this.open = f.key;
        if (f.unloaded) this.loadUntracked(f, cx);
        cx.notify();
      })
      .child(div().w(10).flex_none().text_size(11).text_color(f.status === "A" ? t.done : f.status === "D" ? t.blocked : f.status === "U" ? t.dim : t.working).child(f.status))
      .child(div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(12)
        .when(f.touched, (el) => el.font_weight(600))
        .text_color(f.key === this.open ? t.foreground : f.touched ? t.foreground : t.muted)
        .child(label))
      .when(f.add > 0, (el) => el.child(div().text_size(11).text_color(t.done).child(`+${f.add}`)))
      .when(f.del > 0, (el) => el.child(div().text_size(11).text_color(t.blocked).child(`−${f.del}`)));
  }

  unifiedRow(row, t) {
    if (row.kind === "@") return div().w_full().h(19).flex_none().px(10).truncate().bg(t.raised).text_color(t.dim).child(row.text);
    return h_flex()
      .w_full()
      .h(19)
      .flex_none()
      .gap(8)
      .px(4)
      .when(row.kind === "+", (e) => e.bg(`${t.done}20`))
      .when(row.kind === "-", (e) => e.bg(`${t.blocked}20`))
      .child(div().w(42).flex_none().text_right().text_color(t.dim).child(row.number === undefined ? "" : String(row.number)))
      .child(div().w(7).flex_none().text_color(row.kind === "+" ? t.done : row.kind === "-" ? t.blocked : t.dim).child(row.kind === "+" ? "+" : row.kind === "-" ? "-" : ""))
      .child(div().flex_1().min_w(0).truncate().text_color(row.kind === " " ? t.foreground : t.muted).tooltip(row.text).child(row.text));
  }

  splitRow(row, t) {
    if (row.kind === "@") return div().w_full().h(19).flex_none().px(10).truncate().bg(t.raised).text_color(t.dim).child(row.text);
    // 上下文行左右同文，删 / 增行各占一侧。
    const left = row.kind === "~" ? row.left : { kind: " ", number: row.l, text: row.text };
    const right = row.kind === "~" ? row.right : { kind: " ", number: row.r, text: row.text };
    const cell = (line, first) => h_flex()
      .flex_1()
      .min_w(0)
      .h(19)
      .gap(8)
      .px(4)
      .when(!first, (e) => e.border_l(1).border_color(t.border))
      .when(line?.kind === "+", (e) => e.bg(`${t.done}20`))
      .when(line?.kind === "-", (e) => e.bg(`${t.blocked}20`))
      .child(div().w(40).flex_none().text_right().text_color(t.dim).child(line?.number === undefined ? "" : String(line.number)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).tooltip(line?.text ?? "").child(line?.text ?? ""));
    return h_flex().w_full().h(19).flex_none()
      .child(cell(left, true))
      .child(cell(right, false));
  }

  diffBody(t, cx) {
    const f = this.current();
    if (!f) {
      return div().flex_1().min_h(0).p(16).text_size(12).text_color(t.dim)
        .child(this.stage ? "读取差异…" : this.error || (this.cwd ? "工作区没有未提交的改动。" : ""));
    }
    if (f.unloaded) {
      const body = v_flex().flex_1().min_h(0).p(16).gap(8).text_size(12).text_color(t.dim);
      if (f.loadingBody || !f.loadError) return body.child("读取新文件内容…");
      return body.child(f.loadError).child(h_flex().child(this.button("rv-retry-file", "重试", false,
        (_e, cx) => this.loadUntracked(f, cx), t)));
    }
    return v_flex()
      .id("rv-diff")
      .flex_1()
      .min_h(0)
      .gap(0)
      .px(4)
      .py(4)
      .overflow_y_scrollbar()
      .mode("always")
      .track_scroll(this.diffScroll)
      .children((this.split ? f.split : f.unified).map((row) => (this.split ? this.splitRow(row, t) : this.unifiedRow(row, t))))
      .when(f.lines.length > MAX_ROWS, (el) => el.child(div().px(10).py(6).text_size(11).text_color(t.dim).child(`预览已截断，仅显示前 ${MAX_ROWS} 行。`)));
  }

  button(id, label, active, onClick, t) {
    return div()
      .id(id)
      .h(24)
      .px(9)
      .flex()
      .items_center()
      .rounded(6)
      .text_size(11)
      .bg(active ? t.selected : t.raised)
      .text_color(active ? t.foreground : t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(onClick)
      .child(label);
  }

  dialog(t, cx) {
    const files = this.files;
    const add = files.reduce((n, f) => n + f.add, 0);
    const del = files.reduce((n, f) => n + f.del, 0);
    const modCnt = files.filter((f) => f.status === "M" || f.status === "R").length;
    const addCnt = files.filter((f) => f.status === "A" || f.status === "U").length;
    const delCnt = files.filter((f) => f.status === "D").length;
    const inner = v_flex()
      .id("rv-root")
      .size_full()
      .min_h(0)
      .bg(t.paper ?? t.background)
      .text_color(t.foreground)
      .text_size(13)
      .child(h_flex()
        .h(44)
        .flex_none()
        .px(14)
        .gap(9)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(svg("mods/workspace-chrome/git-compare.svg").size(15).flex_none().text_color(t.accent))
        .child(div().text_size(13).font_semibold().child("审查"))
        .when((this.turnCount ?? 0) > 0, (el) => el
          .child(div().h(18).px(5).flex().items_center().rounded(4).bg(t.accent + "22").text_size(11).text_color(t.accent).child(`本轮 ${this.turnCount}`)))
        .child(div().px(5).py(1).rounded(4).border(1).border_color(t.border).text_size(11).text_color(t.muted).child(`${files.length} 个文件`))
        .when(modCnt > 0, (el) => el.child(div().text_size(11).font_medium().text_color(t.working).child(`${modCnt} 修改`)))
        .when(addCnt > 0, (el) => el.child(div().text_size(11).font_medium().text_color(t.done).child(`${addCnt} 新增`)))
        .when(delCnt > 0, (el) => el.child(div().text_size(11).font_medium().text_color(t.blocked).child(`${delCnt} 删除`)))
        .child(div().text_size(11).text_color(t.done).child(`+${add}`))
        .child(div().text_size(11).text_color(t.blocked).child(`−${del}`))
        .child(div().flex_1())
        .child(this.button("rv-unified", "统一", !this.split, (_e, cx) => {
          this.split = false;
          cx.notify();
        }, t))
        .child(this.button("rv-split", "分栏", this.split, (_e, cx) => {
          this.split = true;
          cx.notify();
        }, t))
        .child(this.button("rv-refresh", "刷新", false, (_e, cx) => this.refresh(cx), t))
        .child(div()
          .id("rv-close")
          .size(24)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(6)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => closeOverlay(props()?.overlay))
          .child(svg("mods/workspace-chrome/x.svg").size(14).text_color(t.muted))))
      .child(h_flex()
        .flex_1()
        .min_h(0)
        .items_stretch()
        .child(v_flex()
          .w(248)
          .flex_none()
          .min_h(0)
          .border_r(1)
          .border_color(t.border)
          .child(div().h(26).flex_none().px(10).flex().items_center().text_size(11).text_color(t.dim).child("改动文件"))
          .child(v_flex()
            .id("rv-files")
            .flex_1()
            .min_h(0)
            .px(6)
            .pb(6)
            .gap(1)
            .overflow_y_scrollbar()
            .mode("always")
            .track_scroll(this.filesScroll)
            .children(files.length
              ? files.map((f) => this.fileRow(f, t, cx))
              : [div().px(8).py(8).text_size(12).text_color(t.dim).child(this.stage ? `读取差异… ${this.stage}` : "没有改动")])))
        .child(v_flex()
          .flex_1()
          .min_w(0)
          .min_h(0)
          .font_family(settings().font_family ?? "JetBrains Mono")
          .text_size(11)
          .when(Boolean(this.current()), (el) => el.child(h_flex()
            .h(26)
            .flex_none()
            .px(12)
            .gap(8)
            .items_center()
            .border_b(1)
            .border_color(t.border)
            .child(div().font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.muted).truncate().child((() => { const c = this.current(); return c ? `${c.repo}/${c.path}` : ""; })()))
            .child(div().flex_1())
            .child(div().text_size(11).text_color(t.dim).child(this.split ? "分栏视图" : "统一视图"))))
          .child(this.diffBody(t, cx))))
      .child(h_flex()
        .h(26)
        .flex_none()
        .px(12)
        .gap(8)
        .items_center()
        .border_t(1)
        .border_color(t.border)
        .text_size(11)
        .text_color(t.dim)
        .child(div().flex_1().truncate().child(this.repos?.length ? `git diff HEAD · ${this.repos.map(baseOf).join(" · ")}` : ""))
        .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).truncate().child(this.error))));
    return props()?.framed ? paperCard(this, t, inner) : inner;
  }

  render(cx) {
    const t = theme();
    return props()?.overlay ? this.dialog(t, cx) : this.compact(t, cx);
  }
}
