#!/usr/bin/env node
'use strict';

// snake-claude launcher.
//
//   npx github:<user>/snake-claude            → install hooks + open the split
//   snake-claude uninstall                     → remove the hooks
//   snake-claude game                          → run just the game (used inside the pane)
//   snake-claude --help                        → usage

const path = require('path');
const state = require('./../src/state');
const hooks = require('./../src/hooks');
const tmux = require('./../src/tmux');

const GAME_PATH = path.join(__dirname, '..', 'src', 'game.js');

function log(msg) {
  process.stdout.write(msg + '\n');
}

function help() {
  log(`snake-claude — play Snake beside Claude Code

  The snake runs while Claude is thinking and pauses (keeping your score)
  when Claude finishes. Requires tmux (Linux / macOS / WSL).

Usage:
  snake-claude              Install the play/pause hooks and open the
                            tmux split (Claude left, Snake right).
  snake-claude uninstall    Remove the hooks from ~/.claude/settings.json.
  snake-claude game         Run only the game (what the launcher puts in
                            the right pane).
  snake-claude --help       Show this help.

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

function launch() {
  const pre = tmux.preflight();

  if (!pre.tmux) {
    log('snake-claude needs tmux for the side-by-side split, and it is not installed.');
    log('');
    log(installInstructions());
    process.exit(1);
  }
  if (!pre.claude) {
    // Not fatal — the left pane will still open a shell where the user can start
    // Claude manually — but warn so it is not a surprise.
    log('Warning: `claude` was not found on PATH; the left pane will open a shell.');
    log('         Start Claude Code there, or install it, then re-run.');
    log('');
  }

  // Make sure the signal file exists and starts paused (Claude is idle at launch).
  state.ensureDir();
  state.write(state.PAUSE);

  // Install the hooks that flip play/pause. Report but do not abort the launch
  // on a soft failure — the game is still playable, just not auto-controlled.
  const res = hooks.install();
  log(res.message);
  if (!res.ok) {
    log('Continuing without auto pause/resume. You can fix settings.json and re-run.');
  }
  log('');

  // Command the right pane runs. Prefer this same CLI so paths resolve via the
  // package; fall back to invoking the game file directly.
  const self = process.argv[1];
  const gameCmd = `node ${shellQuote(self)} game`;

  log('Opening tmux split (Claude ⟷ Snake)…');
  const built = tmux.buildSession({ gameCmd });
  if (!built.ok) {
    log(`Could not open the tmux split: ${built.message}`);
    process.exit(1);
  }
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function main() {
  const arg = (process.argv[2] || '').toLowerCase();

  switch (arg) {
    case '':
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
