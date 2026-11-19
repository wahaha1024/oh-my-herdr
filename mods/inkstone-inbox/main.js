// 待处理：状态栏一个计数，点开是「正在等你的智能体」列表（阻塞优先，其次已完成）。
// 思路来自 Hon-Lu/herdr-huntaway 的 huntaway-inbox；不搬它的悬浮铃铛，
// 改成状态栏一行文字 + 居中弹窗，和 inkstone 的状态栏其余块一致。
// 不存任何状态：Herdr 在你查看后会把 done 变 idle、blocked 变别的，行会自己消失。

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, run, theme, themes, props, closeOverlay, openOverlay } from "herdr";

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
  const key = t.background ?? "";
  if (key !== edgeCacheKey) {
    edgeCacheKey = key;
    const p = EDGE_PRESETS.find((x) => x.bg === key);
    if (!p) { edgeCacheDir = null; return null; }
    const cur = themes().find((x) => x.colors?.background === key);
    edgeCacheDir = cur?.colors?.muted === p.muted ? p.dir : null;
  }
  return edgeCacheDir;
}
function paperCard(view, t, content) {
  const dir = artEdgeDir(t);
  const line = tint(t.accent, "cc");
  if (!dir) return content.rounded(8).border(1).border_color(line);
  const w = Math.max(200, view._cardW ?? 424);
  const h = Math.max(160, view._cardH ?? 344);
  const sideH = Math.max(0, h - 2 * EDGE_T);
  const art = (name, iw, ih) => image(`mods/inkstone-edge/${dir}/${name}.svg`).absolute().w(iw).h(ih);
  const hEdge = (side) => div().relative().w_full().h(EDGE_T).flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(Math.max(0, w - EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-l`, EDGE_LONG, EDGE_T).left(0).top(0)))
    .child(div().absolute().right(0).top(0).w(Math.min(w, EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-r`, EDGE_CORNER, EDGE_T).right(0).top(0)));
  const vEdge = (side) => div().relative().w(EDGE_T).h_full().flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(EDGE_T).h(Math.max(0, sideH - EDGE_FOOT)).overflow_hidden().child(art(`${side}-t`, EDGE_T, EDGE_TALL).left(0).top(0)))
    .child(div().absolute().left(0).bottom(0).w(EDGE_T).h(Math.min(sideH, EDGE_FOOT)).overflow_hidden().child(art(`${side}-b`, EDGE_T, EDGE_FOOT).left(0).bottom(0)));
  return v_flex().id("inbox-card").size_full().min_h(0)
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
const RANK = { blocked: 2, done: 1 };
const LABEL = { blocked: "等你决定", done: "已完成", working: "运行中", idle: "空闲" };

const waiting = () => agents()
  .filter((a) => RANK[a.status])
  .sort((a, b) => RANK[b.status] - RANK[a.status] || b.seq - a.seq);

const nameOf = (a) => String(a.title || a.program?.name || a.app || a.address || "").trim() || a.address;

// 形状 + 颜色双编码：阻塞是方块，已完成是实心圆，空闲是空心圆。
function dot(t, status, size = 7) {
  const base = div().size(size).flex_none();
  if (status === "blocked") return base.rounded(1).bg(t.blocked);
  if (status === "done") return base.rounded_full().bg(t.done);
  if (status === "working") return base.rounded_full().border(2).border_color(t.working);
  return base.rounded_full().border(1.5).border_color(t.dim);
}

export default class Inbox extends View {
  init(_p, cx) {
    cx.timer.every(5000, (cx) => cx.notify());
  }

  jump(a) {
    if (a?.pane) run("pane.focus", { pane: a.pane });
    closeOverlay(props()?.overlay);
  }

  compact(t) {
    const list = waiting();
    const urgent = list.some((a) => a.status === "blocked");
    return h_flex()
      .id("inbox-compact")
      .size_full()
      .px(8)
      .gap(5)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(list.length ? `${list.length} 个智能体在等你 · 点开看是哪些` : "没有智能体在等你")
      .accessibility_label("待处理列表")
      .on_click(() => openOverlay({ mod: "inkstone-inbox", kind: "dialog", frame: "none", width: 424, height: 344, props: { framed: true } }))
      .child(dot(t, urgent ? "blocked" : list.length ? "done" : "idle"))
      .child(div()
        .text_size(11)
        .whitespace_nowrap()
        .text_color(!list.length ? t.dim : urgent ? t.blocked : t.done)
        .child(list.length ? `待 ${list.length}` : "无待办"));
  }

  row(a, i, t) {
    return h_flex()
      .id(`inbox-${i}`)
      .h(42)
      .flex_none()
      .px(10)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(`${a.address} · ${a.space_name} / ${a.tab_name}`)
      .on_click(() => this.jump(a))
      .child(dot(t, a.status, 8))
      .child(v_flex()
        .flex_1()
        .min_w(0)
        .gap(0)
        .child(div().w_full().truncate().text_size(12).child(nameOf(a)))
        .child(div().w_full().truncate().text_size(11).text_color(t.dim)
          .child(`${LABEL[a.status] ?? a.status} · ${a.space_name} / ${a.tab_name}`)))
      .child(svg("mods/inkstone-chrome/chevron-right.svg").size(12).flex_none().text_color(t.dim));
  }

  popup(t) {
    const list = waiting();
    const inner = v_flex()
      .size_full()
      .min_h(0)
      .bg(t.paper ?? t.background)
      .child(h_flex()
        .h(34)
        .flex_none()
        .px(13)
        .gap(8)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(dot(t, list.some((a) => a.status === "blocked") ? "blocked" : "done"))
        .child(div().flex_1().text_size(13).font_semibold().child("待处理"))
        .child(div().text_size(11).text_color(t.dim).child(list.length ? `${list.length} 个` : "全部处理完了"))
        .child(div()
          .id("inbox-close")
          .px(6)
          .py(2)
          .rounded(5)
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props()?.overlay))
          .child("Esc")))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(6)
        .py(6)
        .gap(1)
        .overflow_y_scrollbar()
        .children(list.length
          ? list.map((a, i) => this.row(a, i, t))
          : [div().p(10).text_size(12).text_color(t.dim).child("没有智能体在等你。")]));
    return props()?.framed ? paperCard(this, t, inner) : inner;
  }

  render(_cx) {
    const t = theme();
    return props()?.overlay ? this.popup(t) : this.compact(t);
  }
}
