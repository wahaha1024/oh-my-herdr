// Oh My Herdr 工作台的中文右键菜单。
// 作为 terminals 的右键菜单使用（layouts 根部 "terminal_menu": "inkstone-menu"），
// 也被工作台侧栏用 openOverlay 打开（props { tab: "space" | "tab" }）。
// props: { tab: "pane" | "tab" | "space" | "global", target, overlay }
// 菜单项 [文字, 命令, 参数, 是否在其上方画分隔线]。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, focused, exec } from "herdr";

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

function items(p, git) {
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
        ["粘贴", "terminal.paste", {}, false],
        ["复制选中", "terminal.copy", {}, false],
        ...(inTab
          ? [
              ["向右分屏", "pane.split", { direction: "right", pane: tg.pane }, true],
              ["向下分屏", "pane.split", { direction: "down", pane: tg.pane }, false],
              ["最大化 / 还原", "pane.zoom", { pane: tg.pane }, false],
            ]
          : []),
        ...(term
          ? [
              toProgram
                ? ["右键改用菜单", "terminal.right_click", { terminal: term.address, to: "menu" }, true]
                : ["右键直接送达终端", "terminal.right_click", { terminal: term.address, to: "program" }, true],
            ]
          : []),
        ...(parent ? [[`交回 ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }, true]] : []),
        ...(inTab ? [["关闭窗格", "pane.close", { pane: tg.pane }, true]] : []),
      ];
    }
    case "tab":
      return [
        ["重命名标签", "tab.rename", { id: tg.id }, false],
        ["新建标签", "tab.new", { space: tg.space }, false],
        ["暂存标签", "tab.settle", { id: tg.id }, false],
        ["关闭标签", "tab.close", { id: tg.id }, true],
      ];
    case "space":
      return [
        ["重命名空间", "space.rename", { id: tg.id }, false],
        ["新开终端页", "tab.new", { space: tg.id }, false],
        ...(git
          ? [
              ["新建工作树", "worktree", { space: tg.id, action: "new" }, true],
              ["打开工作树", "worktree", { space: tg.id, action: "open" }, false],
            ]
          : []),
        ...(git === "linked" ? [["移除工作树", "worktree", { space: tg.id, action: "remove" }, false]] : []),
        ["关闭空间", "space.close", { id: tg.id }, true],
      ];
    default:
      return [
        ["新建空间", "space.new", {}, false],
        ["命令面板", "app.palette", {}, false],
        ["设置", "app.settings", {}, false],
        ["OMH 偏好", "mod.open", { name: "inkstone-settings" }, false],
        ["快捷键", "app.help", {}, true],
        ["主题：青瓷（浅）", "app.theme", { name: "qingci" }, true],
        ["主题：宣纸（浅）", "app.theme", { name: "xuanzhi" }, false],
        ["主题：玄墨（深）", "app.theme", { name: "xuanmo" }, false],
        ["主题：沧海（深）", "app.theme", { name: "canghai" }, false],
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
    : command === "terminal.park" ? "chevron-left"
    : command === "tab.settle" || command === "worktree" ? "archive"
    : command === "app.help" ? "terminal"
    : command === "app.settings" || command === "app.theme" || command === "mod.open" ? "settings"
    : command === "app.palette" ? "search"
    : command.endsWith(".close") ? "x"
    : command.endsWith(".rename") ? "square-pen"
    : command.endsWith(".new") ? "plus"
    : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
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
    const it = items(props(), this.git)[i];
    if (!it) return;
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
    if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  render(cx) {
    const t = theme();
    const list = items(props(), this.git);
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
