// OMH 偏好：布局与界面设置放在同一页，两栏并排。
//
// Herdr 自带的 Settings 屏只认 settings.json 的固定字段（外加自动列出 layouts/ 与
// themes/），mod 加不进新项，所以这里做一个自己的设置页：
//   左栏  · 主题：墨观 Inkstone 的六个变体 → app.theme + 写回布局的 theme
//         · 终端右键：弹出菜单 / 直接粘贴 → 改布局的 terminal_menu 并重载
//   右栏  · 界面：明暗 / 缩放 / 界面字体 / 连字 → 直接改 settings.json（Herdr 会热载）
//         · 状态栏四块：系统资源 / 活跃端口 / 待处理 / 代码审查 → 改布局节点的 hidden
// 左栏两组写回 layouts/oh-my-herdr.json，右栏写回 settings.json，重启后都还在。

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  theme, run, props, closeOverlay, shared, setShared,
  appHome, readTextFile, writeTextFile, settings as readSettings,
} from "herdr";

// 中英切换：shared 改动会让所有 mod 重绘，切换语言立即生效。
const LANG = "inkstone.lang";
const pick = (zh, en) => (shared(LANG) === "en" ? en : zh);

const tint = (hex, a) => (typeof hex === "string" && hex.length === 7 ? hex + a : hex);
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
function paperCard(view, t, content) {
  const dir = artEdgeDir(t);
  const line = tint(t.accent, "cc");
  if (!dir) return content.rounded(8).border(1).border_color(line);
  const w = Math.max(400, view._cardW ?? 784);
  const h = Math.max(300, view._cardH ?? 544);
  const sideH = Math.max(0, h - 2 * EDGE_T);
  const art = (name, iw, ih) => image(`mods/inkstone-edge/${dir}/${name}.svg`).absolute().w(iw).h(ih);
  const hEdge = (side) => div().relative().w_full().h(EDGE_T).flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(Math.max(0, w - EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-l`, EDGE_LONG, EDGE_T).left(0).top(0)))
    .child(div().absolute().right(0).top(0).w(Math.min(w, EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-r`, EDGE_CORNER, EDGE_T).right(0).top(0)));
  const vEdge = (side) => div().relative().w(EDGE_T).h_full().flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(EDGE_T).h(Math.max(0, sideH - EDGE_FOOT)).overflow_hidden().child(art(`${side}-t`, EDGE_T, EDGE_TALL).left(0).top(0)))
    .child(div().absolute().left(0).bottom(0).w(EDGE_T).h(Math.min(sideH, EDGE_FOOT)).overflow_hidden().child(art(`${side}-b`, EDGE_T, EDGE_FOOT).left(0).bottom(0)));
  return v_flex().id("prefs-card").size_full().min_h(0)
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
    .child(hEdge("bottom"));
}
const LAYOUT = "oh-my-herdr";
const FILE = () => `${appHome()}/layouts/${LAYOUT}.json`;
const SETTINGS_FILE = () => `${appHome()}/settings.json`;

const THEMES = () => [
  { name: "qingci", label: pick("青瓷", "Qingci"), hint: pick("月白釉底 · 亮", "moon-white glaze · light") },
  { name: "zhi", label: pick("纸", "Zhi"), hint: pick("纸墨底 · 亮 · 撕边纸页", "paper & ink · light · torn page edge") },
  { name: "xuanzhi", label: pick("宣纸", "Xuanzhi"), hint: pick("暖纸底 · 亮", "warm paper · light") },
  { name: "xuanzhi-dimmed", label: pick("宣纸 Dimmed", "Xuanzhi Dimmed"), hint: pick("暖纸 · 降光", "warm paper · dimmed") },
  { name: "xuanmo", label: pick("玄墨", "Xuanmo"), hint: pick("松烟墨 · 暗", "pine-soot ink · dark") },
  { name: "xuanmo-dimmed", label: pick("玄墨 Dimmed", "Xuanmo Dimmed"), hint: pick("墨 · 降光", "ink · dimmed") },
  { name: "canghai", label: pick("沧海", "Canghai"), hint: pick("深海蓝 · 暗", "deep sea blue · dark") },
];

