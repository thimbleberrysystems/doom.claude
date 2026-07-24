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

Usage:
  snake.claude              Install the play/pause hooks and open the
  snake.claude install      tmux split (Claude left, Snake right).
  snake.claude uninstall    Remove the hooks from ~/.claude/settings.json.
  snake.claude game         Run only the game (what the launcher puts in
                            the right pane).
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

function launch() {
  // We must be able to take over an interactive terminal to attach the split.
  // Running inside Claude Code via `!`, over a pipe, or in any non-interactive
  // shell has no TTY — bail early with guidance instead of a cryptic tmux error
  // (and without creating an orphaned detached session).
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log('snake.claude needs a real, interactive terminal to open the split.');
    log('');
    log('This was run without one — most likely from inside Claude Code (the `!`');
    log('prefix), or a non-interactive shell. Open a normal terminal window');
    log('(a fresh bash / zsh / WSL shell) and run it there:');
    log('');
    log('    npx snake.claude');
    log('');
    process.exit(1);
  }

  const pre = tmux.preflight();

  if (!pre.tmux) {
    log('snake.claude needs tmux for the side-by-side split, and it is not installed.');
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

  // Unique id for this launch, shared by both panes and the hooks.
  const id = newSessionId();
  // tmux treats "." and ":" as target separators, so the session name must
  // avoid them (users never see this name — it's internal plumbing).
  const session = `snake-claude-${id}`;

  // Prepare the per-session signal file (starts paused — Claude is idle at
  // launch) and sweep away any files left by earlier crashed sessions.
  state.ensureDir();
  state.pruneStale();
  state.write(id, state.PAUSE);

  // Install the hooks that flip play/pause. Report but do not abort the launch
  // on a soft failure — the game is still playable, just not auto-controlled.
  const res = hooks.install();
  log(res.message);
  if (!res.ok) {
    log('Continuing without auto pause/resume. You can fix settings.json and re-run.');
  }
  log('');

  // Both panes carry SNAKE_CLAUDE_ID so Claude's hooks (child processes of the
  // claude in the left pane) write to THIS session's state file, and the game
  // in the right pane watches that same file.
  const self = process.argv[1];
  const gameCmd = `SNAKE_CLAUDE_ID=${id} node ${shellQuote(self)} game`;
  const claudeCmd = `SNAKE_CLAUDE_ID=${id} claude`;

  log('Opening tmux split (Claude ⟷ Snake)…');
  const built = tmux.buildSession({ session, gameCmd, claudeCmd });
  if (!built.ok) {
    log(`Could not open the tmux split: ${built.message}`);
    state.remove(id);
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
