# Oh My Herdr

A Herdr layout for someone who runs a dozen spaces across several repositories and machines. The sidebar groups spaces by directory and gives each space a colour that follows it; the tab strip carries panel buttons and a dot in the current space's colour; a 380px drawer on the right holds files, changes, sessions, favourites and a cockpit; a 28px status bar stays pinned at the bottom with CPU, memory, ports, pending agents and review. Spaces in a running state are told apart by shape as well as colour, and the sidebar collapses to a rail of coloured badges when dragged narrow.

[中文版 RECIPE](RECIPE.zh.md)

![Oh My Herdr](preview.png)

## What you see

The window has no OS titlebar (`"titlebar": "none"`); the layout draws its own chrome. Four regions:

**Sidebar, left, 272px** (`min` 44, `max` 420, background `canvas`, `resizable: true`), a column of three blocks. In a paper theme (`themes/zhi.json`) these three blocks each paint a slice of one parchment sheet — brand exposes the torn top edge, the list only the two side edges, the footer the bottom edge — so the column reads as a single page on a desk; in rail mode (below 160px) the parchment is dropped and the blocks go back to a flat `chrome` fill.

- 52px brand strip (`inkstone-chrome`, `window_drag: true`): the layout name in 13px semibold next to a small mark, and to its right a search button and a collapse button (46px and icon-only in non-paper themes).
- The list (`inkstone-workbench`), filling the rest. Directory groups and spaces:
  - Group row, 27px: 11px chevron, 13px `folder.svg` tinted with the first space's colour (muted grey when the group holds no colour), 13px semibold name in `foreground`, and on the right a 10px `dim` count of the form `shown/total`. A 1px `border` rule, `mx(8) my(6)`, separates consecutive groups.
  - Space row, 30px, radius 7, `pl(10) pr(8) gap(6)`: a 16×16 badge (radius 4, 9px semibold, min-width 16, `px(3)`) carrying the 1-based index; then the space name at 14px in the space colour; then an 11px `dim` git branch and a 7px status mark. The selected row sits on a 10%-alpha wash of the space colour and the name turns semibold. Hover is `hover`. With nothing else to say a space shows a muted 12px second line instead of branch and status.
  - Terminal and agent rows, 24px, indented 38px (`pl(38)`), 11px: program icon 14–16px, name, and for agents a status dot or the spinning spinner. Agent rows are `dim` and turn `foreground` when focused, with a `raised`-55 background. Plain terminals are `dim` with `selected` as the active background. An empty space prints one muted line, "no terminals yet", indented 30px.
- 120px footer (`inkstone-chrome` with `props.footer: true`), `pt(8) pb(8) gap(2)`: three 32px rows, `px(10) gap(10)` — preferences, Herdr settings, add machine; each row is an icon in `muted`, a 12px label in `muted`, and turns `foreground`/`hover` on hover. "Preferences" and the machine row carry an extra `dim` 10px trailing hint.

**Work column, right**, a column of three:

- 42px header block (`inkstone-tabs`, `window_drag: true`). Left: the tab strip — 30px tall tabs, radius 7, `px(11)`, 14px type, max width 200px, `selected` when active, an `π`/spinner prefix when an agent runs in that tab and a close button on hover. Then, after a 1px vertical rule, the panel buttons: 26px tall, `px(7) gap(5)`, a 14px icon plus an 11px Chinese label (文件 / 变更 / 会话 / 收藏 / 驾驶舱), the active page on `raised` with `foreground` text, others `muted`. Right of the strip: a 7px dot in the current space's colour (tooltip = space name), then the window buttons — minimise, maximise/restore, close — drawn as 10px vector strokes inside 26×26 hit areas, close turning `blocked` on hover, and the sidebar collapse button when the sidebar is wider than 160px.
- Body, filling (`row`, `padding [6,6]`, `gap 8`, background `canvas`): a `page` column holds `page-top`, `page-row` (`page-left` + `panel-body` + `page-right`), `page-bottom`. The four 12px side blocks each mount one `inkstone-edge` slice (`props.side` = top / bottom / left / right) so the terminal sits inside a torn paper edge; they render nothing in themes without a `paper` slot. `panel-body` is a block with `{ "tab": "active" }` holding the terminals through a frame of `header: { content: { mod: "inkstone-pane" }, reveal: "always", height: 30, position: "top" }`, `radius 0`, `border.width 0`, `focus 2px accent`, `gap 1`, `lone true` — the 1px gaps between panes let the desk colour through as a divider. `panel` is a 380px column (`min` 280, `max` 620, `resizable: true`, `px` 380) holding one `stack` with id `panel-stack` whose children are five blocks: `inkstone-files`, `changes`, `cockpit`, `inkstone-sessions`, `inkstone-favorites`. `hidden: true` on `panel` by default.
- 28px status row (`chrome`): `workspace-status` growing, then four fixed blocks — `inkstone-metrics` 152px, `inkstone-ports` 64px, `inkstone-inbox` 84px, `inkstone-review` 88px.

