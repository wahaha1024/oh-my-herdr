// 代码审查：状态栏一个「审查」按钮，点开是全屏差异对话框。
// 取自 AkaraChen/2code 的 Full-screen Diff & Review Dialog：统一 / 分栏两种视图、
// 左侧改动文件导航、每文件 +N −N；本轮（OMP 会话日志）碰过的文件置顶并加粗。
// 差异读 `git diff HEAD`（工作区 + 暂存区），与 shipped 的 changes 模块一样关掉
// fsmonitor 与 index 自动刷新，避免读操作把目录监听搅得反复刷新。
// 长行按宽度截断，悬停看整行——对话框里不做横向滚动，省掉一套滚动条状态。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { panes, spaces, focused, exec, readTextFile, home, props, closeOverlay, openOverlay, theme, settings } from "herdr";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const MAX_ROWS = 800;
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

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
    const dels = [];
    const adds = [];
    while (i < rows.length && rows[i].kind === "-") dels.push(rows[i++]);
    while (i < rows.length && rows[i].kind === "+") adds.push(rows[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ kind: "~", left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return out;
}

function parseDiff(text) {
  const files = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      cur = { path: m?.[2] ?? line.slice(11), status: "M", add: 0, del: 0, lines: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("new file mode")) { cur.status = "A"; continue; }
    if (line.startsWith("deleted file mode")) { cur.status = "D"; continue; }
    if (line.startsWith("rename from ") || line.startsWith("rename to ")) { cur.status = "R"; continue; }
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("index ") ||
        line.startsWith("similarity index") || line.startsWith("old mode") || line.startsWith("new mode") ||
        line.startsWith("Binary files")) continue;
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
  const r = on
    ? await exec("sh", ["-lc", `ls -t ${JSON.stringify(dir)}/*.jsonl 2>/dev/null | head -1`], { on }).catch(() => null)
    : await exec("powershell", ["-NoProfile", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-ChildItem -LiteralPath '${dir.replace(/'/g, "''")}' -Filter *.jsonl -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName`], {}).catch(() => null);
  const p = r?.code === 0 ? r.stdout.trim() : "";
  return p || null;
}

async function fileStamp(path, on) {
  const r = on
    ? await exec("sh", ["-lc", `stat -c '%s|%Y' ${JSON.stringify(path)} 2>/dev/null`], { on }).catch(() => null)
    : await exec("powershell", ["-NoProfile", "-Command", `$f=Get-Item -LiteralPath '${path.replace(/'/g, "''")}' -ErrorAction SilentlyContinue; if($f){"$($f.Length)|$($f.LastWriteTimeUtc.Ticks)"}`], {}).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : "";
}

// 会话文件常有十几 MB，而 exec 只给 8 MiB：整段 tail 在长会话里会被截断，
// 丢掉的正是尾部（也就是本轮），于是「本轮」永远为空。只把 user 消息与工具调用
// 两类行取回来，体积从 MB 降到几十 KB，顺序不变。
const KEEP = '"role":"user"|tool_execution_start';

