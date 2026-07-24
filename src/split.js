'use strict';

// `kaboom.claude split` — open Claude and real Doom side by side in a tmux split.
// Claude in the left pane, the Doom game in the right pane. Focus the Doom pane
// (Ctrl-b then →) to play while you wait on Claude; focus Claude to type.

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const GAME = path.join(__dirname, '..', 'bin', 'kaboom.claude.js');

function have(cmd) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}
function tmux(args, opts = {}) {
  return spawnSync('tmux', args, { encoding: 'utf8', ...opts });
}
function q(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
function log(m) {
  process.stdout.write(m + '\n');
}

function run() {
  if (!have('tmux')) {
    log('kaboom.claude split needs tmux (Claude + Doom side by side), and it is not installed.');
    log('');
    log('  • Debian/Ubuntu/WSL:  sudo apt install tmux');
    log('  • Fedora:             sudo dnf install tmux');
    log('  • macOS (Homebrew):   brew install tmux');
    log('');
    log('Or just play Doom full-screen:  npx kaboom.claude');
    process.exit(1);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log('kaboom.claude split needs a real terminal (run it from a normal shell, not via Claude\'s `!`).');
    process.exit(1);
  }

  const claudeOk = have('claude');
  const shell = process.env.SHELL || 'sh';
  const session = `kaboom-claude-${crypto.randomBytes(3).toString('hex')}`;
  const gameCmd = `node ${q(GAME)} play`;
  const claudeCmd = claudeOk ? 'claude' : `echo "claude not found on PATH — start it here"; ${shell}`;

  let r = tmux(['new-session', '-d', '-s', session, '-n', 'doom', shell]);
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

  // Right pane (0.1) = Doom; left pane (0.0) = Claude. Focus Claude to start.
  tmux(['send-keys', '-t', `${session}:0.1`, gameCmd, 'Enter']);
  tmux(['send-keys', '-t', `${session}:0.0`, claudeCmd, 'Enter']);
  tmux(['select-pane', '-t', `${session}:0.0`]);

  if (!claudeOk) {
    log('Note: `claude` was not found on PATH; start Claude Code in the left pane yourself.');
  }
  log('Opening Claude ⟷ DOOM split… (Ctrl-b then → to focus Doom and play; Q quits Doom)');

  const inside = !!process.env.TMUX;
  const at = inside
    ? tmux(['switch-client', '-t', session], { stdio: 'inherit' })
    : tmux(['attach-session', '-t', session], { stdio: 'inherit' });
  if (at.status !== 0 && at.error) {
    log(`Could not attach: ${at.error.message}`);
    process.exit(1);
  }
}

module.exports = { run };