const STATUS = () => [
  { id: "metrics", label: pick("系统资源", "System resources"), hint: pick("状态栏的 CPU / 内存", "CPU and memory in the status bar") },
  { id: "ports", label: pick("活跃端口", "Open ports"), hint: pick("状态栏的端口计数", "port count in the status bar") },
  { id: "inbox", label: pick("待处理提醒", "Waiting alerts"), hint: pick("状态栏的智能体等待提醒", "agents waiting for you, in the status bar") },
  { id: "review", label: pick("代码审查", "Code review"), hint: pick("状态栏的审查按钮", "the review button in the status bar") },
];

// 界面字体候选：兼容 Windows 与 macOS 的常见等宽字体。
const FONTS = ["JetBrainsMono NF", "JetBrains Mono", "SF Mono", "Menlo", "Cascadia Mono", "Fira Code"];
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.4];

// 深度查找布局树里的节点。
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class InkstoneSettings extends View {
  init(_props, cx) {
    this.doc = null;
    this.err = null;
    this.conf = null;
    this.pendingWrite = Promise.resolve();
    // 读文件是异步的：读完必须 notify，否则视图停在「读取布局…」。
    this.load(cx);
  }

  load(cx) {
    readTextFile(FILE()).then((text) => {
      if (!text) {
        this.err = `找不到布局文件：${FILE()}`;
      } else {
        try {
          this.doc = JSON.parse(text);
        } catch (e) {
          this.err = `布局文件不是合法 JSON：${e}`;
        }
      }
      cx.notify();
    }).catch((e) => {
      this.err = `读取布局失败：${e}`;
      cx.notify();
    });

    // settings.json 只用于「界面」组：拿不到就退回运行时 settings()。
    this.loadSettings(cx);
  }

  async loadSettings(cx) {
    try {
      const text = await readTextFile(SETTINGS_FILE());
      this.conf = text ? JSON.parse(text) : { ...readSettings() };
    } catch (e) {
      this.conf = { ...readSettings() };
      this.err = this.err ?? `读取 settings.json 失败：${e}`;
    }
    cx.notify();
  }

  // 每次只改点击对应的字段。先串行本窗口的写入；外部写入撞上 CAS 时再重读一次。
  save(file, slot, change, cx, after) {
    this.pendingWrite = this.pendingWrite.then(async () => {
      try {
        for (let attempt = 0; ; attempt++) {
          const raw = await readTextFile(file);
          if (raw === null && slot === "doc") throw new Error(`找不到布局文件：${file}`);
          const next = raw === null ? { ...readSettings() } : JSON.parse(raw);
          if (change(next) === false) return;
          try {
            await writeTextFile(file, JSON.stringify(next, null, 2) + "\n", raw);
          } catch (e) {
            if (attempt === 0) continue;
            throw e;
          }
          this[slot] = next;
          this.err = null;
          after?.(next);
          return;
        }
      } catch (e) {
        this.err = `写入 ${slot === "doc" ? pick("布局", "Layout") : "settings.json"} 失败：${e?.message ?? e}`;
      } finally {
        cx.notify();
      }
    });
    return this.pendingWrite;
  }

  saveSettings(change, cx) {
    return this.save(SETTINGS_FILE(), "conf", change, cx);
  }

  // Git 增强是 shared 开关（侧栏 30 秒内跟着变），不用写文件。
  gitOn() {
    return shared("inkstone.git") === true;
  }

  setGit(on, cx) {
    setShared("inkstone.git", on);
    cx.notify();
    // 侧栏按开关重建一次，省得等它自己的 30 秒轮询。
    run("layout.switch", { name: LAYOUT });
  }

  // 界面语言：shared 改动已经能让所有 mod 重绘，这里再重建一次布局，
  // 让常驻的设置页自己也立刻换成另一种语言。
  langOf() {
    return shared(LANG) === "en" ? "en" : "zh";
  }

  setLang(v, cx) {
    setShared(LANG, v);
    cx.notify();
    run("layout.switch", { name: LAYOUT });
  }

  rightClick() {
    return this.doc?.terminal_menu === "inkstone-paste" ? "paste" : "menu";
  }

  setRightClick(mode, cx) {
    return this.save(FILE(), "doc", (doc) => {
      doc.terminal_menu = mode === "paste" ? "inkstone-paste" : "inkstone-menu";
    }, cx, () => run("layout.switch", { name: LAYOUT }));
  }

  pickTheme(name, cx) {
    const light = ["qingci", "zhi", "xuanzhi", "xuanzhi-dimmed"].includes(name);
    if (this.doc) {
      this.save(FILE(), "doc", (doc) => {
        doc.theme = { ...(doc.theme ?? {}), [light ? "light" : "dark"]: name };
      }, cx, () => run("layout.switch", { name: LAYOUT }));
    }
    setShared("inkstone.theme", name);
    run("app.theme", { name });
    cx.notify();
  }

  // 高亮当前这一侧的主题：浅色看 theme.light，深色看 theme.dark。
  currentTheme() {
    const t = this.doc?.theme;
    const dark = (this.conf?.appearance ?? readSettings().appearance) === "dark";
    return (dark ? t?.dark : t?.light) ?? null;
  }

  shown(id) {
    return !find(this.doc, id)?.hidden;
  }

  toggleStatus(id, cx) {
    return this.save(FILE(), "doc", (doc) => {
      const node = find(doc, id);
      if (!node) return false;
      node.hidden = !node.hidden;
    }, cx, (doc) => run(find(doc, id).hidden ? "layout.hide" : "layout.show", { id }));
  }

  // —— 绘制 ——

  heading(t, title, hint) {
    return v_flex().w_full().gap(1).child(div().text_size(12).font_semibold().text_color(t.foreground).child(title))
      .child(div().text_size(11).text_color(t.dim).child(hint));
  }

  seg(t, id, label, on, action) {
    return div().id(id).h(26).px(10).flex_none().flex().items_center().justify_center().rounded(6).text_size(12)
      .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted).cursor_pointer()
      .hover((s) => s.bg(on ? t.selected : t.hover))
      .accessibility_label(label).tab_index(0)
      .on_click(action)
      // 键盘路径：Tab 到这一格，Enter / 空格等价于点一下（action 都不读事件，传 null 安全）。
      .on_key_down((e, cx) => { if (e.key === "enter" || e.key === "space") action(null, cx); })
      .child(label);
  }

  toggle(t, id, label, hint, on, action) {
    return h_flex().id(id).w_full().h(32).px(10).gap(10).items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).accessibility_label(`${label} ${on ? pick("开", "On") : pick("关", "Off")}`).tab_index(0)
      .on_click(action)
      .on_key_down((e, cx) => { if (e.key === "enter" || e.key === "space") action(null, cx); })
      .child(v_flex().flex_1().gap(1)
        .child(div().text_size(12).text_color(t.foreground).child(label))
        .child(div().text_size(11).text_color(t.dim).child(hint)))
      .child(div().w(30).h(16).rounded_full().bg(on ? t.accent : t.raised)
        .border(1).border_color(on ? t.accent : t.border)
        .child(div().size(12).mt(2).ml(on ? 16 : 2).rounded_full().bg(on ? t.accent_foreground : t.dim)));
  }

  // 左栏：主题 + 终端右键。
  left(t, cx) {
    const mode = this.rightClick();
    const current = this.currentTheme();
    return v_flex().w(252).h_full().gap(10)
      .child(v_flex().w_full().gap(5)
        .child(this.heading(t, pick("主题", "Theme"), pick("墨观 Inkstone · 六个变体", "Inkstone · seven variants")))
        .child(h_flex().w_full().gap(6).flex_wrap().children(THEMES().map((x) => div().id(`th-${x.name}`).h(28).px(9).flex_none().flex().items_center().justify_center().rounded(6)
          .text_size(12).bg(current === x.name ? t.selected : t.raised).text_color(current === x.name ? t.foreground : t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(x.hint)
          .accessibility_label(`主题 ${x.label}`).tab_index(0)
          .on_key_down((e, cx) => { if (e.key === "enter" || e.key === "space") this.pickTheme(x.name, cx); })
          .on_click((_e, cx) => this.pickTheme(x.name, cx))
          .child(x.label)))))
      .child(v_flex().w_full().gap(5)
        .child(this.heading(t, pick("终端右键", "Terminal right-click"), pick("右键落在终端上时做什么", "What a right-click on a terminal does")))
        .child(h_flex().w_full().gap(6)
          .child(this.seg(t, "rc-menu", pick("弹出菜单", "Pop-up menu"), mode === "menu", (_e, cx) => this.setRightClick("menu", cx)))
          .child(this.seg(t, "rc-paste", pick("直接粘贴", "Paste straight away"), mode === "paste", (_e, cx) => this.setRightClick("paste", cx)))))
        // 直接粘贴省一次点击，但剪贴板里的多行文本或危险命令会不经确认就进 shell ——
        // 这一行是选中该模式时的常驻提醒，切回菜单模式即消失。
        .when(mode === "paste", (el) => el.child(div().text_size(11).text_color(t.working).child(pick("直接粘贴会把剪贴板内容立刻送进当前程序，粘贴前先确认。", "Pasting sends the clipboard into the running program at once — check it first."))))
      .child(v_flex().w_full().gap(2)
        .child(this.heading(t, pick("状态栏", "Status bar"), pick("关掉的块不再占位；改动写入布局", "Hidden blocks take no room; edits go into the layout")))
        .children(STATUS().map((x) => this.toggle(t, `st-${x.id}`, x.label, x.hint, this.shown(x.id), (_e, cx) => this.toggleStatus(x.id, cx)))));
  }

  // 右栏：界面（settings.json）+ 说明。
  right(t, cx) {
    const conf = this.conf ?? {};
    const dark = conf.appearance === "dark";
    const zoom = Number(conf.zoom ?? 1);
    const font = conf.ui_font ?? FONTS[0];
    const ligatures = Boolean(conf.font_ligatures);
    return v_flex().flex_1().min_w(0).h_full().gap(12)
      .child(v_flex().w_full().gap(5)
        .child(this.heading(t, pick("语言", "Language"), pick("界面文字与右键菜单的中英文", "Chinese or English for the UI and the menus")))
        .child(h_flex().w_full().gap(6)
          .child(this.seg(t, "lang-zh", "中文", this.langOf() === "zh", (_e, cx) => this.setLang("zh", cx)))
          .child(this.seg(t, "lang-en", "English", this.langOf() === "en", (_e, cx) => this.setLang("en", cx)))))
      .child(v_flex().w_full().gap(5)
        .child(this.heading(t, pick("外观", "Appearance"), pick("与 Herdr 的 Settings 是同一份 settings.json", "The same settings.json as Herdr's own Settings")))
        .child(h_flex().w_full().gap(6)
          .child(this.seg(t, "app-light", pick("浅色", "Light"), !dark, (_e, cx) => this.saveSettings((c) => { c.appearance = "light"; }, cx)))
          .child(this.seg(t, "app-dark", pick("深色", "Dark"), dark, (_e, cx) => this.saveSettings((c) => { c.appearance = "dark"; }, cx)))))
      .child(v_flex().w_full().gap(5)
        .child(this.heading(t, pick("缩放与字体", "Zoom & fonts"), pick("整窗缩放 · 界面字体 · 连字", "Window zoom · UI font · ligatures")))
        .child(h_flex().w_full().gap(6).items_center()
          .child(this.seg(t, "zoom-out", "−", false, (_e, cx) => this.saveSettings((c) => {
            const i = ZOOMS.findIndex((z) => z >= Number(c.zoom ?? 1) - 0.001);
            c.zoom = ZOOMS[Math.max(0, (i < 0 ? ZOOMS.length : i) - 1)];
          }, cx)))
          .child(div().h(26).px(10).flex().items_center().rounded(6).bg(t.raised).text_size(11)
            .text_color(t.foreground).child(`${Math.round(zoom * 100)}%`))
          .child(this.seg(t, "zoom-in", "＋", false, (_e, cx) => this.saveSettings((c) => {
            const i = ZOOMS.findIndex((z) => z > Number(c.zoom ?? 1) + 0.001);
            c.zoom = ZOOMS[i < 0 ? ZOOMS.length - 1 : i];
          }, cx)))
          .child(div().w(8).flex_none())
          .child(this.seg(t, "font-next", font, false, (_e, cx) => this.saveSettings((c) => {
            const i = Math.max(0, FONTS.indexOf(c.ui_font ?? FONTS[0]));
            c.ui_font = FONTS[(i + 1) % FONTS.length];
          }, cx)))
          .child(div().h(26).px(8).flex().items_center().rounded(6).text_size(12)
            .bg(ligatures ? t.selected : t.raised).text_color(ligatures ? t.foreground : t.muted)
            .cursor_pointer().hover((s) => s.bg(t.hover))
            .tooltip(pick("字体连字（==、-> 之类合成一个符号）", "Font ligatures (==, -> drawn as one glyph)"))
            .on_click((_e, cx) => this.saveSettings((c) => { c.font_ligatures = !c.font_ligatures; }, cx))
            .child(ligatures ? pick("连字 开", "Ligatures on") : pick("连字 关", "Ligatures off")))))
      .child(v_flex().w_full().gap(2)
        .child(this.heading(t, pick("工作台", "Workbench"), pick("侧栏显示哪些内容", "What the sidebar shows")))
        .child(this.toggle(t, "git-trees", pick("Git 工作树", "Git worktrees"), pick("扫仓库工作树、显示分支标签；不用 git 时关掉更清爽", "Scans worktrees and shows branch tags; turn it off if you don't use git"), this.gitOn(), (_e, cx) => this.setGit(!this.gitOn(), cx))))
      .child(v_flex().w_full().gap(2)
        .child(div().text_size(11).text_color(t.dim).child(`主题与右键写入 layouts/${LAYOUT}.json`))
        .child(div().text_size(11).text_color(t.dim).child(pick("界面项写入 settings.json，Herdr 会热载", "UI settings are written to settings.json and hot-reloaded by Herdr")))
        .when(Boolean(this.err), (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.err))));
  }

  render(cx) {
    const t = theme();
    const framed = Boolean(props()?.framed);
    if (!this.doc) {
      const loading = v_flex().size_full().min_h(0).bg(t.paper ?? t.background).p(16).gap(8)
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child(pick("OMH 偏好", "Layout preferences")))
        .child(div().text_size(11).text_color(this.err ? t.blocked : t.dim).child(this.err ?? pick("读取布局…", "Reading the layout…")));
      return framed ? paperCard(this, t, loading) : loading;
    }
    const inner = v_flex().size_full().min_h(0).bg(t.paper ?? t.background).p(14).gap(12)
      .child(h_flex().w_full().items_center().justify_between()
        .child(v_flex().gap(1)
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child(pick("OMH 偏好", "Layout preferences")))
          .child(div().text_size(11).text_color(t.dim).child(pick("布局与界面设置，和 Herdr 的 Settings 共用同一份配置", "Layout and UI settings, sharing one config with Herdr's own Settings"))))
        .child(div().id("prefs-close").size(22).flex().items_center().justify_center().rounded(5).cursor_pointer()
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props()?.overlay))
          .child(svg("mods/inkstone-chrome/x.svg").size(12))))
      .child(h_flex().w_full().flex_1().min_h(0).gap(16).items_start()
        .child(this.left(t, cx))
        .child(div().w(1).h_full().flex_none().bg(t.border))
        .child(this.right(t, cx)));
    return framed ? paperCard(this, t, inner) : inner;
  }
}
