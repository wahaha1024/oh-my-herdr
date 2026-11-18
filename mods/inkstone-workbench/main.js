// Oh My Herdr 工作台侧栏：按项目（git 仓库）归拢工作树，工作树下直接嵌智能体。
// 融合 2code 的「项目 / 工作树树形导航」与 Orca 的「智能体层级透视」：
//  - 每个空间是一次检出的工作树（未打开的工作树暗色列出，点一下即打开）；
//  - 已打开的工作树下面按空间、标签列出其中的智能体与状态；
//  - 右键行打开 inkstone-menu 的中文菜单（工作树 / 空间动作）。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, agents, panes, run, openOverlay, exec, hc, checking, theme, shared, setShared, layout, window } from "herdr";
import { sprite, glyph, assign, NAMES, FOLDER } from "./sprites.js";

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

// —— 侧栏底部「待你处理 / 进行中」用到的纯函数 ——
// 相对时间：侧栏最窄只剩 200 多像素，放不下「3 分钟」，改成 3m / 2h / 1d。
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

// 程序图标：单色 glyph 用 svg 上色，彩色图标用 image 原样贴。
function progIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint
    ? svg(p.icon).size(size).flex_none().text_color(color)
    : image(p.icon).w(size).h(size).flex_none();
}

// 被卡住的智能体在问什么：hc read 打出它的屏幕，取最后一条像问句的行。
// 屏幕里混着框线、行号、状态栏、空提示符：先剥框线，再排除像代码的行（问句是自然语言）。
// 只作卡片的一行说明，抓不到就留空串，不影响别的功能。
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

// —— 纸墨语汇 ——
// 纸感只在定义了 paper 槽的主题下渲染：Looseleaf 的纸墨资产是硬编码浅色，不读主题。
const PAPER = (t) => Boolean(t.paper);
const inkOf = (t, slot, fallback) => (PAPER(t) ? t[slot] : (t[fallback] ?? t.foreground));

// 羊皮纸只有 144..400 的 17 档：绘制时按实际宽度拉伸（最大变形 8px，撕边看不出），档位取最近，避免 404。
const PARCHMENT = [144, 160, 176, 192, 208, 224, 240, 256, 272, 288, 304, 320, 336, 352, 368, 384, 400];
const nearestSheet = (w) => PARCHMENT.reduce((best, v) => (Math.abs(v - w) < Math.abs(best - w) ? v : best), PARCHMENT[0]);
const PAD = 5, TALL = 1600;

// 一整张纸沿侧栏铺下来，这块画它的 mid（只露两侧）：接在顶块的纸沿下、页脚的上方。
function sheet(view, part, content) {
  const w = Math.max(1, view.sheetW ?? 240), h = Math.max(1, view.sheetH ?? 400);
  const W = nearestSheet(w);
  const art = () => image(`mods/inkstone-chrome/ink/parchment-${W}.svg`).absolute().left(-PAD).w(w + 2 * PAD).h(TALL + 2 * PAD);
  const crop = part === "top" ? div().absolute().left(0).top(-PAD).w(w).h(h + PAD).overflow_hidden().child(art().top(0))
    : part === "foot" ? div().absolute().left(0).bottom(-PAD).w(w).h(h + PAD).overflow_hidden().child(art().bottom(0))
    : div().absolute().left(0).top(0).w(w).h(h).overflow_hidden().child(art().top(-520));
  return div().size_full().px(8)
    .child(div().id(`${part}-sheet`).relative().size_full()
      .on_size_change((size, cx) => {
        if (Math.abs((view.sheetW ?? 0) - size.width) >= 1 || Math.abs((view.sheetH ?? 0) - size.height) >= 1) {
          view.sheetW = size.width;
          view.sheetH = size.height;
          cx.notify();
        }
      })
      .child(crop)
      .child(div().relative().size_full().child(content)));
}

// 荧光笔：选中实色、悬停半透，边角不等（3/8/4/9）；非纸主题退回 t.selected / t.hover。
const swipeOn = (t, el) => (PAPER(t)
  ? el.bg("#f8dc4c9e").rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9)
  : el.bg(t.selected).rounded(6));
