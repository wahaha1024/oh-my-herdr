# Oh My Herdr

> **Dev-branch notes (`dev` only).** This file is tracked on `dev` so both machines can share code locations, change notes and troubleshooting steps. `main` never carries it — before merging `dev` into `main`, run `git rm --cached RECIPE.md RECIPE.zh.md` and commit that, so the notes stay out of the public repo. Never `git push` to `origin` after an edit — wait for explicit approval. The public repo carries only `mods/`, `themes/`, `layouts/`, `pixel-icons/`, `programs.json`, the install scripts, README and LICENSE.

A Herdr layout with machines, folders, spaces and terminals on the left. A 380px drawer on the right holds Files, Sessions and Favourites; the 28px status bar holds CPU, memory, ports, pending agents and Review. Space colours carry across the UI, and the sidebar can collapse to an icon rail.

[中文版 RECIPE](RECIPE.zh.md)

![Oh My Herdr](preview.png)

## 2026-11-19 development handoff

In the checkout, run `git switch dev` and `git pull --ff-only origin dev`. Back up the live Herdr config on a machine with an existing install. Preview with `.\install.ps1 -DryRun -Force` on Windows or `./install.sh --dry-run --force` on macOS/Linux, then remove the dry-run flag to install and switch layouts or restart. Without `-Force` / `--force`, the installers report and skip existing files; even with it, an existing `programs.omp` entry is kept. `refresh.ps1` goes the other way (live configuration → repository). Do not sync `data/` caches or OMP session logs between machines.

### OMP history and reader (`d41c014`, `4459530`)

- **Entry points.** The clock in [`inkstone-pane`](mods/inkstone-pane/main.js) opens history for a local Windows OMP pane. In [`inkstone-history`](mods/inkstone-history/main.js), `rounds()` groups prompts, replies and tools and places compaction markers; `firstKeptEntryId` can point to a user or assistant message. Search all three kinds of text, navigate with ↑/↓, jump with Enter, double-click or the arrow, or open the 62% × 86% reader with the button or `r`. The reader reuses `shared("inkstone.history.read")` rather than rereading the log. A dot means no scrollback match. Do not paste `/tree` as a workaround: OMP receives the pasted text as a prompt, and the CLI cannot target a tree node.
- **First paint and refresh.** `load()` resolves the log by `pane.cwd` and title (`FOUND` keeps hits for 120 seconds), then paints cached rounds before parsing. `readMessages()` prefers Node and resumes from `seen`, the byte after the last complete newline. Leave partial lines for the next pass and reread from zero if the file shrank below the offset. Without Node, PowerShell scans the whole file. Both subprocesses send filtered records, never the full JSONL across IPC. `watchFolder` coalesces writes into a reload after 2 seconds; the 15-second title check only resolves a new file when the title changes. `syncAlign()` reuses alignment if the scrollback total and alignment length match, otherwise uses the 1,500 ms `hc read` cache.
- **Disk cache.** `PARSED` holds at most four sessions; `${appHome()}/data/inkstone-history-cache.json` keeps the three most recent paths in `{v:1, entries:{…}}`. Skip writing if the whole serialised document exceeds 900,000 characters (the `readTextFile` limit is 1 MiB). Saves during refresh are at least 5 seconds apart; close attempts to flush a pending save. `writeTextFile(path, text, expected)` requires the original contents as `expected`; `null` is only for a new file. Check this if the first save succeeds but `seen` never advances.
- **Visual changes.** Edit `FS`, `sectionLabel()`, `row()`, `markRow()` and `renderRead()`. Use theme slots: `accent` for selection/jump, `done` for replies, `working` for tools, and `popover` for the paper search background. Keep the system font and the paper highlighter; GPUI rejects `bg("transparent")`.
- **Verify on the receiving machine.** In the live config, run `herdr-app check mods/inkstone-history` and check that `herdr-app status` reports no errors. Use an OMP session with a long reply and a compaction marker; check search, Esc clearing search, `r` opening the reader and Esc closing it, and arrows only on aligned turns. Check `qingci`, `xuanmo` and `zhi`. The previous machine's ~40 MB probe took 421 ms for a full parse and 103 ms for an empty tail; these are parser timings, not time to first paint. Measure uncached open, first open with disk cache after restart, and same-process reopen separately. Test complete and partial appended lines on a copy of the log.

