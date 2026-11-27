import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, agents, run, openOverlay, exec, theme, window, shared, layout, settings, checking } from "herdr";

// 中英切换：shared 改动会让所有 mod 重绘，切换语言立即生效。
const LANG = "inkstone.lang";
const pick = (zh, en) => (shared(LANG) === "en" ? en : zh);

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

// 标签的状态点：与侧栏、智能体面板同一套形状与颜色——
// 待处理 = 方块（红），运行中 = 圆环（黄），已完成 = 实心圆（绿）。空闲不画，免得每个标签都挂一个灰圈。
const RANK = { blocked: 3, working: 2, done: 1, idle: 0 };

// 一个标签可能开着多个窗格，取最需要关注的那个状态。
function statusOf(list, fallback) {
  let best = fallback ?? "idle";
  for (const a of list) if ((RANK[a.status] ?? 0) > (RANK[best] ?? 0)) best = a.status;
  return best;
}

// 与智能体面板同一套配色：待处理红、运行中琥珀黄、已完成绿——三处对得上，不用再猜颜色。
const FLOW_RED = (t) => t.blocked ?? "#c23142";
const FLOW_YELLOW = (t) => (PAPER(t) ? t.working : luminance(t.background ?? "#ffffff") < 0.5 ? (t.working ?? "#e2c027") : "#b78b26");
const FLOW_GREEN = (t) => (PAPER(t) ? (t.up ?? t.done) : (t.done ?? "#1a6840"));

