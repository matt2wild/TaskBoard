import { deflateRawSync, crc32 } from 'node:zlib';
import { Buffer } from 'node:buffer';

/**
 * A minimal ZIP writer. Exports must be openable by any tool a decade from now
 * (principle 3), so the archive format is plain ZIP with no dependency to rot.
 */
interface Entry {
  name: string; data: Buffer; crc: number; compressed: Buffer;
  offset: number; method: number;
}

const crcOf: (b: Buffer) => number =
  typeof crc32 === 'function'
    ? (b) => crc32(b) >>> 0
    : (() => {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
      }
      return (buf: Buffer) => {
        let c = 0xFFFFFFFF;
        for (const byte of buf) c = table[(c ^ byte) & 0xFF]! ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
      };
    })();

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))) & 0xFFFF,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF,
  };
}

export class ZipWriter {
  private entries: Entry[] = [];
  private chunks: Buffer[] = [];
  private offset = 0;
  private readonly stamp = dosTime(new Date());

  add(name: string, content: Buffer | string, opts: { compress?: boolean } = {}): void {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compress = opts.compress ?? data.length > 256;
    const compressed = compress ? deflateRawSync(data) : data;
    const method = compress ? 8 : 0;
    const crc = crcOf(data);
    const nameBuf = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(this.stamp.time, 10);
    local.writeUInt16LE(this.stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    this.entries.push({ name, data, crc, compressed, offset: this.offset, method });
    this.chunks.push(local, nameBuf, compressed);
    this.offset += local.length + nameBuf.length + compressed.length;
  }

  finish(): Buffer {
    const central: Buffer[] = [];
    let centralSize = 0;
    for (const e of this.entries) {
      const nameBuf = Buffer.from(e.name, 'utf8');
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(20, 6);
      head.writeUInt16LE(0, 8);
      head.writeUInt16LE(e.method, 10);
      head.writeUInt16LE(this.stamp.time, 12);
      head.writeUInt16LE(this.stamp.date, 14);
      head.writeUInt32LE(e.crc, 16);
      head.writeUInt32LE(e.compressed.length, 20);
      head.writeUInt32LE(e.data.length, 24);
      head.writeUInt16LE(nameBuf.length, 28);
      head.writeUInt16LE(0, 30);
      head.writeUInt16LE(0, 32);
      head.writeUInt16LE(0, 34);
      head.writeUInt16LE(0, 36);
      head.writeUInt32LE(0, 38);
      head.writeUInt32LE(e.offset, 42);
      central.push(head, nameBuf);
      centralSize += head.length + nameBuf.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(this.offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...this.chunks, ...central, end]);
  }
}

/** RFC 4180 CSV, with the quoting rules spreadsheets actually expect. */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => cell(r[c])).join(',')),
  ].join('\n');
}

export function toJsonl(rows: Array<Record<string, unknown>>): string {
  return rows.map((r) => JSON.stringify(r)).join('\n');
}