### Sidebar, Review and Sessions

- **Spaces / Agents** (`de3c9a5`, `d41c014`): [`sidebar-lists`](layouts/oh-my-herdr.json) gives Spaces and Agents weights 5:4 with zero gap. [`inkstone-workbench`](mods/inkstone-workbench/main.js) groups by machine → folder → space; [`inkstone-agents`](mods/inkstone-agents/main.js) lists waiting, running and done separately. `EDGE_B` / `EDGE_TOP` crop the adjacent card edges to 8 px. The terminal's [`artDir()`](mods/inkstone-edge/main.js) uses the original paper art for `paper`; other palettes match `background` and `muted` to `ink-qingci`, `ink-xuanzhi` or `ink-xuanmo`.
- **Review** (`3963819`, `d41c014`): [`inkstone-review`](mods/inkstone-review/main.js) opens from the status bar and reads live Git changes with `git diff HEAD`, loading untracked file bodies only on demand. Unified and split views use the same diff. `turnEdits()` / `turnPaths()` resolve paths from `edit` / `write` / `apply_patch` since the latest user message, for repository discovery and ordering, not as a substitute for Git. If the current turn is empty, check UTF-8 paths on Windows and whether the tail contains a user boundary. `tailLines()` filters for user and `tool_execution_start` lines in the subprocess; unfiltered logs can exceed the 8 MiB `exec` output limit.
- **Sessions** (`d41c014`): [`inkstone-sessions`](mods/inkstone-sessions/main.js) adds CodeBuddy, local/remote browsing and a separate 45-second list cache at `data/inkstone-sessions-cache.json`. Test single and bulk deletion only with disposable records: deletion affects actual session records, not just list entries. The right drawer holds Files, Sessions and Favourites; changes go through Review, and Cockpit is a top-bar popup. Keep the two README files user-facing; put troubleshooting here.


## What you see

The window has no OS titlebar (`"titlebar": "none"`); the layout draws its own chrome. Four regions:

**Sidebar, left, 284px** (`min` 44, `max` 420): a 44px brand strip, a flexible column for Spaces and Agents at weights 5:4, then a 40px footer. See the handoff above for grouping and card edges.

**Work column, right**, a column of three:

- 42px header (`inkstone-tabs`): terminal tabs, Files/Sessions/Favourites buttons, a Cockpit popup and window controls.
- Work area: four 12px `inkstone-edge` slices around `panel-body`, plus the 380px drawer. The pane header is `inkstone-pane` (30px, always shown); the pane gap is 1px.
- 28px status row: `workspace-status` grows; `inkstone-metrics`, `inkstone-ports`, `inkstone-inbox` and `inkstone-review` take 152, 64, 84 and 148px respectively.

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

**Panel buttons.** `openPanel(id)` selects Files, Sessions or Favourites in `panel-stack` and shows `panel`; the active page is read from `stack.active`.

**Files & Sessions drawers.** `inkstone-files` provides a Chinese-localised file tree and read-only highlighted preview (`Esc` clears search or exits preview), builds a path search index via `git ls-files` / `jj file list` (falling back to bounded directory traversal skipping `.git`, `.jj`, `node_modules`, `target`, `dist`, `.next`, `__pycache__`), renders `jj` or `git --no-optional-locks` status marks, and offers one-click `@relative/path` clipboard copy on every row and preview header. `inkstone-sessions` scans OMP (`~/.omp/agent/sessions`), Codex (`~/.codex/sessions`), Claude Code (`~/.claude/projects`), Pi (`~/.pi/agent/sessions`), project-local `.herdr/conversations` archives, and (when `sqlite3` is available) OpenCode databases across both the local machine and active remote `{ on }` spaces — reading the first and last 25 lines per `.jsonl` (or full file up to 64 KiB) to pick up the latest `title_change` / `custom-title` / `ai-title`. It includes live keyword search, source filter pills, a current-directory-first vs all-sessions toggle, and one-click resume-command copying. Clicking a row checks `live(s)` first (matching session ID in `argv`/`foreground.argv`, falling back to the first 24 characters of the OSC terminal title plus `cwd`) to switch to an open terminal, or launches `terminal.open` (`omp`/`claude --resume`, `codex resume`, `pi --session`, `opencode -s`).

