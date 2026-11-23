// 侧栏的上下两块：顶部标题行（搜索 / 折叠侧栏）与底部入口（偏好 / 设置 / 加机器）。
// 展开时透明落在侧栏的 canvas 桌面上，把完整的独立纸边卡片空间让给中间的 Spaces 与 Agents。
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, openOverlay } from "herdr";

// 中英切换：shared 改动会让所有 mod 重绘，切换语言立即生效。
const LANG = "inkstone.lang";
const pick = (zh, en) => (shared(LANG) === "en" ? en : zh);

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
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 284) : window()?.platform === "macos" ? 76 : 44 });
}

// 纸感只在定义了 paper 槽的主题下渲染：Looseleaf 的纸墨资产是硬编码浅色，不能读主题。
const PAPER = (t) => Boolean(t.paper);
const inkOf = (t, slot, fallback) => (PAPER(t) ? t[slot] : (t[fallback] ?? t.foreground));


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
      // 展开时一行横排三按钮，省出垂直空间给 Spaces 和 Agents；rail 模式保留紧凑竖排三图标。
      const ready = div().size(5).rounded_full().bg(t.accent);
      const item = (id, icon, label, dim, action, tip, badge = false) => h_flex().id(id)
        .when(collapsed, (el) => el.w(30).h(12).justify_center().rounded(4))
        .when(!collapsed, (el) => el.flex_1().h(28).px(6).gap(5).justify_center().rounded(6))
        .items_center()
        .tooltip(tip)
        .accessibility_label(tip)
        .cursor_pointer()
        .text_color(dim ? t.dim : inkOf(t, "pencil", "muted"))
        .when(paper, (el) => el
          .rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9)
          .hover((s) => s.bg("#f8dc4c4d").text_color("#2a2420")))
        .when(!paper, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click(action)
        .child(svg(`mods/inkstone-chrome/${icon}.svg`).size(collapsed ? 11 : 13).flex_none())
        .when(!collapsed, (el) => el.child(div().text_size(12).whitespace_nowrap().child(label)))
        .when(badge && Boolean(updates().app.ready), (el) => el.child(collapsed ? ready.absolute().top(1).right(4) : ready));
      const openPrefs = () => openOverlay({ mod: "inkstone-settings", kind: "dialog", frame: "none", width: 784, height: 544, props: { framed: true } });
      if (collapsed) {
        return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).py(1).gap(1).items_center().justify_center()
          .child(item("prefs", "layers", pick("偏好", "Preferences"), false, openPrefs, pick("OMH 布局偏好 · 主题 / 右键 / 状态栏 / 面板", "Layout preferences · themes, right-click, status bar, panels")))
          .child(item("settings", "settings", pick("设置", "Settings"), false, () => run("app.settings"), pick("Herdr 全局设置 · 字体 / 缩放 / 快捷键", "Global settings · font, zoom, shortcuts"), true))
          .child(item("machine", "plus", pick("机器", "Machines"), true, () => run("mod.open", { name: "machine-add" }), pick("添加远程机器", "Add a remote machine")));
      }
      return h_flex().size_full().pl(6).pr(4).pb(4).pt(2).gap(4).items_center()
        .child(item("prefs", "layers", pick("偏好", "Preferences"), false, openPrefs, pick("OMH 布局偏好 · 主题 / 右键 / 状态栏 / 面板", "Layout preferences · themes, right-click, status bar, panels")))
        .child(item("settings", "settings", pick("设置", "Settings"), false, () => run("app.settings"), pick("Herdr 全局设置 · 字体 / 缩放 / 快捷键", "Global settings · font, zoom, shortcuts"), true))
        .child(item("machine", "plus", pick("机器", "Machines"), true, () => run("mod.open", { name: "machine-add" }), pick("添加远程机器", "Add a remote machine")));
    }
    // 标题行：纸感下是整页的上边缘，rail / 其他主题下是纯色条。
    const head = h_flex().size_full().pl(paper ? 4 : collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().min_w(0).gap(7).items_center()
        .child(div().size(24).flex_none().flex().items_center().justify_center().rounded(7)
          .bg(paper ? t.mark : t.accent)
          .child(svg("mods/inkstone-chrome/ink/mark.svg").size(16).flex_none().text_color(paper ? t.ink : t.accent_foreground)))
        .child(v_flex().flex_1().min_w(0).gap(paper ? 0 : 1)
          .child(div().min_w(0).truncate().font_weight(700).text_size(paper ? 15 : 16).line_height(paper ? "16px" : "17px").text_color(inkOf(t, "ink", "foreground")).child("Oh My Herdr"))
          .child(svg("mods/inkstone-chrome/ink/squiggle.svg").w(56).h(6).ml(1).flex_none().text_color(paper ? t.down : t.accent)))))
      .when(!collapsed && paper, el => el
        .child(this.slip("search", svg("mods/inkstone-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }), "a"))
        .child(this.slip("sidebar-toggle", svg("mods/inkstone-chrome/sidebar.svg").size(15), toggleSidebar, "b")))
      .when(!collapsed && !paper, el => el
        .child(this.button("search", svg("mods/inkstone-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }), pick("搜索", "Search"))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!collapsed && !paper && !(window()?.platform === "macos"), el => el
        .child(this.button("sidebar-toggle", svg("mods/inkstone-chrome/sidebar.svg").size(15), toggleSidebar, pick("折叠侧栏", "Collapse sidebar"))));
    return collapsed ? head.bg(t.chrome) : head;
  }
}
