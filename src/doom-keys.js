'use strict';

// DOOM key codes (from doomkeys.h) + a terminal-input → DOOM-key mapper.
// Raw-sequence parsing (no external deps).

const K = {
  RIGHT: 0xae,
  LEFT: 0xac,
  UP: 0xad,
  DOWN: 0xaf,
  STRAFE_L: 0xa0,
  STRAFE_R: 0xa1,
  USE: 0xa2,
  FIRE: 0xa3,
  ESCAPE: 27,
  ENTER: 13,
  TAB: 9,
  BACKSPACE: 127,
  RSHIFT: 0x80 + 0x36,
  EQUALS: 0x3d,
  MINUS: 0x2d,
};

// Map a chunk of terminal input to DOOM key codes. Returns an array (a key may
// map to two codes, e.g. run = arrow + shift).
function mapKeyToDoom(data) {
  // Arrow-key escape sequences.
  if (data === '\x1b[A' || data === '\x1bOA') return [K.UP];
  if (data === '\x1b[B' || data === '\x1bOB') return [K.DOWN];
  if (data === '\x1b[C' || data === '\x1bOC') return [K.RIGHT];
  if (data === '\x1b[D' || data === '\x1bOD') return [K.LEFT];

  // Lone ESC → menu.
  if (data === '\x1b') return [K.ESCAPE];

  switch (data) {
    case 'w': return [K.UP];
    case 'W': return [K.UP, K.RSHIFT];
    case 's': return [K.DOWN];
    case 'S': return [K.DOWN, K.RSHIFT];
    case 'a': return [K.STRAFE_L];
    case 'A': return [K.STRAFE_L, K.RSHIFT];
    case 'd': return [K.STRAFE_R];
    case 'D': return [K.STRAFE_R, K.RSHIFT];
    case 'f': case 'F': return [K.FIRE];
    case ' ': return [K.USE];
    case '\r': case '\n': return [K.ENTER];
    case '\t': return [K.TAB];
    case '\x7f': case '\b': return [K.BACKSPACE];
    case '+': case '=': return [K.EQUALS];
    case '-': return [K.MINUS];
  }

  // Weapon selection 1-7 (and 0-9 generally).
  if (data >= '0' && data <= '9') return [data.charCodeAt(0)];

  // Any other single control char (Ctrl+<x>, not Ctrl+C) → fire.
  if (data.length === 1 && data.charCodeAt(0) < 32 && data !== '\x03') return [K.FIRE];

  // Other printable single chars (menu / cheats) pass through lowercased.
  if (data.length === 1 && data.charCodeAt(0) >= 32) return [data.toLowerCase().charCodeAt(0)];

  return [];
}

module.exports = { DoomKeys: K, mapKeyToDoom };
