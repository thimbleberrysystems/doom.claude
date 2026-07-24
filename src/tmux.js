'use strict';

// tmux orchestration. Two ways in:
//
//   splitCurrent()  — the `!`-inside-Claude flow: Claude is already running in a
//                     tmux pane, so we split THAT window and drop snake beside
//                     it. No attach, no TTY needed. This is the primary flow.
//   buildSession()  — the standalone flow: run from a plain shell, we create a
//                     fresh session with Claude + Snake pre-split and attach.
//
// Both key the state file by tmux WINDOW id so Claude's hooks (same window) and
// the snake pane agree without injecting anything into Claude's environment.

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

// The window id ("@N") of a pane/target. Empty string on failure.
function windowIdOf(target) {
  const args = ['display-message', '-p'];
  if (target) args.push('-t', target);
  args.push('#{window_id}');
  const r = tmux(args);
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

// Single-quote a string for a shell command line.
function q(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function gameCommand(self, windowId) {
  return `SNAKE_CLAUDE_WINDOW=${windowId} node ${q(self)} game`;
}

// Preflight report the launcher uses to decide which flow to run.
function preflight() {
  return {
    tmux: have('tmux'),
    claude: have('claude'),
    insideTmux: !!process.env.TMUX,
  };
}

// `!`-inside-Claude flow. Split the window that `targetPane` lives in and run
// snake in the new pane. Returns { ok, message, pane, windowId }.
function splitCurrent({ self, targetPane, snakeWidth = 34 }) {
  if (!have('tmux')) return { ok: false, message: 'tmux is not installed.' };
  const windowId = windowIdOf(targetPane);
  const shell = process.env.SHELL || 'sh';

  const args = ['split-window', '-h', '-P', '-F', '#{pane_id}'];
  if (targetPane) args.push('-t', targetPane);
  args.push(shell);
  const r = tmux(args);
  if (r.status !== 0) {
    return { ok: false, message: `tmux split-window failed: ${(r.stderr || '').trim()}`, windowId };
  }

  const pane = (r.stdout || '').trim();
  if (pane) {
    tmux(['resize-pane', '-t', pane, '-x', String(snakeWidth)]);
    tmux(['send-keys', '-t', pane, gameCommand(self, windowId), 'Enter']);
    // Return focus to Claude so the user keeps typing prompts there.
    if (targetPane) tmux(['select-pane', '-t', targetPane]);
  }
  return { ok: true, message: 'Split created.', pane, windowId };
}

// Standalone flow. Create a fresh session with Claude + Snake pre-split and
// attach. Needs an interactive terminal. Returns { ok, message, session }.
function buildSession({ session, self, claudeCmd = 'claude', snakeWidth = 34 }) {
  if (!have('tmux')) return { ok: false, message: 'tmux is not installed.' };

  if (sessionExists(session)) return attach(session, { existing: true });

  const shell = process.env.SHELL || 'sh';

  let r = tmux(['new-session', '-d', '-s', session, '-n', 'claude', shell]);
  if (r.status !== 0) {
    return { ok: false, message: `tmux new-session failed: ${(r.stderr || '').trim()}` };
  }

  const windowId = windowIdOf(`${session}:0`);

  r = tmux(['split-window', '-h', '-t', `${session}:0`, shell]);
  if (r.status !== 0) {
    tmux(['kill-session', '-t', session]);
    return { ok: false, message: `tmux split-window failed: ${(r.stderr || '').trim()}` };
  }

  tmux(['resize-pane', '-t', `${session}:0.1`, '-x', String(snakeWidth)]);

  // Snake on the right, then Claude on the left. Claude's hooks derive the same
  // window id at runtime, so no env needs to reach the claude process.
  tmux(['send-keys', '-t', `${session}:0.1`, gameCommand(self, windowId), 'Enter']);
  tmux(['send-keys', '-t', `${session}:0.0`, claudeCmd, 'Enter']);
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
  windowIdOf,
  splitCurrent,
  buildSession,
  attach,
  sessionExists,
  killSession,
};
