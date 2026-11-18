# Oh My Herdr

A workbench layout for [Herdr](https://herdr.dev): spaces grouped by folder in the sidebar, each with a fixed colour; a collapsible drawer on the right for files and sessions; a status bar that keeps metrics in sight. Default theme is qingci (light); xuanmo (dark) and zhi (paper) are bundled too — zhi stacks desk, parchment sidebar, torn-edge page and ink text into one paper look.

中文说明见 [README.md](README.md).

![qingci](preview.png)
![xuanmo](preview-dark.png)

> Both images are drawn to the layout's proportions — not screenshots.

---

## What changed

- **Spaces grouped by folder.** Group headers (pixel folder, count, rule), space rows, terminal rows — three levels of indent. Spaces lead with an 8×8 pixel critter instead of a number badge (15 to pick from, one per name, Alt+click to cycle); colours are assigned automatically and remembered, and switching themes only swaps the light/dark step, not the hue.
- **Pixel icons.** Project rows and space rows share one 8×8 grid (drawn as GPUI rectangles, so edges stay hard instead of being blurred by scaling); `programs.json` gives OMP the Codex pixel glyph; a pixel bell in the header appears only when an agent waits on you (blocked, or done while you weren't looking), carries the count, and clicks through to the most urgent one.
- **Sidebar folds to 44px** into a rail of coloured badges, and back.
- **Top bar reworked.** Tabs are 30px tall; the panel buttons carry names; a small dot on the left shows the current space's colour.
- **Five drawer pages** — files (`inkstone-files`), changes, cockpit, sessions, favourites — all closed by default. The files drawer adds fast path search (`git ls-files` / `jj file list` first), one-click `@path` copying in rows and previews, and `jj`/`git` status marks; the sessions drawer needs no Python and adds live search, source pills, current-folder & remote-machine scanning, and one-click resume-command copying, switching to live sessions instead of replaying history.
- **Status bar**: CPU and memory, listening port count, agents waiting on you (click for the list), review entry.
- **Right-click pastes** in terminals, no menu.

## Install

### Script (Windows PowerShell)

```powershell
.\install.ps1 -DryRun     # see what it would write
.\install.ps1             # never overwrites; programs.json only gains missing omp
```

### Script (macOS / Linux / WSL)

```sh
./install.sh --dry-run    # see what it would write
./install.sh              # never overwrites; --force overwrites
./install.sh --target=DIR # install somewhere else
```

Only `install.sh` needs `python3` (or `python`) to merge `programs.json`; without one it prints the `omp` entry to add by hand. The layout and all 14 mods have zero runtime Python dependency.

`pixel-icons/` and `programs.json` install together: the latter only adds one `omp` entry (icon `pixel-icons/codex.svg`, `tint: false`) to your program table; an existing `omp` entry is left as it is.

### On a second machine

Clone the repo and run the right script on another machine (Windows / macOS / Linux) — layout, mods and themes come out identical. Three things are deliberately **not** in the repo: space colours and favourites (they live in `shared.json`), fonts and appearance (`settings.json`, not shipped), and each machine's own spaces and sessions (`view.json`, `~/.omp` / `~/.codex` / `~/.claude` / `~/.pi`). So on a second machine spaces get their colours assigned afresh and favourites start empty; the behaviour is unaffected.

Each machine needs Herdr's shipped `changes` / `workspace-status` / `pane` mods (plus `mods/files/*.svg` icons), `git` (or optional `jj`) for branch/status labels, and whichever agent CLIs (`omp` / `codex` / `claude` / `pi` / `opencode`) you resume from the sessions drawer.

### By hand

1. `layouts/oh-my-herdr.json` → `~/.config/herdr-app/layouts/` (Windows: `C:\Users\<you>\.config\herdr-app\layouts\`).
2. Every folder under `mods/` → the config dir's `mods/`.
3. `themes/qingci.json`, `themes/xuanmo.json`, `themes/zhi.json` → the config dir's `themes/`.
4. Switch to it:

```sh
herdr-app check mods/inkstone-workbench     # worth doing for every mod
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
```

Back is `ctrl-shift-l`; to undo, delete the files.

### Requirements

Herdr's shipped `changes`, `workspace-status`, `pane` mods (and `mods/files/*.svg` icons); `inkstone-files` uses `git` (or optional `jj`) plus PowerShell/`sh`; `inkstone-sessions` uses PowerShell on Windows or `sh` + `awk` on macOS/Linux/remote machines to scan OMP / Codex / Claude Code / Pi / project-local archives (plus OpenCode when `sqlite3` is available); `inkstone-metrics` reads OS CPU/memory counters; `inkstone-ports` uses `Get-NetTCPConnection` on Windows and `lsof` (or `ss`) on macOS/Linux. Everything runs locally or over Herdr's configured remote machine, no extra network, no Python at runtime.

## Palette

Seven space colours, assigned by "least used index" and stored as indices, not hex: `shared("inkstone.spaceColors")` = `{spaceId: 0..6}`. Contrast against the qingci background is 4.82–5.69:1; against xuanmo, 6.39–11.26:1.

| # | Light | Dark | Hue |
|---|---|---|---|
| 0 | `#a84a50` | `#f08a8a` | brick |
| 1 | `#8a5619` | `#f2a46a` | ochre |
| 2 | `#7d640c` | `#e8c76a` | mustard |
| 3 | `#357041` | `#7ecf86` | bamboo |
| 4 | `#34618f` | `#6fb3ea` | indigo |
| 5 | `#5f5399` | `#9a8ce6` | violet |
| 6 | `#805083` | `#c98ae6` | wisteria |

The palette exists twice — `mods/inkstone-workbench/main.js` and `mods/inkstone-tabs/main.js` — because mods cannot import each other; change both.

## Themes

`themes/qingci.json` (background `#e8f0ec`, foreground `#2b333e`, accent `#126e82`) and `themes/xuanmo.json` (background `#14131a`, foreground `#d4cec4`, accent `#619ac3`), each a full 16-colour ANSI set plus semantic slots. The layout declares `theme: { "light": "qingci", "dark": "xuanmo" }` and follows `appearance` in `settings.json`.

`themes/zhi.json` (paper `#f8f5ee`, desk `#dad1bf`, ink `#2a2420`, highlighter `#f8dc4c`, blue-pencil bracket `#2c4f9e`) is an **optional third theme**, off by default: `herdr-app do app.theme '{"name":"zhi"}'`, or pick it in preferences. It adds 11 custom slots (`paper` / `desk` / `ink` / `pencil` / `rule` / `stroke` / `mark` / `bracket` / `up` / `down` / `seal`). Mods only test whether a `paper` slot exists — they never look at theme names — so any theme that defines `paper` gets the paper look. The torn edge is the one extra layer: light qingci draws it too, using the same slices recoloured to its own `background` / `muted` (`mods/inkstone-edge/ink-qingci/`, no new colours); dark xuanmo skips it so no pale rim floats on the dark ground.

The preview images are regenerated from `preview.svg` and the two theme files:

```sh
python mkprev.py    # reads themes/*.json, redraws both previews
```

## Limitations

- Sidebar width, drawer state and the folded rail are runtime state (`layouts/.state/`); they may not survive a restart. The 272/380 in the layout file are starting values.
- The four status blocks are fixed width — changing their content length means editing the `px` values in `layouts/oh-my-herdr.json`.
- Live session matching checks `argv`/`foreground.argv` for the session ID first, then falls back to the first 24 chars of the OSC terminal title plus cwd; manually renaming the title on an unflagged process won't match.
- The cockpit page depends on the `cockpit` mod's own data shape; copying it out alone degrades.
- Sidebar grouping is inferred from cwd prefixes; deep directories get merged.

## Files

```
layouts/oh-my-herdr.json     layout
layouts/oh-my-herdr.png      layout preview (same as preview.png)
preview.svg                  diagram source, shared by both themes
mkprev.py                    generates preview.png / preview-dark.png
mods/inkstone-chrome         brand row + footer rows
mods/inkstone-workbench      folder/space/terminal list, rail mode, 8×8 pixel critters (sprites.js)
mods/inkstone-tabs           tabs + panel buttons + window buttons
mods/inkstone-edge           torn-edge slices around the terminal (paper uses ink/, qingci uses ink-qingci/, dark draws none)
mods/inkstone-pane           custom pane header: program, cwd, status badge, hover split/zoom/close
mods/inkstone-files          file tree, path search, @path copy & jj/git marks
mods/inkstone-sessions       multi-source sessions (search / filters / remote / copy cmd)
mods/inkstone-favorites      favourites drawer
mods/inkstone-inbox          waiting block + overlay
mods/inkstone-metrics        CPU/memory block
mods/inkstone-ports          port block
mods/inkstone-review         review block
mods/inkstone-settings       preferences overlay
mods/inkstone-paste          right-click paste in terminals
mods/inkstone-menu           context menu for workbench rows and optional terminal menu
mods/cockpit                 cockpit drawer
themes/qingci.json           light (default)
themes/xuanmo.json           dark
themes/zhi.json              paper (optional: parchment sidebar, torn edges, highlighter)
pixel-icons/codex.svg        the 8×8 Codex glyph OMP shows
programs.json                program-table patch: omp → pixel-icons/codex.svg
install.ps1 / install.sh     install (Windows / macOS·Linux)
refresh.ps1                  reverse-sync (pull the latest files back)
```
