import type { RasterImage } from '../types.js';
import type { AssetFile, QualityConfig, QualityIssue } from './models.js';

/**
 * Rule: duplicate_frames (amendment B5).
 *
 - exact: 64-bit FNV-1a over the raw raster bytes (two 32-bit passes combined);
 - near:  dHash 8×8 (64-bit) with Hamming distance ≤ duplicateHammingThreshold.
 *
 * Each duplicate asset references the FIRST earlier asset it matches
 * (input order), so chains resolve deterministically. Near detection is
 * O(n²) pairwise — comfortable to ~1k assets (documented boundary).
 */

function fnv1a32(bytes: Uint8ClampedArray, seed: number): number {
  let hash = seed | 0;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Combined 2×32-bit FNV-1a of the raw raster bytes, as 16 hex chars. */
export function rasterHash64(raster: RasterImage): string {
  const high = fnv1a32(raster.data, 0x811c9dc5);
  const low = fnv1a32(raster.data, 0x9747b28c);
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0');
}

function luminance(raster: RasterImage, x: number, y: number): number {
  const px = Math.min(raster.width - 1, Math.floor((x * raster.width) / 9));
  const py = Math.min(raster.height - 1, Math.floor((y * raster.height) / 8));
  const i = (py * raster.width + px) * 4;
  return 0.299 * raster.data[i] + 0.587 * raster.data[i + 1] + 0.114 * raster.data[i + 2];
}

/** 64-bit dHash: 9×8 grayscale grid, horizontal gradient comparisons. */
export function dHash64(raster: RasterImage): bigint {
  let hash = 0n;
  let bit = 63n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (luminance(raster, x, y) > luminance(raster, x + 1, y)) {
        hash |= 1n << bit;
      }
      bit -= 1n;
    }
  }
  return hash;
}

export function hammingDistance64(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  while (xor !== 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

export function similarityPercent(distance: number): number {
  return Math.round((1 - distance / 64) * 100);
}

/**
 * Solid-color sprites are dHash-degenerate (every gradient comparison is
 * equal → the all-zero hash), so plain dHash would call any two flat
 * sprites "near identical". Near duplicates therefore also require a close
 * average color (max per-channel distance, straight alpha ignored).
 */
const MAX_MEAN_COLOR_DISTANCE = 24;

interface MeanColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function meanColor(raster: RasterImage): MeanColor {
  const total = raster.width * raster.height;
  if (total === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < raster.data.length; i += 4) {
    r += raster.data[i];
    g += raster.data[i + 1];
    b += raster.data[i + 2];
  }
  return { r: r / total, g: g / total, b: b / total };
}

function meanColorDistance(a: MeanColor, b: MeanColor): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

interface AssetFingerprints {
  readonly asset: AssetFile;
  readonly exactHash: string;
  readonly dHash: bigint;
  readonly mean: MeanColor;
}

export function duplicateIssues(
  assets: readonly AssetFile[],
  config: QualityConfig,
): readonly (QualityIssue & { readonly asset: string })[] {
  const fingerprints: AssetFingerprints[] = assets.map((asset) => ({
    asset,
    exactHash: rasterHash64(asset.raster),
    dHash: dHash64(asset.raster),
    mean: meanColor(asset.raster),
  }));

  const issues: (QualityIssue & { readonly asset: string })[] = [];
  for (let j = 1; j < fingerprints.length; j++) {
    const candidate = fingerprints[j];
    let matched: AssetFingerprints | null = null;
    let distance = 0;
    let exact = false;
    for (let i = 0; i < j && matched === null; i++) {
      const earlier = fingerprints[i];
      if (earlier.exactHash === candidate.exactHash) {
        matched = earlier;
        exact = true;
      } else {
        const d = hammingDistance64(earlier.dHash, candidate.dHash);
        if (
          d <= config.duplicateHammingThreshold &&
          meanColorDistance(earlier.mean, candidate.mean) <= MAX_MEAN_COLOR_DISTANCE
        ) {
          matched = earlier;
          distance = d;
        }
      }
    }
    if (matched === null) continue;

    const similarity = exact ? 100 : similarityPercent(distance);
    const saving =
      candidate.asset.byteSize !== undefined && candidate.asset.byteSize > 0
        ? `, potential saving: ~${Math.max(1, Math.round(candidate.asset.byteSize / 1024))} KB`
        : '';
    issues.push({
      asset: candidate.asset.name,
      rule: 'duplicate_frames',
      severity: exact ? 'high' : 'medium',
      message:
        `Duplicate of ${matched.asset.name} (similarity: ${similarity}%, ` +
        `${exact ? 'byte-identical' : `dHash distance ${distance}`})${saving}`,
      suggestion: `Remove '${candidate.asset.name}' or replace it with a distinct frame`,
    });
  }
  return issues;
}
