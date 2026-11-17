import { View, div, svg } from "gpui-kit";
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

export default class WorkspaceChrome extends View {
  button(id, label, action, tip) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip ?? id).accessibility_label(tip ?? id)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action, tip = label) => h_flex().id(id).h(32).px(10).gap(10).items_center().rounded(8)
        .when(collapsed, el => el.relative().w(32).px(0).justify_center())
        .tooltip(tip)
        .accessibility_label(tip)
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/inkstone-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const ready = div().size(6).rounded_full().bg(t.accent);
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(8).pb(8).gap(2).text_size(13)
        .when(collapsed, el => el.px(0).items_center())
        .child(row("prefs", "layers", "OMH 偏好", false, () => run("mod.open", { name: "inkstone-settings" }), "OMH 布局偏好 · 主题 / 右键 / 状态栏 / 面板"))
        .child(row("settings", "settings", "Herdr 设置", false, () => run("app.settings"), "Herdr 全局设置 · 字体 / 缩放 / 快捷键")
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
        .child(row("machine", "plus", "添加机器", true, () => run("mod.open", { name: "machine-add" }), "添加远程机器"));
    }
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(div().font_semibold().text_color(t.foreground).child("Oh My Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/inkstone-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }), "搜索")))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/inkstone-chrome/sidebar.svg").size(15), toggleSidebar, "折叠侧栏")));
  }
}
