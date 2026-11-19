// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hayesmaker
// See LICENSE in the project root for full license information.
/**
 * png.mjs — dependency-free PNG encoder for raw RGBA frame buffers.
 *
 * Used by the agent CLI (`c64-agent --screenshot`) to write emulator frames
 * to disk. Relies only on node:zlib (deflateSync + crc32).
 */

import { deflateSync, crc32 } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/**
 * Encode an RGBA buffer as an 8-bit truecolour PNG (alpha dropped — C64 frames are opaque).
 *
 * @param {Uint8Array} rgba   width*height*4 bytes
 * @param {number} width
 * @param {number} height
 * @param {{ scale?: number }} [opts]  integer nearest-neighbour upscale (default 1)
 * @returns {Buffer}
 */
export function encodePng(rgba, width, height, opts = {}) {
  const scale = Math.max(1, Math.floor(opts.scale ?? 1));
  if (rgba.length < width * height * 4) {
    throw new Error(`encodePng: buffer too small (${rgba.length} < ${width * height * 4})`);
  }
  const outW = width * scale;
  const outH = height * scale;
  const stride = outW * 3 + 1;
  const raw = Buffer.alloc(stride * outH);

  for (let y = 0; y < outH; y++) {
    const srcRow = Math.floor(y / scale) * width * 4;
    let o = y * stride;
    raw[o++] = 0; // filter: none
    for (let x = 0; x < outW; x++) {
      const s = srcRow + Math.floor(x / scale) * 4;
      raw[o++] = rgba[s];
      raw[o++] = rgba[s + 1];
      raw[o++] = rgba[s + 2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(outW, 0);
  ihdr.writeUInt32BE(outH, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export default encodePng;
