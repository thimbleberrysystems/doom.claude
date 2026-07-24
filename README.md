# kaboom.claude 😈

**A real Doom, in your terminal, in one command.** No install, no WAD hunting, no compiler — `npx kaboom.claude` runs the actual Doom engine (doomgeneric, compiled to WebAssembly) full-screen with truecolor half-block rendering. It ships **Freedoom** — a free, BSD-licensed, Doom-compatible game — so there's nothing to download and no proprietary assets.

<p align="center">
  <img src="docs/freedoom-title.png" alt="Freedoom running in the terminal via kaboom.claude" width="600">
  <br>
  <em>Actual output from the bundled engine (Freedoom Phase 1) — rendered in your terminal as truecolor half-blocks.</em>
</p>

## Play

From a normal terminal (needs a real TTY — not Claude's `!`):

```sh
npx kaboom.claude
```

**Controls:** `WASD` / arrows move · `F` or `Ctrl` fire · `Space` use/open · `1`–`7` weapons · `Tab` map · `Esc` menu · `Q` quit.

> **Controls feel:** on terminals that support the **Kitty keyboard protocol** (Kitty, Ghostty, WezTerm) it auto-negotiates real key press/release events, so strafing and running are crisp. On other terminals it falls back to press-only with autorepeat (tap again to keep moving). Rendering uses **frame-diffing** (only changed cells are repainted), so it stays smooth even over SSH.

## Play it *next to* Claude

Want Doom running while you use Claude Code? A full-screen game can't share one terminal with Claude, so this opens a **tmux split** — Claude on the left, real Doom on the right:

```sh
npx kaboom.claude split
```

Focus the Doom pane (`Ctrl-b` then `→`) to play while you wait on a response; focus Claude to type. (Requires `tmux`; Linux/macOS/WSL.)

```
┌─ Claude ─────┐┌─ DOOM ───────┐
│ > working…   ││  ▓█ imp!      │
│              ││  HEALTH 80    │
└──────────────┘└──────────────┘
```

## How it works

- The engine is [**doomgeneric**](https://github.com/ozkl/doomgeneric) compiled to **WebAssembly** — it runs under plain Node, no native modules, no system packages. (The WASM build is vendored from [pi-doom](https://github.com/badlogic/pi-doom).)
- Each 640×400 frame is drawn with half-block `▀` characters: the top pixel is the cell's foreground color, the bottom pixel its background — two pixels per character cell, 24-bit color, fit to your terminal.
- Keyboard comes from raw-mode stdin, mapped to Doom key codes.
- The game data is **[Freedoom](https://freedoom.github.io/) Phase 1** (`freedoom1.wad`) — a free, **BSD-3-Clause** IWAD with **no id Software assets**. Bundled, so there's nothing to fetch.

## Requirements

- **Node.js ≥ 16** (WebAssembly support).
- A **truecolor terminal**. Linux, macOS, or WSL.

## Credits & license

- [Freedoom](https://freedoom.github.io/) — the free BSD-licensed game data (`freedoom1.wad`). © 2001–2024 the Freedoom contributors (see `engine/FREEDOOM-CREDITS.txt`).
- [doomgeneric](https://github.com/ozkl/doomgeneric) — the portable Doom engine port (from id Software's GPL engine release).
- [pi-doom](https://github.com/badlogic/pi-doom) — the Node/WASM build this vendors.

**Code: GPL-2.0-or-later. Game data (Freedoom): BSD-3-Clause.** See [LICENSE](LICENSE). This project ships **no id Software assets**. DOOM is a trademark of id Software; Claude and Claude Code are trademarks of Anthropic. This is an independent, unofficial tool, not affiliated with or endorsed by id Software, the Freedoom project, or Anthropic.
