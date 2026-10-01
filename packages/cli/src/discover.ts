import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { matchesAny } from './glob.js';

/**
 * Batch discovery: walks the input root (optionally recursive), matches
 * '/'-separated relative paths against include/exclude globs, and returns
 * PNG candidates sorted by relative path for deterministic processing order.
 */

export interface DiscoveredFile {
  /** Absolute path for reading. */
  readonly absolutePath: string;
  /** '/'-separated path relative to the input root (used in IDs/manifests). */
  readonly relativePath: string;
}

export interface DiscoveryOptions {
  readonly root: string;
  readonly recursive: boolean;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

export function discoverPngFiles(options: DiscoveryOptions): DiscoveredFile[] {
  const found: DiscoveredFile[] = [];
  walk(options.root, '', options, found);
  found.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
  return found;
}

function walk(
  absoluteDir: string,
  relativeDir: string,
  options: DiscoveryOptions,
  out: DiscoveredFile[],
): void {
  const entries = readdirSync(absoluteDir).sort();
  for (const entry of entries) {
    const absolutePath = join(absoluteDir, entry);
    const relativePath = relativeDir === '' ? entry : `${relativeDir}/${entry}`;
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch {
      continue; // vanished between readdir and stat — skip silently
    }
    if (stats.isDirectory()) {
      if (options.recursive) walk(absolutePath, relativePath, options, out);
      continue;
    }
    if (!stats.isFile()) continue;
    if (!/\.png$/i.test(relativePath)) continue;
    if (!matchesAny(relativePath, options.include)) continue;
    if (matchesAny(relativePath, options.exclude)) continue;
    out.push({ absolutePath, relativePath });
  }
}