function dot(t, status, size = 7) {
  if (status === "blocked") return div().size(size).flex_none().rounded(1).bg(FLOW_RED(t));
  if (status === "done") return div().size(size).flex_none().rounded_full().bg(FLOW_GREEN(t));
  if (status === "working") return div().size(size).flex_none().rounded_full().border(2).border_color(FLOW_YELLOW(t));
  return div().size(size).flex_none().rounded_full().border(1.5).border_color(t.dim);
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

// 空间配色与 inkstone-workbench 共用同一套序号：顶栏带一点当前 Space的颜色，
// 终端区和侧栏里那一行说的就是同一个 Space。切明暗主题只换亮度档，色相不变。
const PALETTE_LIGHT = ["#a84a50", "#8a5619", "#7d640c", "#357041", "#34618f", "#5f5399", "#805083"];
const PALETTE_DARK = ["#f08a8a", "#f2a46a", "#e8c76a", "#7ecf86", "#6fb3ea", "#9a8ce6", "#c98ae6"];

// 纸感只在定义了 paper 槽的主题下开启（见 themes/zhi.json）；其余主题原样走 GPUI 几何。
const PAPER = (t) => Boolean(t.paper);
const MARK = "#f8dc4c";

// 状态色加水：把 #rrggbb 变成带透明度的底色，纸底与纯色底都能透出一点。
function tint(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  return m ? `#${m[1]}${alpha}` : String(hex ?? "transparent");
}

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
const PANELS = ["files", "sessions", "favorites"];
// 终端至少留 360 逻辑像素；72 包含画纸边缘、内边距和抽屉分隔。
const DRAWER_RESERVE = 432;

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
    this.pressedAt = 0;      // 上次按下的时刻：拖出标签栏再松开时 root 收不到 mouse_up，靠它判过期
    this.closing = null;     // 等二次确认的标签 id
    this.closingAt = 0;
    this.scroll = ScrollHandle.new();
    this.workWidth = null;
    this.drawerConstrained = false;
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

  // 纵向滚动交给宿主；触控板的纯横向手势才累积距离切换标签。
  wheel(e, cx) {
    const s = this.swipe;
    if (e.touch_phase === "ended" || e.touch_phase === "cancelled") {
      s.acc = s.steps = 0;
      return;
    }
    const { x, y } = e.delta_lines ?? e.delta;
    if (Math.abs(x) <= Math.abs(y)) return;
    cx.stop_propagation();
    if (e.delta_lines) {
      run(x > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const now = Date.now();
    if (e.touch_phase === "started" || now - s.at > 250 || x * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += x;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(x > 0 ? "tab.prev" : "tab.next");
  }

  drawerFits(panel) {
    return this.workWidth === null || this.workWidth >= (panel?.size?.px ?? 380) + DRAWER_RESERVE;
  }

  rememberPanel(space, page) {
    if (this.panels[space] === page) return;
    this.panels[space] = page;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  queuePanelSync(cx) {
    if (this.panelQueued || checking()) return;
    this.panelQueued = true;
    cx.timer.after(0, () => {
      this.panelQueued = false;
      const root = layout();
      this.syncPanel(spaces().find((s) => s.active), find(root, "panel"), root);
    });
  }

  // 空间记住选中的页，缩窄窗口的临时收起不覆盖这个选择。
  syncPanel(space, panel, root) {
    if (!space || !panel) return;
    const now = shownPanel(panel, PANELS);
    const first = this.space === undefined;
    const switched = space.id !== this.space;
    const constrained = !this.drawerFits(panel);
    const resized = constrained !== this.drawerConstrained;
    this.space = space.id;
    this.drawerConstrained = constrained;
    if (switched || resized) this.pending = null;
    if (first && !(space.id in this.panels)) this.rememberPanel(space.id, now);
    if (constrained) {
      if (!panel.hidden && (!this.pending || Date.now() >= this.pending.until)) {
        this.pending = { want: null, until: Date.now() + 1000 };
        closePanel();
      }
      return;
    }
    if (switched || resized) {
      const stored = this.panels[space.id];
      const want = PANELS.includes(stored) ? stored : null;
      if (want !== now) {
        this.pending = { want, until: Date.now() + 1000 };
        if (want) openPanel(want, root);
        else closePanel();
        return;
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    this.rememberPanel(space.id, now);
  }

  branchChip(t) {
    return h_flex().id("branch-chip").flex_none().h(26).px(7).gap(5).items_center().rounded(6)
      .text_color(t.muted).tooltip(this.branch ?? pick("当前目录不在 Git 仓库中", "This folder is not in a Git repository")).accessibility_label(pick(`分支 ${this.branch ?? "无"}`, `branch ${this.branch ?? "none"}`))
      .child(svg("mods/inkstone-chrome/git-branch.svg").size(12).flex_none().text_color(t.dim))
      .child(div().max_w(150).truncate().text_size(12).child(this.branch ?? ""));
  }

  prChip(t) {
    const p = this.pr;
    if (!p) return div().flex_none();
    const label = p.isDraft ? pick("草稿", "draft")
      : p.state === "MERGED" ? pick("已合并", "merged")
      : p.state === "OPEN" ? pick("开启", "open")
      : p.state === "CLOSED" ? pick("已关闭", "closed") : p.state;
    const color = p.isDraft ? t.muted : p.state === "MERGED" ? t.done : p.state === "OPEN" ? t.accent : t.dim;
    const tip = [p.url, this.prStale ? pick("上次刷新失败 · 这是缓存结果", "Last refresh failed · showing cached result") : null].filter(Boolean).join("\n");
    return h_flex().id("pr-chip").flex_none().h(22).px(8).gap(5).items_center().rounded(5)
      .bg(t.raised).border(1).border_color(t.border).cursor_pointer()
      .tooltip(tip).accessibility_label(pick(`拉取请求 ${p.number} ${label}`, `pull request ${p.number} ${label}`)).hover(s => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => exec("gh", ["pr", "view", String(p.number), "--web"], { timeout: 0 }).catch(() => {}))
      .child(svg("mods/inkstone-chrome/git-compare.svg").size(11).flex_none().text_color(color))
      .child(div().text_size(11).text_color(t.foreground).child(`#${p.number}`))
      .child(div().text_size(11).text_color(color).child(label))
      .when(this.prStale, el => el.child(div().text_size(10).text_color(t.dim).child("?")));
  }

  // 顶部像素铃铛：常驻显示。平时为绿色（t.done），有待处理智能体时变红（t.blocked）保持原逻辑；
  // 点击后在按钮旁弹出无框撕纸卡片显示当前驾驶舱内容。
  waiting(t) {
    const list = agents().filter((a) => a.status === "blocked" || a.status === "done");
    const blocked = list.filter((a) => a.status === "blocked").length;
    const tone = blocked ? t.blocked : t.done;
    const tip = list.length
      ? [
        blocked ? pick(`${blocked} 个待你处理`, `${blocked} waiting for you`) : null,
        list.length > blocked ? pick(`${list.length - blocked} 个已完成待查看`, `${list.length - blocked} finished to review`) : null,
        pick("点开查看驾驶舱", "Click to open the cockpit"),
      ].filter(Boolean).join(" · ")
      : pick("全部就绪 · 点开查看驾驶舱", "All clear · click to open the cockpit");
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
      .hover((s) => s.bg(PAPER(t) ? `${MARK}4d` : t.hover))
      .tooltip(tip)
      .accessibility_label(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => openOverlay({
        mod: "cockpit",
        kind: "popup",
        frame: "none",
        at: "pointer",
        width: 396,
        height: 460,
        props: { framed: true, width: 396, height: 460 },
      }))
      .child(bellGlyph(tone))
      .when(list.length > 0, (el) => el.child(div().text_size(12).font_semibold().child(String(list.length))));
  }

  render(cx) {
    const t = theme();
    const space = spaces().find(p => p.active);
    const fill = space ? spaceFill(t, space.id) : null;
    // 休眠会话（tab.settle）只在侧栏的休眠区出现，标签栏不占位。
    const shown = (space?.tabs ?? []).filter((c) => !c.settled);
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action, tip) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(PAPER(t) ? `${MARK}4d` : t.hover).text_color(t.foreground))
      .tooltip(tip ?? id).accessibility_label(tip ?? id)
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      const name = label(c, lead);
      // 状态取自这个标签里的智能体：c.status 只反映窗格自身，常常停在空闲。
      const st = statusOf(agents().filter(a => a.tab === c.id), c.status);
      // 底色也跟状态走：琥珀黄在跑、绿已完成、红待处理，与智能体面板同一套色；
      // 活动标签浓一档，其余淡一档，扫一眼就知道哪个标签在忙。
      const tone = st === "blocked" ? FLOW_RED(t) : st === "working" ? FLOW_YELLOW(t) : st === "done" ? FLOW_GREEN(t) : null;
      const wash = tone ? tint(tone, c.active ? "2e" : "18") : null;
      return h_flex().id(`tab-${c.id}`).h(30).px(11).gap(7).rounded(6).items_center().flex_none().text_size(14)
        // 改名或状态点会改宽度、把活动标签挤出可见区：跟过去，但别再 notify 自己——
        // 每个标签尺寸一变就排一轮渲染，切换/重命名时会连环触发。
        .when(i <= active, el => el.on_size_change(() => this.scroll.scroll_to_item(active)))
        .text_color(c.active ? t.foreground : (tone ?? t.muted))
        .when(!PAPER(t), el => el.border(1)
          .border_color(tone ? tint(tone, c.active ? "aa" : "5c") : (c.active ? t.border : t.chrome))
          .bg(wash ?? (c.active ? t.raised : t.chrome))
          .hover(s => s.bg(tone ? tint(tone, "38") : t.hover)))
        // 纸感：没有状态时选中是一道荧光笔，边缘不是四次圆角而是四个不同的角，像手划出来的。
        .when(PAPER(t), el => el.rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9)
          .when(Boolean(wash), (x) => x.bg(wash))
          .when(!wash && c.active, (x) => x.bg(`${MARK}9e`))
          .hover(s => s.bg(wash ? tint(tone, "3d") : (c.active ? `${MARK}9e` : `${MARK}4d`))))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; this.pressedAt = Date.now(); if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          // 拖到标签栏外再松手时 root 收不到 mouse_up，pressed 会留到下一次点击：
          // 超过 4 秒的按压不当拖拽，只做选中，免得点另一个标签时把它挪走。
          const stale = Date.now() - this.pressedAt > 4000;
          const moving = from !== null && from !== i && !stale ? shown[from] : null;
          if (moving) run("tab.move", { id: moving.id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stopPropagation(); openOverlay({ mod: "inkstone-menu", kind: "popup", width: 236, height: 260, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(st !== "idle", el => el.child(dot(t, st)))
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(16)))
        .child(div().max_w(200).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).size(28).flex_none().flex().items_center().justify_center()
          .rounded(5).text_color(t.dim).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
          .tooltip(this.closing === c.id ? pick("再点一次关闭", "Click again to close") : pick("关闭标签", "Close tab"))
          .accessibility_label(pick("关闭标签", "Close tab"))
          .when(this.closing === c.id, (x) => x.bg(t.blocked).text_color(t.background))
          .on_mouse_down("left", stop).on_click((_e, cx) => {
            cx.stop_propagation();
            // 28px 按钮紧挨标签，误点一次就丢会话：第一次点变红问一次，3 秒内再点才关。
            if (this.closing === c.id && Date.now() - this.closingAt < 3000) {
              this.closing = null;
              run("tab.close", { id: c.id });
              return;
            }
            this.closing = c.id;
            this.closingAt = Date.now();
            cx.notify();
            cx.timer.after(3000, () => {
              if (this.closing !== c.id) return;
              this.closing = null;
              cx.notify();
            });
          })
          .child(svg("mods/inkstone-chrome/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel");
    const enabled = PANELS;
    const drawerFits = this.drawerFits(panel);
    const icons = { files: "mods/inkstone-chrome/file.svg", sessions: "mods/inkstone-chrome/terminal.svg", favorites: "mods/inkstone-chrome/pin.svg" };
    const names = { files: pick("文件", "Files"), sessions: pick("会话", "Sessions"), favorites: pick("收藏", "Favourites") };
    const drawerPage = shownPanel(panel, enabled);
    const pending = this.pending;
    const waiting = pending && pending.want !== drawerPage && Date.now() < pending.until;
    if (space && panel && (space.id !== this.space || !drawerFits !== this.drawerConstrained ||
      (!waiting && (drawerFits ? pending || this.panels[space.id] !== drawerPage : !panel.hidden)))) {
      this.queuePanelSync(cx);
    }
    // 图标按钮固定在右侧：点已激活的页收起抽屉，点别的页切过去。
    // 用图标而非文字：中文词会挤掉标签页的位置（靠 tooltip 与无障碍名说明）。
    const panelButton = (id) => {
      const on = drawerPage === id;
      return h_flex().id(`panel-${id}`).h(26).flex_none().px(7).gap(5).items_center().rounded(6)
        .bg(on ? (PAPER(t) ? `${MARK}9e` : t.selected) : t.chrome).text_color(drawerFits ? (on ? t.foreground : t.muted) : t.dim)
        .on_mouse_down("left", stop)
        .when(drawerFits, (el) => el.cursor_pointer().hover(s => s.bg(PAPER(t) ? `${MARK}4d` : t.hover)).on_click(() => {
          const current = layout();
          const drawer = find(current, "panel");
          const activeSpace = spaces().find((s) => s.active);
          if (!activeSpace || !drawer || !this.drawerFits(drawer)) return;
          const want = shownPanel(drawer, enabled) === id ? null : id;
          this.rememberPanel(activeSpace.id, want);
          this.pending = { want, until: Date.now() + 1000 };
          if (want) openPanel(want, current);
          else closePanel();
        })).tooltip(drawerFits ? pick(`${names[id]}面板`, `${names[id]} panel`)
          : pick(`窗口过窄，拉宽后可打开${names[id]}面板`, `Widen the window to open the ${names[id]} panel`))
        .accessibility_label(pick(`${names[id]}面板`, `${names[id]} panel`))
        .child(svg(icons[id]).size(14).flex_none())
        .child(div().text_size(11).child(names[id]));
    };
    return h_flex().id("inkstone-tabs-root").size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(PAPER(t) ? t.paper : t.chrome)
      .on_size_change((size, cx) => {
        if (this.workWidth === size.width) return;
        this.workWidth = size.width;
        cx.notify();
      })
      // 窗口按钮贴右边缘：系统标题栏去掉后（titlebar none），这排就是唯一的最小化/关闭入口。
      .when(Boolean(w?.buttons), (el) => el.pr(6))
      .when(!PAPER(t), el => el.border_b(1).border_color(t.border))
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel((e, cx) => this.wheel(e, cx))
      // 当前 Space的颜色点：和侧栏那一行、tab 数徽章是同一个颜色，终端区也有了归属。
      .when(Boolean(space), el => el.child(div()
        .id("space-mark")
        .size(7)
        .flex_none()
        .rounded_full()
        .bg(fill ?? t.border)
        .tooltip(clean(space.name) || "Space")
        .accessibility_label(pick(`当前 Space ${clean(space.name) || ""}`, `current space ${clean(space.name) || ""}`))))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }), pick("新建标签", "New tab")))
      .when(Boolean(this.branch), el => el.child(this.branchChip(t)))
      .child(this.prChip(t))
      .child(this.waiting(t))
      .children(enabled.filter((id) => icons[id]).map((id) => panelButton(id)))
      .when(w?.buttons, el => el.child(h_flex().flex_none().gap(0)
        .child(button("minimize", w.platform === "windows" ? svg("mods/inkstone-tabs/win-min.svg").size(16) : "−", () => run("window.minimize"), pick("最小化", "Minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/inkstone-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize"), w.maximized ? pick("还原窗口", "Restore") : pick("最大化", "Maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/inkstone-tabs/win-close.svg").size(16) : svg("mods/inkstone-chrome/close.svg").size(13), () => run("window.close"), pick("关闭窗口", "Close window")))))
      // 纸感：标签条底边不是 1px 描边，而是铅笔压出来的一道横线（只在最底下露 2px）。
      .when(PAPER(t), el => el.relative().child(div().absolute().left(0).right(0).bottom(0).h(2).overflow_hidden()
        .child(image("mods/inkstone-chrome/ink/rule-h.svg").absolute().left(-12).top(-12).w(3864).h(26))));
  }
}
