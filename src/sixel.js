'use strict';

// Sixel encoder for the Doom framebuffer.
//
// Why this beats the Unicode-block renderer: Sixel draws REAL pixels, so small
// text (menus, scores) is sharp instead of being crushed into 2x3 sub-pixel
// glyphs. It only works where the terminal (and, in a split, tmux) supports
// Sixel — see detectSixel() in play.js; otherwise we fall back to blocks.
//
// Doom only ever uses <=256 distinct colours per frame (its palette), and
// nearest-neighbour scaling never invents new ones, so we can build the EXACT
// palette per frame and feed pre-indexed pixels to sixelEncodeIndexed — no lossy
// quantization and no per-pixel colour search.

const S = require('sixel');
const { introducer, FINALIZER, toRGBA8888 } = S;
// sixelEncodeIndexed isn't on the package's top-level export in 0.16, reach it
// from the submodule (fall back to the top level in case a later version adds it).
const sixelEncodeIndexed = S.sixelEncodeIndexed || require('sixel/lib/SixelEncoder').sixelEncodeIndexed;

// Reused across frames to avoid per-frame allocation.
let idxBuf = null;
let idxCap = 0;

// Encode a BGRA frame (sw x sh) as a Sixel DCS string, nearest-neighbour scaled
// to outW x outH. Returns introducer + body + ST, ready to write at the cursor.
function frameToSixel(bgra, sw, sh, outW, outH) {
  const n = outW * outH;
  if (!idxBuf || idxCap < n) { idxBuf = new Uint16Array(n); idxCap = n; }
  const indices = idxBuf;

  const map = new Map();   // packed 0xRRGGBB -> palette index
  const palette = [];      // RGBA8888[]
  let di = 0;
  for (let y = 0; y < outH; y++) {
    const sy = ((y * sh / outH) | 0) * sw;
    for (let x = 0; x < outW; x++) {
      const sx = (x * sw / outW) | 0;
      const p = (sy + sx) << 2;        // *4 — BGRA byte order
      const b = bgra[p], g = bgra[p + 1], r = bgra[p + 2];
      const key = (r << 16) | (g << 8) | b;
      let pi = map.get(key);
      if (pi === undefined) {
        if (palette.length < 256) {
          pi = palette.length;
          palette.push(toRGBA8888(r, g, b, 255));
          map.set(key, pi);
        } else {
          pi = 255;                    // overflow guard (Doom never exceeds 256)
        }
      }
      indices[di++] = pi;
    }
  }
  const body = sixelEncodeIndexed(indices.subarray(0, n), outW, outH, palette);
  return introducer(1) + body + FINALIZER;
}

module.exports = { frameToSixel };
