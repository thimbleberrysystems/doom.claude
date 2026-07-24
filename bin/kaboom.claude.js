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

  npx kaboom.claude            Open Claude and the game side by side. The game
                               plays while you're in its pane and waits while
                               you're in Claude; when Claude replies a 🔔 note
                               shows so you can switch at your own pace. The
                               focused pane has a green outline. Switch: click a
                               pane, or the ◀ Claude / Game ▶ / ⤢ Zoom / ✕ Quit
                               buttons in the bottom bar. (Requires tmux.)

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
    case 'click': {
      // Internal: status-bar button dispatch from `split`.
      // argv: click <range> <socket> <gamePane> <claudePane>
      const [range, socket, gamePane, claudePane] = process.argv.slice(3);
      const { spawnSync } = require('child_process');
      const tx = (a) => spawnSync('tmux', ['-L', socket, ...a], { stdio: 'ignore' });
      if (range === 'claude') tx(['select-pane', '-t', claudePane]);    // switch to Claude
      else if (range === 'game') tx(['select-pane', '-t', gamePane]);   // switch to the game
      else if (range === 'zoom') tx(['resize-pane', '-Z', '-t', gamePane]);
      else if (range === 'quit') tx(['kill-window', '-t', gamePane]);   // close the split
      process.exit(0);
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