const swipeHover = (t, el) => (PAPER(t)
  ? el.rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9).hover((s) => s.bg("#f8dc4c4d"))
  : el.hover((s) => s.bg(t.hover)));

// 空间标记：默认沿用上一版的像素精灵；偏好里可以切成头像式标记。
const markMode = () => (shared("inkstone.spaces.mark") === "avatar" ? "avatar" : "sprite");
const TONE = { 0: "tomato", 1: "tangerine", 2: "lemon", 3: "grass", 4: "sky", 5: "grape", 6: "bubblegum" };

// 头像式空间标记：色相仍由空间的调色板序号决定（与像素精灵一一对应），字母取名字首字，
// 状态点在右下角（待处理 = 忙，已完成 = 在线）。
function avatar(t, idx, letter, status) {
  const tone = TONE[Math.abs(Number(idx) || 0) % 7] ?? "teal";
  const dot = status === "blocked" ? "busy" : status === "done" ? "online" : null;
  return div().relative().size(22).flex_none().flex().items_center().justify_center()
    .text_size(12).font_weight(700).text_color(PAPER(t) ? t.ink : t.foreground)
    .child(image(`mods/inkstone-chrome/ink/av-${tone}.svg`).absolute().left(-6).top(-6).size(34))
    .child(image("mods/inkstone-chrome/ink/av-ring.svg").absolute().left(-8).top(-8).size(38))
    .child(div().relative().child(letter))
    .when(Boolean(dot), (el) => el.child(image(`mods/inkstone-chrome/ink/av-dot-${dot}.svg`).absolute().right(-7).bottom(-7).size(17)));
}

// 像素精灵那条路径原样保留（sprites.js 的 8×8 图案）。
const spriteArt = (art, fill) => sprite(art, fill, { div, v_flex, h_flex }, 2);