**Favourites drawer.** `shared("inkstone.favorites")` is `[{ name, folder }]`. "Collect current" resolves the current space's folder (its first terminal's live cwd, else the space's `folder`) and appends it with the folder's basename as the name; duplicates are ignored. A row clicks through to `space.new { folder }` and shows an "already open" chip when some space's live folder matches. The remove button deletes the row. The empty state offers a "browse folders…" row.

**Pending (inbox).** The status block shows a status shape and "N waiting" (or "nothing waiting"), sized 84px; clicking opens the `inkstone-inbox` overlay (400×320), which lists the blocked agents with their space and tab.

**Metrics / ports / review.** Metrics and ports open their overlays on click. The 148px Review block also displays a Git summary; see the handoff for the diff window.

**Right-click pastes.** `terminal_menu: "inkstone-paste"` points Herdr's terminal menu at a mod that does not draw a menu at all: a 1×1 overlay that on open focuses `props().target.terminal` (falling back to the focused pane only for an explicit command with no target), runs `terminal.paste`, and closes its own overlay (`props().overlay` → `closeOverlay`). Net effect: a right-click in a terminal is a paste, with no menu in the way. `init()` returns early when `checking()` is true, so `herdr-app check` never touches the clipboard.

## Built from

**Layout node tree** (`layouts/oh-my-herdr.json`), top to bottom:

```
layout root     column titlebar none, traffic_lights [12,16],
                       terminal_menu inkstone-paste, theme {light:qingci, dark:xuanmo}
root            row    bg canvas, terminal_padding [14,12], divider 1/border,
                       preview layouts/oh-my-herdr.png
├ sidebar       column 284 (min 44 max 420, bg canvas, resizable, window_drag false)
│ ├ brand       block 44  window_drag, content {mod: inkstone-chrome}
│ ├ sidebar-lists column gap 0
│ │ ├ workbench block weight 5, content {mod: inkstone-workbench}
│ │ └ agents    block weight 4, content {mod: inkstone-agents}
│ └ sidebar-footer block 40, content {mod: inkstone-chrome, props {footer: true}}
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
  │              active files; children: files {mod inkstone-files},
  │              sessions {mod inkstone-sessions}, favorites {mod inkstone-favorites}
  └ status      row
    ├ status-text    block  (mod workspace-status, grows)
    ├ metrics        block 152 (mod inkstone-metrics)
    ├ ports          block 64  (mod inkstone-ports)
    ├ inbox          block 84  (mod inkstone-inbox)
    └ review         block 148 (mod inkstone-review)
```

**Mods written for this layout** (each `mods/<name>/mod.json` is `{ "place": "none" }` unless noted; every one exports a `View` subclass and uses `gpui-kit` + `gpui-base` + `herdr`):

