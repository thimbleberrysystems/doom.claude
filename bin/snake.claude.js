#!/usr/bin/env node
'use strict';

// snake.claude launcher.
//
//   npx snake.claude                → install hooks + open the split
//   snake.claude uninstall          → remove the hooks
//   snake.claude game               → run just the game (used inside the pane)
//   snake.claude --help             → usage

const crypto = require('crypto');
const state = require('./../src/state');
const hooks = require('./../src/hooks');
const tmux = require('./../src/tmux');

// A short, shell-safe id unique to this launch. It names the tmux session, the
// SNAKE_CLAUDE_ID env var (seen by both panes and Claude's hooks), and the
// per-session state file — tying one Claude to one Snake with no cross-talk.
function newSessionId() {
  return crypto.randomBytes(4).toString('hex');
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

function help() {
  log(`snake.claude — play Snake beside Claude Code

  The snake runs while Claude is thinking and pauses (keeping your score)
  when Claude finishes. Requires tmux (Linux / macOS / WSL).

Best experience — run Claude inside tmux, then launch from within Claude:
    tmux            # start tmux
    claude          # start Claude Code in it
    !npx snake.claude   # <- type this inside Claude; snake opens beside it

Usage:
  snake.claude              From inside Claude (in tmux): split the current
  snake.claude install      window and open Snake beside Claude. From a plain
                            shell: launch a fresh Claude + Snake split.
  snake.claude uninstall    Remove the hooks from ~/.claude/settings.json.
  snake.claude game         Run only the game (what the launcher puts in
                            the snake pane).
  snake.claude --help       Show this help.

Controls:  arrows / WASD to steer · q quit · r restart`);
}

function installInstructions() {
  return (
    `Install tmux, then re-run:\n` +
    `  • Debian/Ubuntu/WSL:  sudo apt install tmux\n` +
    `  • Fedora:             sudo dnf install tmux\n` +
    `  • macOS (Homebrew):   brew install tmux`
  );
}

function installHooks() {
  // Install the hooks that flip play/pause. Report but don't abort on a soft
  // failure — the game is still playable, just not auto-controlled.
  const res = hooks.install();
  log(res.message);
  if (!res.ok) {
    log('Continuing without auto pause/resume. You can fix settings.json and re-run.');
  }
}

function launch() {
  const pre = tmux.preflight();
  const self = process.argv[1];

  if (!pre.tmux) {
    log('snake.claude needs tmux for the side-by-side split, and it is not installed.');
    log('');
    log(installInstructions());
    process.exit(1);
  }

  state.ensureDir();
  state.pruneStale();

  // FLOW 1 — invoked from inside Claude (Claude is running in a tmux pane, e.g.
  // via `!npx snake.claude`). Split THIS window; snake lands beside Claude. No
  // attach, no TTY needed.
  if (pre.insideTmux) {
    installHooks();
    const windowId = tmux.windowIdOf(process.env.TMUX_PANE);
    if (windowId) state.write(windowId, state.PAUSE); // start paused until first prompt
    const r = tmux.splitCurrent({ self, targetPane: process.env.TMUX_PANE });
    if (!r.ok) {
      log(`Could not open the snake pane: ${r.message}`);
      process.exit(1);
    }
    log('');
    log('🐍 Snake is now in the pane beside Claude.');
    log('   Submit a prompt to start playing; it pauses when Claude finishes.');
    log('   Focus the snake pane (Ctrl-b then →) to steer with the arrow keys.');
    return;
  }

  // FLOW 2 — invoked from a plain shell (not inside tmux). We need our own
  // interactive terminal to host a fresh Claude + Snake session.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // Almost certainly run via `!` while Claude is NOT inside tmux. Explain the
    // one-time setup that unlocks the in-session `!` flow.
    log('To play snake next to your CURRENT Claude session, Claude must be');
    log('running inside tmux. One-time setup:');
    log('');
    log('  1) exit Claude');
    log('  2) start tmux:     tmux');
    log('  3) start Claude:   claude');
    log('  4) inside Claude:  !npx snake.claude');
    log('');
    log('Or, from a normal terminal, run `npx snake.claude` to launch a fresh');
    log('Claude + Snake split for you.');
    process.exit(1);
  }

  if (!pre.claude) {
    log('Warning: `claude` was not found on PATH; the left pane will open a shell.');
    log('         Start Claude Code there, or install it, then re-run.');
    log('');
  }

  installHooks();
  log('');
  log('Opening tmux split (Claude ⟷ Snake)…');
  const session = `snake-claude-${newSessionId()}`;
  const built = tmux.buildSession({ session, self });
  if (!built.ok) {
    log(`Could not open the tmux split: ${built.message}`);
    process.exit(1);
  }
}

function main() {
  const arg = (process.argv[2] || '').toLowerCase();

  switch (arg) {
    case '':
    case 'install':
    case 'launch':
    case 'start':
      return launch();
    case 'game':
      // Run the game in-process (this is what the tmux right pane executes).
      require('./../src/game.js');
      return;
    case 'uninstall':
    case 'remove': {
      const res = hooks.uninstall();
      log(res.message);
      process.exit(res.ok ? 0 : 1);
      return;
    }
    case '-h':
    case '--help':
    case 'help':
      return help();
    default:
      log(`Unknown command: ${arg}\n`);
      help();
      process.exit(1);
  }
}

main();
