// 右键直接粘贴：布局的 `terminal_menu` 指向本模块时，右键不再弹菜单，
// 而是把剪贴板内容直接注入当前终端的输入行（设置里「OMH 偏好」可切换）。
//
// Herdr 打开 terminal_menu 时会带着一个 overlay；这里立刻粘贴并把 overlay 关掉。
// 窗口只有 1×1，闪一下即可忽略。

import { View, div } from "gpui-kit";
import { run, props, closeOverlay, focused, checking } from "herdr";

export default class DirectPaste extends View {
  init() {
    // check 会真正跑 init：别在静态检查时动剪贴板。
    if (checking()) return;
    const overlay = props()?.overlay;
    // 右键入口以被右键的终端为准；只有无 target 的显式命令才回退焦点终端。
    const term = props()?.target?.terminal ?? focused()?.terminal ?? null;
    // 粘贴跟随焦点终端：先把焦点交回终端，再粘贴，最后关掉 Overlay。
    if (term) run("pane.focus", { terminal: term });
    run("terminal.paste");
    if (overlay) closeOverlay(overlay);
  }

  render() {
    return div().size_full();
  }
}
