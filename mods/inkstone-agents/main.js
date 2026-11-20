// Oh My Herdr 智能体栏：Needs you / In flight / Done 三段，占侧栏的一半，与 Spaces 同级。
// 从 inkstone-workbench 拆出：workbench 只画空间树，这里只画智能体；两边的分区头、卡片、
// 状态标记用同一套语汇（像素状态点、空间色 chip、相对时间）。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, agents, run, hc, checking, theme, shared, setShared, layout } from "herdr";

// 侧栏缩到 44px（图标轨）时只画计数与展开按钮：文字放不下，硬画会溢出到终端区。
function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}
const rail = () => (findNode(layout(), "sidebar")?.size?.px ?? 999) < 160;

const STATUS = { blocked: "待处理", working: "运行中", done: "已完成", idle: "空闲" };
const statusLabel = (s) => STATUS[s] ?? "无状态";

const PALETTE_LIGHT = ["#a84a50", "#8a5619", "#7d640c", "#357041", "#34618f", "#5f5399", "#805083"];
const PALETTE_DARK = ["#f08a8a", "#f2a46a", "#e8c76a", "#7ecf86", "#6fb3ea", "#9a8ce6", "#c98ae6"];

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function tint(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  return m ? `#${m[1]}${alpha}` : hex;
}

const PAPER = (t) => Boolean(t.paper);
const inkOf = (t, slot, fallback) => (PAPER(t) ? t[slot] : (t[fallback] ?? t.foreground));
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

// 独立纸边卡片：与 Spaces / 主终端区一致的四周 12px 撕纸毛边 + 内侧青瓷细框。
function paperCard(view, t, content) {
  const dir = artEdgeDir(t);
  const line = tint(t.accent, "99");
  if (!dir) {
    return div().size_full().min_h(0).pl(6).pr(4).pt(1).pb(2)
      .child(div().size_full().min_h(0).overflow_hidden().rounded(8).border(1).border_color(line).child(content));
  }
  const w = Math.max(120, view._cardW ?? 278);
  const h = Math.max(80, view._cardH ?? 320);
  const EDGE_TOP = 8;
  const sideH = Math.max(0, h - EDGE_TOP - EDGE_T);
  const art = (name, iw, ih) => image(`mods/inkstone-edge/${dir}/${name}.svg`).absolute().w(iw).h(ih);
  const hEdge = (side) => {
    const eh = side === "top" ? EDGE_TOP : EDGE_T;
    const yEdge = (el) => (side === "top" ? el.bottom(0) : el.top(0));
    return div().relative().w_full().h(eh).flex_none().overflow_hidden()
      .child(div().absolute().left(0).top(0).w(Math.max(0, w - EDGE_CORNER)).h(eh).overflow_hidden().child(yEdge(art(`${side}-l`, EDGE_LONG, EDGE_T).left(0))))
      .child(div().absolute().right(0).top(0).w(Math.min(w, EDGE_CORNER)).h(eh).overflow_hidden().child(yEdge(art(`${side}-r`, EDGE_CORNER, EDGE_T).right(0))));
  };
  const vEdge = (side) => div().relative().w(EDGE_T).h_full().flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(EDGE_T).h(Math.max(0, sideH - EDGE_FOOT)).overflow_hidden().child(art(`${side}-t`, EDGE_T, EDGE_TALL).left(0).top(0)))
    .child(div().absolute().left(0).bottom(0).w(EDGE_T).h(Math.min(sideH, EDGE_FOOT)).overflow_hidden().child(art(`${side}-b`, EDGE_T, EDGE_FOOT).left(0).bottom(0)));
  return div().size_full().min_h(0).pl(4).pr(2)
    .child(v_flex().id("ag-card").size_full().min_h(0)
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
      .child(hEdge("bottom")));
}
// 标题里混着 ANSI、变体选择符、零宽与 emoji：剥掉再把空白压成单空格。
function clean(text) {
  if (text == null) return "";
  return String(text)
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\uFE00-\uFE0F\u200B-\u200F\u2028\u2029]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Needs you 用主题红，In flight 用琥珀黄，Done 用绿；兼顾青瓷/宣纸/玄墨对比度，一眼分清三段状态。
const isDark = (t) => luminance(t.background ?? "#ffffff") < 0.5;
const FLOW_RED = (t) => t.blocked ?? "#c23142";
const FLOW_YELLOW = (t) => (PAPER(t) ? t.working : isDark(t) ? (t.working ?? "#e2c027") : "#b78b26");
const FLOW_GREEN = (t) => (PAPER(t) ? (t.up ?? t.done) : (t.done ?? "#1a6840"));