The root is a `row`, background `canvas`, `traffic_lights: [12, 16]`, `terminal_padding: [14, 12]`, `divider: { width: 1, color: "border" }`, `terminal_menu: "inkstone-paste"`, `theme: { "light": "qingci", "dark": "xuanmo" }`, `preview: "layouts/oh-my-herdr.png"`.

## How it behaves

**Space colours.** Seven indices, stored in `shared("inkstone.spaceColors")` as `{ [spaceId]: 0..6 }` — never hex. A new space takes the least-used index; entries for spaces that no longer exist are dropped on the next read, so colours are reclaimed. A colour renders through `fill(t, i)`: `luminance(t.background) < 0.5` picks `PALETTE_DARK`, otherwise `PALETTE_LIGHT`, so a theme change swaps brightness and keeps hue. Badge text uses `#f7faf8` on dark fills and `#14131a` on light ones, decided by the fill's own luminance.

`PALETTE_LIGHT = ["#a84a50", "#8a5619", "#7d640c", "#357041", "#34618f", "#5f5399", "#805083"]`
`PALETTE_DARK = ["#f08a8a", "#f2a46a", "#e8c76a", "#7ecf86", "#6fb3ea", "#9a8ce6", "#c98ae6"]`

**Pixel critters.** Space rows and the rail lead with an 8×8 sprite, not the number badge. `mods/inkstone-workbench/sprites.js` holds `SPRITES` (15 patterns: `slime ghost cat robot mushroom octopus skull heart potion frog rocket terminal coffee bomb star`; `.` clear, `x` the space's colour, `o` white, `k` near-black), `NAMES`, `glyph(rows, fill, kit, px = 2)`, `sprite(name, fill, kit, px = 2)`, `FOLDER` and `assign(spaces, kept)`. `assign` gives a new space the least-used pattern, hashed from its name; the map lives in `shared("inkstone.sprites")` as `{ [spaceId]: name }`, trimmed to live spaces on read. Alt+click a sprite cycles to the next name and writes the map back. Rows are drawn as GPUI rectangles, never as an SVG: a one-colour run per row becomes one `div().bg(...)` of `px * run` width, so an 8-unit pattern at `px = 2` stays crisp — a scaled SVG gets antialiased into mush. The project header's folder is `glyph(FOLDER, fill, kit, 2)`; the tab strip draws a program icon from `programs.json` with `image(icon).size(16)` (an integer 2× of 8 units).

**Header bell.** `inkstone-tabs`'s `waiting(t)` lists agents with `status === "blocked" || "done"` and renders nothing when that list is empty; otherwise a 26px pill carries `bellGlyph(tone)` (the same rectangle-drawn 8×8 bell: rows `...xx...`, `..xxxx..`, `.xxxxxx.`, `.xxxxxx.`, `xxxxxxxx`, `.xxxxxx.`, `........`, `...xx...`) and the count. The tone is `blocked` when any agent is blocked, else `done`. A click selects that agent's space/tab (only when it is not already showing) and then `pane.focus`, falling back to `agent.focus`.

Both `inkstone-workbench` and `inkstone-tabs` hold their own copy — mods cannot import each other — so a palette change is two edits. `tint(hex, alpha)` appends a two-digit alpha to a `#rrggbb` string; `luminance(hex)` is WCAG relative luminance.

**Status, by shape.** `blocked` is a small solid square with radius 1 (7px), `done` a solid 7px circle, `working` a 2px ring plus a 12px `spinner.svg` spinning at 900ms, `idle` and no-status a 1.5px hollow circle. The status block in the status bar repeats the same shapes at 5px.

**Clicks.** A space row selects the space (`space.select`). A terminal or agent row selects its space, its tab (`tab.select`) and focuses the pane or agent. Both are guarded: if the space and tab are already showing, nothing is sent — every select rebuilds the terminal view and replays its scrollback, so a redundant click would cost a full re-render. Group headers toggle expansion; the collapsed state lives in component state, not shared.

**Hover.** Rows get `hover`; the space dot and the count get tooltips (`"<n> terminals"`); the panel buttons show their label always and no tooltip; the rail badges carry the space name, terminal count and status in their tooltip.

**Rail mode.** The sidebar is in rail mode whenever its width is below 160 — decided by reading `layout()` for the `sidebar` node, so dragging the edge triggers it too. In rail mode: group rows show only the folder icon, spaces only the coloured index badge (centred, 15px), the list padding drops from 8 to 4, and the header keeps only `+`, centred (on macOS, where `inkstone-chrome` leaves room for the traffic lights instead of drawing a toggle button, `inkstone-workbench` stacks an `inkstone-sidebar-unfold` button directly above `+`). Nothing is disabled; clicks behave as before. The collapse button sends `layout.resize` to 44 (76 on macOS, for the traffic lights) and back to `shared("sidebar.width")` (default 268); it also mirrors the state into `shared("sidebar.collapsed")`.

**Panel buttons.** `openPanel(id)` selects the page (`layout.select` on the `panel-stack`) and shows the drawer (`layout.show` on `panel`); the active page is read back from `stack.active`. The git button edits `shared("inkstone.git")` and, being the only way the "changes" page is reachable from the header, disappears when git is off: `const enabled = shared("inkstone.git") === true ? PANELS : PANELS.filter(id => id !== "changes")`.

**Files & Sessions drawers.** `inkstone-files` provides a Chinese-localised file tree and read-only highlighted preview (`Esc` clears search or exits preview), builds a path search index via `git ls-files` / `jj file list` (falling back to bounded directory traversal skipping `.git`, `.jj`, `node_modules`, `target`, `dist`, `.next`, `__pycache__`), renders `jj` or `git --no-optional-locks` status marks, and offers one-click `@relative/path` clipboard copy on every row and preview header. `inkstone-sessions` scans OMP (`~/.omp/agent/sessions`), Codex (`~/.codex/sessions`), Claude Code (`~/.claude/projects`), Pi (`~/.pi/agent/sessions`), project-local `.herdr/conversations` archives, and (when `sqlite3` is available) OpenCode databases across both the local machine and active remote `{ on }` spaces — reading the first and last 25 lines per `.jsonl` (or full file up to 64 KiB) to pick up the latest `title_change` / `custom-title` / `ai-title`. It includes live keyword search, source filter pills, a current-directory-first vs all-sessions toggle, and one-click resume-command copying. Clicking a row checks `live(s)` first (matching session ID in `argv`/`foreground.argv`, falling back to the first 24 characters of the OSC terminal title plus `cwd`) to switch to an open terminal, or launches `terminal.open` (`omp`/`claude --resume`, `codex resume`, `pi --session`, `opencode -s`).

**Favourites drawer.** `shared("inkstone.favorites")` is `[{ name, folder }]`. "Collect current" resolves the current space's folder (its first terminal's live cwd, else the space's `folder`) and appends it with the folder's basename as the name; duplicates are ignored. A row clicks through to `space.new { folder }` and shows an "already open" chip when some space's live folder matches. The remove button deletes the row. The empty state offers a "browse folders…" row.

**Pending (inbox).** The status block shows a status shape and "N waiting" (or "nothing waiting"), sized 84px; clicking opens the `inkstone-inbox` overlay (400×320), which lists the blocked agents with their space and tab.

**Metrics / ports / review.** `inkstone-metrics` polls CPU and memory and prints `CPU 12% · 9.4 GB`; `inkstone-ports` shows the listening-port count; both are `dim` 11px and open their overlays on click. `inkstone-review` is a text button 88px wide.

**Right-click pastes.** `terminal_menu: "inkstone-paste"` points Herdr's terminal menu at a mod that does not draw a menu at all: a 1×1 overlay that on open focuses `props().target.terminal` (falling back to the focused pane only for an explicit command with no target), runs `terminal.paste`, and closes its own overlay (`props().overlay` → `closeOverlay`). Net effect: a right-click in a terminal is a paste, with no menu in the way. `init()` returns early when `checking()` is true, so `herdr-app check` never touches the clipboard.

## Built from

**Layout node tree** (`layouts/oh-my-herdr.json`), top to bottom:

```
layout root     column titlebar none, traffic_lights [12,16],
                       terminal_menu inkstone-paste, theme {light:qingci, dark:xuanmo}
root            row    bg canvas, terminal_padding [14,12], divider 1/border,
                       preview layouts/oh-my-herdr.png
├ sidebar       column 272 (min 44 max 420, bg canvas, resizable, window_drag false)
│ ├ brand       block 52  window_drag, content {mod: inkstone-chrome}
│ ├ sidebar-lists column
│ │ ├ spaces    block content {mod: inkstone-workbench}
│ │ └ footer    block 120 content {mod: inkstone-chrome, props {footer: true}}
└ work          column
  ├ tabs        block 42 window_drag content {mod: inkstone-tabs}
  ├ body        row padding [6,6] gap 8, bg canvas
  │ ├ page      column, weight 1
  │ │ ├ page-top    block 12 content {mod: inkstone-edge, props {side: top}}
  │ │ ├ page-row    row, weight 1
  │ │ │ ├ page-left   block 12 content {mod: inkstone-edge, props {side: left}}
  │ │ │ ├ panel-body  block {tab: "active"} content {mod: pane}
  │ │ │ │   header {mod inkstone-pane, always, 30, top}, radius 0, border 0, gap 1, lone
  │ │ │ └ page-right  block 12 content {mod: inkstone-edge, props {side: right}}
  │ │ └ page-bottom block 12 content {mod: inkstone-edge, props {side: bottom}}
  │ └ panel     column 380 (min 280 max 620, resizable, hidden) → stack panel-stack
  │              active files; children: files {mod inkstone-files}, changes, cockpit,
  │              sessions {mod inkstone-sessions}, favorites {mod inkstone-favorites}
  └ status      row
    ├ status-text    block  (mod workspace-status, grows)
    ├ metrics        block 152 (mod inkstone-metrics)
    ├ ports          block 64  (mod inkstone-ports)
    ├ inbox          block 84  (mod inkstone-inbox)
    └ review         block 88  (mod inkstone-review)
```

**Mods written for this layout** (each `mods/<name>/mod.json` is `{ "place": "none" }` unless noted; every one exports a `View` subclass and uses `gpui-kit` + `gpui-base` + `herdr`):

| Mod | Role | Reads / writes | Commands |
|---|---|---|---|
| `inkstone-chrome` | brand strip and footer, one component with a `footer` prop | `layout()` (sidebar width), `shared("sidebar.width")`, `shared("sidebar.collapsed")` | `layout.resize`, `mod.open`, `app.help`, `space.new` |
| `inkstone-workbench` | the list: groups, spaces, terminals, agents, rail mode | `spaces()`, `panes()`, `terminals()`, `layout()`, `shared("inkstone.spaceColors")` | `space.select`, `tab.select`, `pane.focus`, `agent.focus`, `tab.new` |
| `inkstone-tabs` | tab strip, panel buttons, window buttons | `spaces()`, `panes()`, `shared("inkstone.git")`, `shared("inkstone.spaceColors")`, `layout()` | `tab.select`, `tab.close`, `tab.new`, `layout.select`, `layout.show`, `layout.hide`, `window.*`. |
| `inkstone-edge` | one torn-paper slice per `props.side` (top / bottom / left / right) around the terminal page; renders an empty div unless the theme defines `paper` | `theme()`, `layout()` (panel frames) | — |
| `inkstone-pane` | custom pane header: program icon + name, `~/`-folded cwd, working spinner / "待你处理" badge / done check, hover-only split-right / split-down / zoom / close buttons, pencil rule under it | `panes()`, `layout()`, `theme()` | `pane.focus`, `pane.split`, `pane.zoom`, `pane.close` |
| `inkstone-files` | project file tree, path search, `@path` copy, `jj`/`git` marks | `spaces()`, `panes()`, `focused()`, `readTextFile`, `watchFolder`, `exec` | `cx.write_to_clipboard` |
| `inkstone-sessions` | multi-source session drawer (search, filters, remote `{ on }`, copy cmd) | local/remote session dirs via `exec` (PowerShell / `sh`+`awk` / optional `sqlite3`), `terminals()`, `spaces()` | `space.select`, `tab.select`, `pane.focus`, `terminal.open` |
| `inkstone-favorites` | favourites drawer | `shared("inkstone.favorites")`, `panes()` | `space.new`, `mod.open` |
| `inkstone-inbox` | 84px status block + overlay | `spaces()`, `agents` from panes | `space.select`, `tab.select`, `pane.focus`, `overlay.close` |
| `inkstone-metrics` | 152px CPU/memory block | system counters | `overlay.close` |
| `inkstone-ports` | 64px port count | listening sockets | — |
| `inkstone-review` | 88px review button | — | `mod.open` |
| `inkstone-settings` | preferences overlay (`overlay: 760×520`, title "OMH 偏好") | `theme()`, settings | `app.theme`, `overlay.close` |
| `inkstone-paste` | right-click pastes straight into the terminal (`terminal_menu`); a 1×1 overlay that focuses the target terminal, runs `terminal.paste` and closes itself | `props().overlay`, `props().target.terminal` | `pane.focus`, `terminal.paste` |
| `inkstone-menu` | Chinese context menu for workbench rows and optional `terminal_menu` (`overlay: 248×348`) | `props()`, `spaces()`, `panes()`, `terminals()`, `keys()`, `git` via `exec` | `pane.focus`, `terminal.*`, `pane.*`, `tab.*`, `space.*`, `app.*`, `worktree` |
| `cockpit` | cockpit drawer page | `spaces()`, `panes()` | `space.select`, `tab.select` |

**Shipped mods/assets it uses:** `changes`, `workspace-status`, `pane`, plus `mods/files/*.svg` icons.
**Themes:** `themes/qingci.json` — background `#e8f0ec`, foreground `#2b333e`, selection `#c7d9cf`, cursor `#126e82`; ANSI `#4f5b5a #c23142 #1a6840 #66462a #126e82 #813c85 #495c69 #7d8983` and bright `#a5b3ac #82111f #207f4c #b78b26 #11659a #894276 #134857 #8f9c96`; slots `surface #e1eae4`, `canvas #d9e3dc`, `chrome #e1eae4`, `popover #d9e3dc`, `raised #d9e3dc`, `hover #e2ebe5`, `selected #c7d9cf`, `border #afcdd0`, `input #edf4ef`, `muted #5f6b67`, `dim #646c73`, `accent #126e82`, `accent_foreground #f2f8f4`, `solid #126e82`, `ring #126e82`, `working #66462a`, `blocked #c23142`, `done #1a6840`, `idle #a5b3ac`. `themes/xuanmo.json` — background `#14131a`, foreground `#d4cec4`, selection `#332f46`, cursor `#619ac3`; ANSI opens `#3a3646 #e1505d #2bae85 #e2c027 #619ac3 #c08eaf` (16 in all); slots `surface #1a1922`, `canvas #0f0e14`, `chrome #1a1922`, `popover #22212c`, `raised #22212c`, `hover #24222e`, `border #273443`, `input #1e1d27`, `muted #8b8597`, `dim #827f7c`, `accent #619ac3`, `accent_foreground #14131a`, `working #e2c027`, `blocked #e1505d`, `done #2bae85`, `idle #6b6478`. No art or files beyond the theme schema.
**Paper theme (optional):** `themes/zhi.json` — background `#f8f5ee`, foreground `#1f2328`, selection `#cfe3fb`, cursor `#0969da`, GitHub-Light 16-colour ANSI, canvas `#dad1bf`, chrome `#f8f2de`, selected `#f8e68a`, plus 11 custom slots: `paper #f8f5ee`, `desk #dad1bf`, `ink #2a2420`, `pencil #5a554e`, `rule #b2c3dc`, `stroke #8e887f`, `mark #f8dc4c`, `bracket #2c4f9e`, `up #3b7a4b`, `down #c2412d`, `seal #f8f2de`. Mods never check theme names — `Boolean(theme().paper)` decides the paper typography, highlighter and parchment; the torn edge alone is drawn by any theme whose palette matches the recoloured slices (light qingci), and skipped on dark ones. The paper look is still opt-in: the layout says `{light: qingci, dark: xuanmo}` and zhi is picked with `app.theme` or the preferences overlay.
**Programs run:** `git` / optional `jj` (branch, status, file index, worktree lookups via `exec`), `hc` (core queries); on Windows PowerShell (`Get-NetTCPConnection`, `Get-Process`, `Get-CimInstance`, JSONL scan, `where`); on macOS/Linux/remote machines `sh` + `awk` + `command -v`, optional `sqlite3`, `vm_stat`/`top`/`sysctl`/`ps` or `/proc`, `lsof`/`ss`, `open`/`xdg-open`, `kill`. No Python at runtime, no network.
**Art:** small icons come from Herdr's own SVGs (`mods/files/file.svg`, `mods/changes/changes.svg`, `mods/workspace-chrome/*.svg`, `mods/inkstone-chrome/{terminal,pin,spinner}.svg` plus small stroke glyphs for window buttons drawn inline). Space sprites, the project folder and the header bell are GPUI rectangles from `sprites.js` / `bellGlyph`, not assets. One image ships: `pixel-icons/codex.svg` (8×8, `#7a9dff`), wired to OMP through `programs.json` as `"omp": { "icon": "pixel-icons/codex.svg", "tint": false }`. The paper look adds ~3.2MB of SVGs taken from Looseleaf (MIT, license copied alongside): `mods/inkstone-chrome/ink/` holds 39 files — 17 parchment widths (144→400, step 16), 8 avatar discs + ring + 2 status dots, 6 ink-slip buttons, 2 pencil rules, 2 badges, LICENSE — `mods/inkstone-edge/ink/` holds the 8 torn-edge pieces, and `mods/inkstone-edge/ink-qingci/` the same 8 slices with the paper fill swapped to qingci's `background` and the ink line to its `muted`, so the light theme gets the deckle without a single new colour. Parchment is chosen by nearest width and stretched, so no requested width can 404.

## Watch out

- **Selecting the space already showing must be a no-op.** Any `space.select`/`tab.select`, even to the same target, rebuilds the terminal view and replays the scrollback — the result looks like the terminal scrolling from the beginning. Guard every click path.
- **`layout.resize` needs breathing room in the layout.** A `min` larger than the target clamps the resize silently: a `min` of 200 makes `layout.resize {px: 44}` a no-op and rail mode never triggers. Keep `min` at 44.
- **Rail mode must be derived from width, not a flag.** Reading `layout()`'s `sidebar.size.px` keeps dragging the edge and clicking the button consistent.
- **The palette is duplicated.** `PALETTE_LIGHT`/`PALETTE_DARK`, `luminance` and `tint` exist in both `inkstone-workbench` and `inkstone-tabs` because mods can't share modules. A change in one place silently diverges.
- **Session matching checks `argv` first, then OSC title.** Live sessions match `argv`/`foreground.argv` for the session ID first and fall back to the first 24 characters of the terminal title plus `cwd`. Remote spaces also scan over `{ on }` via `exec`.
- **Fixed status widths.** 152/64/84/88 are layout `px` values; longer content overflows or truncates. Change both the mod's text and the layout.
- **`inkstone-inbox`'s overlay is 400×320.** At larger sizes the empty state swims.
- **`shared("sidebar.width")` starts undefined** — default it to 268 rather than reading it directly.
- The drawer starts hidden (`hidden: true` on `panel`); `openPanel` must therefore both select the page and show the node, and the page must be read from `stack.active` rather than tracked separately, or the buttons drift out of sync after a keyboard switch.
- **Do not swap the sprites for SVGs.** The 8×8 patterns are drawn as rectangles on purpose; a bell SVG rendered at 14px came out as a smooth blob with the pixel steps antialiased away. The same applies to the program icon: `image(...)` at 12px blurred it, at 16px (2× of 8 units) it is sharp.
- **`programs.json` is a patch, not a file to copy blindly.** The installer only adds `omp` and leaves an existing entry alone; `pixel-icons/` must ship with it or the icon path dangles and Herdr falls back to its own glyph.
- **`inkstone-edge`'s `mod.json` must stay `{ "place": "none" }`.** Any other `place` makes Herdr splice the block into the layout automatically, and deleting the mod then leaves a hole in the layout.
- **`titlebar` and `traffic_lights` belong on the layout document's outermost node** — the same level as `id`, `type` and `children`. Put them on the inner `root` row and they are silently ignored: the OS titlebar keeps floating above the layout, `window().buttons` stays `false`, and the three − □ × in `inkstone-tabs` never render. Moved out, the titlebar disappears and minimize/maximize/close sit in the tab strip right after the panel buttons.
- **Paper is gated on a theme slot, not a theme name.** Every paper branch reads `Boolean(theme().paper)` and falls back to ordinary slots, because the Looseleaf art is hardcoded light hex — vendored artwork cannot follow a dark theme. Keep the fallback branch free of expressions that would throw when the slot is missing (no `t.mark.slice(...)`, no `t.paper` arithmetic).
- **The three parchment slices must agree to the pixel.** Brand, list and footer draw three crops of one 1600px sheet (`top`, `mid` offset `-520`, `foot`); a 1px difference in any `on_size_change` shows a seam band. The content layer paints `theme().paper` behind itself so the sheet's own gradient steps never show as a stripe. Rail mode (<160px) skips parchment entirely — a 44px torn edge stretches visibly.
