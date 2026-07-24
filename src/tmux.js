'use strict';

// tmux orchestration: build a two-pane session — Claude on the left, Snake on
// the right — and drop the user into it. We create a dedicated session so one
// Claude is paired with exactly one Snake, and so the layout is guaranteed
// regardless of what the user's terminal was doing before.

const { spawnSync } = require('child_process');
const path = require('path');

const SESSION = 'snake-claude';

function have(cmd) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
  return r.status === 0;
}

function tmux(args, opts = {}) {
  return spawnSync('tmux', args, { encoding: 'utf8', ...opts });
}

function sessionExists(name) {
  return tmux(['has-session', '-t', name], { stdio: 'ignore' }).status === 0;
}

// Preflight report the launcher uses to decide whether to proceed.
function preflight() {
  return {
    tmux: have('tmux'),
    claude: have('claude'),
    insideTmux: !!process.env.TMUX,
  };
}

// Build (or reuse) the split session. gameCmd is the shell command that runs the
// game in the right pane. Returns { ok, message, session }.
function buildSession({ gameCmd, snakeWidth = 34 }) {
  if (!have('tmux')) {
    return { ok: false, message: 'tmux is not installed.' };
  }

  // If our session already exists (a previous launch), just re-attach to it
  // rather than stacking a second one.
  if (sessionExists(SESSION)) {
    return attach(SESSION, { existing: true });
  }

  // Left pane: a login-ish shell running claude. We run it through the user's
  // shell so PATH/nvm/etc. resolve exactly as in a normal terminal.
  const shell = process.env.SHELL || 'sh';

  let r = tmux(['new-session', '-d', '-s', SESSION, '-n', 'claude', shell]);
  if (r.status !== 0) {
    return { ok: false, message: `tmux new-session failed: ${(r.stderr || '').trim()}` };
  }

  // Right pane for the snake.
  r = tmux(['split-window', '-h', '-t', `${SESSION}:0`, shell]);
  if (r.status !== 0) {
    tmux(['kill-session', '-t', SESSION]);
    return { ok: false, message: `tmux split-window failed: ${(r.stderr || '').trim()}` };
  }

  // Give the snake a fixed, comfortable width; Claude keeps the rest.
  tmux(['resize-pane', '-t', `${SESSION}:0.1`, '-x', String(snakeWidth)]);

  // Kick off the game on the right, then Claude on the left.
  tmux(['send-keys', '-t', `${SESSION}:0.1`, gameCmd, 'Enter']);
  tmux(['send-keys', '-t', `${SESSION}:0.0`, 'claude', 'Enter']);

  // Focus Claude so the user starts typing prompts immediately.
  tmux(['select-pane', '-t', `${SESSION}:0.0`]);

  return attach(SESSION, { existing: false });
}

// Attach interactively. If we are already inside tmux, nesting an attach errors,
// so switch the client instead.
function attach(session, meta = {}) {
  const inside = !!process.env.TMUX;
  const r = inside
    ? tmux(['switch-client', '-t', session], { stdio: 'inherit' })
    : tmux(['attach-session', '-t', session], { stdio: 'inherit' });
  if (r.status !== 0 && r.error) {
    return { ok: false, message: `tmux attach failed: ${r.error.message}`, session };
  }
  return { ok: true, message: meta.existing ? 'Re-attached to existing session.' : 'Attached.', session };
}

function killSession() {
  if (sessionExists(SESSION)) tmux(['kill-session', '-t', SESSION]);
}

module.exports = {
  SESSION,
  have,
  preflight,
  buildSession,
  attach,
  sessionExists,
  killSession,
};