| Mod | Role | Reads / writes | Commands |
|---|---|---|---|
| `inkstone-chrome` | brand strip and footer, one component with a `footer` prop | `layout()` (sidebar width), `shared("sidebar.width")`, `shared("sidebar.collapsed")` | `layout.resize`, `mod.open`, `app.help`, `space.new` |
| `inkstone-workbench` | machine/folder groups, spaces, terminals and icon rail | `spaces()`, `panes()`, `machines()`, `layout()`, `shared("inkstone.spaceColors")` | `space.select`, `tab.select`, `pane.focus`, `space.new` |
| `inkstone-agents` | separate waiting, running and done groups | `agents()`, `spaces()`, `panes()`, `layout()` | `space.select`, `tab.select`, `pane.focus` |
| `inkstone-tabs` | tab strip, panel buttons, window buttons | `spaces()`, `panes()`, `shared("inkstone.git")`, `shared("inkstone.spaceColors")`, `layout()` | `tab.select`, `tab.close`, `tab.new`, `layout.select`, `layout.show`, `layout.hide`, `window.*`. |
| `inkstone-edge` | torn-paper slices for `paper` or a matching palette | `theme()`, `layout()` | — |
| `inkstone-pane` | custom pane header: program icon + name, `~/`-folded cwd, working spinner / "待你处理" badge / done check, hover-only split-right / split-down / zoom / close buttons, pencil rule under it | `panes()`, `layout()`, `theme()` | `pane.focus`, `pane.split`, `pane.zoom`, `pane.close` |
| `inkstone-files` | project file tree, path search, `@path` copy, `jj`/`git` marks | `spaces()`, `panes()`, `focused()`, `readTextFile`, `watchFolder`, `exec` | `cx.write_to_clipboard` |
| `inkstone-history` | searchable OMP history by turn, compaction markers and full-window reader | session JSONL, `hc read`, `shared("inkstone.history")`, `shared("inkstone.history.read")` | `pane.focus`, `terminal.scroll` |
| `inkstone-sessions` | multi-source session drawer (search, filters, remote `{ on }`, copy cmd) | local/remote session dirs via `exec` (PowerShell / `sh`+`awk` / optional `sqlite3`), `terminals()`, `spaces()` | `space.select`, `tab.select`, `pane.focus`, `terminal.open` |
| `inkstone-favorites` | favourites drawer | `shared("inkstone.favorites")`, `panes()` | `space.new`, `mod.open` |
| `inkstone-inbox` | 84px status block + overlay | `spaces()`, `agents` from panes | `space.select`, `tab.select`, `pane.focus`, `overlay.close` |
| `inkstone-metrics` | 152px CPU/memory block | system counters | `overlay.close` |
| `inkstone-ports` | 64px port count | listening sockets | — |
| `inkstone-review` | Git summary and live unified/split diff with current-turn ordering | Git diff/status, OMP session log | `mod.open` |
| `inkstone-settings` | preferences overlay (`overlay: 760×520`, title "OMH 偏好") | `theme()`, settings | `app.theme`, `overlay.close` |
| `inkstone-paste` | right-click pastes straight into the terminal (`terminal_menu`); a 1×1 overlay that focuses the target terminal, runs `terminal.paste` and closes itself | `props().overlay`, `props().target.terminal` | `pane.focus`, `terminal.paste` |
| `inkstone-menu` | Chinese context menu for workbench rows and optional `terminal_menu` (`overlay: 248×348`) | `props()`, `spaces()`, `panes()`, `terminals()`, `keys()`, `git` via `exec` | `pane.focus`, `terminal.*`, `pane.*`, `tab.*`, `space.*`, `app.*`, `worktree` |
| `cockpit` | top-bar popup | `spaces()`, `panes()` | `space.select`, `tab.select` |

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
- **Fixed status widths.** 152/64/84/148 are layout `px` values; change both the mod's text and the layout when longer content no longer fits.
- **`inkstone-inbox`'s overlay is 400×320.** At larger sizes the empty state swims.
- **`shared("sidebar.width")` starts undefined** — default it to 268 rather than reading it directly.
- The drawer starts hidden (`hidden: true` on `panel`); `openPanel` must therefore both select the page and show the node, and the page must be read from `stack.active` rather than tracked separately, or the buttons drift out of sync after a keyboard switch.
- **Do not swap the sprites for SVGs.** The 8×8 patterns are drawn as rectangles on purpose; a bell SVG rendered at 14px came out as a smooth blob with the pixel steps antialiased away. The same applies to the program icon: `image(...)` at 12px blurred it, at 16px (2× of 8 units) it is sharp.
- **`programs.json` is a patch, not a file to copy blindly.** The installer only adds `omp` and leaves an existing entry alone; `pixel-icons/` must ship with it or the icon path dangles and Herdr falls back to its own glyph.
- **`inkstone-edge`'s `mod.json` must stay `{ "place": "none" }`.** Any other `place` makes Herdr splice the block into the layout automatically, and deleting the mod then leaves a hole in the layout.
- **`titlebar` and `traffic_lights` belong on the layout document's outermost node** — the same level as `id`, `type` and `children`. Put them on the inner `root` row and they are silently ignored: the OS titlebar keeps floating above the layout, `window().buttons` stays `false`, and the three − □ × in `inkstone-tabs` never render. Moved out, the titlebar disappears and minimize/maximize/close sit in the tab strip right after the panel buttons.
- **Paper is gated on a theme slot, not a theme name.** Every paper branch reads `Boolean(theme().paper)` and falls back to ordinary slots, because the Looseleaf art is hardcoded light hex — vendored artwork cannot follow a dark theme. Keep the fallback branch free of expressions that would throw when the slot is missing (no `t.mark.slice(...)`, no `t.paper` arithmetic).
- **The three parchment slices must agree to the pixel.** Brand, list and footer draw three crops of one 1600px sheet (`top`, `mid` offset `-520`, `foot`); a 1px difference in any `on_size_change` shows a seam band. The content layer paints `theme().paper` behind itself so the sheet's own gradient steps never show as a stripe. Rail mode (<160px) skips parchment entirely — a 44px torn edge stretches visibly.
- **A always-on pane-header button must reserve the hover group's width.** The header is an `h_flex` with `gap 8`; when the four hover buttons appear, the row grows and every button to their left shifts by 4×22 + 4×8 = 120px. The OMP history button sat right there, so a click aimed at it landed on `close` and killed the terminal. Render four empty 22px divs at the same slots while not hovered — one merged 88px block is not enough, because the parent's `gap` only applies between siblings.
- **No arrow on an old turn? Check live scrollback first.** Run `hc read <term> --lines 20000 --json` against the exact current terminal. `complete: false` means the returned scrollback is partial, not that log parsing failed. Filter large JSONL logs in a subprocess; `readTextFile` is for small caches only.
- **PowerShell commands sent through `exec` lose their double quotes.** Windows' argument parsing strips `"` before PowerShell sees it, so the command looks unterminated, PowerShell waits on stdin and the call only returns on timeout. Build all quoting from `[string][char]34`, and prefix command strings with `[Console]::OutputEncoding=[Text.Encoding]::UTF8;` — otherwise a Chinese path comes back as mojibake and the lookup fails silently.
- **Locate the OMP session by `pane.cwd`, not by title search.** `~/.omp/agent/sessions/<cwd with [:\/] replaced by ->` holds only that project's sessions; scanning the whole store and falling back to “most recently written file” silently shows another project's conversation when the title is still empty.

