# snake-claude 🐍

Play **Snake** right next to Claude Code. The snake runs **while Claude is thinking**, and **pauses — keeping your score** — the moment Claude finishes and hands the keyboard back to you. A little something to do with those idle seconds.

```
┌──────────────┬─────────────┐
│ Claude Code  │   SNAKE     │
│ > working... │  ■■■◆   ●   │
│              │  score 42   │
└──────────────┴─────────────┘
```

## Quick start

One command — no clone, no install:

```sh
npx github:thimbleberrysystems/snake.claude
```

That's it. The launcher:

1. Installs two tiny **hooks** into `~/.claude/settings.json` (backed up first).
2. Opens a **tmux split** — Claude Code on the left, Snake on the right.
3. Drops you in the Claude pane, ready to type.

Submit a prompt → the snake starts moving. When Claude finishes → it freezes with a *"your move"* overlay, score intact. Next prompt picks up right where you left off.

## Controls

| Key | Action |
| --- | --- |
| Arrow keys / `WASD` | Steer |
| `q` | Quit the game |
| `r` | Restart (after game over) |

## How it works

- **Signal file** — `~/.claude/snake/state` holds a single word, `play` or `pause`.
- **Hooks** — Claude Code's `UserPromptSubmit` hook writes `play`; the `Stop` hook writes `pause`. Fast shell one-liners, no processes spawned.
- **Game** — polls that file each tick. Zero dependencies: raw ANSI + Node's TTY. It always restores your terminal cleanly, even on a crash.

The hooks carry a `# snake-claude` marker, so installing is idempotent and uninstalling is surgical.

## Uninstall

Removes only the snake-claude hooks; your other settings are untouched:

```sh
npx github:thimbleberrysystems/snake.claude uninstall
```

## Requirements

- **tmux** (Linux, macOS, or WSL) — provides the side-by-side split.
- **Node.js ≥ 16**.
- **Claude Code** on your `PATH` (the left pane runs `claude`).

> Native Windows (bare cmd/PowerShell) isn't supported — use **WSL**, where tmux runs fine.

## Known limitation

There is one global signal file, so it assumes a single active Claude + Snake pair. Running two Claude Code sessions at once would share the same play/pause signal. Per-session scoping is planned.

## License

MIT
