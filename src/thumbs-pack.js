// Range-reader for /workspace/index/lance/thumbs.pack (TIDX1 format).
// This loads only the header, binary-search records, and the requested WebP blob.

import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const HEADER_SIZE = 13;
const RECORD_SIZE = 38;
const MAGIC = Buffer.from('TIDX1', 'ascii');
const HASH_RE = /^[0-9a-f]{64}$/;

export class ThumbsPack {
  constructor(path, descriptor = null) {
    this.path = path;
    this.descriptor = descriptor;
    this.header = null;
    this.blobStart = 0;
    this.handle = null;
  }

  async open() {
    if (this.handle) return this;
    this.handle = await open(this.path, 'r');
    const header = Buffer.alloc(HEADER_SIZE);
    const {bytesRead} = await this.handle.read(header, 0, HEADER_SIZE, 0);
    if (bytesRead !== HEADER_SIZE || !header.subarray(0, 5).equals(MAGIC)) {
      throw new Error(`invalid thumbs.pack header at ${this.path}`);
    }
    this.header = {
      tile: header.readUInt8(5),
      views: header.readUInt8(6),
      grid_w: header.readUInt8(7),
      grid_h: header.readUInt8(8),
      count: header.readUInt32LE(9),
    };
    this.blobStart = HEADER_SIZE + RECORD_SIZE * this.header.count;
    if (this.descriptor?.bytes) {
      const stat = await this.handle.stat();
      if (stat.size !== this.descriptor.bytes) {
        throw new Error(`thumbs.pack byte size ${stat.size} != descriptor ${this.descriptor.bytes}`);
      }
    }
    return this;
  }

  async readAt(offset, length) {
    const buffer = Buffer.alloc(length);
    const {bytesRead} = await this.handle.read(buffer, 0, length, offset);
    if (bytesRead !== length) throw new Error(`short pack read: ${bytesRead}/${length}`);
    return buffer;
  }

  async recordAt(index) {
    const raw = await this.readAt(HEADER_SIZE + index * RECORD_SIZE, RECORD_SIZE);
    return {
      hash: raw.subarray(0, 32),
      hex: raw.subarray(0, 32).toString('hex'),
      offset: raw.readUInt32LE(32),
      length: raw.readUInt16LE(36),
    };
  }

  async find(hashHex) {
    if (!HASH_RE.test(hashHex)) throw new Error('hash must be 64 lowercase hex characters');
    const key = Buffer.from(hashHex, 'hex');
    let lo = 0;
    let hi = this.header.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const candidate = await this.readAt(HEADER_SIZE + mid * RECORD_SIZE, 32);
      if (Buffer.compare(candidate, key) < 0) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= this.header.count) return null;
    const record = await this.recordAt(lo);
    return record.hash.equals(key) ? record : null;
  }

  async blob(hashHex) {
    await this.open();
    const record = await this.find(hashHex);
    if (!record) return null;
    if (record.offset < this.blobStart || record.offset + record.length > (await this.handle.stat()).size) {
      throw new Error(`invalid blob range for ${hashHex}`);
    }
    return {bytes: await this.readAt(record.offset, record.length), record};
  }

  async firstHash() {
    await this.open();
    return (await this.recordAt(0)).hex;
  }

  async verifyDescriptor() {
    if (!this.descriptor?.sha256) return null;
    await this.open();
    const stat = await this.handle.stat();
    const hash = createHash('sha256');
    let position = 0;
    const chunk = Buffer.alloc(1024 * 1024);
    while (position < stat.size) {
      const {bytesRead} = await this.handle.read(chunk, 0, Math.min(chunk.length, stat.size - position), position);
      if (!bytesRead) break;
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    const digest = hash.digest('hex');
    if (digest !== this.descriptor.sha256) throw new Error(`thumbs.pack sha256 ${digest} != descriptor`);
    return digest;
  }

  async close() {
    if (this.handle) await this.handle.close();
    this.handle = null;
  }
}

export function spritePosition(view, gridW, size) {
  return {x: -(view % gridW) * size, y: -Math.floor(view / gridW) * size,
    width: gridW * size, height: Math.ceil(7 / gridW) * size};
}