export default class Workbench extends View {
  init(_props, cx) {
    this.scroll = ScrollHandle.new();
    this.fold = new Set(shared("inkstone.folded") ?? []);
    this.repos = {}; // 目录 -> { root, branch } | null
    this.trees = {}; // 项目根 -> { at, list: [{ path, branch, main }] }
    this.refresh(cx);
    cx.timer.every(30000, (cx) => this.refresh(cx));
    // 底部两块：相对时间的基准，以及被卡住智能体的提问原文（5 秒抓一次）。
    this.now = Date.now();
    this.asking = false;
    cx.timer.every(30000, (cx) => {
      this.now = Date.now();
      cx.notify();
    });
    cx.timer.every(5000, (cx) => this.pollAsks(cx));
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
          // 领先 / 落后上游的提交数：没有上游就当作 0，尾巴只在异常时显示。
          const counts = br?.code === 0
            ? await exec("git", [...git, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd: folder, on }).catch(() => null)
            : null;
          const [ahead, behind] = counts?.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
          this.repos[folder] = {
            at: Date.now(),
            value: top?.code === 0
              ? { root: top.stdout.trim(), branch: br?.stdout.trim() || null, ahead: ahead || 0, behind: behind || 0 }
              : null,
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

  // 空间图案：8×8 像素精灵，替代原来的数字徽章。
  // 存的是名字（slime/ghost/…），新空间拿用得最少的那个；删掉已经不存在的空间。
  sprites() {
    const kept = { ...(shared("inkstone.sprites") ?? {}) };
    const list = spaces();
    const ids = new Set(list.map((s) => s.id));
    let changed = false;
    for (const id of Object.keys(kept)) {
      if (!ids.has(id) || !NAMES.includes(kept[id])) {
        delete kept[id];
        changed = true;
      }
    }
    const next = assign(list, kept);
    if (next.changed || changed) setShared("inkstone.sprites", next.out);
    return next.out;
  }

  // Alt+点击图案：按 sprites.js 里的顺序换到下一个。
  cycleSprite(id, cx) {
    const all = { ...(shared("inkstone.sprites") ?? {}) };
    const at = NAMES.indexOf(all[id]);
    all[id] = NAMES[(at + 1) % NAMES.length];
    setShared("inkstone.sprites", all);
    cx.notify();
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
      byRoot.get(root).spaces.push({
        space: s,
        folder: here,
        branch: gitOn() ? (repo?.branch ?? s.branch) : null,
        name: repo?.root ? base(repo.root) : base(here ?? s.folder),
        ahead: repo?.ahead ?? 0,
        behind: repo?.behind ?? 0,
        repo: Boolean(repo),
      });
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
      .h(26)
      .flex_none()
      .pl(38)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(PAPER(t) ? "#f8dc4c4d" : t.hover))
      .tooltip(`${name}\n${detail}`)
      .accessibility_label(`${name} ${detail}`)
      .on_click(() => this.openAgent(a))
      .child(dot(t, a.status, 7))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(a.status === "blocked" ? t.blocked : t.foreground).child(name))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(a.status === "blocked" ? "待处理" : a.status === "done" ? "已完成" : ""));
  }

  // 点智能体行/卡片：切到它的空间与标签，再把焦点给那个终端。
  // 只在确实要换空间/标签时才切换：每次切换都会重建终端视图并重放 scrollback。
  openAgent(a) {
    const sp = spaces().find((s) => s.id === a.space);
    if (sp && !sp.active) run("space.select", { id: a.space });
    const tb = sp?.tabs?.find((x) => x.id === a.tab);
    if (tb && !tb.active) run("tab.select", { id: a.tab });
    run("agent.focus", { terminal: a.address });
  }

  // —— Spaces 下面两块：待你处理 / 进行中 ——
  // 分区头：字形箭头 + 标题 + 计数。折起来只收内容，标题与数字留着。
  flowHead(key, label, n, color, t, open, cx) {
    return h_flex()
      .id(`wb-flow-${key}`)
      .h(26)
      .flex_none()
      .px(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(PAPER(t) ? "#f8dc4c26" : t.hover))
      .tooltip(open ? `收起${label}` : `展开${label}`)
      .accessibility_label(`${label} ${n}`)
      .on_click(() => this.toggleFlow(key, cx))
      .child(svg(open ? "mods/inkstone-chrome/chevron-down.svg" : "mods/inkstone-chrome/chevron-right.svg").size(10).flex_none().text_color(t.dim))
      .child(div().flex_none().text_size(11).font_weight(700).text_color(color).child(label))
      .child(div().flex_none().px(5).rounded(8).bg(PAPER(t) ? tint(color, "22") : t.raised).text_size(10).text_color(inkOf(t, "pencil", "muted")).child(String(n)))
      .child(div().flex_1());
  }

  toggleFlow(key, cx) {
    const open = { needs: true, flight: true, ...(shared("inkstone.flow.open") ?? {}) };
    open[key] = !open[key];
    setShared("inkstone.flow.open", open);
    cx.notify();
  }

  // 空间名 chip：颜色跟上面的空间行同源（spaceColors + 明暗档），不做哈希着色，
  // 免得同一个空间在两处是两个颜色。
  spaceChip(name, id, t, colors) {
    const c = this.fill(t, colors[id] ?? 0);
    return div().flex_none().max_w(110).truncate().px(5).py(1).rounded(3)
      .bg(tint(c, PAPER(t) ? "1f" : "26"))
      .text_size(11)
      .text_color(c)
      .child(name);
  }

  // 等你处理：一个卡住的智能体一张卡片——卡在哪、哪个空间、卡了多久、在问什么。
  askCard(a, t, asks, colors) {
    const name = clean(a.title) || a.program?.name || a.app || a.address;
    const space = clean(a.space_name) || a.address;
    const q = asks[a.address] ?? "";
    const icon = progIcon(a.program, 12, t.muted);
    return v_flex()
      .id(`wb-ask-${a.address}`)
      .flex_none()
      .mx(2)
      .mb(6)
      .px(8)
      .py(6)
      .gap(3)
      .rounded(8)
      .bg(t.raised)
      .border(1)
      .border_color(tint(t.blocked, PAPER(t) ? "55" : "44"))
      .cursor_pointer()
      .hover((s) => s.bg(tint(t.blocked, PAPER(t) ? "12" : "1a")))
      .tooltip(q ? `${name}\n${q}` : name)
      .accessibility_label(`${name} 待处理`)
      .on_click(() => this.openAgent(a))
      .child(h_flex()
        .gap(6)
        .items_center()
        .child(div().size(7).flex_none().rounded_full().bg(t.blocked).loop("opacity", { from: 0.35, to: 1, period: 900 }))
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_weight(600).text_color(inkOf(t, "ink", "foreground")).child(name))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(ago(sinceOf(a), this.now ?? Date.now()))))
      .child(h_flex()
        .pl(13)
        .gap(6)
        .items_center()
        .when(Boolean(icon), (el) => el.child(icon))
        .child(this.spaceChip(space, a.space, t, colors))
        .child(div().flex_none().text_size(11).font_weight(600).text_color(t.blocked).child("等你处理"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(a.program?.name ?? a.app ?? "")))
      .when(Boolean(q), (el) => el.child(div().pl(13).text_size(11).text_color(inkOf(t, "pencil", "muted")).truncate().child(q)));
  }

  // 进行中：两行——在干什么 / 在哪个空间、什么程序、跑了多久。
  flightRow(a, t, colors) {
    const name = clean(a.title) || a.program?.name || a.app || a.address;
    const space = clean(a.space_name) || a.address;
    const icon = progIcon(a.program, 12, t.muted);
    return v_flex()
      .id(`wb-fly-${a.address}`)
      .flex_none()
      .px(8)
      .py(4)
      .gap(2)
      .rounded(6)
      .cursor_pointer()
      .when(a.focused, (el) => swipeOn(t, el))
      .when(!a.focused, (el) => swipeHover(t, el))
      .tooltip(`${name}\n${statusLabel(a.status)} · ${a.tab_name ?? ""} · ${a.address}`)
      .accessibility_label(`${name} 运行中`)
      .on_click(() => this.openAgent(a))
      .child(h_flex()
        .gap(6)
        .items_center()
        .child(svg("mods/inkstone-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(name))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(ago(sinceOf(a), this.now ?? Date.now()))))
      .child(h_flex()
        .pl(18)
        .gap(6)
        .items_center()
        .when(Boolean(icon), (el) => el.child(icon))
        .child(this.spaceChip(space, a.space, t, colors))
        .child(div().flex_none().text_size(11).text_color(t.working).child("运行中"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(a.program?.name ?? a.app ?? "")));
  }

  // 卡住的智能体在问什么：每 5 秒抓一次，结果进 shared，重绘时直接用。
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

  // 没跑智能体的终端也要有自己一行：否则徽章上的 tab 数在下面找不到对应的行。
  termRow(s, c, t) {
    const ps = panes();
    const lead = ps.find((p) => p.tab === c.id);
    const prog = lead?.program;
    const name = clean(c.name) || prog?.name || "终端";
    return h_flex()
      .id(`wb-tab-${c.id}`)
      .h(26)
      .flex_none()
      .pl(38)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .when(Boolean(c.active && s.active), (el) => swipeOn(t, el))
      .when(!(c.active && s.active), (el) => el.hover((h) => h.bg(PAPER(t) ? "#f8dc4c4d" : t.hover)))
      .tooltip(`${lead?.cwd ?? s.folder ?? ""}${prog?.name ? `\n${prog.name}` : ""}`)
      .accessibility_label(`终端 ${name}`)
      .on_click(() => {
        if (!s.active) run("space.select", { id: s.id });
        if (!c.active) run("tab.select", { id: c.id });
      })
      .child(prog?.icon
        ? (prog.tint ? svg(prog.icon).size(13).flex_none().text_color(t.muted) : image(prog.icon).size(16).flex_none())
        : svg("mods/inkstone-chrome/terminal.svg").size(13).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(name));
  }

  treeRow(w, t, n = 0) {
    return h_flex()
      .id(`wb-t-${w.path}`)
      .h(26)
      .flex_none()
      .relative()
      .ml(20)
      .pl(6)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .when(Boolean(w.active), (el) => swipeOn(t, el))
      .when(!w.active, (el) => swipeHover(t, el))
      // 铅笔竖线：一条长线裁一段，按同级序号偏移，让同组的工作树连成一条。
      .when(PAPER(t), (el) => el.child(div()
        .absolute().left(0).top(-2).w(2).h(30).overflow_hidden()
        .child(image("mods/inkstone-chrome/ink/rule-v.svg").absolute().left(-12).top(-12 - n * 33).w(26).h(2424))))
      .cursor_pointer()
      .tooltip(`${w.folder}\n未打开 · 点一下在此工作树中新建空间`)
      .on_click(() => run("space.new", { folder: w.folder, name: base(w.folder) }))
      .child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(base(w.folder)))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(w.branch ?? ""));
  }

  // 空间行：30 高、14 号彩色名字 + tab 数，夹在 27 高的项目头与 26 高的终端行之间，
  // 三层用高度、字号、颜色分开。选中是一道荧光笔，其他主题仍是淡色底。
  spaceRow({ space: s, folder, branch, name, ahead, behind, repo }, t, fill, art, colorIndex, mark) {
    const on = s.active;
    const has = s.status === "blocked" || s.status === "done" || s.status === "working";
    const folded = this.fold.has(s.id);
    const count = (s.tabs ?? []).length;
    const label = clean(s.name) || base(folder ?? s.folder) || "未命名空间";
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
      .when(on, (el) => swipeOn(t, el))
      .when(!on, (el) => swipeHover(t, el))
      .tooltip(`${folder ?? s.folder}${branch ? `\n${branch}` : ""}`)
      .accessibility_label(`${label} · ${count} 个终端 · ${statusLabel(s.status)}`)
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
      // 空间标记是它的固定身份：颜色分目录归属，字母 / 图案分空间。
      .child(this.mark(s.id, t, { mode: mark, art, fill, idx: colorIndex, letter: label, status: s.status, tip: `${count} 个终端` }))
      .child(div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(14)
        .text_color(fill)
        .when(on, (el) => el.font_semibold())
        .child(label))
      // 终端数从徽章里搬到这里：图案只剩身份，数量用小字跟在名字后。
      .child(div().flex_none().text_size(10).text_color(t.dim).child(String(count)))
      .when(gitOn() && repo, (el) => el.child(this.gitTail({ branch, name, ahead, behind }, label, t)))
      .when(has, (el) => el.child(dot(t, s.status, 7)));
  }

  // 空间的标记：偏好的头像（默认）或像素精灵，两条路径都是活的。
  mark(id, t, { mode, art, fill, idx, letter, status, tip }) {
    const sprite = mode === "sprite";
    return div()
      .id(`wb-sp-${id}`)
      .flex_none()
      .when(sprite, (el) => el.h(16).flex().items_center().justify_center().cursor_pointer())
      .tooltip(sprite ? `${tip} · Alt+点击换图案` : tip)
      .accessibility_label(`空间标记 ${sprite ? art : [...letter][0] ?? ""}`)
      .on_mouse_down("left", (e, cx) => {
        if (!e.modifiers.alt) return;
        cx.stop_propagation();
        if (sprite) this.cycleSprite(id, cx);
      })
      .child(sprite ? spriteArt(art, fill) : avatar(t, idx, [...letter][0]?.toUpperCase() ?? "·", status));
  }

  // 铅笔尾巴：分支名与空间名同名（或就是 main / master）、仓库名与空间名同名时都不显示；
  // ↑ / ↓ 只在有领先 / 落后时才出现——正常状态下一律安静。
  gitTail(g, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => (a ?? "").toLowerCase() === (name ?? "").toLowerCase();
    // 只有异常才占位置：分支是 main/master、或与空间同名时都不写，仓库名由组头承担。
    const where = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    return h_flex()
      .flex_none()
      .gap(5)
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().max_w(96).min_w(0).truncate().tooltip(where).child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().font_semibold().text_color(inkOf(t, "up", "done")).child(`↑${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().font_semibold().text_color(inkOf(t, "down", "blocked")).child(`↓${g.behind}`)));
  }

  // 目录层用「文件夹图标 + 深色粗体名」，空间层用「标记 + 彩色名」——
  // 两层靠符号形状区分；纸感下项目头下面一条铅笔线，组与组之间不再另加灰线。
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
      .when(PAPER(t), (el) => el
        .relative()
        .rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9)
        .hover((s) => s.bg("#f8dc4c4d"))
        .child(div().absolute().left(6).right(6).bottom(-2).h(1).bg("#b2c3dcb8")))
      .when(!PAPER(t), (el) => el.hover((s) => s.bg(t.hover)))
      .tooltip(g.root)
      .accessibility_label(`目录 ${base(g.root)} ${open}/${g.spaces.length}`)
      .on_click((_e, cx) => this.toggleFold(g.root, cx))
      .on_mouse_down("right", () => this.menu({ id: g.spaces.find((x) => x.space)?.space.id, folder: g.root }, "space"))
      .child(svg(folded ? "mods/workspace-chrome/chevron-right.svg" : "mods/workspace-chrome/chevron-down.svg").size(11).flex_none().text_color(t.dim))
      .child(glyph(FOLDER, fill ?? t.muted, { div, v_flex, h_flex }, 2))
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(base(g.root)))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(`${open}/${g.spaces.length}`));
  }

  // rail 模式：一个空间只剩它的标记，名字、终端数与分支收进 tooltip。
  railSpace(s, t, fill, art, colorIndex, mark) {
    const on = Boolean(s.active);
    const count = (s.tabs ?? []).length;
    const label = clean(s.name) || base(s.folder) || "未命名空间";
    return h_flex()
      .id(`wb-rs-${s.id}`)
      .h(28)
      .flex_none()
      .justify_center()
      .items_center()
      .cursor_pointer()
      .when(on, (el) => swipeOn(t, el))
      .when(!on, (el) => swipeHover(t, el))
      .tooltip(`${label} · ${count} 个终端 · ${statusLabel(s.status)}`)
      .accessibility_label(`${label} · ${count} 个终端`)
      .on_click(() => (on ? null : run("space.select", { id: s.id })))
      .on_mouse_down("right", () => this.menu({ id: s.id }))
      .child(this.mark(s.id, t, { mode: mark, art, fill, idx: colorIndex, letter: label, status: s.status, tip: `${count} 个终端` }));
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
      .hover((s) => s.bg(PAPER(t) ? "#f8dc4c4d" : t.hover))
      .tooltip(`${base(g.root)}${folded ? " · 已折叠" : ""}`)
      .accessibility_label(`目录 ${base(g.root)}`)
      .on_click((_e, cx) => this.toggleFold(g.root, cx))
      .on_mouse_down("right", () => this.menu({ id: g.spaces.find((x) => x.space)?.space.id, folder: g.root }, "space"))
      .child(glyph(FOLDER, fill ?? t.muted, { div, v_flex, h_flex }, 2));
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

  // 新建空间的墨线纸片：一张手绘方片，悬停换描深一档（Looseleaf 的 ib-c）。
  newSlip() {
    const t = theme();
    const lit = Boolean(this.newLit);
    return div()
      .id("inkstone-space-new")
      .relative().size(28).flex_none().flex().items_center().justify_center()
      .cursor_pointer()
      .text_color(lit ? inkOf(t, "ink", "foreground") : "#4a423b")
      .on_hover((h, cx) => {
        this.newLit = h;
        cx.notify();
      })
      .on_click(() => run("space.new"))
      .tooltip("新建空间")
      .accessibility_label("新建空间")
      .child(image(`mods/inkstone-chrome/ink/ib-c${lit ? "-on" : ""}.svg`).absolute().left(-12).top(-12).w(52).h(52))
      .child(svg("mods/inkstone-chrome/plus.svg").size(16).relative());
  }

  render(cx) {
    const t = theme();
    const groups = this.groups();
    const colors = this.colors();
    const art = this.sprites();
    const total = agents().length;
    const needs = agents().filter((a) => a.status === "blocked").length;
    const rows = [];
    const narrow = rail();
    const mark = markMode();
    const paper = PAPER(t) && !narrow;
    for (const [gi, g] of groups.entries()) {
      const head = g.spaces.find((x) => x.space)?.space.id;
      const fill = head ? this.fill(t, colors[head] ?? 0) : null;
      if (narrow) {
        rows.push(this.railProject(g, t, fill));
        if (this.fold.has(g.root)) continue;
        for (const item of g.spaces) {
          if (item.space) rows.push(this.railSpace(item.space, t, this.fill(t, colors[item.space.id] ?? 0), art[item.space.id] ?? "slime", colors[item.space.id] ?? 0, mark));
        }
        continue;
      }
      // 组与组之间一条细分隔线：目录是上一层边界，不是又一行空间。纸感下改由项目头的铅笔线承担。
      if (gi > 0 && !PAPER(t)) rows.push(div().h(1).flex_none().mx(8).my(6).bg(t.border));
      rows.push(this.projectRow(g, t, fill));
      if (this.fold.has(g.root)) continue;
      const hint = this.hintRow(g, t);
      if (hint) rows.push(hint);
      let trees = 0;
      for (const item of g.spaces) {
        if (!item.space) {
          rows.push(this.treeRow(item, t, trees++));
          continue;
        }
        const s = item.space;
        rows.push(this.spaceRow(item, t, this.fill(t, colors[s.id] ?? 0), art[s.id] ?? "slime", colors[s.id] ?? 0, mark));
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
    // Spaces 下面：等你的与在跑的智能体。追加进同一个滚动列表，不改动上面的空间行。
    if (!narrow) {
      const list = agents();
      const asks = shared("inkstone.asks") ?? {};
      const open = shared("inkstone.flow.open") ?? {};
      const waiting = list.filter((a) => a.status === "blocked").sort((a, b) => b.seq - a.seq);
      const running = list.filter((a) => a.status === "working").sort((a, b) => b.seq - a.seq);
      if (waiting.length) {
        const showNeeds = open.needs !== false;
        rows.push(div().h(10).flex_none());
        rows.push(this.flowHead("needs", "待你处理", waiting.length, t.blocked, t, showNeeds, cx));
        if (showNeeds) for (const a of waiting) rows.push(this.askCard(a, t, asks, colors));
      }
      const showFlight = open.flight !== false;
      rows.push(div().h(10).flex_none());
      rows.push(this.flowHead("flight", "进行中", running.length, t.working, t, showFlight, cx));
      if (showFlight) {
        if (!running.length) rows.push(div().px(10).py(4).flex_none().text_size(11).text_color(t.dim).child("暂无运行中的智能体"));
        else for (const a of running) rows.push(this.flightRow(a, t, colors));
      }
    }
    const inner = v_flex()
      .size_full()
      .min_h(0)
      .bg(paper ? t.paper : t.chrome)
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
          .h(44)
          .pl(12)
          .pr(10)
          .mb(4)
          .items_center()
          .justify_between()
          .border_b(1)
          .border_color(tint(t.border, "77"))
          .child(div()
            .text_size(paper ? 15.5 : 18)
            .line_height(paper ? "17px" : "19px")
            .font_bold()
            .text_color(inkOf(t, "ink", "foreground"))
            .child("Spaces"))
          .child(h_flex()
            .gap(6)
            .items_center()
            .when(needs > 0, (el) => el.child(h_flex()
              .h(20)
              .px(6)
              .gap(4)
              .items_center()
              .rounded(5)
              .bg(tint(t.blocked, "18"))
              .border(1)
              .border_color(tint(t.blocked, "44"))
              .child(div().size(5).rounded_full().bg(t.blocked))
              .child(div().text_size(10.5).font_semibold().text_color(t.blocked).child(`${needs}`))))
            .child(h_flex()
              .h(20)
              .px(7)
              .gap(4)
              .items_center()
              .rounded(5)
              .bg(t.raised)
              .border(1)
              .border_color(t.border)
              .child(div().size(5).rounded_full().bg(total > 0 ? t.accent : t.dim))
              .child(div().text_size(10.5).text_color(t.muted).child((needs > 0 || (findNode(layout(), "sidebar")?.size?.px ?? 999) < 250) ? `${total}` : `${total} 智能体`)))
            .child(paper
              ? this.newSlip()
              : div()
                .id("inkstone-space-new")
                .size(24)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(6)
                .bg(t.raised)
                .border(1)
                .border_color(t.border)
                .text_color(t.muted)
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
    // 纸感下这一块画同一张纸上的一段（只露两侧），上接标题块的纸沿、下接页脚。
    return paper ? sheet(this, "mid", inner) : inner;
  }
}