function ago(ms, now) {
  if (!ms) return "";
  const d = Math.max(0, now - ms);
  if (d < 60000) return "刚刚";
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  return `${Math.floor(d / 86400000)}d`;
}

// 这个智能体的标签从什么时候起在变：优先「开始干活」的时间，否则最后一次状态变化。
function sinceOf(a) {
  const tb = spaces().find((s) => s.id === a.space)?.tabs?.find((x) => x.id === a.tab);
  return tb?.working_since ?? tb?.changed_at ?? null;
}

function progIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint
    ? svg(p.icon).size(size).flex_none().text_color(color)
    : image(p.icon).w(size).h(size).flex_none();
}

// 卡住的智能体在问什么：hc read 取屏幕最后一条像问句的行；抓不到就留空。
const looksSentence = (l) => /\p{Script=Han}/u.test(l) || l.split(/\s+/).length >= 5;
const looksCode = (l) => /[;{}<>]|=>|`|\breturn\b|\bconst\b|\bfunction\b|\bimport\b/.test(l);

async function askedText(address) {
  const r = await hc(["read", address]);
  if (r.code !== 0 || !r.stdout) return "";
  const lines = r.stdout.split("\n")
    .map((l) => l
      .replace(/^\s*\d+\s*[│┃|╎]\s*/u, "")
      .replace(/^[\s│┃╭╰╮╯─━❯›>⎿⏺●•◆□☐✳*]+/u, "")
      .replace(/[\s│┃╭╰╮╯─━]+$/u, "")
      .trim())
    .reverse();
  const q = lines.find((l) =>
    l.length >= 10
    && /\p{L}/u.test(l)
    && /[?？](\s|\)|。|$)/u.test(l)
    && looksSentence(l)
    && !looksCode(l)
    && !l.startsWith("?")
    && !/tok\/s|shortcuts/i.test(l));
  if (!q) return "";
  return q.length > 160 ? `${q.slice(0, 159)}…` : q;
}

// 状态标记：在跑转圈、已完成打勾、空闲空心圈。
function mark(a, t, accent) {
  if (a.status === "done") return svg("mods/inkstone-chrome/circle-check.svg").size(12).flex_none().text_color(accent);
  if (a.status === "working") return svg("mods/inkstone-chrome/spinner.svg").size(12).flex_none().text_color(accent).spin(900);
  return div().size(12).flex_none().flex().items_center().justify_center().child(div().size(7).rounded_full().border(1).border_color(accent));
}

export default class AgentsPanel extends View {
  init(_props, cx) {
    this.scroll = ScrollHandle.new();
    this.now = Date.now();
    this.asking = false;
    this.colorsCache = null;
    cx.timer.every(30000, (cx) => {
      this.now = Date.now();
      cx.notify();
    });
    cx.timer.every(5000, (cx) => this.pollAsks(cx));
  }

  // 空间配色：只存调色板序号，和 workbench 共用同一份 shared 数据。
  colors() {
    const kept = { ...(shared("inkstone.spaceColors") ?? {}) };
    const list = spaces();
    const ids = new Set(list.map((s) => s.id));
    let changed = false;
    for (const id of Object.keys(kept)) {
      if (!ids.has(id) || !Number.isInteger(kept[id])) {
        delete kept[id];
        changed = true;
      }
    }
    const used = new Set(Object.values(kept));
    for (const s of list) {
      if (Number.isInteger(kept[s.id])) continue;
      let next = 0;
      while (used.has(next) && next < 6) next += 1;
      kept[s.id] = next;
      used.add(next);
      changed = true;
    }
    if (changed) setShared("inkstone.spaceColors", kept);
    return kept;
  }

  fill(t, i) {
    const light = luminance(t.background ?? "#ffffff") > 0.5;
    return (light ? PALETTE_LIGHT : PALETTE_DARK)[i % 7] ?? t.accent;
  }

  openAgent(a) {
    const sp = spaces().find((s) => s.id === a.space);
    if (sp && !sp.active) run("space.select", { id: a.space });
    const tb = sp?.tabs?.find((x) => x.id === a.tab);
    if (tb && !tb.active) run("tab.select", { id: a.tab });
    run("agent.focus", { terminal: a.address });
  }

  toggleFlow(key, cx) {
    const open = { needs: true, flight: true, done: true, ...(shared("inkstone.flow.open") ?? {}) };
    open[key] = !open[key];
    setShared("inkstone.flow.open", open);
    cx.notify();
  }

  // 分区头：箭头 + 标题 + 计数。三段共用，颜色只留在计数 pill 上。
  head(key, label, n, color, t, open, cx) {
    return h_flex()
      .id(`ia-head-${key}`)
      .h(28)
      .flex_none()
      .px(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(PAPER(t) ? "#f8dc4c26" : t.hover))
      .tooltip(open ? `收起 ${label}` : `展开 ${label}`)
      .accessibility_label(`${label} ${n}`)
      .on_click(() => this.toggleFlow(key, cx))
      .child(svg(open ? "mods/inkstone-chrome/chevron-down.svg" : "mods/inkstone-chrome/chevron-right.svg").size(10).flex_none().text_color(t.dim))
      .child(div().flex_none().text_size(PAPER(t) ? 13 : 14).line_height(PAPER(t) ? "15px" : "16px").font_bold().text_color(color).child(label))
      .when(n > 0, (el) => el.child(div().flex_none().px(5).rounded(8).bg(tint(color, isDark(t) ? "2e" : "20")).text_size(10.5).font_semibold().text_color(color).child(String(n))))
      .child(div().flex_1());
  }

  empty(label, t) {
    return div().h(20).px(14).flex_none().flex().items_center().text_size(11).text_color(t.dim).child(label);
  }

  spaceChip(name, id, t, colors) {
    const c = this.fill(t, colors[id] ?? 0);
    return div().flex_none().max_w(96).truncate().px(5).py(1).rounded(3)
      .bg(tint(c, PAPER(t) ? "1f" : "26"))
      .text_size(11)
      .text_color(c)
      .child(name);
  }

  // 等你处理（红区）：卡住的智能体一张醒目红卡——卡在哪、哪个空间、卡了多久、在问什么。
  askCard(a, t, asks, colors) {
    const name = clean(a.title) || a.program?.name || a.app || a.address;
    const space = clean(a.space_name) || a.address;
    const q = asks[a.address] ?? "";
    const icon = progIcon(a.program, 12, t.muted);
    const accent = FLOW_RED(t);
    const dark = isDark(t);
    const bgIdle = tint(accent, a.focused ? (dark ? "38" : "28") : (dark ? "24" : "18"));
    const bgHover = tint(accent, dark ? "32" : "24");
    const bd = tint(accent, a.focused ? "aa" : (dark ? "70" : "58"));
    return v_flex()
      .id(`ia-ask-${a.address}`)
      .flex_none()
      .mx(2)
      .mb(4)
      .px(8)
      .py(6)
      .gap(3)
      .rounded(7)
      .bg(bgIdle)
      .border(1)
      .border_color(bd)
      .cursor_pointer()
      .hover((s) => s.bg(bgHover).border_color(tint(accent, "88")))
      .tooltip(q ? `${name}\n${q}` : name)
      .accessibility_label(`${name} 待处理`)
      .on_click(() => this.openAgent(a))
      .child(h_flex()
        .gap(6)
        .items_center()
        .child(div().size(7).flex_none().rounded_full().bg(accent).loop("opacity", { from: 0.35, to: 1, period: 900 }))
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_weight(600).text_color(inkOf(t, "ink", "foreground")).child(name))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(ago(sinceOf(a), this.now))))
      .child(h_flex()
        .pl(13)
        .gap(6)
        .items_center()
        .when(Boolean(icon), (el) => el.child(icon))
        .child(this.spaceChip(space, a.space, t, colors))
        .child(div().flex_none().text_size(11).font_weight(600).text_color(accent).child("asks you"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(a.program?.name ?? a.app ?? "")))
      .when(Boolean(q), (el) => el.child(div().pl(13).text_size(11).text_color(inkOf(t, "pencil", "muted")).truncate().child(q)));
  }

  // 进行中（黄区）与已完成（绿区）共用的一行：每行自带对应状态浅色底与细框，聚焦加深。
  row(a, t, colors, accent = FLOW_YELLOW(t), word = "running", tintTone = accent) {
    const name = clean(a.title) || a.program?.name || a.app || a.address;
    const space = clean(a.space_name) || a.address;
    const icon = progIcon(a.program, 12, t.muted);
    const dark = isDark(t);
    const bgIdle = tint(tintTone, a.focused ? (dark ? "36" : "28") : (dark ? "22" : "18"));
    const bgHover = tint(tintTone, dark ? "30" : "24");
    const bd = tint(tintTone, a.focused ? "aa" : (dark ? "66" : "4d"));
    return v_flex()
      .id(`ia-row-${a.address}`)
      .flex_none()
      .mx(2)
      .mb(3)
      .px(8)
      .py(5)
      .gap(2)
      .rounded(7)
      .bg(bgIdle)
      .border(1)
      .border_color(bd)
      .cursor_pointer()
      .hover((s) => s.bg(bgHover).border_color(tint(tintTone, "88")))
      .tooltip(`${name}\n${statusLabel(a.status)} · ${a.tab_name ?? ""} · ${a.address}`)
      .accessibility_label(`${name} ${word}`)
      .on_click(() => this.openAgent(a))
      .child(h_flex()
        .gap(6)
        .items_center()
        .child(mark(a, t, accent))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().text_color(t.foreground).child(name))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(ago(sinceOf(a), this.now))))
      .child(h_flex()
        .pl(18)
        .gap(6)
        .items_center()
        .when(Boolean(icon), (el) => el.child(icon))
        .child(this.spaceChip(space, a.space, t, colors))
        .child(div().flex_none().text_size(11).font_medium().text_color(accent).child(word))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(a.program?.name ?? a.app ?? "")));
  }
  pollAsks(cx) {
    if (checking()) return;
    const blocked = agents().filter((a) => a.status === "blocked").map((a) => a.address);
    const stored = shared("inkstone.asks") ?? {};
    if (!blocked.length) {
      if (Object.keys(stored).length) setShared("inkstone.asks", {});
      return;
    }
    if (this.asking) return;
    this.asking = true;
    cx.spawn(async () => {
      const next = {};
      for (const address of blocked) {
        try {
          next[address] = await askedText(address);
        } catch {
          next[address] = "";
        }
      }
      this.asking = false;
      if (JSON.stringify(next) !== JSON.stringify(stored)) setShared("inkstone.asks", next);
    });
  }

  // 图标轨：只留一条展开按钮 + 三段的计数点，文字一个不画。
  railView(t, needs, flight, done) {
    const pill = (n, color) => h_flex()
      .h(20)
      .w(24)
      .flex_none()
      .justify_center()
      .items_center()
      .gap(3)
      .child(div().size(6).rounded_full().bg(color))
      .when(n > 0, (el) => el.child(div().text_size(10).text_color(t.muted).child(String(n))));
    return v_flex()
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .items_center()
      .py(4)
      .gap(3)
      .bg(PAPER(t) ? (t.paper ?? t.chrome) : t.chrome)
      .child(div()
        .id("ia-unfold")
        .size(24)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("展开侧栏")
        .accessibility_label("展开侧栏")
        .on_click(() => {
          setShared("sidebar.collapsed", false);
          run("layout.resize", { id: "sidebar", px: shared("sidebar.width") ?? 284 });
        })
        .child(svg("mods/inkstone-chrome/chevron-right.svg").size(14)))
      .child(pill(needs, FLOW_RED(t)))
      .child(pill(flight, FLOW_YELLOW(t)))
      .child(pill(done, FLOW_GREEN(t)));
  }

  render(cx) {
    const t = theme();
    const list = agents();
    const colors = this.colors();
    const asks = shared("inkstone.asks") ?? {};
    const open = shared("inkstone.flow.open") ?? {};
    const waiting = list.filter((a) => a.status === "blocked").sort((a, b) => b.seq - a.seq);
    const running = list.filter((a) => a.status === "working").sort((a, b) => b.seq - a.seq);
    const done = list.filter((a) => a.status === "done" || a.status === "idle").sort((a, b) => b.seq - a.seq);
    const rows = [];

    if (rail()) return this.railView(t, waiting.length, running.length, done.length);

    const showNeeds = open.needs !== false;
    rows.push(this.head("needs", "Needs you", waiting.length, FLOW_RED(t), t, showNeeds, cx));
    if (showNeeds) {
      if (!waiting.length) rows.push(this.empty("all clear", t));
      else for (const a of waiting) rows.push(this.askCard(a, t, asks, colors));
    }
    const showFlight = open.flight !== false;
    rows.push(this.head("flight", "In flight", running.length, FLOW_YELLOW(t), t, showFlight, cx));
    if (showFlight) {
      if (!running.length) rows.push(this.empty("nothing running", t));
      else for (const a of running) rows.push(this.row(a, t, colors, FLOW_YELLOW(t), "running", FLOW_YELLOW(t)));
    }
    const showDone = open.done !== false;
    const green = FLOW_GREEN(t);
    rows.push(this.head("done", "Done", done.length, green, t, showDone, cx));
    if (showDone) {
      if (!done.length) rows.push(this.empty("nothing yet", t));
      else for (const a of done) {
        const finished = a.status === "done";
        rows.push(this.row(a, t, colors, finished ? green : t.dim, finished ? "done" : "idle", green));
      }
    }

    const inner = v_flex()
      .size_full()
      .min_h(0)
      .h_full()
      .overflow_hidden()
      .bg(t.paper ?? t.background)
      .text_size(13)
      .child(h_flex()
        .h(40)
        .pl(12)
        .pr(10)
        .mb(2)
        .items_center()
        .justify_between()
        .border_b(1)
        .border_color(tint(t.border, "77"))
        .child(div()
          .text_size(PAPER(t) ? 15.5 : 17)
          .line_height("18px")
          .font_bold()
          .text_color(inkOf(t, "ink", "foreground"))
          .child("Agents"))
        .child(h_flex()
          .gap(6)
          .items_center()
          .when(waiting.length > 0, (el) => el.child(h_flex()
            .h(18)
            .px(6)
            .gap(4)
            .items_center()
            .rounded(5)
            .bg(tint(t.blocked, "18"))
            .border(1)
            .border_color(tint(t.blocked, "44"))
            .child(div().size(5).rounded_full().bg(t.blocked))
            .child(div().text_size(10.5).font_semibold().text_color(t.blocked).child(String(waiting.length)))))
          .child(h_flex()
            .h(18)
            .px(7)
            .gap(4)
            .items_center()
            .rounded(5)
            .bg(t.raised)
            .border(1)
            .border_color(t.border)
            .child(div().size(5).rounded_full().bg(list.length ? t.accent : t.dim))
            .child(div().text_size(10.5).text_color(t.muted).child(`${list.length}`)))))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(8)
        .pb(6)
        .gap(1)
        .overflow_y_scrollbar()
        .mode("always")
        .track_scroll(this.scroll)
        .children(rows));
    return paperCard(this, t, inner);
  }
}
