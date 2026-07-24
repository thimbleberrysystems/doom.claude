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
  // Give the game 62% of the width so it renders bigger / more readable.
  r = tmux(['split-window', '-h', '-l', '62%', '-t', `${session}:0`, shell]);
  if (r.status !== 0) {
    tmux(['kill-session', '-t', session]);
    log(`tmux split-window failed: ${(r.stderr || '').trim()}`);
    process.exit(1);
  }

  // Right pane (0.1) = the game; left pane (0.0) = Claude.
  tmux(['send-keys', '-t', `${session}:0.1`, gameCmd, 'Enter']);
  tmux(['send-keys', '-t', `${session}:0.0`, claudeCmd, 'Enter']);

  // Stable pane ids for the status-bar button actions.
  const gamePane = (tmux(['display-message', '-p', '-t', `${session}:0.1`, '#{pane_id}']).stdout || '').trim();
  const claudePane = (tmux(['display-message', '-p', '-t', `${session}:0.0`, '#{pane_id}']).stdout || '').trim();

  // ---- make it easy + obvious (all isolated to our socket) ----
  // Click a pane to focus it, or Alt-arrows; Alt-z zooms the focused pane.
  // focus-events lets the game know when its pane is (un)focused → it plays only
  // while focused and freezes when you switch to Claude (never forced).
  tmux(['set-option', '-g', 'mouse', 'on']);
  tmux(['set-option', '-g', 'focus-events', 'on']);
  tmux(['bind-key', '-n', 'M-Left', 'select-pane', '-L']);
  tmux(['bind-key', '-n', 'M-Right', 'select-pane', '-R']);
  tmux(['bind-key', '-n', 'M-z', 'resize-pane', '-Z']);

  // The FOCUSED pane gets a thick bright-green outline + a labelled header, so
  // it's always obvious which one has your keys.
  tmux(['set-option', '-g', 'pane-border-status', 'top']);
  tmux(['set-option', '-g', 'pane-border-lines', 'heavy']);
  tmux(['set-option', '-g', 'pane-border-format', ' #{pane_title} ']);
  tmux(['set-option', '-g', 'pane-active-border-style', 'fg=colour46,bold']);
  tmux(['set-option', '-g', 'pane-border-style', 'fg=colour238']);
  tmux(['set-option', '-g', 'automatic-rename', 'off']);
  tmux(['select-pane', '-t', `${session}:0.0`, '-T', '◀ CLAUDE']);
  tmux(['select-pane', '-t', `${session}:0.1`, '-T', 'GAME ▶']);
  tmux(['select-pane', '-t', `${session}:0.0`]);

  // Clickable buttons in the bottom status bar. Clicks are dispatched back
  // through this CLI (`click <range>`) so the logic is JS, not tmux quoting.
  const btn = (name, label, bg) => `#[fg=colour231,bg=${bg}]#[range=user|${name}] ${label} #[norange]#[default] `;
  tmux(['set-option', '-g', 'status-left', ' kaboom.claude   ']);
  tmux(['set-option', '-g', 'status-left-length', '20']);
  tmux(['set-option', '-g', 'status-right',
    btn('claude', '◀ Claude', 'colour24') + btn('game', 'Game ▶', 'colour28') +
    btn('zoom', '⤢ Zoom', 'colour238') + btn('quit', '✕ Close game', 'colour88')]);
  tmux(['set-option', '-g', 'status-right-length', '90']);
  tmux(['set-option', '-g', 'status-style', 'bg=colour235,fg=colour252']);
  tmux(['bind-key', '-n', 'MouseDown1Status', 'run-shell', '-b',
    `node ${q(GAME)} click "#{mouse_status_range}" ${SOCKET} ${gamePane} ${claudePane}`]);

  if (!claudeOk) {
    log('Note: `claude` was not found on PATH; start Claude Code in the left pane yourself.');
  }
  log('');
  log('  Claude ◀ left    ·    game ▶ right    ·    focused pane = green outline');
  log('  ───────────────────────────────────────────────────────────────────');
  log('  Click a pane to switch — or the ◀ Claude / Game ▶ buttons in the bottom bar.');
  log('  The game plays only while you\'re in it, and waits when you\'re in Claude.');
  log('  When Claude replies, a "🔔 ready" note shows in the game — switch whenever you like.');
  log('  In the game: arrows/WASD move · F fire · Q quit. Zoom fullscreen: Alt-z or ⤢ button.');
  log('');

  if (process.env.TMUX) {
    log('  (You\'re already in tmux — this opens nested; Alt-keys and mouse still work.)');
  }

  const at = tmux(['attach-session', '-t', session], { stdio: 'inherit' });
  if (at.status !== 0 && at.error) {
    log(`Could not attach: ${at.error.message}`);
    process.exit(1);
  }
}

module.exports = { run };
