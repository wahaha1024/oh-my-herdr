// Oh My Herdr 工作台的中文右键菜单。
// 作为 terminals 的右键菜单使用（layouts 根部 "terminal_menu": "inkstone-menu"），
// 也被工作台侧栏用 openOverlay 打开（props { tab: "space" | "tab" }）。
// props: { tab: "pane" | "tab" | "space" | "global", target, overlay }
// 菜单项 [文字, 命令, 参数, 是否在其上方画分隔线]。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, focused, exec, window, shared } from "herdr";

// 中英切换：shared 改动会让所有 mod 重绘，切换语言立即生效。
const LANG = "inkstone.lang";
const pick = (zh, en) => (shared(LANG) === "en" ? en : zh);

// A space's live folder: its first terminal's, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  const t = top.stdout.trim().replace(/\\/g, "/"), c = common.stdout.trim().replace(/\\/g, "/");
  return c === `${t}/.git` ? "main" : "linked";
}

function items(p, git, more) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // A terminal shown outside a tab has no pane to split, zoom or close.
      const inTab = panes().some((pane) => pane.pane === tg.pane);
      return [
        [pick("粘贴", "Paste"), "terminal.paste", {}, false],
        [pick("复制选中", "Copy selection"), "terminal.copy", {}, false],
        ...(inTab
          ? [
              [pick("向右分屏", "Split right"), "pane.split", { direction: "right", pane: tg.pane }, true],
              [pick("向下分屏", "Split down"), "pane.split", { direction: "down", pane: tg.pane }, false],
              [pick("最大化 / 还原", "Maximize / restore"), "pane.zoom", { pane: tg.pane }, false],
            ]
          : []),
        ...(term
          ? [
              toProgram
                ? [pick("右键改用菜单", "Switch right-click to the menu"), "terminal.right_click", { terminal: term.address, to: "menu" }, true]
                : [pick("右键直接送达终端", "Send right-click straight to the terminal"), "terminal.right_click", { terminal: term.address, to: "program" }, true],
            ]
          : []),
        ...(parent ? [[pick(`交回 ${parent.name || parent.address}`, `Hand back to ${parent.name || parent.address}`), "terminal.park", { terminal: term.address }, true]] : []),
        ...(inTab ? [[pick("关闭窗格", "Close pane"), "pane.close", { pane: tg.pane }, true]] : []),
      ];
    }
    case "agent": {
      // 会话行右键：目标是这个智能体所在的标签；开关类都走宿主命令，不碰 agent 的输入。
      // 二级视图：斜杠命令会原样打进会话并回车，所以收在这一层里，多点一次才执行。
      if (more) {
        return [
          [pick("← 返回", "← Back"), "inkstone.back", {}, false],
          [pick("/fork 分叉会话", "/fork fork the session"), "inkstone.hc", { hc: "send", terminal: tg.terminal, text: "/fork" }, true],
          [pick("/compact 压缩上下文", "/compact compact the context"), "inkstone.hc", { hc: "send", terminal: tg.terminal, text: "/compact" }, false],
          [pick("/context 上下文占用", "/context context usage"), "inkstone.hc", { hc: "send", terminal: tg.terminal, text: "/context" }, false],
          [pick("/cost 花费", "/cost cost"), "inkstone.hc", { hc: "send", terminal: tg.terminal, text: "/cost" }, false],
          [pick("/status 状态", "/status status"), "inkstone.hc", { hc: "send", terminal: tg.terminal, text: "/status" }, false],
          [pick("/tree 查看会话树", "/tree session tree"), "inkstone.hc", { hc: "send", terminal: tg.terminal, text: "/tree" }, false],
          [pick("/export 导出会话", "/export export the session"), "inkstone.hc", { hc: "send", terminal: tg.terminal, text: "/export" }, false],
          [pick("/rewind 回退", "/rewind rewind"), "inkstone.hc", { hc: "send", terminal: tg.terminal, text: "/rewind" }, true],
          [pick("/clear 清空会话", "/clear clear the session"), "inkstone.hc", { hc: "send", terminal: tg.terminal, text: "/clear" }, false],
        ];
      }
      const working = tg.status === "working";
      const folder = panes().find((p) => p.pane === tg.pane)?.cwd
        ?? spaces().find((s) => s.id === tg.space)?.folder
        ?? null;
      return [
        [pick("重命名会话", "Rename session"), "tab.rename", { id: tg.tab }, false],
        [tg.pinned ? pick("取消置顶", "Unpin") : pick("置顶会话", "Pin to top"), "terminal.pin", { terminal: tg.terminal, pinned: !tg.pinned }, false],
        [pick("暂存会话", "Put the session away"), "tab.settle", { id: tg.tab }, true],
        [pick("前移", "Move left"), "tab.move", { id: tg.tab, by: "-" }, false],
        [pick("后移", "Move right"), "tab.move", { id: tg.tab, by: "+" }, false],
        [pick("同空间新标签", "New tab in this space"), "tab.new", { space: tg.space }, false],
        [pick("左右分屏", "Split right"), "pane.split", { pane: tg.pane, direction: "right" }, false],
        [pick("向下分屏", "Split down"), "pane.split", { pane: tg.pane, direction: "down" }, false],
        [pick("最大化 / 还原", "Maximize / restore"), "pane.zoom", { pane: tg.pane }, false],
        [pick("快速窥视", "Peek"), "terminal.peek", { terminal: tg.terminal }, false],
        ...(folder ? [[pick("打开所在目录", "Open its folder"), "inkstone.open", { folder }, false]] : []),
        // 会改变 agent 行为的两条单独放：跑着时只给「中断」，停下了才给「压缩」。
        working
          ? [pick("中断当前回合", "Interrupt this turn"), "inkstone.hc", { hc: "interrupt", terminal: tg.terminal }, true]
          : [pick("压缩上下文（/compact）", "Compact the context (/compact)"), "inkstone.hc", { hc: "send", terminal: tg.terminal, text: "/compact" }, true],
        [pick("更多命令…", "More commands…"), "inkstone.more", {}, false],
        [pick("复制终端地址", "Copy terminal address"), "inkstone.copy", { text: tg.terminal ?? "" }, true],
        [pick("关闭会话", "Close session"), "tab.close", { id: tg.tab }, false],
      ];
    }
    case "tab":
      return [
        [pick("重命名标签", "Rename tab"), "tab.rename", { id: tg.id }, false],
        [pick("新建标签", "New tab"), "tab.new", { space: tg.space }, false],
        [pick("暂存标签", "Put the tab away"), "tab.settle", { id: tg.id }, false],
        [pick("关闭标签", "Close tab"), "tab.close", { id: tg.id }, true],
      ];
    case "dir": {
      // 目录头右键：这里的动作都以「目录」为目标，不是某个空间。
      const local = !tg.machine;
      return [
        [pick("新建文件夹…", "New folder…"), "inkstone.space", { mode: "folder", folder: tg.folder, machine: tg.machine ?? null }, false],
        [pick("在此新建空间…", "New space here…"), "inkstone.space", { mode: "space", folder: tg.folder, machine: tg.machine ?? null }, false],
        [pick("复制路径", "Copy path"), "inkstone.copy", { text: tg.folder ?? "" }, true],
        ...(local ? [[pick("在文件管理器中打开", "Show in files"), "inkstone.open", { folder: tg.folder }, false]] : []),
      ];
    }
    case "machine": {
      // 机器层右键：这里的动作以「这台机器的根目录」为目标，用它在下面起新项目。
      const on = tg.machine ?? null;
      const root = tg.root ?? null;
      return [
        [pick("新建文件夹…", "New folder…"), "inkstone.space", { mode: "folder", folder: root, machine: on }, false],
        [pick("在此新建空间…", "New space here…"), "inkstone.space", { mode: "space", folder: root, machine: on }, false],
        [pick("设置根目录…", "Set the root folder…"), "inkstone.space", { mode: "root", machine: on }, true],
        ...(root ? [[pick("复制路径", "Copy path"), "inkstone.copy", { text: root }, false]] : []),
      ];
    }
    case "space":
      return [
        [pick("重命名空间", "Rename space"), "space.rename", { id: tg.id }, false],
        [pick("新开终端页", "New terminal tab"), "tab.new", { space: tg.id }, false],
        ...(git
          ? [
              [pick("新建工作树", "New worktree"), "worktree", { space: tg.id, action: "new" }, true],
              [pick("打开工作树", "Open worktree"), "worktree", { space: tg.id, action: "open" }, false],
            ]
          : []),
        ...(git === "linked" ? [[pick("移除工作树", "Remove worktree"), "worktree", { space: tg.id, action: "remove" }, false]] : []),
        // 归属目录决定这个空间在侧栏归到哪个项目，独立于它此刻的 cwd。
        [pick("设置归属目录…", "Set the project folder…"), "inkstone.space", { mode: "bind", space: tg.id, folder: tg.folder ?? null, machine: tg.machine ?? null }, true],
        [pick("关闭空间及其终端", "Close space and its terminals"), "space.close", { id: tg.id }, true],
      ];
    default:
      return [
        [pick("新建空间", "New space"), "space.new", {}, false],
        [pick("命令面板", "Command palette"), "app.palette", {}, false],
        [pick("设置", "Settings"), "app.settings", {}, false],
        [pick("OMH 偏好", "Layout preferences"), "mod.open", { name: "inkstone-settings" }, false],
        [pick("快捷键", "Shortcuts"), "app.help", {}, true],
        [pick("主题：青瓷（浅）", "Theme: Qingci (light)"), "app.theme", { name: "qingci" }, true],
        [pick("主题：宣纸（浅）", "Theme: Xuanzhi (light)"), "app.theme", { name: "xuanzhi" }, false],
        [pick("主题：玄墨（深）", "Theme: Xuanmo (dark)"), "app.theme", { name: "xuanmo" }, false],
        [pick("主题：沧海（深）", "Theme: Canghai (dark)"), "app.theme", { name: "canghai" }, false],
      ];
  }
}

