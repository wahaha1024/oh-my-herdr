// 目录收藏：把常去的文件夹钉在这里，一点就切过去（已开着就选中，没开就新建空间）。
// 移植自 Lamb-Yang/herdr-sessions 的 hs-favorites，去掉跨机器（machine）字段，文案改中文。

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, home, run, shared, setShared, spaces, panes, focused, pickFolder, notify } from "herdr";

const KEY = "inkstone.favorites";
const read = () => shared(KEY) ?? [];
const norm = (p) => String(p ?? "").replace(/[\\/]+$/, "").toLowerCase();
const same = (a, b) => Boolean(norm(a?.folder)) && norm(a?.folder) === norm(b?.folder);

// 收藏当前目录时看空间自己的目录；空间没有目录才退到聚焦终端。
function here() {
  const space = spaces().find((s) => s.active);
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return space?.folder || pane?.cwd || f?.cwd || null;
}

export default class Favorites extends View {
  open(f) {
    const hit = spaces().find((s) => same(s, f));
    if (hit) run("space.select", { id: hit.id });
    else run("space.new", { folder: f.folder });
  }

  keep(folder) {
    if (!folder) return;
    const list = read();
    if (list.some((x) => same(x, { folder }))) {
      notify({ title: "已经收藏过", body: folder, level: "info" });
      return;
    }
    const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
    setShared(KEY, [...list, { name, folder }]);
    notify({ title: "已收藏", body: folder, level: "success" });
  }

  addCurrent() {
    const folder = here();
    if (!folder) {
      notify({ title: "当前没有可收藏的目录", level: "warning" });
      return;
    }
    this.keep(folder);
  }

  async browse() {
    const folder = await pickFolder({ prompt: "收藏哪个文件夹？" });
    if (folder) this.keep(folder);
  }

  drop(f, cx) {
    setShared(KEY, read().filter((x) => !same(x, f)));
    cx.notify();
  }

  row(f, i, t, short) {
    const open = spaces().some((s) => same(s, f));
    return h_flex()
      .id(`fav-${i}`)
      .h(38)
      .flex_none()
      .px(8)
      .gap(7)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.open(f))
      .child(svg("mods/inkstone-chrome/folder.svg").size(13).flex_none().text_color(t.muted))
      .child(v_flex()
        .flex_1()
        .min_w(0)
        .gap(0)
        .child(div().w_full().truncate().text_size(12).child(f.name))
        .child(div().w_full().truncate().text_size(11).text_color(t.dim).tooltip(f.folder).child(short(f.folder))))
      .when(open, (el) => el.child(div().px(4).py(1).rounded(3).bg(t.raised).text_size(10).text_color(t.done).child("已打开")))
      .child(div()
        .id(`fav-x-${i}`)
        .size(18)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(4)
        .text_size(11)
        .text_color(t.dim)
        .tooltip("取消收藏")
        .hover((s) => s.text_color(t.blocked))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.drop(f, cx);
        })
        .child("✕"));
  }

  render(_cx) {
    const t = theme();
    const h = home();
    const short = (p) => {
      const q = String(p ?? "");
      return h && q.toLowerCase().startsWith(String(h).toLowerCase()) ? "~" + q.slice(String(h).length) : q;
    };
    const list = [...read()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .child(h_flex()
        .h(34)
        .flex_none()
        .px(12)
        .gap(7)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(svg("mods/inkstone-chrome/pin.svg").size(13).flex_none().text_color(t.accent))
        .child(div().text_size(12).font_semibold().child("目录收藏"))
        .child(div().text_size(11).text_color(t.dim).child(String(list.length)))
        .child(div().flex_1())
        .child(div()
          .id("fav-add")
          .px(7)
          .py(3)
          .rounded(5)
          .text_size(11)
          .text_color(t.muted)
          .cursor_pointer()
          .tooltip("把当前空间所在目录加进来")
          .accessibility_label("收藏当前目录")
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.addCurrent())
          .child("收藏当前")))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(6)
        .py(6)
        .gap(1)
        .overflow_y_scrollbar()
        .children(list.length
          ? list.map((f, i) => this.row(f, i, t, short))
          : [div().p(8).text_size(12).text_color(t.dim).child("还没有收藏 · 用上面的「收藏当前」或下面的浏览")]))
      .child(h_flex()
        .id("fav-browse")
        .h(30)
        .flex_none()
        .mx(6)
        .mb(6)
        .px(8)
        .gap(6)
        .items_center()
        .accessibility_label("浏览文件夹收藏")
        .rounded(6)
        .cursor_pointer()
        .text_size(12)
        .text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => this.browse())
        .child(svg("mods/inkstone-chrome/plus.svg").size(12).flex_none())
        .child(div().child("浏览文件夹…")));
  }
}
