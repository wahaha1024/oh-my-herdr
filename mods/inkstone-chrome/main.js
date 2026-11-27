// 侧栏的上下两块：顶部标题行（搜索 / 折叠侧栏）与底部入口（偏好 / 设置 / 加机器）。
// 展开时透明落在侧栏的 canvas 桌面上，把完整的独立纸边卡片空间让给中间的 Spaces 与 Agents。
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, openOverlay, closeOverlay, checking } from "herdr";

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
    this.welcome = false;
    // 首次引导：shared 里的标记跨重启持久，真正的展示与写标记都在 brand 实例的
    // 第一次 render 里做（footer 实例不参与，避免它抢先把标记立起来）。init 里只读状态。
    this.welcome = !shared("inkstone.welcomed") && !checking();
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
    // 引导卡走独立渲染分支；footer / 标题行的实例不受影响。
    if (props()?.welcome) return this.renderWelcome(theme());
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
      const openWelcome = () => openOverlay({ mod: "inkstone-chrome", kind: "dialog", frame: "none", width: 480, height: 372, key: "omh-welcome", props: { welcome: true } });
      if (collapsed) {
        return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).py(1).gap(1).items_center().justify_center()
          .child(item("prefs", "layers", pick("偏好", "Preferences"), false, openPrefs, pick("OMH 布局偏好 · 主题 / 右键 / 状态栏 / 面板", "Layout preferences · themes, right-click, status bar, panels")))
          .child(item("settings", "settings", pick("设置", "Settings"), false, () => run("app.settings"), pick("Herdr 全局设置 · 字体 / 缩放 / 快捷键", "Global settings · font, zoom, shortcuts"), true))
          .child(item("machine", "plus", pick("机器", "Machines"), true, () => run("mod.open", { name: "machine-add" }), pick("添加远程机器", "Add a remote machine")));
      }
      return h_flex().size_full().pl(6).pr(4).pb(4).pt(2).gap(4).items_center()
        .child(item("prefs", "layers", pick("偏好", "Preferences"), false, openPrefs, pick("OMH 布局偏好 · 主题 / 右键 / 状态栏 / 面板", "Layout preferences · themes, right-click, status bar, panels")))
        .child(item("welcome", "archive", pick("引导", "Guide"), false, openWelcome, pick("再看一遍上手说明", "Show the getting-started card again")))
        .child(item("reset-layout", "square", pick("恢复布局", "Reset layout"), false, () => run("layout.switch", { name: "main" }), pick("切回默认布局（面板与状态栏复原，不关终端）", "Switch back to the default layout (panels and status bar; terminals stay open)")))
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
    // 首次引导卡：只在 brand（标题行）实例、非折叠时弹一次；此刻才写 shared 标记，
    // 折叠状态下不标记，展开后下次渲染仍会弹。footer 实例与引导卡实例（welcome props）都不触发。
    if (this.welcome && !collapsed && !props()?.footer) {
      this.welcome = false;
      setShared("inkstone.welcomed", "shown");
      openOverlay({ mod: "inkstone-chrome", kind: "dialog", frame: "none", width: 480, height: 372, key: "omh-welcome", props: { welcome: true } });
    }
    return collapsed ? head.bg(t.chrome) : head;
  }

  // 首次引导 / 再看一遍：三条最常用的说明 + 指向偏好的入口。关掉只是收起卡片，
  // 不写任何配置（标记在 init 里已写，重开走偏好里的「引导」按钮）。
  renderWelcome(t) {
    const row = (icon, title, body) => h_flex().w_full().gap(10).items_start()
      .child(svg(`mods/inkstone-chrome/${icon}.svg`).size(15).flex_none().mt(2).text_color(t.accent))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
        .child(div().text_size(11.5).line_height("17px").text_color(t.muted).child(body)));
    const cap = pick(
      "很多能力藏在偏好里，点底部「偏好」随时回来；这份说明也能在那里再看一遍。",
      "Most of these live in Preferences (the button at the bottom); this card can be reopened there.",
    );
    return v_flex().size_full().bg(t.paper ?? t.background).p(18).gap(12)
      .child(h_flex().w_full().items_start().justify_between()
        .child(v_flex().gap(1)
          .child(div().text_size(14).font_weight(700).text_color(t.foreground).child(pick("欢迎用 Oh My Herdr", "Welcome to Oh My Herdr")))
          .child(div().text_size(11).text_color(t.dim).child(pick("三件上手就知道的事", "Three things worth knowing first"))))
        .child(div().id("omh-welcome-close").size(22).flex().items_center().justify_center().rounded(5).cursor_pointer()
          .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props()?.overlay))
          .accessibility_label(pick("知道了", "Got it"))
          .child(svg("mods/inkstone-chrome/close.svg").size(12))))
      .child(row("search", pick("项目跟着文件夹走", "Projects follow folders"),
        pick("左侧把同一台机器上相邻文件夹的项目归成一组；「新建 Space」指向哪个文件夹，终端就在那里起。",
          "The sidebar groups projects by nearby folders on the same machine; a new space opens a terminal in the folder you point it at.")))
      .child(row("settings", pick("Agents 状态在侧栏", "Agent status lives in the sidebar"),
        pick("有 Agents 在跑时它挂着自己的标记；不回头刷终端，状态与待处理事项都在那里看。",
          "Running agents hang their tag in the sidebar; check status and pending work there instead of watching the terminal.")))
      .child(row("square-pen", pick("会话与文件都在面板里", "Sessions and files live in panels"),
        pick("「文件 / 会话 / 收藏」共用中间面板，切换不关终端；会话是各程序的记录，只读。",
          "Files, sessions and favorites share the middle panel; switching never closes a terminal. Sessions are per-program records, read-only.")))
      .child(v_flex().w_full().gap(6).mt(2)
        .child(div().text_size(11).line_height("16px").text_color(t.dim).child(cap))
        .child(h_flex().w_full().gap(8).items_center()
          .child(div().id("omh-welcome-prefs").h(26).px(12).flex().items_center().rounded(6).cursor_pointer()
            .bg(t.accent).text_size(12).font_weight(600).text_color(t.accent_foreground ?? t.background)
            .hover(s => s.bg(t.solid ?? t.accent))
            .accessibility_label(pick("打开偏好", "Open preferences"))
            .on_click(() => { closeOverlay(props()?.overlay); openOverlay({ mod: "inkstone-settings", kind: "dialog", frame: "none", width: 784, height: 544, props: { framed: true } }); })
            .child(pick("打开偏好", "Open preferences")))
          .child(div().flex_1())));
  }
}
