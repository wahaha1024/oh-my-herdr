// 终端区纸页的一条撕边。Herdr 自己画终端，所以纸页的毛边（deckled edge）由这个 mod 的
// 四条细块围出来，一条边一块：
//   { "content": { "mod": "inkstone-edge", "props": { "side": "top" | "bottom" | "left" | "right" } } }
// 每条都是同一张纸的一次裁切（Looseleaf 的纸张配方：纸料、毛边、4000 × 2400，ink/<side>-*.svg）：
// 长切片给出边，从纸的另一端取的短切片给出远角，于是任何尺寸都能合拢。

import { View, div, image } from "gpui-kit";
import { props, theme, themes } from "herdr";

const T = 12, LONG = 3206, TALL = 1794, CORNER = 46, FOOT = 40;

// 亮色主题也画边线：ink-qingci/ 是同一套切片刻的，纸料换成青瓷的 background、
// 墨线换成青瓷的 muted——不引入任何新颜色。只有当活动主题的这两个槽与烤进去的
// 值完全一致时才用它，其它主题保持留空。深色主题一律不画（浅色纸边在玄墨上露白）。
const QINGCI_PAPER = "#e8f0ec";
const QINGCI_INK = "#5f6b67";
let cacheKey = "";
let cacheDir = null;
function artDir(t) {
  if (t.paper) return "ink";
  const key = t.background ?? "";
  if (key !== cacheKey) {
    cacheKey = key;
    const cur = themes().find((x) => x.light && x.colors.background === key);
    cacheDir = key === QINGCI_PAPER && cur?.colors.muted === QINGCI_INK ? "ink-qingci" : null;
  }
  return cacheDir;
}

export default class Edge extends View {
  render() {
    const t = theme();
    const dir = artDir(t);
    if (!dir) return div().size_full();
    const side = props()?.side ?? "top";
    const w = this.w ?? 800, h = this.h ?? 600;
    const art = (name, iw, ih) => image(`mods/inkstone-edge/${dir}/${name}.svg`).absolute().w(iw).h(ih);
    const root = div().id(`edge-${side}`).relative().size_full().overflow_hidden()
      .on_size_change((size, cx) => {
        if (Math.abs((this.w ?? 0) - size.width) >= 1 || Math.abs((this.h ?? 0) - size.height) >= 1) { this.w = size.width; this.h = size.height; cx.notify(); }
      });
    if (side === "top" || side === "bottom") {
      return root
        .child(div().absolute().left(0).top(0).w(Math.max(0, w - CORNER)).h(T).overflow_hidden().child(art(`${side}-l`, LONG, T).left(0).top(0)))
        .child(div().absolute().right(0).top(0).w(Math.min(w, CORNER)).h(T).overflow_hidden().child(art(`${side}-r`, CORNER, T).right(0).top(0)));
    }
    return root
      .child(div().absolute().left(0).top(0).w(T).h(Math.max(0, h - FOOT)).overflow_hidden().child(art(`${side}-t`, T, TALL).left(0).top(0)))
      .child(div().absolute().left(0).bottom(0).w(T).h(Math.min(h, FOOT)).overflow_hidden().child(art(`${side}-b`, T, FOOT).left(0).bottom(0)));
  }
}
