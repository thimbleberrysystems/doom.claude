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
  log(`kaboom.claude — real DOOM in your terminal

  npx kaboom.claude            Play DOOM. Runs the actual engine (doomgeneric,
                             compiled to WebAssembly) full-screen in your
                             terminal with truecolor half-block rendering.
                             Controls: WASD / arrows move, F or Ctrl fire,
                             Space use, 1-7 weapons, Tab map, Esc menu, Q quit.
                             Needs a real terminal (not Claude's \`!\`).

  npx kaboom.claude split      Claude and DOOM side by side in a tmux split —
                             Claude left, real Doom right. Play Doom while you
                             wait on Claude. (Requires tmux.)

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
