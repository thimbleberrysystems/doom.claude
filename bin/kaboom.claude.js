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

  npx kaboom.claude            Open Claude and the game side by side. When Claude
                               starts working the game auto-starts so you can
                               play the wait; when the reply's ready it pauses and
                               hands you back to Claude. Prefer to keep playing?
                               Click "Don't interrupt" — a 🔔 note shows and you
                               switch when you like. The focused pane has a green
                               outline. Switch: click a pane, or the ◀ Claude /
                               Game ▶ / ›› Minimize / ⤢ Zoom / ✕ Close-game buttons
                               (✕ and Q close the game only; Claude stays).
                               (Requires tmux.)

  npx kaboom.claude unhook     Remove the hooks kaboom added to
                               ~/.claude/settings.json and restore your original
                               status line.

  npx kaboom.claude --help     Show this help.

Controls (in the game): WASD / arrows move · Shift run · Space or F fire ·
E use · 1-7 weapons · Tab map · Esc menu · Q quit.

Rendering: auto-detects SIXEL for pixel-sharp text (needs a Sixel terminal,
and in the split a tmux built with --enable-sixel); otherwise falls back to
Unicode blocks. KABOOM_SIXEL=0 forces blocks; KABOOM_BLOCKS=quad uses 2x2.

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
      // argv: click <range> <socket> <gamePane> <claudePane> <id>
      const [range, socket, gamePane, claudePane, kid] = process.argv.slice(3);
      const { statusRight, CLOSE_CLAUDE_BAR } = require('../src/bar');
      const { spawnSync } = require('child_process');
      const fs = require('fs'), os = require('os'), path = require('path');
      const tx = (a) => spawnSync('tmux', ['-L', socket, ...a], { stdio: 'ignore' });
      const tget = (a) => (spawnSync('tmux', ['-L', socket, ...a], { encoding: 'utf8' }).stdout || '').trim();
      const optOn = (name) => tget(['show-options', '-gqv', name]) === '1';
      // "Don't interrupt" lives in a file the game reads (robust cross-process).
      const keepFile = path.join(os.homedir(), '.claude', 'kaboom', `keep.${kid}`);
      const keepOn = () => { try { return fs.readFileSync(keepFile, 'utf8').trim() === '1'; } catch (_) { return false; } };
      // Rebuild the bar preserving both toggles (minimized + keep-playing).
      const rebuild = () => tx(['set-option', '-g', 'status-right',
        statusRight({ minimized: optOn('@kaboom_min'), keepPlaying: keepOn() })]);
      if (range === 'claude') tx(['select-pane', '-t', claudePane]);    // switch to Claude
      else if (range === 'game') tx(['select-pane', '-t', gamePane]);   // switch to the game
      else if (range === 'zoom') tx(['resize-pane', '-Z', '-t', gamePane]); // maximise (fullscreen toggle)
      else if (range === 'keepplaying') {                               // toggle "Don't interrupt"
        try { fs.mkdirSync(path.dirname(keepFile), { recursive: true }); } catch (_) {}
        try { fs.writeFileSync(keepFile, keepOn() ? '0' : '1'); } catch (_) {}
        rebuild();
      } else if (range === 'minimize') {                                // ›› shrink the game to a sliver
        // Leave fullscreen first so the width change is visible.
        if (tget(['display-message', '-p', '-t', gamePane, '#{window_zoomed_flag}']) === '1') {
          tx(['resize-pane', '-Z', '-t', gamePane]);
        }
        // Remember the current width on the pane itself, so ‹‹ restores it exactly.
        const w = parseInt(tget(['display-message', '-p', '-t', gamePane, '#{pane_width}']), 10) || 0;
        if (w > 6) tx(['set-option', '-p', '-t', gamePane, '@kaboom_lastw', String(w)]);
        // The sliver IS the restore button: label its border ‹‹, then hand focus
        // to Claude. Clicking the strip restores it (handled in src/play.js).
        tx(['select-pane', '-t', gamePane, '-T', '‹‹']);
        tx(['resize-pane', '-t', gamePane, '-x', '6']);                 // sliver — just wide enough to click
        tx(['select-pane', '-t', claudePane]);                         // hand focus to Claude
        tx(['set-option', '-g', '@kaboom_min', '1']);
        rebuild();                                                      // status button flips ›› → ‹‹
      } else if (range === 'restore') {                                 // ‹‹ bring the game back to its last size
        let w = parseInt(tget(['show-options', '-pqv', '-t', gamePane, '@kaboom_lastw']), 10);
        if (!w || w < 6) {                                              // no memory → sensible default (~62%)
          const win = parseInt(tget(['display-message', '-p', '-t', gamePane, '#{window_width}']), 10) || 100;
          w = Math.round(win * 0.62);
        }
        tx(['resize-pane', '-t', gamePane, '-x', String(w)]);
        tx(['select-pane', '-t', gamePane, '-T', 'GAME ▶']);           // back into the game, drop the ‹‹ label
        tx(['set-option', '-g', '@kaboom_min', '0']);
        rebuild();                                                      // button flips ‹‹ → ››
      } else if (range === 'quit') {                                    // close the game only…
        tx(['set-option', '-g', 'status-right', CLOSE_CLAUDE_BAR]);     // …and flip the button to "✕ Close Claude"
        tx(['kill-pane', '-t', gamePane]);
      } else if (range === 'quitclaude') {                             // …which then ends the whole split
        tx(['kill-session', '-t', claudePane]);
      }
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
