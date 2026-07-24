'use strict';

// Thin wrapper around the doomgeneric WebAssembly build (vendored in engine/).
// Ported to CommonJS from pi-doom's doom-engine.ts (GPL-2.0). Loads the real
// Doom engine under plain Node — no native deps — feeds the (Freedoom) WAD,
// steps frames, and exposes the framebuffer + key input.

const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const BUILD_DIR = join(__dirname, '..', 'engine');
const DOOM_JS = join(BUILD_DIR, 'doom.js');
// Freedoom — a free (BSD-licensed) Doom-compatible IWAD, no id Software assets.
const WAD = join(BUILD_DIR, 'freedoom1.wad');

class DoomEngine {
  constructor() {
    this.module = null;
    this.frameBufferPtr = 0;
    this.initialized = false;
    this.width = 640;
    this.height = 400;
  }

  async init() {
    if (!existsSync(DOOM_JS)) throw new Error(`Doom engine not found at ${DOOM_JS}`);

    // Pass the bytes as a Uint8Array directly (Emscripten accepts it) — avoids
    // building a 28M-element JS array, so init is faster and lighter.
    const wadArray = new Uint8Array(readFileSync(WAD));

    // The Emscripten glue is a factory module. Load it via `new Function` so it
    // works regardless of the host module system.
    const code = readFileSync(DOOM_JS, 'utf-8');
    const holder = { exports: {} };
    const fn = new Function('module', 'exports', '__dirname', '__filename', 'require', code);
    fn(holder, holder.exports, BUILD_DIR, DOOM_JS, require);
    const createDoomModule = holder.exports;

    this.module = await createDoomModule({
      locateFile: (p) => (p.endsWith('.wasm') ? join(BUILD_DIR, p) : p),
      print: () => {},
      printErr: () => {},
      preRun: [
        (m) => {
          m.FS_createPath('/', 'doom', true, true);
          m.FS_createDataFile('/doom', 'freedoom1.wad', wadArray, true, false);
        },
      ],
    });
    if (!this.module) throw new Error('Failed to initialize the Doom module');

    this._create();
    this.frameBufferPtr = this.module._DG_GetFrameBuffer();
    this.width = this.module._DG_GetScreenWidth();
    this.height = this.module._DG_GetScreenHeight();
    this.initialized = true;
  }

  _create() {
    const m = this.module;
    const args = ['doom', '-iwad', '/doom/freedoom1.wad'];
    const argPtrs = [];
    for (const arg of args) {
      const ptr = m._malloc(arg.length + 1);
      for (let i = 0; i < arg.length; i++) m.setValue(ptr + i, arg.charCodeAt(i), 'i8');
      m.setValue(ptr + arg.length, 0, 'i8');
      argPtrs.push(ptr);
    }
    const argvPtr = m._malloc(argPtrs.length * 4);
    argPtrs.forEach((p, i) => m.setValue(argvPtr + i * 4, p, 'i32'));
    m._doomgeneric_Create(args.length, argvPtr);
    argPtrs.forEach((p) => m._free(p));
    m._free(argvPtr);
  }

  tick() {
    if (this.initialized) this.module._doomgeneric_Tick();
  }

  // Returns the current frame as a raw ARGB Uint8Array view into WASM memory
  // (length width*height*4, byte order B,G,R,A on little-endian).
  frame() {
    if (!this.initialized) return null;
    const bytes = this.width * this.height * 4;
    return this.module.HEAPU8.subarray(this.frameBufferPtr, this.frameBufferPtr + bytes);
  }

  pushKey(pressed, key) {
    if (this.initialized) this.module._DG_PushKeyEvent(pressed ? 1 : 0, key);
  }
}

module.exports = { DoomEngine };
