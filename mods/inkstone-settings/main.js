// OMH 偏好：布局与界面设置放在同一页，两栏并排。
//
// Herdr 自带的 Settings 屏只认 settings.json 的固定字段（外加自动列出 layouts/ 与
// themes/），mod 加不进新项，所以这里做一个自己的设置页：
//   左栏  · 主题：墨观 Inkstone 的六个变体 → app.theme + 写回布局的 theme
//         · 终端右键：弹出菜单 / 直接粘贴 → 改布局的 terminal_menu 并重载
//   右栏  · 界面：明暗 / 缩放 / 界面字体 / 连字 → 直接改 settings.json（Herdr 会热载）
//         · 状态栏三块：系统资源 / 活跃端口 / 代码审查 → 改布局节点的 hidden
// 左栏两组写回 layouts/oh-my-herdr.json，右栏写回 settings.json，重启后都还在。

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  theme, run, props, closeOverlay, shared, setShared,
  appHome, readTextFile, writeTextFile, settings as readSettings,
} from "herdr";

const LAYOUT = "oh-my-herdr";
const FILE = () => `${appHome()}/layouts/${LAYOUT}.json`;
const SETTINGS_FILE = () => `${appHome()}/settings.json`;

const THEMES = [
  { name: "qingci", label: "青瓷", hint: "月白釉底 · 亮" },
  { name: "xuanzhi", label: "宣纸", hint: "暖纸底 · 亮" },
  { name: "xuanzhi-dimmed", label: "宣纸 Dimmed", hint: "暖纸 · 降光" },
  { name: "xuanmo", label: "玄墨", hint: "松烟墨 · 暗" },
  { name: "xuanmo-dimmed", label: "玄墨 Dimmed", hint: "墨 · 降光" },
  { name: "canghai", label: "沧海", hint: "深海蓝 · 暗" },
];

const STATUS = [
  { id: "metrics", label: "系统资源", hint: "状态栏的 CPU / 内存" },
  { id: "ports", label: "活跃端口", hint: "状态栏的端口计数" },
  { id: "review", label: "代码审查", hint: "状态栏的审查按钮" },
];