async function tailLines(file, on, n) {
  const r = on
    ? await exec("sh", ["-lc", `tail -n ${n} -- ${JSON.stringify(file)} 2>/dev/null | grep -E ${JSON.stringify(KEEP)}`], { on }).catch(() => null)
    : await exec("powershell", ["-NoProfile", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Content -LiteralPath '${file.replace(/'/g, "''")}' -Tail ${n} -ErrorAction SilentlyContinue | Where-Object { $_ -match '${KEEP}' }`], {}).catch(() => null);
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

export default class Review extends View {
  init(_p, cx) {
    this.files = [];
    this.open = null;
    this.split = false;
    this.loading = false;
    this.error = "";
    this.cwd = null;
    this.repos = [];
    this.turnCount = 0;
    this.reposCache = new Map();
    this.turnCache = { key: null, stamp: "", paths: [] };
    this.at = 0;
    this.filesScroll = ScrollHandle.new();
    this.diffScroll = ScrollHandle.new();
    if (props()?.overlay) this.refresh(cx);
  }

  refresh(cx) {
    if (this.loading) return;
    const { cwd, on } = location();
    if (!cwd) {
      this.error = "当前没有目录";
      return;
    }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const { files, repos, turn } = await this.collect(cwd, on);
        this.files = files;
        this.repos = repos;
        this.turnCount = turn.paths.length;
        if (!this.files.some((f) => f.key === this.open)) this.open = this.files[0]?.key ?? null;
        this.cwd = repos[0] ?? cwd;
        this.error = this.files.length ? "" : (repos.length ? "没有未提交的改动" : "当前目录不在 Git 仓库中");
      } catch (e) {
        this.error = String(e?.message ?? e);
        this.files = [];
        this.repos = [];
      }
      this.loading = false;
      this.at = Date.now();
      cx.notify();
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

  // 汇总：本轮碰过的仓库 + 当前目录所属仓库，各自 git diff HEAD；未跟踪文件只收本轮碰过的。
  async collect(cwd, on) {
    const turn = await this.turnEdits(cwd, on);
    const turnSet = new Set(turn.paths.map(normPath));
    const repos = new Map();
    for (const p of turn.paths) {
      const dir = p.replace(/[\\/][^\\/]+$/, "");
      const repo = await this.repoOf(dir, on);
      if (repo) repos.set(repo, true);
    }
    const here = await this.repoOf(cwd, on);
    if (here) repos.set(here, true);
    const files = [];
    for (const repo of repos.keys()) {
      let r = await exec("git", [...READ, "diff", "HEAD", "--no-color", "--no-ext-diff", "-U3"], { cwd: repo, on, timeout: 20000 }).catch(() => null);
      if (r && r.code !== 0) {
        // 还没有第一次提交：HEAD 不存在，退回工作区差异。
        r = await exec("git", [...READ, "diff", "--no-color", "--no-ext-diff", "-U3"], { cwd: repo, on, timeout: 20000 }).catch(() => null);
      }
      for (const f of r && r.code === 0 ? parseDiff(r.stdout ?? "") : []) {
        f.repo = repo;
        f.repoName = baseOf(repo);
        f.key = `${repo}\u0000${f.path}`;
        f.touched = turnSet.has(normPath(`${repo}/${f.path}`));
        files.push(f);
      }
      const st = await exec("git", [...READ, "status", "--porcelain=v1", "-z", "-uall"], { cwd: repo, on }).catch(() => null);
      for (const entry of String(st?.stdout ?? "").split("\u0000")) {
        if (!entry.startsWith("?? ")) continue;
        const rel = entry.slice(3);
        if (!turnSet.has(normPath(`${repo}/${rel}`))) continue;
        const text = await readTextFile(`${repo}/${rel}`, { on }).catch(() => null);
        const lines = text == null ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/).map((l) => `+${l}`);
        const unified = unifiedRows(lines).slice(0, MAX_ROWS);
        files.push({ path: rel, status: "U", add: lines.length, del: 0, lines, unified, split: splitRows(unified), repo, repoName: baseOf(repo), key: `${repo}\u0000${rel}`, touched: true });
      }
    }
    files.sort((a, b) => (a.touched === b.touched ? (a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path)) : a.touched ? -1 : 1));
    return { files, repos: [...repos.keys()], turn };
  }

  current() {
    return this.files.find((f) => f.key === this.open) ?? null;
  }

  // 状态栏形态：一个「审查」按钮。
  compact(t) {
    return h_flex()
      .id("review-compact")
      .size_full()
      .flex_none()
      .px(10)
      .gap(6)
      .items_center()
      .border_l(1)
      .border_color(t.border)
      .cursor_pointer()
      .tooltip("审查本轮改动与工作区差异")
      .hover((s) => s.bg(t.hover))
      .on_click(() => openOverlay({ mod: "inkstone-review", kind: "dialog", width: 1240, height: 840, props: { review: true } }))
      .child(svg("mods/workspace-chrome/git-compare.svg").size(12).flex_none().text_color(t.muted))
      .child(div().text_size(11).text_color(t.muted).child("审查"));
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
        .child(this.loading ? "读取差异…" : this.error || (this.cwd ? "工作区没有未提交的改动。" : ""));
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
      .when(f.lines.length > MAX_ROWS, (el) => el.child(div().px(10).py(6).text_size(11).text_color(t.dim).child(`只显示前 ${MAX_ROWS} 行。`)));
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
    return v_flex()
      .id("rv-root")
      .size_full()
      .min_h(0)
      .bg(t.background)
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
              : [div().px(8).py(8).text_size(12).text_color(t.dim).child(this.loading ? "读取差异…" : "没有改动")])))
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
            .child(div().font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.muted).truncate().child(this.open ?? ""))
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
  }

  render(cx) {
    const t = theme();
    return props()?.overlay ? this.dialog(t, cx) : this.compact(t);
  }
}
