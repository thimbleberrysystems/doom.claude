'use strict';

// tmux orchestration: build a two-pane session — Claude on the left, Snake on
// the right — and drop the user into it. We create a dedicated session so one
// Claude is paired with exactly one Snake, and so the layout is guaranteed
// regardless of what the user's terminal was doing before.

const { spawnSync } = require('child_process');

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

// Build the split session. `session` is a unique name for this launch, `gameCmd`
// runs the game (right pane) and `claudeCmd` runs Claude (left pane) — both
// carry the SNAKE_CLAUDE_ID. Returns { ok, message, session }.
function buildSession({ session, gameCmd, claudeCmd, snakeWidth = 34 }) {
  if (!have('tmux')) {
    return { ok: false, message: 'tmux is not installed.' };
  }

  // Unique session per launch, so multiple splits can coexist. If somehow the
  // name is taken (same id twice), just re-attach rather than stacking.
  if (sessionExists(session)) {
    return attach(session, { existing: true });
  }

  // Panes run through the user's shell so PATH/nvm/etc. resolve exactly as in a
  // normal terminal.
  const shell = process.env.SHELL || 'sh';

  let r = tmux(['new-session', '-d', '-s', session, '-n', 'claude', shell]);
  if (r.status !== 0) {
    return { ok: false, message: `tmux new-session failed: ${(r.stderr || '').trim()}` };
  }

  // Right pane for the snake.
  r = tmux(['split-window', '-h', '-t', `${session}:0`, shell]);
  if (r.status !== 0) {
    tmux(['kill-session', '-t', session]);
    return { ok: false, message: `tmux split-window failed: ${(r.stderr || '').trim()}` };
  }

  // Give the snake a fixed, comfortable width; Claude keeps the rest.
  tmux(['resize-pane', '-t', `${session}:0.1`, '-x', String(snakeWidth)]);

  // Kick off the game on the right, then Claude on the left.
  tmux(['send-keys', '-t', `${session}:0.1`, gameCmd, 'Enter']);
  tmux(['send-keys', '-t', `${session}:0.0`, claudeCmd, 'Enter']);

  // Focus Claude so the user starts typing prompts immediately.
  tmux(['select-pane', '-t', `${session}:0.0`]);

  return attach(session, { existing: false });
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

function killSession(session) {
  if (sessionExists(session)) tmux(['kill-session', '-t', session]);
}

module.exports = {
  have,
  preflight,
  buildSession,
  attach,
  sessionExists,
  killSession,
};
