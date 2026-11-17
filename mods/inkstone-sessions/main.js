// OMP 会话：列本机的 omp 会话，点一条在它原来的目录里 `omp --resume <id>`。
// 思路来自 Lamb-Yang/herdr-sessions 的 hs-sessions，但数据源换成 OMP：
// 会话文件是 ~/.omp/agent/sessions/<编码目录>/<时间戳>_<uuid>.jsonl，
// 第一行是 title，第二行是 {id, timestamp, cwd, title}，直接读这两个字段即可，
// 不依赖 python 之外的东西（python 只用来批量读文件头，缺失时面板给出提示）。

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, run, theme, spaces, notify, terminals } from "herdr";

const MAX = 80;

// 一次读所有会话文件的前两行；ensure_ascii 让输出全 ASCII，避开 Windows 控制台编码。
const SCAN = [
  "import glob,json,os",
  'b=os.path.expanduser("~/.omp/agent/sessions")',
  "o=[]",
  'for p in glob.glob(os.path.join(b,"*","*.jsonl")):',
  "    try:",
  '        f=open(p,encoding="utf-8")',
  "        f.readline()",
  "        s=json.loads(f.readline())",
  "        f.close()",
  "    except Exception:",
  "        continue",
  '    o.append({"id":s.get("id") or "","t":s.get("title") or "","cwd":s.get("cwd") or "","ts":s.get("timestamp") or "","m":int(os.path.getmtime(p))})',
  'o.sort(key=lambda x:x["m"],reverse=True)',
  "print(json.dumps(o[:" + MAX + "]))",
].join("\n");

