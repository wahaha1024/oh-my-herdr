// 代码审查：状态栏一个「审查」按钮，点开是全屏差异对话框。
// 取自 AkaraChen/2code 的 Full-screen Diff & Review Dialog：统一 / 分栏两种视图、
// 左侧变更文件导航、每文件 +N −N。
// 差异读 `git diff HEAD`（工作区 + 暂存区），与 shipped 的 changes 模块一样关掉
// fsmonitor 与 index 自动刷新，避免读操作把目录监听搅得反复刷新。
// 长行按宽度截断，悬停看整行——对话框里不做横向滚动，省掉一套滚动条状态。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { panes, spaces, focused, exec, props, closeOverlay, openOverlay, theme, settings } from "herdr";

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

export default class Review extends View {
  init(_p, cx) {
    this.files = [];
    this.open = null;
    this.split = false;
    this.loading = false;
    this.error = "";
    this.cwd = null;
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
        let r = await exec("git", [...READ, "diff", "HEAD", "--no-color", "--no-ext-diff", "-U3"], { cwd, on, timeout: 20000 }).catch(() => null);
        if (r && r.code !== 0) {
          // 还没有第一次提交：HEAD 不存在，退回工作区差异。
          r = await exec("git", [...READ, "diff", "--no-color", "--no-ext-diff", "-U3"], { cwd, on, timeout: 20000 }).catch(() => null);
        }
        if (!r || r.code !== 0) throw new Error((r?.stderr || r?.stdout || "git diff 失败").trim().split("\n")[0] || "git diff 失败");
        this.files = parseDiff(r.stdout ?? "");
        if (!this.files.some((f) => f.path === this.open)) this.open = this.files[0]?.path ?? null;
        this.cwd = cwd;
        this.error = "";
      } catch (e) {
        this.error = String(e?.message ?? e);
        this.files = [];
      }
      this.loading = false;
      this.at = Date.now();
      cx.notify();
    });
  }

  current() {
    return this.files.find((f) => f.path === this.open) ?? null;
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
      .tooltip("全屏审查当前工作区差异")
      .hover((s) => s.bg(t.hover))
      .on_click(() => openOverlay({ mod: "inkstone-review", kind: "dialog", width: 1240, height: 840, props: { review: true } }))
      .child(svg("mods/workspace-chrome/git-compare.svg").size(12).flex_none().text_color(t.muted))
      .child(div().text_size(11).text_color(t.muted).child("审查"));
  }

  fileRow(f, t, cx) {
    const parts = f.path.split("/");
    const name = parts.pop();
    return h_flex()
      .id(`rv-file-${f.path}`)
      .h(28)
      .flex_none()
      .px(9)
      .gap(7)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .when(f.path === this.open, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .tooltip(f.path)
      .on_click((_e, cx) => {
        this.open = f.path;
        cx.notify();
      })
      .child(div().w(10).flex_none().text_size(11).text_color(f.status === "A" ? t.done : f.status === "D" ? t.blocked : t.working).child(f.status))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(f.path === this.open ? t.foreground : t.muted).child(parts.length ? `${parts.join("/")}/${name}` : name))
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
          .child(div().h(26).flex_none().px(10).flex().items_center().text_size(11).text_color(t.dim).child("变更文件"))
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
        .child(div().flex_1().truncate().child(this.cwd ? `git diff HEAD · ${this.cwd}` : ""))
        .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).truncate().child(this.error))));
  }

  render(cx) {
    const t = theme();
    return props()?.overlay ? this.dialog(t, cx) : this.compact(t);
  }
}