// 界面字体候选：本机已装且带等宽字形的一档。
const FONTS = ["JetBrainsMono NF", "JetBrains Mono", "Cascadia Mono", "Fira Code"];

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
    this.raw = null;
    this.err = null;
    this.conf = null;
    this.confRaw = null;
    // 读文件是异步的：读完必须 notify，否则视图停在「读取布局…」。
    this.load(cx);
  }

  load(cx) {
    readTextFile(FILE()).then((text) => {
      if (!text) {
        this.err = `找不到布局文件：${FILE()}`;
      } else {
        try {
          this.raw = text;
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
    readTextFile(SETTINGS_FILE()).then((text) => {
      this.confRaw = text;
      this.conf = text ? JSON.parse(text) : { ...readSettings() };
      cx.notify();
    }).catch((e) => {
      this.conf = { ...readSettings() };
      this.err = this.err ?? `读取 settings.json 失败：${e}`;
      cx.notify();
    });
  }

  // 写回布局文件，必要时重载布局让 terminal_menu 生效。
  save(cx, reload) {
    if (!this.doc) return;
    const text = JSON.stringify(this.doc, null, 2) + "\n";
    writeTextFile(FILE(), text, this.raw).then(() => {
      this.raw = text;
      if (reload) run("layout.switch", { name: LAYOUT });
    }).catch((e) => {
      this.err = `写入失败：${e}`;
      cx.notify();
    });
  }

  // 写回 settings.json：Herdr 盯着这个文件，改完热载。
  saveSettings(patch, cx) {
    const next = { ...(this.conf ?? readSettings()), ...patch };
    const text = JSON.stringify(next, null, 2) + "\n";
    writeTextFile(SETTINGS_FILE(), text, this.confRaw).then(() => {
      this.conf = next;
      this.confRaw = text;
      this.err = null;
      cx.notify();
    }).catch((e) => {
      this.err = `写入 settings.json 失败：${e}`;
      cx.notify();
    });
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

  rightClick() {
    return this.doc?.terminal_menu === "inkstone-paste" ? "paste" : "menu";
  }

  setRightClick(mode, cx) {
    if (!this.doc || this.rightClick() === mode) return;
    this.doc.terminal_menu = mode === "paste" ? "inkstone-paste" : "inkstone-menu";
    cx.notify();
    this.save(cx, true);
  }

  pickTheme(name, cx) {
    const light = ["qingci", "xuanzhi", "xuanzhi-dimmed"].includes(name);
    if (this.doc) {
      this.doc.theme = { ...(this.doc.theme ?? {}), [light ? "light" : "dark"]: name };
      this.save(cx, true);
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
    const node = find(this.doc, id);
    if (!node) return;
    node.hidden = Boolean(this.shown(id));
    if (node.hidden) run("layout.hide", { id });
    else run("layout.show", { id });
    cx.notify();
    this.save(cx, false);
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
      .hover((s) => s.bg(t.hover)).accessibility_label(`${label} ${on ? "开" : "关"}`).tab_index(0)
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
    return v_flex().w(252).h_full().gap(12)
      .child(v_flex().w_full().gap(5)
        .child(this.heading(t, "主题", "墨观 Inkstone · 六个变体"))
        .child(h_flex().w_full().gap(6).flex_wrap().children(THEMES.map((x) => div().id(`th-${x.name}`).h(28).px(9).flex_none().flex().items_center().justify_center().rounded(6)
          .text_size(12).bg(current === x.name ? t.selected : t.raised).text_color(current === x.name ? t.foreground : t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(x.hint)
          .accessibility_label(`主题 ${x.label}`).tab_index(0)
          .on_key_down((e, cx) => { if (e.key === "enter" || e.key === "space") this.pickTheme(x.name, cx); })
          .on_click((_e, cx) => this.pickTheme(x.name, cx))
          .child(x.label)))))
      .child(v_flex().w_full().gap(5)
        .child(this.heading(t, "终端右键", "右键落在终端上时做什么"))
        .child(h_flex().w_full().gap(6)
          .child(this.seg(t, "rc-menu", "弹出菜单", mode === "menu", (_e, cx) => this.setRightClick("menu", cx)))
          .child(this.seg(t, "rc-paste", "直接粘贴", mode === "paste", (_e, cx) => this.setRightClick("paste", cx)))))
        // 直接粘贴省一次点击，但剪贴板里的多行文本或危险命令会不经确认就进 shell ——
        // 这一行是选中该模式时的常驻提醒，切回菜单模式即消失。
        .when(mode === "paste", (el) => el.child(div().text_size(11).text_color(t.working).child("直接粘贴会把剪贴板内容立刻送进当前程序，粘贴前先确认。")))
      .child(v_flex().w_full().gap(2)
        .child(this.heading(t, "状态栏", "关掉的块不再占位；改动写入布局"))
        .children(STATUS.map((x) => this.toggle(t, `st-${x.id}`, x.label, x.hint, this.shown(x.id), (_e, cx) => this.toggleStatus(x.id, cx)))));
  }

  // 右栏：界面（settings.json）+ 说明。
  right(t, cx) {
    const conf = this.conf ?? {};
    const dark = conf.appearance === "dark";
    const zoom = Number(conf.zoom ?? 1);
    const font = conf.ui_font ?? FONTS[0];
    const ligatures = Boolean(conf.font_ligatures);
    const fontIndex = Math.max(0, FONTS.indexOf(font));
    return v_flex().flex_1().min_w(0).h_full().gap(12)
      .child(v_flex().w_full().gap(5)
        .child(this.heading(t, "外观", "与 Herdr 的 Settings 是同一份 settings.json"))
        .child(h_flex().w_full().gap(6)
          .child(this.seg(t, "app-light", "浅色", !dark, (_e, cx) => this.saveSettings({ appearance: "light" }, cx)))
          .child(this.seg(t, "app-dark", "深色", dark, (_e, cx) => this.saveSettings({ appearance: "dark" }, cx)))))
      .child(v_flex().w_full().gap(5)
        .child(this.heading(t, "缩放与字体", "整窗缩放 · 界面字体 · 连字"))
        .child(h_flex().w_full().gap(6).items_center()
          .child(this.seg(t, "zoom-out", "−", false, (_e, cx) => {
            const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
            this.saveSettings({ zoom: ZOOMS[Math.max(0, (i < 0 ? ZOOMS.length : i) - 1)] }, cx);
          }))
          .child(div().h(26).px(10).flex().items_center().rounded(6).bg(t.raised).text_size(11)
            .text_color(t.foreground).child(`${Math.round(zoom * 100)}%`))
          .child(this.seg(t, "zoom-in", "＋", false, (_e, cx) => {
            const i = ZOOMS.findIndex((z) => z > zoom + 0.001);
            this.saveSettings({ zoom: ZOOMS[i < 0 ? ZOOMS.length - 1 : i] }, cx);
          }))
          .child(div().w(8).flex_none())
          .child(this.seg(t, "font-next", font, false, (_e, cx) => this.saveSettings({ ui_font: FONTS[(fontIndex + 1) % FONTS.length] }, cx)))
          .child(div().h(26).px(8).flex().items_center().rounded(6).text_size(12)
            .bg(ligatures ? t.selected : t.raised).text_color(ligatures ? t.foreground : t.muted)
            .cursor_pointer().hover((s) => s.bg(t.hover))
            .tooltip("字体连字（==、-> 之类合成一个符号）")
            .on_click((_e, cx) => this.saveSettings({ font_ligatures: !ligatures }, cx))
            .child(ligatures ? "连字 开" : "连字 关"))))
      .child(v_flex().w_full().gap(2)
        .child(this.heading(t, "工作台", "侧栏显示哪些内容"))
        .child(this.toggle(t, "git-trees", "Git 工作树", "扫仓库工作树、显示分支标签；不用 git 时关掉更清爽", this.gitOn(), (_e, cx) => this.setGit(!this.gitOn(), cx))))
      .child(v_flex().w_full().gap(2)
        .child(div().text_size(11).text_color(t.dim).child(`主题与右键写入 layouts/${LAYOUT}.json`))
        .child(div().text_size(11).text_color(t.dim).child("界面项写入 settings.json，Herdr 会热载"))
        .when(Boolean(this.err), (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.err))));
  }

  render() {
    const t = theme();
    if (!this.doc) {
      return v_flex().w(720).h(500).bg(t.popover).p(16).gap(8)
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child("OMH 偏好"))
        .child(div().text_size(11).text_color(this.err ? t.blocked : t.dim).child(this.err ?? "读取布局…"));
    }
    return v_flex().w(720).h(500).bg(t.popover).p(14).gap(12)
      .child(h_flex().w_full().items_center().justify_between()
        .child(v_flex().gap(1)
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child("OMH 偏好"))
          .child(div().text_size(11).text_color(t.dim).child("布局与界面设置，和 Herdr 的 Settings 共用同一份配置")))
        .child(div().id("prefs-close").size(22).flex().items_center().justify_center().rounded(5).cursor_pointer()
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props()?.overlay))
          .child(svg("mods/inkstone-chrome/x.svg").size(12))))
      .child(h_flex().w_full().flex_1().min_h(0).gap(16).items_start()
        .child(this.left(t))
        .child(div().w(1).h_full().flex_none().bg(t.border))
        .child(this.right(t)));
  }
}
