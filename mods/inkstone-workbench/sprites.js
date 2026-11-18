// 8x8 pixel sprites for space avatars. Drawn for Herdr, not taken from any game.
// "." clear, "x" the space's color, "o" white, "k" near-black.
// pixel-spaces and pixel-picker each carry this file (a mod can't import from another
// mod's folder): change both copies together.

export const SPRITES = {
  slime: [
    "........",
    "...xx...",
    "..xxxx..",
    ".xxxxxx.",
    ".xokxok.",
    "xxxxxxxx",
    "xxxxxxxx",
    ".xxxxxx.",
  ],
  ghost: [
    "..xxxx..",
    ".xxxxxx.",
    "xxxxxxxx",
    "xokxxokx",
    "xxxxxxxx",
    "xxxxxxxx",
    "xxxxxxxx",
    "xx.xx.xx",
  ],
  cat: [
    ".x....x.",
    ".xx..xx.",
    ".xxxxxx.",
    "xxoxxoxx",
    "xxxxxxxx",
    "xxxkkxxx",
    ".xxxxxx.",
    "..xxxx..",
  ],
  robot: [
    "...xx...",
    ".xxxxxx.",
    ".xoxxox.",
    ".xxxxxx.",
    ".xkkkkx.",
    ".xxxxxx.",
    "..x..x..",
    ".xx..xx.",
  ],
  mushroom: [
    "..xxxx..",
    ".xoxxox.",
    "xxxxxxxx",
    "xoxxxxox",
    "xxxxxxxx",
    ".oooooo.",
    ".okooko.",
    "..oooo..",
  ],
  octopus: [
    "..xxxx..",
    ".xxxxxx.",
    "xxxxxxxx",
    "xokxxokx",
    "xxxxxxxx",
    ".xxxxxx.",
    "x.x..x.x",
    ".x.xx.x.",
  ],
  skull: [
    ".xxxxxx.",
    "xxxxxxxx",
    "xkkxxkkx",
    "xkkxxkkx",
    "xxxkkxxx",
    ".xxxxxx.",
    ".x.xx.x.",
    ".xxxxxx.",
  ],
  heart: [
    "........",
    ".xx..xx.",
    "xoxxxxxx",
    "xxxxxxxx",
    "xxxxxxxx",
    ".xxxxxx.",
    "..xxxx..",
    "...xx...",
  ],
  potion: [
    "...oo...",
    "...xx...",
    "...xx...",
    "..xxxx..",
    ".xxxxxx.",
    ".xoxxxx.",
    ".xxxxxx.",
    "..xxxx..",
  ],
  frog: [
    ".xx..xx.",
    "xokxxokx",
    "xxxxxxxx",
    "xkxxxxkx",
    "xxkkkkxx",
    "xxxxxxxx",
    ".xxxxxx.",
    "xx....xx",
  ],
  rocket: [
    "...xx...",
    "..xxxx..",
    "..xoox..",
    "..xxxx..",
    ".xxxxxx.",
    "xxxxxxxx",
    "x.xxxx.x",
    "...oo...",
  ],
  terminal: [
    "xxxxxxxx",
    "xkkkkkkx",
    "xokkkkkx",
    "xkokkkkx",
    "xokkookx",
    "xkkkkkkx",
    "xxxxxxxx",
    "..xxxx..",
  ],
  coffee: [
    ".o..o...",
    "..o..o..",
    "xxxxxx..",
    "xxxxxxxx",
    "xxxxxx.x",
    "xxxxxxxx",
    "xxxxxx..",
    ".xxxx...",
  ],
  bomb: [
    "......o.",
    ".....x..",
    "..xxxx..",
    ".xxxxxx.",
    "xoxxxxxx",
    "xxxxxxxx",
    ".xxxxxx.",
    "..xxxx..",
  ],
  star: [
    "...xx...",
    "...xx...",
    "xxxxxxxx",
    ".xxxxxx.",
    "..xxxx..",
    ".xxxxxx.",
    ".xx..xx.",
    ".x....x.",
  ],
};

export const NAMES = Object.keys(SPRITES);

// Each run of one color in a row is one rectangle: [char, length].
function runs(row) {
  const out = [];
  for (let i = 0; i < row.length; ) {
    let j = i;
    while (j < row.length && row[j] === row[i]) j++;
    out.push([row[i], j - i]);
    i = j;
  }
  return out;
}

// 项目行的文件夹：与空间图案同一格律，单色。左上角伸出的标签是它和「方块」的区别。
export const FOLDER = [
  "xxxx....",
  "x...xxxx",
  "xxxxxxxx",
  "xxxxxxxx",
  "xxxxxxxx",
  "xxxxxxxx",
  "xxxxxxxx",
  "........",
];

// 工作台印章：侧栏+主屏+底座的微缩像素台，配在头部「工作台」左侧当辨识标。
export const WORKBENCH = [
  "xxxxxxxx",
  "x.x....x",
  "x.x.xx.x",
  "x.x....x",
  "xxxxxxxx",
  "..x..x..",
  ".xxxxxx.",
];

// Any 8-wide pattern as GPUI rectangles, `px` pixels per sprite pixel.
export function glyph(rows, fill, { div, v_flex, h_flex }, px = 2) {
  const ink = { x: fill, o: "#ffffff", k: "#17181c" };
  return v_flex().flex_none().w(px * 8).h(px * rows.length).children(
    rows.map((row) => h_flex().flex_none().h(px).children(
      runs(row).map(([c, n]) => {
        const cell = div().flex_none().w(px * n).h(px);
        return c === "." ? cell : cell.bg(ink[c]);
      }),
    )),
  );
}

// The sprite as GPUI rectangles, `px` pixels per sprite pixel.
export function sprite(name, fill, kit, px = 2) {
  return glyph(SPRITES[name] ?? SPRITES.slime, fill, kit, px);
}

// A sprite for each space: kept once picked, new spaces get the least used one.
export function assign(spaces, kept) {
  const out = { ...kept };
  let changed = false;
  for (const s of spaces) {
    if (out[s.id] && NAMES.includes(out[s.id])) continue;
    const uses = (n) => Object.values(out).filter((v) => v === n).length;
    const least = Math.min(...NAMES.map(uses));
    const free = NAMES.filter((n) => uses(n) === least);
    let h = 0;
    for (const ch of s.name ?? s.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    out[s.id] = free[h % free.length];
    changed = true;
  }
  return { out, changed };
}
