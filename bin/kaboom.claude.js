#!/usr/bin/env node
'use strict';

// kaboom.claude — the real DOOM in your terminal.
//
//   npx kaboom.claude            play DOOM (the actual doomgeneric engine)
//   npx kaboom.claude split      Claude + DOOM side by side in a tmux split
//   npx kaboom.claude --help     usage

function log(msg) {
  process.stdout.write(msg + '\n');
}

function help() {
  log(`kaboom.claude — a real terminal FPS (Freedoom on the doomgeneric engine)

  npx kaboom.claude            Play. Runs the doomgeneric engine (WebAssembly)
                             full-screen with truecolor half-block rendering,
                             playing Freedoom (free, BSD-licensed game data).
                             Controls: WASD / arrows move, F or Ctrl fire,
                             Space use, 1-7 weapons, Tab map, Esc menu, Q quit.
                             Needs a real terminal (not Claude's \`!\`).

  npx kaboom.claude split      The game and Claude side by side in a tmux split —
                             Claude left, the game right. The game plays while
                             Claude is thinking and pauses when it replies; press
                             P in the game to play/pause manually anytime.
                             Switch panes: Ctrl-b then an arrow key. (Needs tmux.)

  npx kaboom.claude unhook     Remove the pause-on-idle hooks that 'split' added
                             to ~/.claude/settings.json.

  npx kaboom.claude --help     Show this help.`);
}

async function play() {
  const { start } = require('./../src/play');
  await start();
}

function main() {
  const arg = (process.argv[2] || '').toLowerCase();
  switch (arg) {
    case '':
    case 'play':
      return play().catch((err) => {
        process.stderr.write(`kaboom.claude: ${err && err.message ? err.message : err}\n`);
        process.exit(1);
      });
    case 'split':
      return require('./../src/split').run();
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
