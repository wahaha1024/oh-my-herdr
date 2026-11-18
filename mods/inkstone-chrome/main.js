// 侧栏的上下两块：顶部标题行（搜索 / 折叠侧栏）与底部入口（偏好 / 设置 / 加机器）。
// 纸感主题（定义 theme().paper）下，顶块画整张羊皮纸的上边缘、底块画下边缘、中间列表块画纸身，
// 三块合起来像一整页；其他主题退回纯 GPUI 几何。

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// 纸感只在定义了 paper 槽的主题下渲染：Looseleaf 的纸墨资产是硬编码浅色，不能读主题。
const PAPER = (t) => Boolean(t.paper);
const inkOf = (t, slot, fallback) => (PAPER(t) ? t[slot] : (t[fallback] ?? t.foreground));

const PAD = 5, TALL = 1600;
// 羊皮纸只有 144..400 的 17 档，绘制时按实际宽度拉伸（最大变形 8px，撕边看不出），档位取最近的一档，避免 404。
const PARCHMENT = [144, 160, 176, 192, 208, 224, 240, 256, 272, 288, 304, 320, 336, 352, 368, 384, 400];
const nearest = (w) => PARCHMENT.reduce((best, v) => (Math.abs(v - w) < Math.abs(best - w) ? v : best), PARCHMENT[0]);

// 一整张纸沿侧栏往下铺：这块画它的 part（top = 上边缘与两侧，mid = 只两侧，foot = 两侧与下边缘），
// 都是同一张 1600 高图的裁切，三块拼起来才是一页。
function sheet(view, part, content, extra = null) {
  const tone = theme().paper;
  const w = Math.max(1, view.sheetW ?? 240), h = Math.max(1, view.sheetH ?? 400);
  const W = nearest(w);
  const art = () => image(`mods/inkstone-chrome/ink/parchment-${W}.svg`).absolute().left(-PAD).w(w + 2 * PAD).h(TALL + 2 * PAD);
  const crop = part === "top" ? div().absolute().left(0).top(-PAD).w(w).h(h + PAD).overflow_hidden().child(art().top(0))
    : part === "foot" ? div().absolute().left(0).bottom(-PAD).w(w).h(h + PAD).overflow_hidden().child(art().bottom(0))
    : div().absolute().left(0).top(0).w(w).h(h).overflow_hidden().child(art().top(-520));
  return div().size_full().px(8)
    .when(part === "top", (el) => el.pt(20))
    .when(part === "foot", (el) => el.pb(6))
    .child(div().id(`${part}-sheet`).relative().size_full()
      .on_size_change((size, cx) => {
        if (Math.abs((view.sheetW ?? 0) - size.width) >= 1 || Math.abs((view.sheetH ?? 0) - size.height) >= 1) {
          view.sheetW = size.width;
          view.sheetH = size.height;
          cx.notify();
        }
      })
      .child(crop)
      // 内容层自己铺一层主题的纸色：图的毛边只露在四边 ±PAD 里当撕痕，
      // 否则三块各自取图的某一截，色阶不同会在接缝处露一条横带。
      .child(div().relative().size_full().when(Boolean(tone), (el) => el.bg(tone)).child(content))
      .when(Boolean(extra), (el) => el.child(extra(w))));
}

export default class WorkspaceChrome extends View {
  init() {
    this.hover = null;
  }

  // 墨线纸片按钮：纸上一张手绘方片，悬停换成描深一档的同一张（Looseleaf 的 ib 按钮）。
  slip(id, label, action, art = "a") {
    const t = theme();
    const lit = this.hover === id;
    return div().id(id).relative().size(28).flex_none().flex().items_center().justify_center().cursor_pointer()
      .text_color(lit ? inkOf(t, "ink", "foreground") : PAPER(t) ? "#4a423b" : t.muted)
      .on_hover((h, cx) => {
        this.hover = h ? id : this.hover === id ? null : this.hover;
        cx.notify();
      })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(action)
      .child(image(`mods/inkstone-chrome/ink/ib-${art}${lit ? "-on" : ""}.svg`).absolute().left(-12).top(-12).w(52).h(52))
      .child(div().relative().child(label));
  }

  button(id, label, action, tip) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip ?? id).accessibility_label(tip ?? id)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const paper = PAPER(t) && !collapsed;
    if (props()?.footer) {
      // 纸感页脚：一条铅笔线，下面是幽灵按钮；rail 模式不画纸，保留图标列。
      const row = (id, icon, label, dim, action, tip = label) => h_flex().id(id)
        .h(collapsed ? 19 : paper ? 30 : 32).px(collapsed ? 0 : paper ? 8 : 10).gap(paper ? 8 : 10).flex_none().items_center()
        .when(collapsed, el => el.w(32).justify_center())
        .tooltip(tip)
        .accessibility_label(tip)
        .cursor_pointer()
        .text_color(dim ? t.dim : inkOf(t, "pencil", "muted"))
        .when(paper, el => el
          .rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9)
          .hover(s => s.bg("#f8dc4c4d").text_color("#2a2420")))
        .when(!paper, el => el
          .rounded(8)
          .hover(s => s.bg(t.hover).text_color(t.foreground)))
        .on_click(action)
        .child(svg(`mods/inkstone-chrome/${icon}.svg`).size(paper ? 15 : 14))
        .when(!collapsed, el => el.child(div().text_size(paper ? 12.5 : 13).child(label)));
      const ready = div().size(6).rounded_full().bg(t.accent);
      const rows = v_flex().size_full().gap(paper ? 1 : 2).justify_end()
        .when(collapsed, el => el.items_center())
        .child(row("prefs", "layers", "OMH 偏好", false, () => run("mod.open", { name: "inkstone-settings" }), "OMH 布局偏好 · 主题 / 右键 / 状态栏 / 面板"))
        .child(row("settings", "settings", "Herdr 设置", false, () => run("app.settings"), "Herdr 全局设置 · 字体 / 缩放 / 快捷键")
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
        .child(row("machine", "plus", "添加机器", true, () => run("mod.open", { name: "machine-add" }), "添加远程机器"));
      if (paper) {
        return sheet(this, "foot", v_flex().size_full()
          .child(div().relative().h(2).mx(6).flex_none().overflow_hidden()
            .child(image("mods/inkstone-chrome/ink/rule-h.svg").absolute().left(-12).top(-12).w(3864).h(26)))
          .child(rows));
      }
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(8).pb(8).gap(2).text_size(13)
        .when(collapsed, el => el.px(0).items_center())
        .child(rows.items_start().justify_end());
    }
    // 标题行：纸感下是整页的上边缘，rail / 其他主题下是纯色条。
    const head = h_flex().size_full().pl(paper ? 4 : collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center()
        .child(div().font_weight(700).text_size(14).text_color(inkOf(t, "ink", "foreground")).child("Oh My Herdr"))))
      .when(!collapsed && paper, el => el
        .child(this.slip("search", svg("mods/inkstone-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }), "a"))
        .child(this.slip("sidebar-toggle", svg("mods/inkstone-chrome/sidebar.svg").size(15), toggleSidebar, "b")))
      .when(!collapsed && !paper, el => el
        .child(this.button("search", svg("mods/inkstone-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }), "搜索")))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!collapsed && !paper && !(window()?.platform === "macos"), el => el
        .child(this.button("sidebar-toggle", svg("mods/inkstone-chrome/sidebar.svg").size(15), toggleSidebar, "折叠侧栏")));
    if (paper) return sheet(this, "top", head);
    return head.bg(t.chrome);
  }
}
