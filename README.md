# kaboom.claude 😈

**Real [Freedoom](https://freedoom.github.io/), playable right next to Claude Code — in one command.** `npx kaboom.claude` opens a split: Claude on one side, the game on the other. The game **plays while Claude is thinking** and **pauses when it replies** — so you frag demons in the dead time and never miss Claude's answer. No install, no WAD hunting, no compiler; the real [doomgeneric](https://github.com/ozkl/doomgeneric) engine runs as WebAssembly with truecolor half-block rendering, and the free BSD-licensed game data ships in the package.

<p align="center">
  <img src="docs/freedoom-title.png" alt="Freedoom running in the terminal via kaboom.claude" width="600">
  <br>
  <em>Actual output from the bundled engine (Freedoom Phase 1) — rendered in your terminal as truecolor half-blocks.</em>
</p>

## Play

From a normal terminal (needs `tmux`; Linux/macOS/WSL):

```sh
npx kaboom.claude
```

That's it — Claude and the game open side by side:

```
┌─ Claude ─────┐┌─ kaboom ─────┐
│ > working…   ││  ▓█ enemy!    │
│              ││  HEALTH 80    │
└──────────────┘└──────────────┘
```

- **Switch panes (easy):** just **click** a pane, or press **Alt-←/Alt-→** — no tmux prefix needed. (Classic `Ctrl-b` arrows work too.)
- **Auto play/pause:** the game **plays while Claude is thinking** and **pauses when it replies** (a banner shows the controls).
- **Play anytime:** press **`P`** in the game to play or pause manually — so you can keep playing even while Claude is idle.
- **Game controls:** `WASD` / arrows move · `F` or `Ctrl` fire · `Space` use · `1`–`7` weapons · `Tab` map · `Esc` menu · `Q` quit.
- Controls stay visible in the tmux status bar. It runs on its own tmux socket, so your normal tmux config is untouched. Remove the pause hooks later with `npx kaboom.claude unhook`.

> **Controls feel:** on terminals with the **Kitty keyboard protocol** (Kitty, Ghostty, WezTerm) it negotiates real key press/release for crisp strafe/run; elsewhere it falls back to autorepeat. Rendering uses **frame-diffing** so it stays smooth even over SSH.

### No tmux? Play full-screen

```sh
npx kaboom.claude play
```

Runs just the game, full-screen, on its own (no Claude split, no tmux).

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

**Code: GPL-2.0-or-later** (full text in [COPYING](COPYING)). **Game data (Freedoom): BSD-3-Clause.** See [LICENSE](LICENSE) for full attributions, the GPL corresponding-source offer, and modification notes. The bundled `engine/doom.js` + `engine/doom.wasm` are an unmodified WebAssembly build of [doomgeneric](https://github.com/ozkl/doomgeneric) (via pi-doom); complete corresponding source is at those upstream repos.

This project ships **no id Software assets**. DOOM is a trademark of id Software; Claude and Claude Code are trademarks of Anthropic. This is an independent, unofficial tool, not affiliated with or endorsed by id Software, the Freedoom project, or Anthropic.
