# doom.claude 😈

**The real DOOM, in your terminal, in one command.** No install, no WAD hunting, no compiler — `npx doom.claude` runs the actual DOOM engine (doomgeneric, compiled to WebAssembly) full-screen with truecolor half-block rendering. The shareware game data ships in the package.

<p align="center">
  <img src="docs/doom-title.png" alt="DOOM running in the terminal via doom.claude" width="600">
  <br>
  <em>Actual output from the bundled engine — rendered in your terminal as truecolor half-blocks.</em>
</p>

## Play

From a normal terminal (needs a real TTY — not Claude's `!`):

```sh
npx doom.claude
```

**Controls:** `WASD` / arrows move · `F` or `Ctrl` fire · `Space` use/open · `1`–`7` weapons · `Tab` map · `Esc` menu · `Q` quit.

> **Controls feel:** on terminals that support the **Kitty keyboard protocol** (Kitty, Ghostty, WezTerm) it auto-negotiates real key press/release events, so strafing and running are crisp. On other terminals it falls back to press-only with autorepeat (tap again to keep moving). Rendering uses **frame-diffing** (only changed cells are repainted), so it stays smooth even over SSH.

## How it works

- The engine is [**doomgeneric**](https://github.com/ozkl/doomgeneric) compiled to **WebAssembly** — it runs under plain Node, no native modules, no system packages. (The WASM build is vendored from [pi-doom](https://github.com/badlogic/pi-doom).)
- Each 640×400 frame is drawn with half-block `▀` characters: the top pixel is the cell's foreground color, the bottom pixel its background — two pixels per character cell, 24-bit color, fit to your terminal.
- Keyboard comes from raw-mode stdin, mapped to DOOM key codes.
- The **shareware WAD** (`doom1.wad`, "Knee-Deep in the Dead") is bundled — freely redistributable, unmodified.

## Bonus: the DOOM status-line HUD

There's also a DOOM-themed **Claude Code status line** (from an earlier iteration) — HEALTH = remaining context, AMMO = tokens, a reactive DOOMGUY face, and an auto-firefight. It lives at the bottom of Claude while you work:

<p align="center">
  <img src="docs/doom.svg" alt="DOOM-themed Claude Code status-line HUD" width="640">
</p>

```sh
npx doom.claude hud        # install it
npx doom.claude hud off    # remove it
```

## Requirements

- **Node.js ≥ 16** (WebAssembly support).
- A **truecolor terminal**. Linux, macOS, or WSL.

## Credits & license

- [id Software](https://github.com/id-Software/DOOM) — DOOM (© 1993).
- [doomgeneric](https://github.com/ozkl/doomgeneric) — the portable port.
- [pi-doom](https://github.com/badlogic/pi-doom) — the Node/WASM build this vendors.

**GPL-2.0-or-later** (see [LICENSE](LICENSE)). DOOM is a trademark of id Software; this project is not affiliated with or endorsed by id Software.
