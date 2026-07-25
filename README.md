# kaboom.claude 😈

**Real [Freedoom](https://freedoom.github.io/), playable right next to Claude Code — in one command.** `npx kaboom.claude` opens a split: Claude on the left, the game on the right. The game **starts the moment Claude begins working** and **waits when you switch back to read the reply** — so you frag demons in the dead time and never miss Claude's answer. No install, no WAD hunting, no compiler: the real [doomgeneric](https://github.com/ozkl/doomgeneric) engine runs as WebAssembly and the free, BSD-licensed game data ships in the package.

<p align="center">
  <img src="docs/kaboom-demo.gif" alt="kaboom.claude in action: Claude Code on the left, Freedoom playing bottom-right with a live Claude info panel" width="900">
  <br>
  <em>Claude working on the left; real Freedoom playing bottom-right, with a live Claude info panel above it (state, model, context, tokens, cost, controls). Sixel-crisp pixels; switch / minimize / zoom / close buttons in the bottom bar.</em>
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

kaboom picks the best renderer your terminal supports, automatically:

- **Sixel (crisp, the good one).** When the terminal advertises **Sixel**, kaboom draws the framebuffer as **real pixels** — so menus, options and scores are pixel-sharp, exactly like the "very clear" terminal-Doom projects. Doom only uses ≤256 colours per frame, so each frame is encoded losslessly (no quantization) and drawn inside synchronized-output brackets to avoid tearing. The picture renders at Doom's native ~640×480, and in the split the **game pane auto-fits to it** so Claude gets all the leftover width (no black margins). This is auto-detected via the terminal's device-attributes reply; through tmux it needs a **tmux built with `--enable-sixel`** (tmux ≥3.4) and a Sixel-capable host terminal (**Windows Terminal ≥1.22**, WezTerm, xterm, foot, mlterm, …).
- **Block fallback (everywhere else).** Without Sixel, kaboom falls back to **sextant blocks** — a 2×3 grid of sub-pixels per character cell (Unicode `U+1FB00`…), with each cell's foreground/background split by **colour clustering** (not brightness), so red-on-red menu text still separates instead of turning to mush. Frame-diffing redraws only changed cells. Readable, if not pixel-perfect.

Either way it's **24-bit truecolor**, fit to your terminal; press **Alt-z** (⤢ Zoom) for the sharpest picture.

> **Knobs:** `KABOOM_SIXEL=0` forces the block renderer even where Sixel is available (and `=1` forces Sixel on); `KABOOM_BLOCKS=quad` uses 2×2 quadrant blocks (for fonts without sextant glyphs).
>
> **Keyboard note:** on terminals with the **Kitty keyboard protocol** (Kitty, Ghostty, WezTerm) controls use real key press/release for crisp strafe/run; elsewhere they fall back to autorepeat.

## How it works

- The engine is [**doomgeneric**](https://github.com/ozkl/doomgeneric) compiled to **WebAssembly** — it runs under plain Node, no native modules, no system packages. (The WASM build is vendored from [pi-doom](https://github.com/badlogic/pi-doom).)
- **Play/pause is driven by Claude's activity.** `npx kaboom.claude` installs small Claude Code hooks (`UserPromptSubmit` → *busy*, `Stop` → *idle*, plus subagent/tool/notification hooks) that write per-session files the game watches. The game plays while Claude is busy and freezes when you return to read. All hooks are guarded on a `KABOOM_ID` env var, so they do nothing in any Claude session that isn't a kaboom split.
- **A live Claude info panel** sits in the empty top-right space above the game: Claude's state (working / replied / needs-you), model, a context-fill bar, tokens, running subagents, current tool, cost and turn count — plus the 🔔 bell. The telemetry comes from a `statusLine` command kaboom installs **non-destructively**: it wraps and passes through your existing status line, and `npx kaboom.claude unhook` restores it exactly.
- **Switching is beginner-proof.** Everything (mouse, Alt-keys, the status-bar buttons, the green focus outline) runs on a dedicated tmux socket, so none of your own tmux config is touched.
- The game data is **[Freedoom](https://freedoom.github.io/) Phase 1** (`freedoom1.wad`) — a free, **BSD-3-Clause** IWAD with **no id Software assets**. Bundled, so there's nothing to fetch.

## Requirements

- **Node.js ≥ 16** (WebAssembly support).
- **`tmux`** for the split (Linux / macOS / WSL). Full-screen `play` mode doesn't need it. For the crisp **Sixel** picture in the split, tmux must be built with `--enable-sixel` (tmux ≥3.4) — otherwise it falls back to blocks.
- A **truecolor terminal**. For pixel-sharp text, a **Sixel-capable** one (Windows Terminal ≥1.22, WezTerm, xterm, foot, mlterm…); otherwise any terminal with a sextant-capable font works via the block fallback.

## Credits & license

- [Freedoom](https://freedoom.github.io/) — the free, BSD-licensed game data (`freedoom1.wad`). © 2001–2024 the Freedoom contributors (see `engine/FREEDOOM-CREDITS.txt`).
- [doomgeneric](https://github.com/ozkl/doomgeneric) — the portable Doom engine port (from id Software's GPL engine release).
- [pi-doom](https://github.com/badlogic/pi-doom) — the Node/WASM build this vendors.

**Code: GPL-2.0-or-later** (full text in [COPYING](COPYING)). **Game data (Freedoom): BSD-3-Clause.** See [LICENSE](LICENSE) for full attributions, the GPL corresponding-source offer, and modification notes. The bundled `engine/doom.js` + `engine/doom.wasm` are an unmodified WebAssembly build of [doomgeneric](https://github.com/ozkl/doomgeneric) (via pi-doom); complete corresponding source is at those upstream repos.

This project ships **no id Software assets**. DOOM is a trademark of id Software; Claude and Claude Code are trademarks of Anthropic. This is an independent, unofficial tool, not affiliated with or endorsed by id Software, the Freedoom project, or Anthropic.
