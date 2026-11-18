// 终端区纸页的一条撕边。Herdr 自己画终端，所以纸页的毛边（deckled edge）由这个 mod 的
// 四条细块围出来，一条边一块：
//   { "content": { "mod": "inkstone-edge", "props": { "side": "top" | "bottom" | "left" | "right" } } }
// 每条都是同一张纸的一次裁切（Looseleaf 的纸张配方：纸料、毛边、4000 × 2400，ink/<side>-*.svg）：
// 长切片给出边，从纸的另一端取的短切片给出远角，于是任何尺寸都能合拢。

import { View, div, image } from "gpui-kit";
import { props, theme } from "herdr";

const T = 12, LONG = 3206, TALL = 1794, CORNER = 46, FOOT = 40;

export default class Edge extends View {
  render() {
    // 纸料是硬编码的浅色：只在定义了 paper 槽的主题下画；青瓷与玄墨下留空，
    // 终端区退回原来的 GPUI 几何（否则深色底上会浮出一圈白纸边）。
    if (!theme().paper) return div().size_full();
    const side = props()?.side ?? "top";
    const w = this.w ?? 800, h = this.h ?? 600;
    const art = (name, iw, ih) => image(`mods/inkstone-edge/ink/${name}.svg`).absolute().w(iw).h(ih);
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
