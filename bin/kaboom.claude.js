#!/usr/bin/env node
'use strict';

// kaboom.claude — play real Freedoom right next to Claude Code.
//
//   npx kaboom.claude            Claude + the game side by side (tmux split)
//   npx kaboom.claude play       just the game, full-screen (no Claude; no tmux)
//   npx kaboom.claude unhook     remove the pause hooks
//   npx kaboom.claude --help     usage

function log(msg) {
  process.stdout.write(msg + '\n');
}

function help() {
  log(`kaboom.claude — real Freedoom next to Claude Code

  npx kaboom.claude            Open Claude and the game side by side in a tmux
                               split. The game plays while Claude is thinking
                               and pauses when it replies; press P in the game
                               to play/pause anytime. Switch panes: click one,
                               or Alt-←/→. (Requires tmux.)

  npx kaboom.claude unhook     Remove the pause-on-idle hooks kaboom added to
                               ~/.claude/settings.json.

  npx kaboom.claude --help     Show this help.

Controls (in the game): WASD / arrows move · F or Ctrl fire · Space use ·
1-7 weapons · Tab map · Esc menu · P play/pause · Q quit.

No tmux?  npx kaboom.claude play   runs the game full-screen on its own.`);
}

async function play() {
  const { start } = require('./../src/play');
  await start();
}

function main() {
  const arg = (process.argv[2] || '').toLowerCase();
  switch (arg) {
    case '':
    case 'split':
      return require('./../src/split').run();
    case 'play': // the game itself — what `split` runs in the game pane, and a no-tmux fallback
      return play().catch((err) => {
        process.stderr.write(`kaboom.claude: ${err && err.message ? err.message : err}\n`);
        process.exit(1);
      });
    case 'unhook': {
      const res = require('./../src/hooks').uninstall();
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
