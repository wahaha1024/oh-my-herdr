# Oh My Herdr

A full interface layer for [Herdr](https://herdr.dev): spaces grouped by folder in the sidebar, each with a colour that follows it; a drawer on the right for files and sessions; a status bar that stays out of the way. Install it with one script — nothing you already have is overwritten, and deleting the files puts Herdr back.

Default is qingci (light). xuanmo (dark) and the optional zhi (paper) are bundled too.

中文说明见 [README.md](README.md).

![qingci](screenshot.png)
![paper](screenshot-paper.png)

> Real renders, not mockups: the sidebar is dragged to its 44px rail, the middle is two terminals side by side each with its own pane header, the page edge is torn, and the drawer sits on the files page. The terminal runs a demo repository — no real data. For xuanmo (dark), see `preview-dark.png` (a diagram).

## Why use it

- **Folder → space → terminal in one glance.** The sidebar groups spaces by directory, and a space's colour follows its badge, its tab and its terminal, so you always know which project and which machine you are in.
- **Waiting doesn't interrupt.** A pixel bell with a count appears only when an agent needs you; click it to jump to the most urgent one. Files, changes and sessions live in the right-hand drawer and never steal the terminal.
- **Three themes, one rule.** Light and dark follow the system. Paper is a different look entirely — desk colour, parchment sidebar, torn-edge page, highlighter selection.
- **Everything runs locally.** Folders, sessions, ports and memory are read from local files and OS counters. No network calls, no Python at runtime.

## What differs from stock Herdr

| Area | Stock | With this |
|---|---|---|
| Sidebar | One column of spaces, agents/terminals split below | Three levels of indent: folder, space, terminal, with counts on group headers. Each space leads with an 8×8 pixel critter (15 to pick from, Alt+click to cycle); colours are assigned and remembered. Dragged to 44px it becomes a rail of badges |
| Top bar | Tab strip | 30px tabs; named panel buttons at the right (files / sessions / favourites / cockpit / changes); a colour dot for the current space at the left; minimise / maximise / close folded into the same row, with no system title bar above it |
| Terminal panes | Default pane header | Custom header: program icon, name, cwd, status (spinner while working, "waiting on you" badge, check when done), with split / zoom / close on hover |
| Right drawer | Built-in panels | One 380px drawer switching between five pages: files, changes, cockpit, sessions, favourites |
| Status bar | Basic state | Four blocks: CPU and memory, listening ports, agents waiting on you (click for the list), review entry |
| Terminal | Context menu | Right-click pastes |
| Themes | Bundled | qingci, xuanmo, plus optional paper: parchment sidebar, torn page around the terminal, highlighter selection, pencil rules |

## What's new

- **Files page** — keyword search (`git ls-files` / `jj file list` first), one-click `@path` copy from rows and the preview header, `jj` / `git` status marks.
- **Sessions page** — scans OMP / Codex / Claude Code / Pi / project archives (OpenCode too when `sqlite3` is present), with search, source filters, current-folder and remote-machine scans, and one-click resume-command copy. A session already running in a terminal is marked open and clicking switches to it.
- **Cockpit** — what each agent is doing, where it is stuck, and what it suggests next, on one page.
- **Favourites** — pin the spaces and terminals you keep coming back to.
- **Prompt history** — OMP panes get a button at the right end of the pane header; it opens every prompt you sent in that session, newest first, scrollable and live-updating. Click one to see three things in the panel: your prompt, the tools that turn ran, and the agent's last reply — the terminal keeps only about the last thousand lines, so older turns live here. Rows still present in the terminal carry a dot and jump back to their place.
- **Remote spaces** — once a machine is connected, its folders, sessions and files list like local ones.

## Themes

- `themes/qingci.json` — light, the default: pale teal-grey ground, deep ink text, teal accent.
- `themes/xuanmo.json` — dark: deep ground, warm text; selected automatically when the system is dark.
- `themes/zhi.json` — paper, optional and off by default: paper ground, desk colour, ink text, highlighter, blue-pencil brackets. Switch with `herdr-app do app.theme '{"name":"zhi"}'` or from preferences.

Paper is the one look that needs extra art (parchment and torn-edge slices, about 3MB, shipped with the package). In rail mode (sidebar under 44px) the parchment is skipped; the other themes are unaffected.

## Install

### Script (Windows PowerShell)

```powershell
.\install.ps1 -DryRun     # see what it would write
.\install.ps1             # never overwrites; programs.json only gains a missing omp entry
```

### Script (macOS / Linux / WSL)

```sh
./install.sh --dry-run    # see what it would write
./install.sh              # never overwrites; --force overwrites
./install.sh --target=DIR # install somewhere else
```

### By hand

1. `layouts/oh-my-herdr.json` → `~/.config/herdr-app/layouts/` (Windows: `C:\Users\<you>\.config\herdr-app\layouts\`).
2. Every folder under `mods/` → the config dir's `mods/`.
3. The three theme files under `themes/` → the config dir's `themes/`.
4. Switch to it: `herdr-app do layout.switch '{"name":"oh-my-herdr"}'`. Back is `ctrl-shift-l`.

### Requirements

Herdr's own `changes` / `workspace-status` / `pane` mods (they ship with Herdr) and `git` (or optional `jj`). `python3` is only used by `install.sh` to merge the program table; without it the entry to add is printed instead.

### On a second machine

Clone the repo and run the matching script — layout, mods and themes come out identical. What does not travel is per-machine state: space colours and favourites, fonts and appearance, each machine's own spaces and session records. So spaces get their colours assigned afresh and favourites start empty; everything else works the same.

To update a machine that already has it, add `-Force` (`./install.sh --force`): the scripts skip files that already exist, so without it the layout, mods and themes stay at the old version — the usual symptom is no torn paper edge around the terminal and no NEED YOU / IN FLIGHT sections at the bottom of the sidebar.

## Limits

- Sidebar width, drawer state and the folded rail are runtime state and may not survive a restart.
- Space colours and favourites are stored per machine, not synced with the repo.
- Sidebar grouping is inferred from cwd prefixes, so deep paths get merged into one group.
