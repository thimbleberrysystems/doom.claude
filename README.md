# kaboom.claude 😈

**Real [Freedoom](https://freedoom.github.io/), playable right next to Claude Code — in one command.** `npx kaboom.claude` opens a split: Claude on the left, the game on the right. The game **starts the moment Claude begins working** and **waits when you switch back to read the reply** — so you frag demons in the dead time and never miss Claude's answer. No install, no WAD hunting, no compiler: the real [doomgeneric](https://github.com/ozkl/doomgeneric) engine runs as WebAssembly and the free, BSD-licensed game data ships in the package.

<p align="center">
  <img src="docs/kaboom-demo.gif" alt="kaboom.claude in action: Claude Code on the left, Freedoom playing in the right tmux pane" width="900">
  <br>
  <em>Claude working on the left; real Freedoom playing in the right pane. The focused pane gets the green outline; the bottom bar carries the controls hint and the switch / minimize / zoom / close buttons.</em>
</p>

## Play

From a normal terminal (needs `tmux`; Linux/macOS/WSL):

```sh
npx kaboom.claude
```

That's it — Claude and the game open side by side, each pane **labelled** (`◀ CLAUDE` / `GAME ▶`) with the **focused pane outlined in bright green** so it's always clear which one has your keys.

- **Auto-starts on Claude's turn.** The moment you send a prompt and Claude starts working, the game **comes into focus and plays** — hands-free. (It focuses the pane; it does *not* zoom you to fullscreen — that stays your call.)
- **Hands you back when Claude replies.** By default, the moment Claude finishes the game **pauses and focus returns to Claude** so you never miss the answer — play the wait, then you're right back where you need to be.
- **Don't want the interruption?** Click **Don't interrupt** in the bottom bar. Now when Claude replies the game **keeps playing** and just shows a **🔔 note**; go read the reply whenever *you* like (`Alt-←` or click the left pane). Click it again to go back to auto-return.
- **Switch panes:** **click** a pane, the **◀ Claude** / **Game ▶** buttons in the bottom bar, or **Alt-←/→**. The green outline moves with you.
- **Resize the split:** **drag the divider** with your mouse, or nudge it with **Alt-Shift-←/→** (hold to slide it) — give the game more room, or hand it back to Claude, however you like.
- **Minimize:** the **››** button shrinks the game to a thin sliver at the edge and drops you into Claude. **Click the sliver** (it shows **‹‹**) to bring the game back to its previous size — the strip itself is the restore button, right there at the divider.
- **Zoom:** the **⤢ Zoom** button (or **Alt-z**) blows the game up to fullscreen for real playing; press again to return.
- **Close the game:** the **✕ Close game** button (or **Q**) closes the **game only — Claude keeps running**. The button then becomes **✕ Close Claude**, which ends the whole split.

### Controls

| Action | Keys |
|---|---|
| Move / turn | `W A S D` or arrow keys |
| **Fire** | **`Space`** or `F` |
| **Use** (doors, switches) | **`E`** |
| Run | hold `Shift` while moving |
| Weapons | `1`–`7` |
| Automap | `Tab` |
| Menu | `Esc` |
| Quit the game | `Q` |

Runs on its **own tmux socket**, so your normal tmux config is untouched. Remove the pause hooks any time with `npx kaboom.claude unhook`.

### No tmux? Play full-screen

```sh
npx kaboom.claude play
```

Runs just the game, full-screen, on its own — no Claude split, no tmux.

## How it renders (and why it's readable)

Getting Doom legible in a text terminal took two things beyond a naive pixel-to-character map:

- **Sextant blocks — 2×3 sub-pixels per character cell.** Each cell packs a 2-wide × 3-tall grid of pixels using Unicode sextant glyphs (`U+1FB00`…). The extra *vertical* resolution over half/quadrant blocks is what makes the menu, options, and scoreboard text actually readable.
- **Colour clustering, not brightness.** The six sub-pixels in a cell are split into a foreground and a background colour by **clustering on RGB distance**, not luminance. Doom's menus are red-on-red — near-identical brightness — so a brightness split turned them to mush; clustering on colour keeps the text crisp.
- **Frame-diffing** redraws only the cells that changed, so it stays smooth even over SSH. **24-bit truecolor**, fit to your terminal.

It's still a terminal, so for the sharpest picture press **Alt-z** (⤢ Zoom) to go fullscreen.

> **Font note:** sextant glyphs need a modern terminal font (Kitty, Ghostty, WezTerm, foot, recent Windows Terminal / VTE — WSL is fine). If yours shows blank boxes, set `KABOOM_BLOCKS=quad` to fall back to 2×2 quadrant blocks.
>
> **Keyboard note:** on terminals with the **Kitty keyboard protocol** (Kitty, Ghostty, WezTerm) controls use real key press/release for crisp strafe/run; elsewhere they fall back to autorepeat.

## How it works

- The engine is [**doomgeneric**](https://github.com/ozkl/doomgeneric) compiled to **WebAssembly** — it runs under plain Node, no native modules, no system packages. (The WASM build is vendored from [pi-doom](https://github.com/badlogic/pi-doom).)
- **Play/pause is driven by Claude's activity.** `npx kaboom.claude` installs two small Claude Code hooks — `UserPromptSubmit` → *busy*, `Stop` → *idle* — that write a per-session flag the game watches. The game plays while Claude is busy and freezes when you return to read. The hooks are guarded on a `KABOOM_ID` env var, so they do nothing in any Claude session that isn't a kaboom split. Remove them with `npx kaboom.claude unhook`.
- **Switching is beginner-proof.** Everything (mouse, Alt-keys, the status-bar buttons, the green focus outline) runs on a dedicated tmux socket, so none of your own tmux config is touched.
- The game data is **[Freedoom](https://freedoom.github.io/) Phase 1** (`freedoom1.wad`) — a free, **BSD-3-Clause** IWAD with **no id Software assets**. Bundled, so there's nothing to fetch.

## Requirements

- **Node.js ≥ 16** (WebAssembly support).
- **`tmux`** for the split (Linux / macOS / WSL). Full-screen `play` mode doesn't need it.
- A **truecolor terminal** with a font that has sextant glyphs (see the font note above).

## Credits & license

- [Freedoom](https://freedoom.github.io/) — the free, BSD-licensed game data (`freedoom1.wad`). © 2001–2024 the Freedoom contributors (see `engine/FREEDOOM-CREDITS.txt`).
- [doomgeneric](https://github.com/ozkl/doomgeneric) — the portable Doom engine port (from id Software's GPL engine release).
- [pi-doom](https://github.com/badlogic/pi-doom) — the Node/WASM build this vendors.

**Code: GPL-2.0-or-later** (full text in [COPYING](COPYING)). **Game data (Freedoom): BSD-3-Clause.** See [LICENSE](LICENSE) for full attributions, the GPL corresponding-source offer, and modification notes. The bundled `engine/doom.js` + `engine/doom.wasm` are an unmodified WebAssembly build of [doomgeneric](https://github.com/ozkl/doomgeneric) (via pi-doom); complete corresponding source is at those upstream repos.

This project ships **no id Software assets**. DOOM is a trademark of id Software; Claude and Claude Code are trademarks of Anthropic. This is an independent, unofficial tool, not affiliated with or endorsed by id Software, the Freedoom project, or Anthropic.
