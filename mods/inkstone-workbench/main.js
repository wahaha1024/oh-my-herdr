// Oh My Herdr 工作台侧栏：按项目（git 仓库）归拢工作树，工作树下直接嵌智能体。
// 融合 2code 的「项目 / 工作树树形导航」与 Orca 的「智能体层级透视」：
//  - 每个空间是一次检出的工作树（未打开的工作树暗色列出，点一下即打开）；
//  - 已打开的工作树下面按空间、标签列出其中的智能体与状态；
//  - 右键行打开 inkstone-menu 的中文菜单（工作树 / 空间动作）。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, agents, panes, machines, run, openOverlay, exec, theme, shared, setShared, layout } from "herdr";
import { sprite, glyph, assign, NAMES, FOLDER } from "./sprites.js";

// 中英切换：shared 改动会让所有 mod 重绘，切换语言立即生效。
const LANG = "inkstone.lang";
const pick = (zh, en) => (shared(LANG) === "en" ? en : zh);

const git = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
// 机器层（This computer / myserver…）在最上面，目录层往下缩进一档；
// 下面几处行内的左内边距都按 IND 加，层次一眼能数出来。
const IND = 10;
const PAD = 12; // 根目录下的子项目比根目录行再缩进这么多
const LOCAL = "This computer";
// 缓存键带上机器：两台机器上同名目录不能共用一份 git 探测结果。
const mkey = (on, path) => `${on ?? ""}\u0000${path ?? ""}`;
const base = (path) => (path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path || "~";
const samePath = (a, b) => (a ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === (b ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

// 空间归属哪个项目：显式归属 > 项目目录内的实时目录 > 空间目录。
// 智能体把 cwd 挪到项目之外时不再跟着跳组——「会话归到别处」正是这么来的。
const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const under = (path, parent) => {
  const a = norm(path), b = norm(parent);
  return Boolean(a) && Boolean(b) && a.startsWith(`${b}/`);
};
const bindsOf = () => shared("inkstone.bindings") ?? {};
// 机器根目录：每台机器可以指定一个目录，侧栏在它下面先留一行，右键就能在那里新建子项目。
const rootsOf = () => shared("inkstone.roots") ?? {};

// 一个仓库在侧栏里只占一个项目：工作树的 --show-toplevel 是它自己，只有 --git-common-dir
// 才指向主仓库。主仓库给相对路径 ".git"，工作树给绝对路径，两种都归到同一个父目录。
function projectOf(value) {
  const root = String(value?.root ?? "").trim();
  if (!root) return null;
  const raw = String(value?.common ?? "").trim();
  if (!raw) return root;
  const sep = root.includes("\\") ? "\\" : "/";
  const abs = /^([A-Za-z]:[\\/]|[\\/])/.test(raw)
    ? raw
    : `${root.replace(/[\\/]+$/, "")}${sep}${raw.replace(/^\.\//, "")}`;
  // 结尾的 "." 是裸仓库的写法（--git-common-dir 给 "."），先归一。
  const clean = abs.replace(/[\\/]+\.?$/, "").replace(/[\\/]+$/, "");
  // 普通仓库与工作树都以 ".git" 结尾；裸仓库 / --separate-git-dir 直接用该目录。
  if (clean.split(/[\\/]/).pop() !== ".git") return clean;
  return clean.replace(/[\\/][^\\/]+$/, "") || root;
}

function place(s, ps, binds) {
  // 显式归属由「设置归属目录…」写入 shared，重启后仍然有效。
  const bound = binds?.[s.id];
  if (bound) return bound;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  const live = ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd;
  if (!live) return s.folder;
  if (!s.folder) return live;
  return samePath(live, s.folder) || under(live, s.folder) ? live : s.folder;
}

// Git 增强默认关闭（OMH 偏好里可开）：不在 herdr 里用 git 功能时，
// 不扫工作树、不显示分支标签，侧栏只按目录归拢空间。
const gitOn = () => shared("inkstone.git") === true;

const STATUS = () => ({
  blocked: pick("待处理", "Waiting"),
  working: pick("运行中", "Running"),
  done: pick("已完成", "Done"),
  idle: pick("空闲", "Idle"),
});
const statusLabel = (s) => STATUS()[s] ?? pick("无状态", "No status");

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

// 与智能体面板 / 标签栏同一套状态配色：待处理红、运行中琥珀、已完成绿。
const isDark = (t) => luminance(t.background ?? "#ffffff") < 0.5;
const FLOW_RED = (t) => t.blocked ?? "#c23142";
const FLOW_YELLOW = (t) => (PAPER(t) ? t.working : isDark(t) ? (t.working ?? "#e2c027") : "#b78b26");
const FLOW_GREEN = (t) => (PAPER(t) ? (t.up ?? t.done) : (t.done ?? "#1a6840"));
const flowTone = (t, st) => (st === "blocked" ? FLOW_RED(t) : st === "working" ? FLOW_YELLOW(t) : st === "done" ? FLOW_GREEN(t) : null);

// 一个标签可能开着多个窗格：状态取最需要关注的那个（与标签栏同一套优先级）。
const RANK = { blocked: 3, working: 2, done: 1, idle: 0 };
const statusOf = (list, fallback) => {
  let best = fallback ?? "idle";
  for (const a of list) if ((RANK[a.status] ?? 0) > (RANK[best] ?? 0)) best = a.status;
  return best;
};

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

// 标题里常混着终端进度符号、Nerd Font 私有区图标和 emoji。私有区图标（如 pi 的 󰕮）只有
// Nerd 补丁字体才有字形，所以界面字体（settings.json 的 ui_font）要选 JetBrainsMono NF 一类；
// 这里只剥 ANSI、变体选择符、零宽与 emoji，把空白压成单空格。
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

const EDGE_T = 12, EDGE_LONG = 3206, EDGE_TALL = 1794, EDGE_CORNER = 46, EDGE_FOOT = 40;
const EDGE_PRESETS = [
  { bg: "#e8f0ec", muted: "#5f6b67", dir: "ink-qingci" },
  { bg: "#f7f4ed", muted: "#746b5e", dir: "ink-xuanzhi" },
  { bg: "#e9e2d4", muted: "#665f53", dir: "ink-xuanzhi" }, // xuanzhi-dimmed
  { bg: "#14131a", muted: "#8b8597", dir: "ink-xuanmo" },
  { bg: "#19181e", muted: "#8f8996", dir: "ink-xuanmo" }, // xuanmo-dimmed
];
let edgeCacheKey = "";
let edgeCacheDir = null;
function artEdgeDir(t) {
  if (t.paper) return "ink";
  const bg = t.background ?? "", muted = t.muted ?? "";
  const key = `${bg}|${muted}`;
  if (key !== edgeCacheKey) {
    edgeCacheKey = key;
    const p = EDGE_PRESETS.find((x) => x.bg === bg && x.muted === muted)
      ?? EDGE_PRESETS.find((x) => x.bg === bg);
    edgeCacheDir = p ? p.dir : null;
  }
  return edgeCacheDir;
}

// 独立纸边卡片：四周 12px 撕纸毛边 + 内侧青瓷细框，样式对齐主终端区（page）。
function paperCard(view, t, content) {
  const dir = artEdgeDir(t);
  const line = tint(t.accent, "99");
  if (!dir) {
    return div().size_full().min_h(0).pl(6).pr(4).pt(2).pb(1)
      .child(div().size_full().min_h(0).overflow_hidden().rounded(8).border(1).border_color(line).child(content));
  }
  const w = Math.max(120, view._cardW ?? 278);
  const h = Math.max(80, view._cardH ?? 400);
  const EDGE_B = 8;
  const sideH = Math.max(0, h - EDGE_T - EDGE_B);
  const art = (name, iw, ih) => image(`mods/inkstone-edge/${dir}/${name}.svg`).absolute().w(iw).h(ih);
  const hEdge = (side) => {
    const eh = side === "bottom" ? EDGE_B : EDGE_T;
    return div().relative().w_full().h(eh).flex_none().overflow_hidden()
      .child(div().absolute().left(0).top(0).w(Math.max(0, w - EDGE_CORNER)).h(eh).overflow_hidden().child(art(`${side}-l`, EDGE_LONG, EDGE_T).left(0).top(0)))
      .child(div().absolute().right(0).top(0).w(Math.min(w, EDGE_CORNER)).h(eh).overflow_hidden().child(art(`${side}-r`, EDGE_CORNER, EDGE_T).right(0).top(0)));
  };
  const vEdge = (side) => div().relative().w(EDGE_T).h_full().flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(EDGE_T).h(Math.max(0, sideH - EDGE_FOOT)).overflow_hidden().child(art(`${side}-t`, EDGE_T, EDGE_TALL).left(0).top(0)))
    .child(div().absolute().left(0).bottom(0).w(EDGE_T).h(Math.min(sideH, EDGE_FOOT)).overflow_hidden().child(art(`${side}-b`, EDGE_T, EDGE_FOOT).left(0).bottom(0)));
  return div().size_full().min_h(0).pl(4).pr(2)
    .child(v_flex().id("wb-card").size_full().min_h(0)
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
      .child(hEdge("bottom")));
}

// 荧光笔：选中实色、悬停半透，边角不等（3/8/4/9）；非纸主题退回 t.selected / t.hover。
const swipeOn = (t, el) => (PAPER(t)
  ? el.bg("#f8dc4c9e").rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9)
  : el.bg(t.selected).rounded(6));
const swipeHover = (t, el) => (PAPER(t)
  ? el.rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9).hover((s) => s.bg("#f8dc4c4d"))
  : el.hover((s) => s.bg(t.hover)));

