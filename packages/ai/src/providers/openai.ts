import type { UnderstandInvocation, VisionProvider } from '../types.js';
import { AiProviderError } from '../types.js';

/**
 * OpenAI-compatible cloud vision provider (V3 Feature 7 "Cloud").
 *
 * Uses the global fetch API — zero SDK dependencies. The constructor is
 * disabled-by-default: an API key must be provided explicitly (C5 privacy:
 * callers must surface the upload notice before constructing this).
 *
 * Tests never touch the network: the fetch function is injectable.
 */

export type FetchFn = typeof globalThis.fetch;

export interface OpenAiVisionOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetchFn?: FetchFn;
}

interface ChatCompletionResponse {
  readonly choices?: readonly {
    readonly message?: { readonly content?: string };
  }[];
}

export class OpenAiVisionProvider implements VisionProvider {
  readonly id = 'openai';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(options: OpenAiVisionOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  }

  async understand(invocation: UnderstandInvocation): Promise<unknown> {
    let payload: string;
    try {
      payload = JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: invocation.prompt },
              { type: 'image_url', image_url: { url: toDataUrl(invocation.image) } },
            ],
          },
        ],
      });
    } catch (error) {
      throw new AiProviderError(this.id, `failed to encode request: ${String(error)}`, error);
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: payload,
      });
    } catch (error) {
      throw new AiProviderError(this.id, `request failed: ${String(error)}`, error);
    }

    if (!response.ok) {
      throw new AiProviderError(this.id, `HTTP ${response.status} from provider`);
    }

    const body = (await response.json()) as ChatCompletionResponse;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AiProviderError(this.id, 'response has no message content');
    }
    try {
      return JSON.parse(content);
    } catch {
      return { raw: content }; // schema layer reports the problem
    }
  }
}

/** Pure TS base64 (avoids Node Buffer / browser btoa divergence). */
export function toBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? alphabet[b2 & 0x3f] : '=';
  }
  return out;
}

function toDataUrl(image: { data: Uint8ClampedArray; width: number; height: number }): string {
  return `data:image/png;base64,${toBase64(encodePngStored(image.width, image.height, new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.length)))}`;
}

// --- minimal environment-free PNG encoder ------------------------------------
// Stored (uncompressed) deflate blocks keep this valid PNG without any zlib
// dependency, so packages/ai stays environment-free (browser + Node).

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  new DataView(out.buffer, 8 + data.length, 4).setUint32(0, crc32(crcInput));
  return out;
}

function storedDeflate(raw: Uint8Array): Uint8Array {
  // zlib wrapper + stored deflate blocks (max 65535 bytes each)
  const maxBlock = 65535;
  const blocks = Math.ceil(raw.length / maxBlock) || 1;
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let cursor = 0;
  out[cursor++] = 0x78; // zlib header (deflate, fastest)
  out[cursor++] = 0x01;
  for (let block = 0; block < blocks; block++) {
    const start = block * maxBlock;
    const size = Math.min(maxBlock, raw.length - start);
    const final = block === blocks - 1 ? 1 : 0;
    out[cursor++] = final; // BFINAL + BTYPE=00 (stored)
    out[cursor++] = size & 0xff;
    out[cursor++] = (size >> 8) & 0xff;
    out[cursor++] = ~size & 0xff;
    out[cursor++] = (~size >> 8) & 0xff;
    out.set(raw.subarray(start, start + size), cursor);
    cursor += size;
  }
  new DataView(out.buffer).setUint32(cursor, crc32(raw) >>> 0);
  return out;
}

function encodePngStored(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = new Uint8Array(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw.set(rgba.subarray(i, i + 4), offset);
      offset += 4;
    }
  }
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', storedDeflate(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
