// Oh My Herdr 工作台侧栏：按项目（git 仓库）归拢工作树，工作树下直接嵌智能体。
// 融合 2code 的「项目 / 工作树树形导航」与 Orca 的「智能体层级透视」：
//  - 每个空间是一次检出的工作树（未打开的工作树暗色列出，点一下即打开）；
//  - 已打开的工作树下面按空间、标签列出其中的智能体与状态；
//  - 右键行打开 inkstone-menu 的中文菜单（工作树 / 空间动作）。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, agents, panes, run, openOverlay, exec, theme, shared, setShared, layout, window } from "herdr";

const git = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const base = (path) => (path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path || "~";
const samePath = (a, b) => (a ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === (b ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

// 一个空间此刻所在的目录：它第一个终端的实时目录，否则创建时的目录。
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// Git 增强默认关闭（OMH 偏好里可开）：不在 herdr 里用 git 功能时，
// 不扫工作树、不显示分支标签，侧栏只按目录归拢空间。
const gitOn = () => shared("inkstone.git") === true;

const STATUS = { blocked: "待处理", working: "运行中", done: "已完成", idle: "空闲" };
const statusLabel = (s) => STATUS[s] ?? "无状态";

// 智能体状态点：形状与颜色一起编码，色弱也能分辨——
// 待处理 = 方块，已完成 = 实心圆，运行中 = 圆环，空闲 / 无状态 = 空心圆。
// 侧栏缩成 rail（Windows/Linux 44px，macOS 76px）时宽度放不下名字：只留目录图标与空间徽章。
function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}
const rail = () => (findNode(layout(), "sidebar")?.size?.px ?? 999) < 160;

function dot(t, status, size = 7) {
  if (status === "blocked") return div().size(size).flex_none().rounded(1).bg(t.blocked);
  if (status === "done") return div().size(size).flex_none().rounded_full().bg(t.done);
  if (status === "working") return div().size(size).flex_none().rounded_full().border(2).border_color(t.working);
  return div().size(size).flex_none().rounded_full().border(1.5).border_color(status === "idle" ? t.idle : t.dim);
}

function duration(ms) {
  if (!ms || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时`;
  return `${Math.floor(h / 24)} 天`;
}

// 每个空间一个固定的颜色：不同目录、不同空间靠名字就能分开。
// 索引存进 shared，切明暗主题时只换亮度档，色相不变——认的还是同一个空间。
// 浅色档按青瓷的 #e8f0ec 底选（最低 4.8:1），深色档按玄墨的 #14131a 底选（最低 6.3:1）。
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

// 主题取不到「半透明」：拼一个 #rrggbbaa 给 GPUI。
function tint(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  return m ? `#${m[1]}${alpha}` : hex;
}

// 标题里常混着终端进度符号、Nerd Font 私有区图标和 emoji：本机字体没有这些字形，
// 直接画出来就是豆腐块。这里统一剥掉，把空白压成单空格。
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

export default class Workbench extends View {
  init(_props, cx) {
    this.scroll = ScrollHandle.new();
    this.fold = new Set(shared("inkstone.folded") ?? []);
    this.repos = {}; // 目录 -> { root, branch } | null
    this.trees = {}; // 项目根 -> { at, list: [{ path, branch, main }] }
    this.refresh(cx);
    cx.timer.every(30000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.busy) return;
    // 开关关掉时彻底不碰 git：清掉缓存，让 groups() 退回纯目录归拢。
    if (!gitOn()) {
      if (this.mode !== "off") {
        this.mode = "off";
        this.key = null;
        this.repos = {};
        this.trees = {};
        cx.notify();
      }
      return;
    }
    this.mode = "git";
    const ps = panes();
    const list = spaces();
    const key = JSON.stringify(list.map((s) => [s.id, place(s, ps), s.machine ?? null]));
    // 目录探测缓存 5 分钟、工作树列表 30 秒。只看 key 的话定时器形同虚设：
    // 空间没变就永远不再扫，新建的工作树要等下次增删空间才出现。
    const here = [...new Set(list.map((s) => place(s, ps)))];
    const repoStale = here.some((f) => {
      if (!f) return false;
      const r = this.repos[f];
      return !r || Date.now() - r.at >= 300000;
    });
    // 非 Git 目录也过期重试：用户中途 git init 之后不该永远是「不在 Git 仓库中」。
    const treeStale = Object.values(this.repos).some((r) => {
      if (!r?.value) return false;
      const tr = this.trees[r.value.root];
      return !tr || Date.now() - tr.at >= 30000;
    });
    if (key === this.key && !repoStale && !treeStale) return;
    this.key = key;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const folders = new Map(); // 目录 -> 机器
        for (const s of list) folders.set(place(s, ps), s.machine ?? null);
        for (const [folder, on] of folders) {
          if (!folder) continue;
          const cached = this.repos[folder];
          if (cached && (cached.value || Date.now() - cached.at < 300000)) continue;
          const top = await exec("git", [...git, "rev-parse", "--show-toplevel"], { cwd: folder, on }).catch(() => null);
          const br = top?.code === 0
            ? await exec("git", [...git, "branch", "--show-current"], { cwd: folder, on }).catch(() => null)
            : null;
          this.repos[folder] = {
            at: Date.now(),
            value: top?.code === 0 ? { root: top.stdout.trim(), branch: br?.stdout.trim() || null } : null,
          };
        }
        const roots = new Set(Object.values(this.repos).map((r) => r?.value?.root).filter(Boolean));
        for (const root of roots) {
          const seen = this.trees[root];
          if (seen && Date.now() - seen.at < 30000) continue;
          const on = spaces().find((s) => samePath(this.repos[place(s, panes())]?.value?.root, root))?.machine ?? null;
          const r = await exec("git", [...git, "worktree", "list", "--porcelain"], { cwd: root, on }).catch(() => null);
          const out = [];
          if (r?.code === 0) {
            let cur = null;
            for (const line of r.stdout.split(/\r?\n/)) {
              if (line.startsWith("worktree ")) {
                if (cur) out.push(cur);
                cur = { path: line.slice(9).trim(), branch: null, main: out.length === 0 };
              } else if (cur && line.startsWith("branch ")) {
                cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
              } else if (cur && line === "detached") cur.branch = "（游离）";
            }
            if (cur) out.push(cur);
          }
          this.trees[root] = { at: Date.now(), list: out };
        }
      } catch (e) {
        console.warn(`inkstone-workbench: ${e}`);
      }
      this.busy = false;
      cx.notify();
    });
  }

  menu(target, tab = "space") {
    openOverlay({ mod: "inkstone-menu", kind: "popup", width: 220, height: 300, props: { tab, target } });
  }

  toggleFold(id, cx) {
    if (this.fold.has(id)) this.fold.delete(id);
    else this.fold.add(id);
    setShared("inkstone.folded", [...this.fold]);
    cx.notify();
  }

  // 空间配色：只存调色板序号（0..6），切明暗主题时色相不变、只换亮度档。
  // 新空间取「用得最少」的序号，删掉已经不存在的空间。
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
    const uses = (i) => Object.values(kept).filter((v) => v === i).length;
    for (const s of list) {
      if (kept[s.id] !== undefined) continue;
      let best = 0;
      for (let i = 1; i < PALETTE_LIGHT.length; i++) if (uses(i) < uses(best)) best = i;
      kept[s.id] = best;
      changed = true;
    }
    if (changed) setShared("inkstone.spaceColors", kept);
    return kept;
  }

  // 序号 + 主题明暗 -> 具体颜色。
  fill(t, i) {
    const palette = luminance(t.background) < 0.5 ? PALETTE_DARK : PALETTE_LIGHT;
    return palette[Math.abs(Number(i) || 0) % palette.length];
  }

  // 项目 -> 工作树；不在 git 里的空间按目录单列。
  groups() {
    const ps = panes();
    const list = spaces();
    const byRoot = new Map();
    for (const s of list) {
      const here = place(s, ps);
      const repo = gitOn() ? this.repos[here]?.value : null;
      const root = repo?.root ?? here ?? s.folder ?? "~";
      if (!byRoot.has(root)) byRoot.set(root, { root, repo, spaces: [], trees: [] });
      byRoot.get(root).spaces.push({ space: s, folder: here, branch: gitOn() ? (repo?.branch ?? s.branch) : null });
    }
    for (const g of byRoot.values()) {
      const seen = this.trees[g.root]?.list ?? [];
      g.trees = seen;
      // 还没扫过 / 不是仓库 / 只有主工作树：三种空态要说清，不能都写成「无」。
      g.scanned = Boolean(this.trees[g.root]);
      g.repo = g.repo ?? this.repos[g.root]?.value ?? null;
      // 工作树列出的路径里，没有空间打开的那些补在下面。
      for (const w of seen) {
        if (!g.spaces.some((x) => samePath(x.folder, w.path))) g.spaces.push({ tree: w, folder: w.path, branch: w.branch });
      }
    }
    return [...byRoot.values()].sort((a, b) => base(a.root).localeCompare(base(b.root), "zh"));
  }

  // 一个智能体一行：状态点、名字、右侧「待处理 / 已完成」。
  agentRow(a, t) {
    const name = clean(a.title) || a.program?.name || a.app || a.address;
    const detail = [statusLabel(a.status), a.tab_name, a.address].filter(Boolean).join(" · ");
    return h_flex()
      .id(`wb-a-${a.address}`)
      .h(24)
      .flex_none()
      .pl(38)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(`${name}\n${detail}`)
      .accessibility_label(`${name} ${detail}`)
      .on_click(() => {
        // 只在确实要换空间/标签时才切换：每次切换都会重建终端视图并重放 scrollback。
        const sp = spaces().find((s) => s.id === a.space);
        if (sp && !sp.active) run("space.select", { id: a.space });
        const tb = sp?.tabs?.find((x) => x.id === a.tab);
        if (tb && !tb.active) run("tab.select", { id: a.tab });
        run("agent.focus", { terminal: a.address });
      })
      .child(dot(t, a.status, 6))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(a.status === "blocked" ? t.blocked : t.dim).child(name))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(a.status === "blocked" ? "待处理" : a.status === "done" ? "已完成" : ""));
  }

  // 没跑智能体的终端也要有自己一行：否则徽章上的 tab 数在下面找不到对应的行。
  termRow(s, c, t) {
    const ps = panes();
    const lead = ps.find((p) => p.tab === c.id);
    const prog = lead?.program;
    const name = clean(c.name) || prog?.name || "终端";
    return h_flex()
      .id(`wb-tab-${c.id}`)
      .h(24)
      .flex_none()
      .pl(38)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .when(Boolean(c.active && s.active), (el) => el.bg(t.selected))
      .when(!(c.active && s.active), (el) => el.hover((h) => h.bg(t.hover)))
      .tooltip(`${lead?.cwd ?? s.folder ?? ""}${prog?.name ? `\n${prog.name}` : ""}`)
      .accessibility_label(`终端 ${name}`)
      .on_click(() => {
        if (!s.active) run("space.select", { id: s.id });
        if (!c.active) run("tab.select", { id: c.id });
      })
      .child(prog?.icon
        ? (prog.tint ? svg(prog.icon).size(12).flex_none().text_color(t.dim) : image(prog.icon).size(12).flex_none())
        : svg("mods/inkstone-chrome/terminal.svg").size(12).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(name));
  }

  treeRow(w, t) {
    return h_flex()
      .id(`wb-t-${w.path}`)
      .h(26)
      .flex_none()
      .pl(30)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .when(Boolean(w.active), (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .cursor_pointer()
      .tooltip(`${w.folder}\n未打开 · 点一下在此工作树中新建空间`)
      .on_click(() => run("space.new", { folder: w.folder, name: base(w.folder) }))
      .child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(base(w.folder)))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(w.branch ?? ""));
  }

  // 空间行：30 高、14 号彩色名字 + tab 数徽章，夹在 26 高的项目头与 24 高的智能体行之间，
  // 三层用高度、字号、颜色分开。选中时徽章填实该空间的颜色，整行只留一层淡色底。
  spaceRow({ space: s, folder, branch }, t, fill) {
    const on = s.active;
    const has = s.status === "blocked" || s.status === "done" || s.status === "working";
    const folded = this.fold.has(s.id);
    const count = (s.tabs ?? []).length;
    const ink = luminance(fill) < 0.5 ? "#f7faf8" : "#14131a";
    return h_flex()
      .id(`wb-s-${s.id}`)
      .h(30)
      .flex_none()
      .pl(10)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(on, (el) => el.bg(tint(fill, "1a")))
      .when(!on, (el) => el.hover((h) => h.bg(t.hover)))
      .tooltip(`${folder ?? s.folder}${branch ? `\n${branch}` : ""}`)
      .accessibility_label(`${clean(s.name) || "未命名空间"} · ${count} 个终端 · ${statusLabel(s.status)}`)
      .on_click(() => (on ? null : run("space.select", { id: s.id })))
      .on_mouse_down("right", () => this.menu({ id: s.id }))
      // 折叠是空间自己的开关：与「切换到空间」分开，免得想看子项就得跳过去。
      .child(div()
        .id(`wb-f-${s.id}`)
        .size(14)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(4)
        .cursor_pointer()
        .hover((h) => h.bg(t.hover))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.toggleFold(s.id, cx);
        })
        .child(svg(folded ? "mods/workspace-chrome/chevron-right.svg" : "mods/workspace-chrome/chevron-down.svg").size(10).flex_none().text_color(t.dim)))
      .child(div()
        .flex_none()
        .min_w(16)
        .px(3)
        .h(16)
        .flex()
        .items_center()
        .justify_center()
        .rounded(4)
        .bg(on ? fill : tint(fill, "26"))
        .font_semibold()
        .text_size(9)
        .text_color(on ? ink : fill)
        .tooltip(`${count} 个终端`)
        .child(div().line_height("9px").child(String(count))))
      .child(div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(14)
        .text_color(fill)
        .when(on, (el) => el.font_semibold())
        .child(clean(s.name) || base(folder ?? s.folder) || "未命名空间"))
      .when(Boolean(branch), (el) => el.child(div().flex_none().max_w(96).truncate().text_size(11).text_color(t.dim).tooltip(branch ?? "").child(branch ?? "")))
      .when(has, (el) => el.child(dot(t, s.status, 7)));
  }

  // 目录层用「文件夹图标 + 深色粗体名」，空间层用「数字徽章 + 彩色名」——
  // 两层靠符号形状区分，不再靠字号大小去猜；组与组之间一条细分隔线。
  projectRow(g, t, fill) {
    const folded = this.fold.has(g.root);
    const open = g.spaces.filter((x) => x.space).length;
    return h_flex()
      .id(`wb-p-${g.root}`)
      .h(27)
      .flex_none()
      .px(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(g.root)
      .accessibility_label(`目录 ${base(g.root)} ${open}/${g.spaces.length}`)
      .on_click((_e, cx) => this.toggleFold(g.root, cx))
      .on_mouse_down("right", () => this.menu({ id: g.spaces.find((x) => x.space)?.space.id, folder: g.root }, "space"))
      .child(svg(folded ? "mods/workspace-chrome/chevron-right.svg" : "mods/workspace-chrome/chevron-down.svg").size(11).flex_none().text_color(t.dim))
      .child(svg("mods/workspace-chrome/folder.svg").size(13).flex_none().text_color(fill ?? t.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(base(g.root)))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(`${open}/${g.spaces.length}`));
  }

  // rail 模式：一个空间只剩它的彩色数字徽章，名字和分支收进 tooltip。
  railSpace(s, t, fill) {
    const on = Boolean(s.active);
    const count = (s.tabs ?? []).length;
    const ink = luminance(fill) < 0.5 ? "#f7faf8" : "#14131a";
    return h_flex()
      .id(`wb-rs-${s.id}`)
      .h(28)
      .flex_none()
      .justify_center()
      .items_center()
      .cursor_pointer()
      .when(on, (el) => el.bg(tint(fill, "1a")))
      .when(!on, (el) => el.hover((h) => h.bg(t.hover)))
      .tooltip(`${clean(s.name) || base(s.folder) || "未命名空间"} · ${count} 个终端 · ${statusLabel(s.status)}`)
      .accessibility_label(`${clean(s.name) || "未命名空间"} · ${count} 个终端`)
      .on_click(() => (on ? null : run("space.select", { id: s.id })))
      .on_mouse_down("right", () => this.menu({ id: s.id }))
      .child(div()
        .min_w(20)
        .px(4)
        .h(20)
        .flex()
        .items_center()
        .justify_center()
        .rounded(5)
        .bg(on ? fill : tint(fill, "26"))
        .font_semibold()
        .text_size(10)
        .text_color(on ? ink : fill)
        .child(div().line_height("10px").child(String(count))));
  }

  // rail 模式下的目录头：一个 folder 图标，点一下折叠整组。
  railProject(g, t, fill) {
    const folded = this.fold.has(g.root);
    return h_flex()
      .id(`wb-rp-${g.root}`)
      .h(24)
      .flex_none()
      .justify_center()
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(`${base(g.root)}${folded ? " · 已折叠" : ""}`)
      .accessibility_label(`目录 ${base(g.root)}`)
      .on_click((_e, cx) => this.toggleFold(g.root, cx))
      .on_mouse_down("right", () => this.menu({ id: g.spaces.find((x) => x.space)?.space.id, folder: g.root }, "space"))
      .child(svg("mods/workspace-chrome/folder.svg").size(14).flex_none().text_color(fill ?? t.muted));
  }

  // 组下没有工作树可列时，说清是哪一种空（扫描中 / 不是仓库 / 只有主工作树），
  // 别让一个空白的项目看起来像坏了。
  hintRow(g, t) {
    if (!gitOn()) return null;
    let text = null;
    // 非 Git 目录永远扫不到工作树，先判 repo：否则会一直停在「正在扫描」。
    if (!g.repo) text = "不在 Git 仓库中";
    else if (!g.scanned) text = "正在扫描工作树…";
    else if (g.trees.length <= 1) text = "没有其他工作树 · 右键项目新建";
    if (!text) return null;
    return div().pl(30).pr(8).py(2).text_size(11).text_color(t.dim).child(text);
  }

  render(cx) {
    const t = theme();
    const groups = this.groups();
    const colors = this.colors();
    const total = agents().length;
    const needs = agents().filter((a) => a.status === "blocked").length;
    const rows = [];
    const narrow = rail();
    for (const [gi, g] of groups.entries()) {
      const head = g.spaces.find((x) => x.space)?.space.id;
      const fill = head ? this.fill(t, colors[head] ?? 0) : null;
      if (narrow) {
        rows.push(this.railProject(g, t, fill));
        if (this.fold.has(g.root)) continue;
        for (const item of g.spaces) {
          if (item.space) rows.push(this.railSpace(item.space, t, this.fill(t, colors[item.space.id] ?? 0)));
        }
        continue;
      }
      // 组与组之间一条细分隔线：目录是上一层边界，不是又一行空间。
      if (gi > 0) rows.push(div().h(1).flex_none().mx(8).my(6).bg(t.border));
      rows.push(this.projectRow(g, t, fill));
      if (this.fold.has(g.root)) continue;
      const hint = this.hintRow(g, t);
      if (hint) rows.push(hint);
      for (const item of g.spaces) {
        if (!item.space) {
          rows.push(this.treeRow(item, t));
          continue;
        }
        const s = item.space;
        rows.push(this.spaceRow(item, t, this.fill(t, colors[s.id] ?? 0)));
        if (this.fold.has(s.id)) continue;
        // 每个终端一行：跑着智能体的显示智能体（一个标签可能多个窗格），
        // 普通终端显示程序名——这样徽章上的 tab 数在下面都数得出来。
        const tabs = s.tabs ?? [];
        if (!tabs.length) {
          rows.push(div().pl(38).pr(8).py(2).text_size(11).text_color(t.dim).child("还没有终端"));
          continue;
        }
        const list = agents();
        for (const c of tabs) {
          const mine = list.filter((a) => a.tab === c.id);
          if (mine.length) for (const a of mine) rows.push(this.agentRow(a, t));
          else rows.push(this.termRow(s, c, t));
        }
      }
    }
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .child(narrow
        ? v_flex()
          .py(4)
          .gap(2)
          .items_center()
          .when(window()?.platform === "macos", (el) => el.child(div()
            .id("inkstone-sidebar-unfold")
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
              run("layout.resize", { id: "sidebar", px: shared("sidebar.width") ?? 272 });
            })
            .child(svg("mods/inkstone-chrome/chevron-right.svg").size(14))))
          .child(div()
            .id("inkstone-space-new")
            .size(24)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(6)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip("新建空间")
            .accessibility_label("新建空间")
            .on_click(() => run("space.new"))
            .child(svg("mods/workspace-chrome/plus.svg").size(14)))
        : h_flex()
          .h(32)
          .pl(16)
          .pr(10)
          .items_center()
          .justify_between()
          .text_size(12)
          .text_color(t.dim)
          .child("工作台")
          .child(h_flex()
            .gap(6)
            .items_center()
            .when(needs > 0, (el) => el.child(div().text_size(11).text_color(t.blocked).child(`${needs} 待处理`)))
            .child(div().text_size(11).child(`${total} 智能体`))
            .child(div()
              .id("inkstone-space-new")
              .size(24)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(6)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .tooltip("新建空间")
              .accessibility_label("新建空间")
              .on_click(() => run("space.new"))
              .child(svg("mods/workspace-chrome/plus.svg").size(14)))))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(narrow ? 4 : 8)
        .pb(12)
        .gap(1)
        .overflow_y_scrollbar()
        .mode("always")
        .track_scroll(this.scroll)
        .children(rows.length ? rows : [div().px(10).py(8).text_size(12).text_color(t.dim).child("还没有空间 · 点上面的 + 新建")]));
  }
}
