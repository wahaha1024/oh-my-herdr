import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, agents, run, openOverlay, exec, theme, window, shared, layout, settings } from "herdr";

// 8×8 像素铃铛，与侧栏空间图案同一套画法：GPUI 矩形逐格拼，边缘是硬的。
// 不走 svg——矢量缩放会抗锯齿，8px 的铃铛会被糊成圆润的钟形。
const BELL = [
  "...xx...",
  "..xxxx..",
  ".xxxxxx.",
  ".xxxxxx.",
  "xxxxxxxx",
  ".xxxxxx.",
  "........",
  "...xx...",
];

function bellGlyph(color, px = 2) {
  const ink = { x: color };
  return v_flex().flex_none().w(px * 8).h(px * BELL.length).children(
    BELL.map((row) => {
      const cells = [];
      for (let i = 0; i < row.length; ) {
        let j = i;
        while (j < row.length && row[j] === row[i]) j++;
        const cell = div().flex_none().w(px * (j - i)).h(px);
        cells.push(row[i] === "." ? cell : cell.bg(ink[row[i]]));
        i = j;
      }
      return h_flex().flex_none().h(px).children(cells);
    }),
  );
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

// 空间配色与 inkstone-workbench 共用同一套序号：顶栏带一点当前空间的颜色，
// 终端区和侧栏里那一行说的就是同一个空间。切明暗主题只换亮度档，色相不变。
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

// 空间 -> 颜色；没有分配到序号的（还没在侧栏渲染过）返回 null，调用方退回主题的 border。
function spaceFill(t, id) {
  const idx = (shared("inkstone.spaceColors") ?? {})[id];
  if (!Number.isInteger(idx)) return null;
  const palette = luminance(t.background) < 0.5 ? PALETTE_DARK : PALETTE_LIGHT;
  return palette[Math.abs(idx) % palette.length];
}

// 右侧抽屉的页容器：新布局是一个 stack（切页 = 一条 layout.select）；
// 老布局是三块互斥 block（只能靠 hidden 开关来"选页"）。两套都认。
const PANELS = ["files", "changes", "sessions", "favorites", "cockpit"];

function pageStack(panel) {
  if (panel?.type === "stack" && (panel.children ?? []).some((c) => PANELS.includes(c.id))) return panel;
  for (const child of panel?.children ?? []) {
    const found = pageStack(child);
    if (found) return found;
  }
  return null;
}

// 抽屉此刻显示哪一页：stack 看 active，互斥 block 看谁没 hidden。null = 收起。
function shownPanel(panel, enabled) {
  if (!panel || panel.hidden) return null;
  const st = pageStack(panel);
  if (st) return enabled.includes(st.active) ? st.active : null;
  return enabled.find((id) => !find(panel, id)?.hidden) ?? null;
}

function openPanel(id, root = layout()) {
  run("layout.show", { id: "panel" });
  const st = pageStack(find(root, "panel"));
  if (st) {
    run("layout.select", { stack: st.id, child: id });
    return;
  }
  for (const other of PANELS) {
    if (other === id) run("layout.show", { id: other });
    else run("layout.hide", { id: other });
  }
}

function closePanel() {
  run("layout.hide", { id: "panel" });
}

export default class Tabs extends View {
  init(_p, cx) {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    if (!this.panels || typeof this.panels !== "object" || Array.isArray(this.panels)) this.panels = {};
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
    // 分支 / 拉取请求胶囊（取自 2code 的 Quiet Top Bar）。
    this.pr = null;
    this.prStale = false;
    this.branch = null;
    this.at = 0;
    this.refreshPr(cx);
    cx.timer.every(15000, (cx) => this.refreshPr(cx));
  }

  // 窗格不在仓库时退回空间的目录与分支，胶囊才不会整条消失。
  refreshPr(cx) {
    const pane = panes().find((p) => p.focused) ?? panes()[0];
    const space = spaces().find((s) => s.active);
    const branch = pane?.branch ?? space?.branch ?? null;
    const cwd = pane?.cwd ?? space?.folder ?? null;
    if (branch !== this.branch || Date.now() - this.at > 60000) {
      this.branch = branch;
      this.at = Date.now();
      this.loadPr(branch, cwd, cx);
    }
  }

  loadPr(branch, cwd, cx) {
    if (!branch || !cwd) {
      this.pr = null;
      this.prStale = false;
      return;
    }
    const want = branch;
    cx.spawn(async (cx) => {
      const r = await exec("gh", ["pr", "list", "--head", branch, "--state", "all", "--json", "number,state,isDraft,url", "--limit", "1"], { cwd, timeout: 12000 }).catch(() => null);
      if (this.branch !== want) return;
      // 查不到（断网、gh 未登录、超时）时保留上一次的胶囊并标成陈旧：
      // PR 状态不该在网络抖动时凭空消失，也不该被当成最新结果。
      this.prStale = r?.code !== 0;
      if (r?.code === 0) {
        let next = null;
        try {
          const list = JSON.parse(r.stdout.trim() || "[]");
          const x = Array.isArray(list) ? list[0] : null;
          if (x?.number) next = { number: x.number, state: x.state, isDraft: Boolean(x.isDraft), url: x.url };
        } catch (e) {
          console.warn(`inkstone-tabs: ${e}`);
        }
        this.pr = next;
      }
      cx.notify();
    });
  }

  // One tab per wheel notch. A touchpad or smooth-scrolling mouse sends many
  // small events per gesture: a short swipe or one smoothed notch (about
  // 25 px) switches one tab, a longer swipe keeps going a tab per 60 px, at
  // most one every 100 ms so each shows.
  wheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe, now = Date.now();
    // Phases often arrive only as moves (a macOS touchpad included): a pause
    // or a turn starts a new gesture.
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, enabled) {
    if (!space || !panel) return;
    const now = shownPanel(panel, enabled);
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) openPanel(want, layout());
          else closePanel();
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  branchChip(t) {
    return h_flex().id("branch-chip").flex_none().h(26).px(7).gap(5).items_center().rounded(6)
      .text_color(t.muted).tooltip(this.branch ?? "当前目录不在 Git 仓库中").accessibility_label(`分支 ${this.branch ?? "无"}`)
      .child(svg("mods/workspace-chrome/git-branch.svg").size(12).flex_none().text_color(t.dim))
      .child(div().max_w(150).truncate().text_size(12).child(this.branch ?? ""));
  }

  prChip(t) {
    const p = this.pr;
    if (!p) return div().flex_none();
    const label = p.isDraft ? "草稿" : p.state === "MERGED" ? "已合并" : p.state === "OPEN" ? "开启" : p.state === "CLOSED" ? "已关闭" : p.state;
    const color = p.isDraft ? t.muted : p.state === "MERGED" ? t.done : p.state === "OPEN" ? t.accent : t.dim;
    const tip = [p.url, this.prStale ? "上次刷新失败 · 这是缓存结果" : null].filter(Boolean).join("\n");
    return h_flex().id("pr-chip").flex_none().h(22).px(8).gap(5).items_center().rounded(5)
      .bg(t.raised).border(1).border_color(t.border).cursor_pointer()
      .tooltip(tip).accessibility_label(`拉取请求 ${p.number} ${label}`).hover(s => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => exec("gh", ["pr", "view", String(p.number), "--web"], { timeout: 0 }).catch(() => {}))
      .child(svg("mods/workspace-chrome/git-compare.svg").size(11).flex_none().text_color(color))
      .child(div().text_size(11).text_color(t.foreground).child(`#${p.number}`))
      .child(div().text_size(11).text_color(color).child(label))
      .when(this.prStale, el => el.child(div().text_size(10).text_color(t.dim).child("?")));
  }

  // 顶部像素铃铛：只在有智能体等你（待处理，或你不在时已完成）时出现。
  // 颜色分轻重（有 blocked 就是 blocked 色），数字是等你的总数；点一下到最急的那个。
  waiting(t) {
    const list = agents().filter((a) => a.status === "blocked" || a.status === "done");
    if (!list.length) return div().flex_none();
    const rank = (a) => (a.status === "blocked" ? 0 : 1);
    const first = [...list].sort((a, b) => rank(a) - rank(b) || (b.seq ?? 0) - (a.seq ?? 0))[0];
    const blocked = list.filter((a) => a.status === "blocked").length;
    const tone = blocked ? t.blocked : t.done;
    const tip = [
      blocked ? `${blocked} 个待你处理` : null,
      list.length > blocked ? `${list.length - blocked} 个已完成待查看` : null,
      "点一下跳到最急的那个",
    ].filter(Boolean).join(" · ");
    return h_flex()
      .id("inkstone-waiting")
      .h(26)
      .px(7)
      .gap(5)
      .flex_none()
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .text_color(tone)
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .accessibility_label(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => {
        // 与侧栏的智能体行一致：只在确实要换空间/标签时才切换，避免重放 scrollback。
        const sp = spaces().find((s) => s.id === first.space);
        if (sp && !sp.active) run("space.select", { id: first.space });
        if (first.tab && !sp?.tabs?.find((x) => x.id === first.tab)?.active) run("tab.select", { id: first.tab });
        if (first.pane) run("pane.focus", { pane: first.pane });
        else if (first.address) run("agent.focus", { terminal: first.address });
      })
      .child(bellGlyph(tone))
      .child(div().text_size(12).font_semibold().child(String(list.length)));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const fill = space ? spaceFill(t, space.id) : null;
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action, tip) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip ?? id).accessibility_label(tip ?? id)
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      const name = label(c, lead);
      return h_flex().id(`tab-${c.id}`).h(30).px(11).gap(7).rounded(6).items_center().flex_none().text_size(14)
        // 改名或状态点会改宽度、把活动标签挤出可见区：跟过去，但别再 notify 自己——
        // 每个标签尺寸一变就排一轮渲染，切换/重命名时会连环触发。
        .when(i <= active, el => el.on_size_change(() => this.scroll.scroll_to_item(active)))
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(16)))
        .child(div().max_w(200).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel");
    // 右侧抽屉的页：文件 / 变更 / 会话 / 收藏 / 驾驶舱。
    // Git 关掉时「变更」面板没有内容，按钮一并收起（在 OMH 偏好里开「Git 工作树」才出现）。
    const enabled = shared("inkstone.git") === true ? PANELS : PANELS.filter((id) => id !== "changes");
    const icons = { files: "mods/files/file.svg", changes: "mods/changes/changes.svg", sessions: "mods/inkstone-chrome/terminal.svg", favorites: "mods/inkstone-chrome/pin.svg", cockpit: "mods/workspace-chrome/layers.svg" };
    const names = { files: "文件", changes: "变更", sessions: "会话", favorites: "收藏", cockpit: "驾驶舱" };
    this.syncPanel(space, panel, enabled);
    // 图标按钮固定在右侧：点已激活的页收起抽屉，点别的页切过去。
    // 用图标而非文字：中文词会挤掉标签页的位置（靠 tooltip 与无障碍名说明）。
    const panelButton = (id) => {
      const on = shownPanel(panel, enabled) === id;
      return h_flex().id(`panel-${id}`).h(26).flex_none().px(7).gap(5).items_center().rounded(6).cursor_pointer()
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) closePanel();
          else openPanel(id, layout());
        }).tooltip(`${names[id]}面板`).accessibility_label(`${names[id]}面板`)
        .child(svg(icons[id]).size(14).flex_none())
        .child(div().text_size(11).child(names[id]));
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => this.wheel(e))
      // 当前空间的颜色点：和侧栏那一行、tab 数徽章是同一个颜色，终端区也有了归属。
      .when(Boolean(space), el => el.child(div()
        .id("space-mark")
        .size(7)
        .flex_none()
        .rounded_full()
        .bg(fill ?? t.border)
        .tooltip(clean(space.name) || "空间")
        .accessibility_label(`当前空间 ${clean(space.name) || ""}`)))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }), "新建标签"))
      .when(Boolean(this.branch), el => el.child(this.branchChip(t)))
      .child(this.prChip(t))
      .child(this.waiting(t))
      .children(enabled.filter((id) => icons[id]).map((id) => panelButton(id)))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/inkstone-tabs/win-min.svg").size(16) : "−", () => run("window.minimize"), "最小化"))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/inkstone-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize"), w.maximized ? "还原窗口" : "最大化"))
        .child(button("close-window", w.platform === "windows" ? svg("mods/inkstone-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"), "关闭窗口")));
  }
}