function menuIcon(command) {
  const name =
    command === "terminal.paste" ? "file-text"
    : command === "terminal.copy" ? "files"
    : command === "pane.split" ? "panel-right"
    : command === "pane.zoom" ? "square"
    : command === "terminal.right_click" ? "square-pen"
    : command === "terminal.pin" ? "pin"
    : command === "terminal.peek" ? "sidebar"
    : command === "inkstone.hc" ? "square"
    : command === "inkstone.more" ? "chevron-right"
    : command === "inkstone.back" ? "chevron-left"
    : command === "tab.move" ? "chevron-right"
    : command === "terminal.park" ? "chevron-left"
    : command === "tab.settle" || command === "worktree" ? "archive"
    : command === "inkstone.space" ? "folder-plus"
    : command === "inkstone.open" ? "folder"
    : command === "inkstone.copy" ? "file-text"
    : command === "app.help" ? "terminal"
    : command === "app.settings" || command === "app.theme" || command === "mod.open" ? "settings"
    : command === "app.palette" ? "search"
    : command.endsWith(".close") ? "x"
    : command.endsWith(".rename") ? "square-pen"
    : command.endsWith(".new") ? "plus"
    : "terminal";
  return `mods/inkstone-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => (b.section === "global" || b.section === "terminal") && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.more = false; // 会话菜单的二级视图（斜杠命令）
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git, this.more)[i];
    if (!it) return;
    // 二级视图只是换一份列表，不关菜单。
    if (it[1] === "inkstone.more") { this.more = true; cx.notify(); return; }
    if (it[1] === "inkstone.back") { this.more = false; cx.notify(); return; }
    // 复制 / 粘贴跟随「焦点终端」，而菜单自己握着焦点：先把焦点交回终端并执行，
    // 再关菜单。顺序反过来时菜单一关焦点就落到别处，粘贴会打空。
    // 取不到右键目标时不猜焦点：宁可什么都不做，也别把剪贴板打进别的窗格。
    if (it[1] === "terminal.paste" || it[1] === "terminal.copy") {
      const term = props()?.target?.terminal;
      if (term) {
        run("pane.focus", { terminal: term });
        run(it[1], it[2]);
      }
      closeOverlay(props()?.overlay);
      return;
    }
    closeOverlay(props()?.overlay);
    if (it[1] === "inkstone.space") {
      openOverlay({ mod: "inkstone-space", kind: "dialog", props: it[2] });
      return;
    }
    // 走 hc 子进程：interrupt 按停止键，send 把斜杠命令打进会话再回车。
    if (it[1] === "inkstone.hc") {
      const { hc, terminal, text } = it[2];
      if (terminal) exec("hc", [hc, terminal, ...(text ? [text] : [])], { timeout: 20000 }).catch(() => null);
      return;
    }
    if (it[1] === "inkstone.open") {
      const plat = window()?.platform;
      const cmd = plat === "windows" ? "explorer" : plat === "macos" ? "open" : "xdg-open";
      // explorer 打开目录后以 1 退出，属于正常；失败不值得打断操作。
      exec(cmd, [it[2].folder]).catch(() => null);
      return;
    }
    if (it[1] === "inkstone.copy") {
      cx.write_to_clipboard(it[2].text);
      return;
    }
    if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  render(_cx) {
    const t = theme();
    const list = items(props(), this.git, this.more);
    return v_flex()
      .id("inkstone-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(Boolean(it[3]), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
              .id(`inkstone-mi-${i}`)
              .h(30)
              .px(8)
              .gap(9)
              .rounded(7)
              .items_center()
              .justify_between()
              .text_color(t.foreground)
              .when(i === this.at, (el) => el.bg(t.selected))
              .hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.choose(i, cx))
              .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
              .child(div().flex_1().truncate().child(it[0]))
              .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
