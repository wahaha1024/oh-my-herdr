// 终端区纸页的一条撕边。Herdr 自己画终端，所以纸页的毛边（deckled edge）由这个 mod 的
// 四条细块围出来，一条边一块：
//   { "content": { "mod": "inkstone-edge", "props": { "side": "top" | "bottom" | "left" | "right" } } }
// 每条都是同一张纸的一次裁切（Looseleaf 的纸张配方：纸料、毛边、4000 × 2400，ink/<side>-*.svg）：
// 长切片给出边，从纸的另一端取的短切片给出远角，于是任何尺寸都能合拢。

import { View, div, image } from "gpui-kit";
import { props, theme, themes } from "herdr";

const T = 12, LONG = 3206, TALL = 1794, CORNER = 46, FOOT = 40;

// 对应内置亮/暗主题画边线：ink-qingci / ink-xuanzhi / ink-xuanmo 由同一套切片替换色值，
// 不引入任何新颜色；仅当当前主题与对应切片色值匹配时启用，其余主题保持留空。
const PRESETS = [
  { bg: "#e8f0ec", muted: "#5f6b67", dir: "ink-qingci" },
  { bg: "#f7f4ed", muted: "#746b5e", dir: "ink-xuanzhi" },
  { bg: "#14131a", muted: "#8b8597", dir: "ink-xuanmo" },
];
let cacheKey = "";
let cacheDir = null;
function artDir(t) {
  if (t.paper) return "ink";
  const key = t.background ?? "";
  if (key !== cacheKey) {
    cacheKey = key;
    const p = PRESETS.find((x) => x.bg === key);
    if (!p) { cacheDir = null; return null; }
    const cur = themes().find((x) => x.colors?.background === key);
    cacheDir = cur?.colors?.muted === p.muted ? p.dir : null;
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