## Troubleshooting

Something looks off after installing (classic case: no torn paper edge around the terminal, no Agents block with Needs you / In flight / Done in the lower sidebar). Run these three checks on the machine that misbehaves:

```powershell
$cfg = "$HOME\.config\herdr-app"
# 1) does the layout carry the four page strips? expect 4
(Select-String -Path "$cfg\layouts\oh-my-herdr.json" -Pattern 'page-left|page-right|page-top|page-bottom').Count
# 2) is the edge mod the version with the qingci slices? expect more than 0 (0 means the old one)
(Select-String -Path "$cfg\mods\inkstone-edge\main.js" -Pattern 'ink-qingci').Count
# 3) any mod load errors? expect empty
(herdr-app status | ConvertFrom-Json).errors
```

macOS / Linux equivalents:

```sh
cfg="$HOME/.config/herdr-app"
grep -c 'page-left\|page-right\|page-top\|page-bottom' "$cfg/layouts/oh-my-herdr.json"
grep -c 'ink-qingci' "$cfg/mods/inkstone-edge/main.js"
herdr-app status | grep -o '"errors":\[[^]]*\]'
```

| Result | Cause | Fix |
|---|---|---|
| 1 is not 4, or 2 is 0 | an older install is in place; `install.ps1` / `install.sh` skipped the existing files | `.\install.ps1 -Force` (`./install.sh --force`), then `herdr-app do layout.switch '{"name":"oh-my-herdr"}'`, or restart herdr-app |
| 3 is not empty | herdr older than 0.1.16, no `themes` export, the edge mod fails to load | update herdr |
| all three fine, still no edge | the active palette may not match an edge preset | compare with `herdr-app do app.theme '{"name":"qingci"}'` and check `inkstone-edge/main.js` `PRESETS` |

Either way the config only takes effect after a reload: switch the layout once, or restart herdr-app.

Deploying from the repo to a machine: `refresh.ps1` only syncs **live → repo**. Going the other way is a manual copy (back up to `~/.config/herdr-app/.backup-<date>/` first) or `install.ps1 -Force`.
