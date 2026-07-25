'use strict';

// The tmux status-right bar, built in one place so `split` (initial render) and
// the `click` dispatch (when a toggle flips) always agree.
//
// Buttons dispatch back through `kaboom.claude click <range>`.
//  • minimize/restore — one toggle: ›› shrinks the game to a sliver, ‹‹ (and the
//    sliver itself) brings it back to its last size.
//  • keepplaying — "Don't interrupt": OFF (default) means when Claude replies the
//    game pauses and focus returns to Claude; ON keeps you in the game (a 🔔 note
//    shows instead) so your run isn't interrupted.

const btn = (name, label, bg) =>
  `#[fg=colour231,bg=${bg}]#[range=user|${name}] ${label} #[norange]#[default] `;

const HINT = `#[fg=colour246]Space to shoot · E to use#[default]   `;

// Normal split bar. opts: { minimized, keepPlaying }.
function statusRight(opts) {
  opts = opts || {};
  const toggle = opts.minimized
    ? btn('restore', '‹‹ Restore', 'colour238')    // game is a sliver → click to bring it back
    : btn('minimize', '›› Minimize', 'colour238'); // game is open → click to minimize it
  const keep = opts.keepPlaying
    ? btn('keepplaying', '✓ Don’t interrupt', 'colour28')  // active → won't switch back
    : btn('keepplaying', 'Don’t interrupt', 'colour238');  // off (default) → returns to Claude
  return HINT +
    btn('claude', '◀ Claude', 'colour24') + btn('game', 'Game ▶', 'colour28') +
    keep + toggle + btn('zoom', '⤢ Zoom', 'colour238') +
    btn('quit', '✕ Close game', 'colour88');
}

// Shown after the game pane is closed — the toggle now ends the whole session.
const CLOSE_CLAUDE_BAR =
  ' #[fg=colour231,bg=colour88]#[range=user|quitclaude] ✕ Close Claude — end session #[norange]#[default]';

module.exports = { statusRight, CLOSE_CLAUDE_BAR, btn };
