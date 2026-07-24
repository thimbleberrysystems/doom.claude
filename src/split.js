'use strict';

// `kaboom.claude split` — open Claude and the game side by side in a tmux split.
// Claude in the left pane, the game in the right pane.
//
// Switching is made beginner-friendly: it runs on a DEDICATED tmux socket (so
// none of the user's own tmux config is touched), with mouse enabled (click a
// pane to focus it) and Alt+Left/Right bound to switch panes with no prefix.
// The classic Ctrl-b arrows still work too.

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const GAME = path.join(__dirname, '..', 'bin', 'kaboom.claude.js');
const SOCKET = 'kaboomclaude'; // isolated tmux server — our settings, not the user's

function have(cmd) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}
// All tmux calls go to our private socket so mouse/keybindings/status don't
// leak into the user's normal tmux sessions.
function tmux(args, opts = {}) {
  return spawnSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8', ...opts });
}
function q(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
function log(m) {
  process.stdout.write(m + '\n');
}

function run() {
  if (!have('tmux')) {
    log('kaboom.claude split needs tmux (Claude + the game side by side), and it is not installed.');
    log('');
    log('  • Debian/Ubuntu/WSL:  sudo apt install tmux');
    log('  • Fedora:             sudo dnf install tmux');
    log('  • macOS (Homebrew):   brew install tmux');
    log('');
    log('Without tmux you can still play the game full-screen:  npx kaboom.claude play');
    process.exit(1);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log('kaboom.claude split needs a real terminal (run it from a normal shell, not via Claude\'s `!`).');
    process.exit(1);
  }

  const claudeOk = have('claude');
  const shell = process.env.SHELL || 'sh';
  const id = crypto.randomBytes(3).toString('hex');
  const session = `kaboom-${id}`;

  // Install the pause-on-idle hooks so the game plays while Claude is thinking
  // and pauses when it replies. Both panes carry KABOOM_ID so the hooks (run by
  // the claude in the left pane) and the game (right pane) share one signal file.
  const hk = require('./hooks').install();
  log(hk.message);

  const gameCmd = `KABOOM_ID=${id} node ${q(GAME)} play`;
  const claudeCmd = claudeOk
    ? `KABOOM_ID=${id} claude`
    : `echo "claude not found on PATH — start it here"; KABOOM_ID=${id} ${shell}`;

  let r = tmux(['new-session', '-d', '-s', session, '-n', 'kaboom', shell]);
  if (r.status !== 0) {
    log(`tmux new-session failed: ${(r.stderr || '').trim()}`);
    process.exit(1);
  }
  r = tmux(['split-window', '-h', '-t', `${session}:0`, shell]);
  if (r.status !== 0) {
    tmux(['kill-session', '-t', session]);
    log(`tmux split-window failed: ${(r.stderr || '').trim()}`);
    process.exit(1);
  }

  // Right pane (0.1) = the game; left pane (0.0) = Claude. Focus Claude to start.
  tmux(['send-keys', '-t', `${session}:0.1`, gameCmd, 'Enter']);
  tmux(['send-keys', '-t', `${session}:0.0`, claudeCmd, 'Enter']);
  tmux(['select-pane', '-t', `${session}:0.0`]);

  // ---- make switching intuitive (all isolated to our socket) ----
  tmux(['set-option', '-g', 'mouse', 'on']);                 // click a pane to focus it
  tmux(['bind-key', '-n', 'M-Left', 'select-pane', '-L']);   // Alt+Left  → Claude
  tmux(['bind-key', '-n', 'M-Right', 'select-pane', '-R']);  // Alt+Right → game
  tmux(['set-option', '-g', 'status-right', ' click a pane · or Alt-←/→ · game: P play/pause · Q quit ']);
  tmux(['set-option', '-g', 'status-right-length', '70']);

  if (!claudeOk) {
    log('Note: `claude` was not found on PATH; start Claude Code in the left pane yourself.');
  }
  log('Opening Claude ⟷ game split…');
  log('  • Switch panes: CLICK a pane, or press Alt-←/Alt-→ (no prefix needed).');
  log('  • In the game: arrow keys / WASD move · F fire · P play/pause · Q quit.');
  log('  • The game plays while Claude is thinking, and pauses when it replies.');

  if (process.env.TMUX) {
    log('  • (You\'re already in tmux — this opens as a nested session; Alt-←/→ and');
    log('     mouse still work. Detach the inner one with Ctrl-b d.)');
  }

  const at = tmux(['attach-session', '-t', session], { stdio: 'inherit' });
  if (at.status !== 0 && at.error) {
    log(`Could not attach: ${at.error.message}`);
    process.exit(1);
  }
}

module.exports = { run };