const ago = (sec) => {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 60) return "刚刚";
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} 天前`;
  return new Date(sec * 1000).toLocaleDateString("zh-CN");
};
const base = (p) => String(p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
const norm = (p) => String(p ?? "").replace(/[\\/]+$/, "").toLowerCase();

export default class Sessions extends View {
  init(_p, cx) {
    this.list = [];
    this.loading = true;
    this.failed = false;
    this.all = false;
    this.bin = "omp";
    this.detect();
    this.reload(cx);
    cx.timer.every(60000, (cx) => this.reload(cx));
  }

  detect() {
    exec("where", ["omp"], { timeout: 5000 })
      .then((r) => {
        const line = String(r?.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
        if (line) this.bin = line;
      })
      .catch(() => {});
  }

  reload(cx) {
    exec("python", ["-c", SCAN], { timeout: 20000 })
      .then((r) => {
        if (r?.code !== 0) {
          this.list = [];
          this.failed = true;
          return;
        }
        const text = String(r?.stdout ?? "").trim();
        this.list = text ? JSON.parse(text) : [];
        this.failed = false;
      })
      .catch(() => {
        this.failed = true;
      })
      .finally(() => {
        this.loading = false;
        cx.notify();
      });
  }

  // 这个会话是不是已经开在某个终端里。omp 把会话标题写进了终端标题（OSC 0/2），
  // 所以按标题认；认出来就切过去，别再 `omp --resume` 一遍——新进程会把整段历史重新渲染。
  live(s) {
    const head = String(s.t ?? "").trim().slice(0, 24);
    if (head.length < 4) return null;
    const cwd = norm(s.cwd);
    // 同一标题可能有几条记录（恢复过一次就会多一条），终端标题分不出新旧：
    // 只认最新的那条，别给旧记录也盖上「已打开」。
    const twins = this.list.filter((o) => norm(o.cwd) === cwd && String(o.t ?? "").trim().slice(0, 24) === head);
    if (twins.length > 1 && twins[0] !== s) return null;
    return terminals().find((x) => {
      if (!String(x.title ?? "").includes(head)) return false;
      return !cwd || !x.cwd || norm(x.cwd) === cwd;
    });
  }

  resume(s) {
    const up = this.live(s);
    if (up) {
      const labels = Array.isArray(up.labels)
        ? up.labels
        : Object.entries(up.labels ?? {}).map(([k, v]) => `${k}=${v}`);
      const label = (k) => {
        const hit = labels.find((l) => String(l).startsWith(`${k}=`));
        return hit ? String(hit).slice(k.length + 1) : null;
      };
      const space = label("herdr.space");
      const tab = label("herdr.tab");
      if (space && !spaces().find((z) => z.id === space)?.active) run("space.select", { id: space });
      if (tab) run("tab.select", { id: tab });
      if (up.address) run("pane.focus", { terminal: up.address });
      notify({ title: "会话已经开着", body: "切过去，不重新加载历史", level: "info" });
      return;
    }
    const args = { argv: [this.bin, "--resume", s.id], place: "tab" };
    if (s.cwd) args.folder = s.cwd;
    run("terminal.open", args);
    notify({ title: "正在恢复会话", body: s.t || s.id, level: "info" });
  }

  shown() {
    const all = this.list;
    if (this.all) return all;
    const here = norm(spaces().find((s) => s.active)?.folder);
    if (!here) return all;
    const hit = all.filter((s) => {
      const c = norm(s.cwd);
      return c && (c === here || c.startsWith(here + "\\") || c.startsWith(here + "/"));
    });
    return hit.length ? hit : all;
  }

  row(s, i, t) {
    return h_flex()
      .id(`ses-${i}`)
      .h(44)
      .flex_none()
      .px(8)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((h) => h.bg(t.hover))
      .tooltip(this.live(s)
        ? `${s.cwd || "?"}\n这个会话正开着：点一下切过去，不重新加载`
        : `${s.cwd || "?"}\n点一下：omp --resume ${String(s.id).slice(0, 8)}`)
      .on_click(() => this.resume(s))
      .child(div().size(22).flex_none().flex().items_center().justify_center().rounded(5).bg(t.raised)
        .child(svg("mods/inkstone-chrome/terminal.svg").size(12).flex_none().text_color(t.accent)))
      .child(v_flex()
        .flex_1()
        .min_w(0)
        .gap(0)
        .child(div().w_full().truncate().text_size(12).child(s.t || String(s.id).slice(0, 8)))
        .child(div().w_full().truncate().text_size(11).text_color(t.dim)
          .child(`${ago(s.m)} · ${base(s.cwd) || "?"}`)))
      .when(this.live(s), (el) => el.child(div()
        .flex_none()
        .px(5)
        .py(1)
        .rounded(4)
        .bg(t.raised)
        .text_size(9)
        .text_color(t.done)
        .child("已打开")));
  }

  render(_cx) {
    const t = theme();
    const list = this.shown();
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .child(h_flex()
        .h(34)
        .flex_none()
        .px(12)
        .gap(7)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(svg("mods/inkstone-chrome/terminal.svg").size(13).flex_none().text_color(t.accent))
        .child(div().text_size(12).font_semibold().child("OMP 会话"))
        .child(div().text_size(11).text_color(t.dim).child(String(list.length)))
        .child(div().flex_1())
        .child(h_flex()
          .id("ses-scope")
          .px(7)
          .py(3)
          .rounded(5)
          .text_size(11)
          .text_color(this.all ? t.muted : t.accent)
          .cursor_pointer()
          .tooltip(this.all ? "现在显示全部会话，点一下只看当前目录" : "只看当前空间的目录，点一下显示全部")
          .accessibility_label("切换会话范围")
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            this.all = !this.all;
            cx.notify();
          })
          .child(this.all ? "全部" : "当前目录"))
        .child(div()
          .id("ses-reload")
          .px(6)
          .py(2)
          .rounded(5)
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .tooltip("重新扫描")
          .accessibility_label("重新扫描会话")
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.reload(cx))
          .child("刷新")))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(6)
        .py(6)
        .gap(1)
        .overflow_y_scrollbar()
        .children(list.length
          ? list.map((s, i) => this.row(s, i, t))
          : [div().p(8).text_size(12).text_color(this.failed ? t.blocked : t.dim)
            .child(this.failed
              ? "读取会话失败：需要 python 在 PATH 里。"
              : this.loading ? "正在扫描会话…" : "这个目录还没有 omp 会话记录。")]));
  }
}

function here() {
  return spaces().find((s) => s.active)?.folder ?? "";
}
