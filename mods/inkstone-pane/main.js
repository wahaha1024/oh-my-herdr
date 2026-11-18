// 自绘窗格头：程序图标、名称、目录、状态，以及分割 / 放大 / 关闭。
// 布局里用 { "pane": { "header": { "content": { "mod": "inkstone-pane" } } } } 挂上。
// 纸感主题（定义 theme().paper）下标题用墨字、目录用铅笔灰、底边是手绘铅笔线；
// 其他主题退回主题色。Props 由 app 传入：{ pane, terminal }。点击聚焦该窗格。

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout } from "herdr";

// 找第一个可见的 tab 帧（含 stack 里当前可见的那个），用来判断头在上还是在下。
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter((child) => !child.hidden);
    children = [visible.find((child) => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

const PAPER = (t) => Boolean(t.paper);
const ink = (t, slot, fallback) => (PAPER(t) ? t[slot] : (t[fallback] ?? t.foreground));

export default class Pane extends View {
  init() {
    this.hovered = false;
    this.over = null;
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  // 幽灵按钮：纸感下悬停是一道荧光笔。
  button(t, id, art, command, args) {
    const on = this.over === id;
    return div()
      .id(id)
      .size(22).flex().items_center().justify_center()
      .text_color(on ? ink(t, "ink", "foreground") : ink(t, "pencil", "muted"))
      .when(on, (el) =>
        PAPER(t)
          ? el.bg("#f8dc4c9e").rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9)
          : el.bg(t.hover).rounded(6))
      .on_hover((h, cx) => {
        this.over = h ? id : this.over === id ? null : this.over;
        cx.notify();
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/inkstone-pane/${art}.svg`).size(16));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 16, t.dim);
    const st = p.status;
    const pane = p.pane;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    const ruleLine = div()
      .absolute().left(0).right(0).h(2).overflow_hidden()
      .child(image("mods/inkstone-chrome/ink/rule-h.svg").absolute().left(-12).top(-12).w(3864).h(26));
    const needs = div()
      .relative().h(20).w(76).flex_none().flex().items_center().justify_center()
      .text_size(12).text_color(PAPER(t) ? t.seal : t.accent_foreground)
      .child(image("mods/inkstone-chrome/ink/badge-d-76.svg").absolute().left(-12).top(-12).w(100).h(44))
      .child(div().relative().pb(1).child("待你处理"));
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .relative()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .text_size(13)
      .on_hover((hovered, cx) => {
        this.hovered = hovered;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane }))
      .when(PAPER(t), (el) => el.child(bottom ? ruleLine.top(0) : ruleLine.bottom(0)))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(
        div()
          .flex_none().truncate().max_w(260).font_weight(700)
          .text_color(p.focused ? ink(t, "ink", "foreground") : PAPER(t) ? "#4a423b" : t.foreground)
          .child(name),
      )
      .child(div().flex_1().truncate().text_color(ink(t, "pencil", "muted")).child(folder(p.cwd)))
      .when(st === "working", (el) =>
        el.child(svg("mods/inkstone-chrome/spinner.svg").size(16).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", (el) => el.child(needs))
      .when(st === "done", (el) => el.child(svg("mods/inkstone-chrome/check.svg").size(16).flex_none().text_color(t.done)))
      .when(this.hovered, (el) =>
        el.child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
          .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
          .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
          .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
