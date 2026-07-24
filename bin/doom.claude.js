#!/usr/bin/env node
'use strict';

// doom.claude — a Claude Code status-line arcade.
//
//   npx doom.claude              install the status line (Pong + live HUD)
//   npx doom.claude uninstall    remove it
//   npx doom.claude --help       usage
//
// The installer is fully non-interactive, so it also works via Claude's `!`
// prefix:  !npx doom.claude

const install = require('./../src/install');

function log(msg) {
  process.stdout.write(msg + '\n');
}

function help() {
  log(`doom.claude — a Pong + live-telemetry arcade in your Claude Code status line

The status line shows, at the bottom of Claude, two rows that update ~1×/sec:

    Opus 4.8 · ● thinking · ctx 42% · 4s · 2 agents      (live HUD)
    ❚        ●                     ❚  3:2                 (auto-play Pong)

Usage:
  npx doom.claude              Install it (also works as !npx doom.claude
                                inside Claude). Edits ~/.claude/settings.json
                                (backed up first).
  npx doom.claude off          Turn it off (remove the status line + hooks).
  npx doom.claude on           Turn it back on. ('uninstall'/'install' also work.)
  npx doom.claude probe        Temporarily show a diagnostic status line
                                (numbered rows + JSON fields) so you can see
                                your height cap. Run 'install' to switch back.
  npx doom.claude --help       Show this help.

Notes:
  • Auto-play only — the status line can't read the keyboard, so the game
    plays itself; the HUD reflects what Claude is doing.
  • Requires Node.js. No tmux, no extra window.`);
}

function activationNote() {
  log('');
  log('▸ The status line should appear at the bottom of Claude Code.');
  log('  If it doesn\'t show immediately, reload settings: run  /statusline');
  log('  (or restart Claude Code). The Pong rally + HUD update about once a second.');
}

function main() {
  const arg = (process.argv[2] || '').toLowerCase();

  switch (arg) {
    case 'on':
    case '':
    case 'install': {
      const res = install.install('statusline');
      log(res.message);
      if (res.ok) activationNote();
      process.exit(res.ok ? 0 : 1);
      return;
    }
    case 'probe': {
      const res = install.install('probe');
      log(res.message);
      if (res.ok) {
        log('');
        log('▸ Count the numbered rows you can see in the status line = your height cap.');
        log('  Then run  npx doom.claude install  to switch to the game.');
      }
      process.exit(res.ok ? 0 : 1);
      return;
    }
    case 'off':
    case 'uninstall':
    case 'remove': {
      const res = install.uninstall();
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