const TONE = { 0: "tomato", 1: "tangerine", 2: "lemon", 3: "grass", 4: "sky", 5: "grape", 6: "bubblegum" };

// 字母头像：给根目录下的子项目用，跟空间的像素精灵区分开。
// 色相取名字的字符和，同一个项目每次渲染都是同一个颜色。
const toneOf = (text) => [...String(text ?? "")].reduce((a, c) => a + (c.codePointAt(0) ?? 0), 0);

// 字母头像：色相由序号决定，字母取名字首字，状态点在右下角（待处理 = 忙，已完成 = 在线）。
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
    this.foldM = new Set(shared("inkstone.foldedMachines") ?? []); // 折叠的机器："This computer" / 机器名
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
    const binds = bindsOf();
    const folders = new Map(); // 机器::目录 -> { folder, on }
    for (const s of list) {
      const f = place(s, ps, binds);
      if (f) folders.set(mkey(s.machine ?? null, f), { folder: f, on: s.machine ?? null });
    }
    const key = JSON.stringify([
      [...folders].map(([k, v]) => [k, v.folder]),
      Object.keys(binds).sort().map((k) => [k, binds[k]]),
      machines().map((m) => [m.name, m.layout]),
    ]);
    // 目录探测缓存 5 分钟、工作树列表 30 秒。只看 key 的话定时器形同虚设：
    // 空间没变就永远不再扫，新建的工作树要等下次增删空间才出现。
    // 缓存键必须与写入处一致（带机器前缀），否则每项都判过期、每次刷新重扫所有仓库。
    // 探测失败（超时、SSH 断开）不是「不在 Git 仓库中」：前者下一次刷新（≤30 秒）就重试，后者缓存 5 分钟。
    const GIT_FAIL_TTL = 10000;
    const repoStale = [...folders.keys()].some((fk) => {
      const r = this.repos[fk];
      if (!r) return true;
      return Date.now() - r.at >= (r.failed ? GIT_FAIL_TTL : 300000);
    });
    // 非 Git 目录也过期重试：用户中途 git init 之后不该永远是「不在 Git 仓库中」。
    const treeStale = Object.values(this.repos).some((r) => {
      const p = r?.value ? projectOf(r.value) : null;
      if (!p) return false;
      const tr = this.trees[mkey(r.on ?? null, p)];
      return !tr || Date.now() - tr.at >= 30000;
    });
    if (key === this.key && !repoStale && !treeStale) return;
    this.key = key;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        for (const [fk, { folder, on }] of folders) {
          const cached = this.repos[fk];
          if (cached && Date.now() - cached.at < (cached.failed ? GIT_FAIL_TTL : 300000)) continue;
          const top = await exec("git", [...git, "rev-parse", "--show-toplevel"], { cwd: folder, on }).catch(() => null);
          // 同一仓库的多个工作树必须归到一个项目：「--show-toplevel」给的是各工作树自己，
          // 靠「--git-common-dir」的父目录才能认出主仓库。
          const common = top?.code === 0
            ? await exec("git", [...git, "rev-parse", "--git-common-dir"], { cwd: folder, on }).catch(() => null)
            : null;
          const br = top?.code === 0
            ? await exec("git", [...git, "branch", "--show-current"], { cwd: folder, on }).catch(() => null)
            : null;
          // 领先 / 落后上游的提交数：没有上游就当作 0，尾巴只在异常时显示。
          const counts = br?.code === 0
            ? await exec("git", [...git, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd: folder, on }).catch(() => null)
            : null;
          const [ahead, behind] = counts?.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
          const root = top?.code === 0 ? top.stdout.trim() : null;
          // 只有 git 明确说「不是仓库」才长缓存；超时、SSH 断开等失败 10 秒后就重试。
          const notRepo = top?.code === 128 && /not a git repository/i.test(String(top.stderr ?? ""));
          const failed = !top || (top.code !== 0 && !notRepo);
          this.repos[fk] = {
            at: Date.now(),
            on,
            failed,
            value: root
              ? {
                root,
                project: projectOf({ root, common: common?.code === 0 ? common.stdout.trim() : null }),
                branch: br?.stdout.trim() || null,
                ahead: ahead || 0,
                behind: behind || 0,
              }
              : null,
          };
        }
        // 项目根也按机器分开：两台机器上同名的仓库不能互相顶掉工作树列表。
        const roots = new Map();
        for (const r of Object.values(this.repos)) {
          const p = r?.value ? projectOf(r.value) : null;
          if (p) roots.set(mkey(r.on ?? null, p), { root: p, on: r.on ?? null });
        }
        for (const [rk, { root, on }] of roots) {
          const seen = this.trees[rk];
          if (seen && Date.now() - seen.at < 30000) continue;
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
              } else if (cur && line === "detached") cur.branch = pick("（游离）", "detached");
            }
            if (cur) out.push(cur);
          }
          this.trees[rk] = { at: Date.now(), list: out };
        }
      } catch (e) {
        console.warn(`inkstone-workbench: ${e}`);
      }
      this.busy = false;
      cx.notify();
    });
  }

  menu(target, tab = "space") {
    // 高度按分支估：会话菜单项最多，给足避免被裁。
    const height = tab === "agent" ? 480 : tab === "tab" ? 260 : 300;
    openOverlay({ mod: "inkstone-menu", kind: "popup", width: 236, height, props: { tab, target } });
  }

  toggleFold(id, cx) {
    if (this.fold.has(id)) this.fold.delete(id);
    else this.fold.add(id);
    setShared("inkstone.folded", [...this.fold]);
    cx.notify();
  }

  // 折叠是按「项目」记的：不同机器上同名目录不是同一个项目，键里要带机器前缀。
  // 旧版本存的是裸路径，读的时候两种都认，再点一次折叠就会换成新键。
  foldKey(g) {
    return `${g.on ?? ""}|${g.root}`;
  }
  // 同一个判断要给「父组」用：g.parent 只有路径，机器在 g.on 上。
  isFoldedAt(on, path) {
    return this.fold.has(`${on ?? ""}|${path}`) || this.fold.has(path);
  }
  isFolded(g) {
    return this.isFoldedAt(g.on, g.root);
  }

  // 机器层自己的折叠：与本机/各服务器的空间互不影响。
  machineKey(m) {
    return m.name ?? LOCAL;
  }

  toggleMachine(m, cx) {
    const key = this.machineKey(m);
    if (this.foldM.has(key)) this.foldM.delete(key);
    else this.foldM.add(key);
    setShared("inkstone.foldedMachines", [...this.foldM]);
    cx.notify();
  }

  // 新建空间：开「新建空间」面板，目录默认当前会话目录，可手输、可挑、可选最近。
  // 机器不同就从那台机器的 home 起（否则会把远程目录当成本机路径）。
  newSpace(on) {
    openOverlay({ mod: "inkstone-space", kind: "dialog", props: { mode: "space", machine: on ?? null } });
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

  // 项目 -> 工作树；不在 git 里的空间按目录单列。缓存键带机器，两台机器上的同名目录不会串。
  groupsOf(list) {
    const ps = panes();
    const binds = bindsOf();
    const byRoot = new Map();
    for (const s of list) {
      const here = place(s, ps, binds);
      const on = s.machine ?? null;
      const cached = this.repos[mkey(on, here)];
      const repo = gitOn() ? cached?.value : null;
      // 工作树归到主仓库的项目根，不再各占一行（project 在 refresh 里用 --git-common-dir 算好）。
      const root = (repo && (repo.project || repo.root)) || here || s.folder || "~";
      const rk = mkey(on, root);
      if (!byRoot.has(rk)) byRoot.set(rk, { root, on, repo, spaces: [], trees: [] });
      byRoot.get(rk).spaces.push({
        space: s,
        folder: here,
        branch: gitOn() ? (repo?.branch ?? s.branch) : null,
        name: base(root),
        ahead: repo?.ahead ?? 0,
        behind: repo?.behind ?? 0,
        repo: Boolean(repo),
      });
    }
    for (const g of byRoot.values()) {
      const cached = this.trees[mkey(g.on, g.root)];
      const seen = cached?.list ?? [];
      g.trees = seen;
      // 还没扫过 / 不是仓库 / 只有主工作树：三种空态要说清，不能都写成「无」。
      g.scanned = Boolean(cached);
      g.repo = g.repo
        ?? g.spaces.map((x) => this.repos[mkey(g.on, x.folder)]?.value).find(Boolean)
        ?? null;
      // 工作树列出的路径里，没有空间打开的那些补在下面。
      for (const w of seen) {
        if (!g.spaces.some((x) => samePath(x.folder, w.path))) g.spaces.push({ tree: w, folder: w.path, branch: w.branch, on: g.on });
      }
    }
    return [...byRoot.values()].sort((a, b) => base(a.root).localeCompare(base(b.root), "zh"));
  }

  groups() {
    return this.groupsOf(spaces());
  }

  // 机器 -> 目录分组。本机与每台连着的服务器各占一层；还没列出/加载中的机器也留一行，
  // 否则它上面的空间会凭空消失，也没地方在本机之外新建。
  machinesView() {
    const list = spaces();
    const order = [];
    for (const m of machines()) order.push({ name: m.name ?? null, state: m.layout });
    for (const s of list) {
      const n = s.machine ?? null;
      if (!order.some((x) => (x.name ?? null) === n)) order.push({ name: n, state: "loading" });
    }
    order.sort((a, b) => (a.name === null ? -1 : b.name === null ? 1 : a.name.localeCompare(b.name, "zh")));
    return order.map((m) => {
      const on = m.name ?? null;
      const mine = list.filter((s) => (s.machine ?? null) === on);
      let groups = this.groupsOf(mine);
      // 机器根目录：落在它里面的项目缩进一级挂在它下面，其余组照旧排在后面；
      // 根目录本身还没有空间时也占一行，能右键在它下面建子项目。
      const root = rootsOf()[on ?? ""] ?? null;
      if (root) {
        const inside = [];
        const outside = [];
        for (const g of groups) {
          const same = samePath(g.root, root);
          if (same || under(g.root, root)) {
            // 只有真正的子项目才有 parent：机器根目录那一组若也挂着 parent，
            // 它会把自己当成“父组已折叠”而整行消失。
            if (!same) {
              g.parent = root;
              g.pad = PAD;
            } else g.pad = 0;
            inside.push(g);
          } else outside.push(g);
        }
        if (!inside.some((g) => samePath(g.root, root))) {
          inside.unshift({ root, on, repo: null, spaces: [], trees: [], scanned: true, rootRow: true, pad: 0 });
        }
        groups = [...inside, ...outside];
      }
      return { name: on, state: m.state, root, spaces: mine, groups, key: m.name ?? LOCAL };
    });
  }

  // 一个智能体一行：状态点、名字、右侧「待处理 / 已完成」。
  // 当前打开的行底色跟状态走（与 Agents 面板同一套色）；空闲用选中底。
  agentRow(a, t, pad = 0) {
    const name = clean(a.title) || a.program?.name || a.app || a.address;
    const detail = [statusLabel(a.status), a.tab_name, a.address].filter(Boolean).join(" · ");
    const tone = flowTone(t, a.status === "idle" ? "done" : a.status);
    const opened = Boolean(a.tab && spaces().find((s) => s.id === a.space)?.active
      && spaces().find((s) => s.id === a.space)?.tabs?.find((x) => x.id === a.tab)?.active);
    const wash = opened && tone ? tint(tone, PAPER(t) ? "3d" : "2e") : null;
    return h_flex()
      .id(`wb-a-${a.address}`)
      .h(26)
      .flex_none()
      .pl(38 + IND + pad)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .when(Boolean(wash), (el) => el.bg(wash))
      .when(!wash && opened, (el) => swipeOn(t, el))
      .when(!opened, (el) => el.hover((s) => s.bg(PAPER(t) ? "#f8dc4c4d" : t.hover)))
      .when(Boolean(wash), (el) => el.hover((s) => s.bg(tint(tone, PAPER(t) ? "4d" : "38"))))
      .tooltip(`${name}\n${detail}`)
      .accessibility_label(`${name} ${detail}`)
      .on_click(() => this.openAgent(a))
      .when(Boolean(a.tab), (el) => el.on_mouse_down("right", () => this.menu({
        tab: a.tab, space: a.space, terminal: a.address, name,
        pane: a.pane, status: a.status, pinned: Boolean(a.pinned),
      }, "agent")))
      .child(dot(t, a.status, 7))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(a.status === "blocked" ? t.blocked : t.foreground).child(name))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(a.status === "blocked" ? pick("待处理", "Waiting") : a.status === "done" ? pick("已完成", "Done") : ""));
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

  // 没跑智能体的终端也要有自己一行：否则徽章上的 tab 数在下面找不到对应的行。
  // 当前打开的行底色跟状态走（与 Agents 面板同一套色）：琥珀在跑、绿已完成、红待处理。
  termRow(s, c, t, pad = 0) {
    const ps = panes();
    const lead = ps.find((p) => p.tab === c.id);
    const prog = lead?.program;
    const name = clean(c.name) || prog?.name || pick("终端", "Terminal");
    const tone = flowTone(t, statusOf(agents().filter((a) => a.tab === c.id), c.status));
    const opened = Boolean(c.active && s.active);
    const wash = opened && tone ? tint(tone, PAPER(t) ? "3d" : "2e") : null;
    return h_flex()
      .id(`wb-tab-${c.id}`)
      .h(26)
      .flex_none()
      .pl(38 + IND + pad)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .when(Boolean(wash), (el) => el.bg(wash))
      .when(!wash && opened, (el) => swipeOn(t, el))
      .when(!opened, (el) => el.hover((h) => h.bg(PAPER(t) ? "#f8dc4c4d" : t.hover)))
      .when(Boolean(wash), (el) => el.hover((h) => h.bg(tint(tone, PAPER(t) ? "4d" : "38"))))
      .tooltip(`${lead?.cwd ?? s.folder ?? ""}${prog?.name ? `\n${prog.name}` : ""}`)
      .accessibility_label(pick(`终端 ${name}`, `Terminal ${name}`))
      .on_click(() => {
        if (!s.active) run("space.select", { id: s.id });
        if (!c.active) run("tab.select", { id: c.id });
      })
      .on_mouse_down("right", () => this.menu({ id: c.id, space: s.id, name }, "tab"))
      .child(prog?.icon
        ? (prog.tint ? svg(prog.icon).size(13).flex_none().text_color(t.muted) : image(prog.icon).size(16).flex_none())
        : svg("mods/inkstone-chrome/terminal.svg").size(13).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(name));
  }

  treeRow(w, t, n = 0, pad = 0) {
    return h_flex()
      .id(`wb-t-${w.path}`)
      .h(26)
      .flex_none()
      .relative()
      .ml(20 + IND + pad)
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
      .tooltip(`${w.folder}\n${pick("未打开 · 点一下在此工作树中新建空间", "not open · click to make a space here")}`)
      .on_click(() => run("space.new", { folder: w.folder, name: base(w.folder), machine: w.on ?? "" }))
      .child(svg("mods/inkstone-chrome/git-branch.svg").size(11).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(base(w.folder)))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(w.branch ?? ""));
  }

  // 空间行：30 高、14 号彩色名字 + tab 数，夹在 27 高的项目头与 26 高的终端行之间，
  // 三层用高度、字号、颜色分开。选中是一道荧光笔，其他主题仍是淡色底。
  spaceRow({ space: s, folder, branch, name, ahead, behind, repo }, t, fill, art, colorIndex, pad = 0) {
    const on = s.active;
    const has = s.status === "blocked" || s.status === "done" || s.status === "working";
    const folded = this.fold.has(s.id);
    const count = (s.tabs ?? []).length;
    const label = clean(s.name) || base(folder ?? s.folder) || pick("未命名空间", "Untitled");
    return h_flex()
      .id(`wb-s-${s.id}`)
      .h(30)
      .flex_none()
      .pl(10 + IND + pad)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(on, (el) => swipeOn(t, el))
      .when(!on, (el) => swipeHover(t, el))
      .tooltip(`${folder ?? s.folder}${branch ? `\n${branch}` : ""}`)
      .accessibility_label(pick(`${label} · ${count} 个终端 · ${statusLabel(s.status)}`, `${label} · ${count} terminals · ${statusLabel(s.status)}`))
      .on_click(() => (on ? null : run("space.select", { id: s.id })))
      .on_mouse_down("right", () => this.menu({ id: s.id, folder: folder ?? s.folder ?? null, machine: s.machine ?? null }, "space"))
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
        .child(svg(folded ? "mods/inkstone-chrome/chevron-right.svg" : "mods/inkstone-chrome/chevron-down.svg").size(10).flex_none().text_color(t.dim)))
      // 空间标记是它的固定身份：颜色分目录归属，字母 / 图案分空间。
      .child(this.mark(s.id, t, { art, fill, tip: pick(`${count} 个终端`, `${count} terminals`) }))
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

  // 空间标记：像素精灵，Alt+点击换图案。子项目用头像，所以这里不再有开关。
  mark(id, t, { art, fill, tip }) {
    return div()
      .id(`wb-sp-${id}`)
      .flex_none()
      .h(16).flex().items_center().justify_center().cursor_pointer()
      .tooltip(pick(`${tip} · Alt+点击换图案`, `${tip} · Alt+click changes the mark`))
      .accessibility_label(pick(`空间标记 ${art}`, `Space mark ${art}`))
      .on_mouse_down("left", (e, cx) => {
        if (!e.modifiers.alt) return;
        cx.stop_propagation();
        this.cycleSprite(id, cx);
      })
      .child(spriteArt(art, fill));
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

  // 机器层：This computer / 机器名，压在所有目录之上。左侧图标，右侧「在这台机器新建空间」、
  // 连接状态点、折叠箭头——只有这一层不缩进，目录与空间都往下让一档。
  machineRow(m, t) {
    const folded = this.foldM.has(m.key);
    const open = m.spaces.length;
    const tone = m.state === "unavailable" ? t.blocked : m.state === "ready" ? t.accent : t.dim;
    const stateWord = m.state === "unavailable" ? pick("连不上", "offline")
      : m.state === "ready" ? pick("已连接", "connected") : pick("加载中", "loading");
    return h_flex()
      .id(`wb-m-${m.key}`)
      .h(26)
      .flex_none()
      .pl(8)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((h) => h.bg(PAPER(t) ? "#f8dc4c4d" : t.hover))
      .tooltip(`${m.name ?? pick("本机", "This computer")} · ${stateWord}`)
      .accessibility_label(pick(`${m.key} · ${open} 个空间`, `${m.key} · ${open} spaces`))
      .on_click((_e, c) => this.toggleMachine(m, c))
      .on_mouse_down("right", () => this.menu({ machine: m.name ?? null, root: m.root ?? null }, "machine"))
      .child(div()
        .flex_1()
        .min_w(0)
        .truncate()
        .cursor_pointer()
        .text_size(12.5)
        .font_semibold()
        .text_color(inkOf(t, "ink", "muted"))
        .on_click((_e, c) => {
          c.stop_propagation();
          this.toggleMachine(m, c);
        })
        .child(m.key))
      .child(div().flex_none().cursor_pointer().text_size(10).text_color(t.dim).child(String(open)))
      .child(div()
        .id(`wb-mn-${m.key}`)
        .size(18)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(4)
        .cursor_pointer()
        .hover((h) => h.bg(PAPER(t) ? "#f8dc4c4d" : t.hover))
        .tooltip(m.name ? pick(`在 ${m.key} 上新建空间`, `new space on ${m.key}`) : pick("在本机新建空间", "new space on this computer"))
        .accessibility_label(pick(`在 ${m.key} 上新建空间`, `new space on ${m.key}`))
        .on_click((_e, c) => {
          c.stop_propagation();
          this.newSpace(m.name);
        })
        .child(svg("mods/inkstone-chrome/plus.svg").size(12).flex_none().text_color(t.muted)))
      .child(div().size(6).flex_none().rounded_full().bg(tone))
      .child(svg(folded ? "mods/inkstone-chrome/chevron-right.svg" : "mods/inkstone-chrome/chevron-down.svg").size(10).flex_none().text_color(t.dim));
  }

  // 目录层用「文件夹图标 + 深色粗体名」，空间层用「标记 + 彩色名」——
  // 两层靠符号形状区分；纸感下项目头下面一条铅笔线，组与组之间不再另加灰线。
  projectRow(g, t, fill, pad = 0) {
    const folded = this.isFolded(g);
    const open = g.spaces.filter((x) => x.space).length;
    const name = base(g.root);
    // 机器根目录下的子项目用字母头像：与空间的像素精灵分开，也让从属关系一眼可见。
    const head = pad > 0
      ? avatar(t, toneOf(name), [...name][0]?.toUpperCase() ?? "·", null)
      : glyph(FOLDER, fill ?? t.muted, { div, v_flex, h_flex }, 2);
    return h_flex()
      .id(`wb-p-${g.root}`)
      .h(27)
      .flex_none()
      .pl(8 + IND + pad)
      .pr(8)
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
      .accessibility_label(pick(`目录 ${base(g.root)} ${open}/${g.spaces.length}`, `Folder ${base(g.root)} ${open}/${g.spaces.length}`))
      .on_click((_e, cx) => this.toggleFold(this.foldKey(g), cx))
      .on_mouse_down("right", () => this.menu({ folder: g.root, machine: g.on }, "dir"))
      .child(svg(folded ? "mods/inkstone-chrome/chevron-right.svg" : "mods/inkstone-chrome/chevron-down.svg").size(11).flex_none().text_color(t.dim))
      .child(head)
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(name))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(g.spaces.length ? `${open}/${g.spaces.length}` : ""));
  }

  // rail 模式：一个空间只剩它的标记，名字、终端数与分支收进 tooltip。
  railSpace(s, t, fill, art) {
    const on = Boolean(s.active);
    const count = (s.tabs ?? []).length;
    const label = clean(s.name) || base(s.folder) || pick("未命名空间", "Untitled");
    return h_flex()
      .id(`wb-rs-${s.id}`)
      .h(28)
      .flex_none()
      .justify_center()
      .items_center()
      .cursor_pointer()
      .when(on, (el) => swipeOn(t, el))
      .when(!on, (el) => swipeHover(t, el))
      .tooltip(pick(`${label} · ${count} 个终端 · ${statusLabel(s.status)}`, `${label} · ${count} terminals · ${statusLabel(s.status)}`))
      .accessibility_label(pick(`${label} · ${count} 个终端`, `${label} · ${count} terminals`))
      .on_click(() => (on ? null : run("space.select", { id: s.id })))
      .on_mouse_down("right", () => this.menu({ id: s.id, folder: s.folder ?? null, machine: s.machine ?? null }, "space"))
      .child(this.mark(s.id, t, { art, fill, tip: pick(`${count} 个终端`, `${count} terminals`) }));
  }

  // rail 模式下的目录头：一个 folder 图标，点一下折叠整组。
  railProject(g, t, fill) {
    const folded = this.isFolded(g);
    return h_flex()
      .id(`wb-rp-${g.root}`)
      .h(24)
      .flex_none()
      .justify_center()
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(PAPER(t) ? "#f8dc4c4d" : t.hover))
      .tooltip(`${base(g.root)}${folded ? pick(" · 已折叠", " · collapsed") : ""}`)
      .accessibility_label(pick(`目录 ${base(g.root)}`, `Folder ${base(g.root)}`))
      .on_click((_e, cx) => this.toggleFold(this.foldKey(g), cx))
      .on_mouse_down("right", () => this.menu({ folder: g.root, machine: g.on }, "dir"))
      .child(glyph(FOLDER, fill ?? t.muted, { div, v_flex, h_flex }, 2));
  }

  // 组下没有工作树可列时，说清是哪一种空（扫描中 / 不是仓库 / 只有主工作树），
  // 别让一个空白的项目看起来像坏了。
  hintRow(g, t, pad = 0) {
    if (!gitOn()) return null;
    let text = null;
    // 非 Git 目录永远扫不到工作树，先判 repo：否则会一直停在「正在扫描」。
    if (!g.repo) text = pick("不在 Git 仓库中", "Not in a Git repository");
    else if (!g.scanned) text = pick("正在扫描工作树…", "Scanning worktrees…");
    else if (g.trees.length <= 1) text = pick("没有其他工作树 · 右键项目新建", "No other worktrees · right-click the project to add one");
    if (!text) return null;
    return div().pl(30 + IND + pad).pr(8).py(2).text_size(11).text_color(t.dim).child(text);
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
      .on_click(() => this.newSpace(null))
      .tooltip(pick("新建空间", "New space"))
      .accessibility_label(pick("新建空间", "New space"))
      .child(image(`mods/inkstone-chrome/ink/ib-c${lit ? "-on" : ""}.svg`).absolute().left(-12).top(-12).w(52).h(52))
      .child(svg("mods/inkstone-chrome/plus.svg").size(16).relative());
  }

  render(_cx) {
    const t = theme();
    const groups = this.groups();
    const buckets = this.machinesView();
    const colors = this.colors();
    const art = this.sprites();
    const total = agents().length;
    const needs = agents().filter((a) => a.status === "blocked").length;
    const rows = [];
    const narrow = rail();
    const paper = PAPER(t) && !narrow;
    if (narrow) {
      for (const g of groups) {
        const head = g.spaces.find((x) => x.space)?.space.id;
        const fill = head ? this.fill(t, colors[head] ?? 0) : null;
        rows.push(this.railProject(g, t, fill));
        if (this.isFolded(g)) continue;
        for (const item of g.spaces) {
          if (item.space) rows.push(this.railSpace(item.space, t, this.fill(t, colors[item.space.id] ?? 0), art[item.space.id] ?? "slime"));
        }
      }
    } else {
      // 机器层：本机与每台服务器各一段，目录分组收在它下面——新建空间时不会再
      // 悄悄建在最后一次点过的远程空间那台机器上。设了机器根目录时，根目录行在上，
      // 落在它里面的项目缩进一级挂在下面。
      for (const m of buckets) {
        rows.push(this.machineRow(m, t));
        if (this.foldM.has(m.key)) continue;
        if (!m.groups.length) {
          rows.push(div().pl(18 + IND).pr(8).py(2).text_size(11).text_color(t.dim).child(m.state === "unavailable" ? pick("连不上这台机器", "Can't reach this machine") : pick("这台机器上还没有空间", "No spaces on this machine yet")));
          continue;
        }
        let prev = null;
        for (const g of m.groups) {
          // 根目录折叠时，挂在它下面的子项目一起收起来。
          if (g.parent && this.isFoldedAt(g.on, g.parent)) continue;
          const pad = g.pad ?? 0;
          const head = g.spaces.find((x) => x.space)?.space.id;
          const fill = head ? this.fill(t, colors[head] ?? 0) : null;
          // 组与组之间一条细分隔线：目录是上一层边界，不是又一行空间。
          // 根目录与它的第一个子项目之间不画，那是一条从属关系。
          const joined = Boolean(g.parent && prev && samePath(prev.root, g.parent));
          if (prev && !joined && !PAPER(t)) rows.push(div().h(1).flex_none().mx(8).my(6).bg(t.border));
          rows.push(this.projectRow(g, t, fill, pad));
          prev = g;
          if (this.isFolded(g)) continue;
          const hint = g.rootRow ? null : this.hintRow(g, t, pad);
          if (hint) rows.push(hint);
          let trees = 0;
          for (const item of g.spaces) {
            if (!item.space) {
              rows.push(this.treeRow(item, t, trees++, pad));
              continue;
            }
            const s = item.space;
            rows.push(this.spaceRow(item, t, this.fill(t, colors[s.id] ?? 0), art[s.id] ?? "slime", colors[s.id] ?? 0, pad));
            if (this.fold.has(s.id)) continue;
            // 每个终端一行：跑着智能体的显示智能体（一个标签可能多个窗格），
            // 普通终端显示程序名——这样徽章上的 tab 数在下面都数得出来。
            const tabs = s.tabs ?? [];
            if (!tabs.length) {
              rows.push(div().pl(38 + IND + pad).pr(8).py(2).text_size(11).text_color(t.dim).child(pick("还没有终端", "No terminals yet")));
              continue;
            }
            const list = agents();
            for (const c of tabs) {
              const mine = list.filter((a) => a.tab === c.id);
              if (mine.length) for (const a of mine) rows.push(this.agentRow(a, t, pad));
              else rows.push(this.termRow(s, c, t, pad));
            }
          }
        }
      }
    }
    const inner = v_flex()
      .size_full()
      .min_h(0)
      .bg(narrow ? t.chrome : (t.paper ?? t.background))
      .text_size(13)
      .child(narrow
        ? v_flex()
          .size_full()
          .min_h(0)
          .overflow_hidden()
          .py(4)
          .gap(2)
          .items_center()
          .child(div()
            .id("inkstone-sidebar-unfold")
            .size(24)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(6)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip(pick("展开侧栏", "Expand sidebar"))
            .accessibility_label(pick("展开侧栏", "Expand sidebar"))
            .on_click(() => {
              setShared("sidebar.collapsed", false);
              run("layout.resize", { id: "sidebar", px: shared("sidebar.width") ?? 284 });
            })
            .child(svg("mods/inkstone-chrome/chevron-right.svg").size(14)))
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
            .tooltip(pick("新建空间", "New space"))
            .accessibility_label(pick("新建空间", "New space"))
            .on_click(() => this.newSpace(null))
            .child(svg("mods/inkstone-chrome/plus.svg").size(14)))
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
            .child(pick("空间", "Spaces")))
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
              .child(div().text_size(10.5).text_color(t.muted).child((needs > 0 || (findNode(layout(), "sidebar")?.size?.px ?? 999) < 250) ? `${total}` : pick(`${total} 智能体`, `${total} agents`))))
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
                .tooltip(pick("新建空间", "New space"))
                .accessibility_label(pick("新建空间", "New space"))
                .on_click(() => this.newSpace(null))
                .child(svg("mods/inkstone-chrome/plus.svg").size(14)))))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(narrow ? 4 : 8)
        .pb(narrow ? 12 : 6)
        .gap(1)
        .overflow_y_scrollbar()
        .mode("always")
        .track_scroll(this.scroll)
        .children(rows.length ? rows : [div().px(10).py(8).text_size(12).text_color(t.dim).child(pick("还没有空间 · 点上面的 + 新建", "No spaces yet · use + above"))]));
    // 展开态下包成独立纸边卡片；rail 图标轨态保持紧贴窄条。
    return narrow ? inner : paperCard(this, t, inner);
  }
}
