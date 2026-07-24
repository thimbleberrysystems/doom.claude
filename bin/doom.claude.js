#!/usr/bin/env node
'use strict';

// doom.claude — the real DOOM in your terminal, plus an optional DOOM-themed
// Claude Code status-line HUD.
//
//   npx doom.claude            play DOOM (the actual doomgeneric engine)
//   npx doom.claude hud        install the DOOM status-line HUD in Claude Code
//   npx doom.claude hud off    remove the HUD
//   npx doom.claude hud probe  diagnostic status line (height / JSON fields)
//   npx doom.claude --help     usage

function log(msg) {
  process.stdout.write(msg + '\n');
}

function help() {
  log(`doom.claude — real DOOM in your terminal

  npx doom.claude            Play DOOM. Runs the actual engine (doomgeneric,
                             compiled to WebAssembly) full-screen in your
                             terminal with truecolor half-block rendering.
                             Controls: WASD / arrows move, F or Ctrl fire,
                             Space use, 1-7 weapons, Tab map, Esc menu, Q quit.
                             Needs a real terminal (not Claude's \`!\`).

  npx doom.claude hud        Install the DOOM-themed Claude Code status-line
                             HUD (HEALTH = context, AMMO = tokens, reactive
                             DOOMGUY face). Auto-plays in the status bar.
  npx doom.claude hud off    Remove the HUD.
  npx doom.claude hud probe  Diagnostic status line (height cap / JSON fields).

  npx doom.claude --help     Show this help.`);
}

async function play() {
  const { start } = require('./../src/play');
  await start();
}

function hud(sub) {
  const install = require('./../src/install');
  const a = (sub || '').toLowerCase();
  if (a === 'off' || a === 'uninstall' || a === 'remove') {
    const res = install.uninstall();
    log(res.message);
    process.exit(res.ok ? 0 : 1);
  }
  if (a === 'probe') {
    const res = install.install('probe');
    log(res.message);
    if (res.ok) log('\n▸ Count the numbered rows you can see = your height cap. Then `npx doom.claude hud` to switch back.');
    process.exit(res.ok ? 0 : 1);
  }
  const res = install.install('statusline');
  log(res.message);
  if (res.ok) {
    log('');
    log('▸ The HUD should appear at the bottom of Claude Code.');
    log('  If not, reload settings: run  /statusline  (or restart Claude Code).');
  }
  process.exit(res.ok ? 0 : 1);
}

function main() {
  const arg = (process.argv[2] || '').toLowerCase();
  switch (arg) {
    case '':
    case 'play':
      return play().catch((err) => {
        process.stderr.write(`doom.claude: ${err && err.message ? err.message : err}\n`);
        process.exit(1);
      });
    case 'hud':
    case 'install':
    case 'on':
      return hud(arg === 'hud' ? process.argv[3] : '');
    case 'off':
    case 'uninstall':
      return hud('off');
    case 'probe':
      return hud('probe');
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
