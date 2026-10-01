import type { AssetFile, QualityIssue } from './models.js';
import { parseAssetName } from './naming.js';

/**
 * Rule: size_mismatch — sprites grouped by their parsed animation group
 * (B4: naming parsing runs first) must share one frame size; deviants are
 * flagged against the group's majority size.
 */

function majoritySize(sizes: readonly { width: number; height: number }[]): {
  width: number;
  height: number;
} {
  const counts = new Map<string, { size: { width: number; height: number }; count: number }>();
  for (const size of sizes) {
    const key = `${size.width}x${size.height}`;
    const entry = counts.get(key);
    if (entry === undefined) counts.set(key, { size, count: 1 });
    else entry.count += 1;
  }
  // Deterministic: highest count, then smallest width, then smallest height.
  let best: { size: { width: number; height: number }; count: number } | null = null;
  for (const entry of counts.values()) {
    if (
      best === null ||
      entry.count > best.count ||
      (entry.count === best.count &&
        (entry.size.width < best.size.width ||
          (entry.size.width === best.size.width && entry.size.height < best.size.height)))
    ) {
      best = entry;
    }
  }
  return best === null ? { width: 0, height: 0 } : best.size;
}

/**
 * Size warnings keyed by asset name. Groups are processed in sorted order
 * so the map's insertion order is deterministic.
 */
export function sizeIssuesByAsset(assets: readonly AssetFile[]): ReadonlyMap<string, QualityIssue> {
  const groups = new Map<string, AssetFile[]>();
  for (const asset of assets) {
    const { group } = parseAssetName(asset.name);
    const members = groups.get(group);
    if (members === undefined) groups.set(group, [asset]);
    else members.push(asset);
  }

  const warnings = new Map<string, QualityIssue>();
  const sortedGroups = [...groups.keys()].sort();
  for (const group of sortedGroups) {
    const members = groups.get(group) ?? [];
    if (members.length < 2) continue;
    const majority = majoritySize(
      members.map((m) => ({ width: m.raster.width, height: m.raster.height })),
    );
    for (const member of members) {
      if (member.raster.width === majority.width && member.raster.height === majority.height)
        continue;
      warnings.set(member.name, {
        rule: 'size_mismatch',
        severity: 'high',
        message:
          `Frame size mismatch in group '${group}': ${member.name} is ` +
          `${member.raster.width}x${member.raster.height} (expected ${majority.width}x${majority.height})`,
        suggestion: `Resize or re-export to ${majority.width}x${majority.height} so the group animates consistently`,
      });
    }
  }
  return warnings;
}

export function sizeIssues(assets: readonly AssetFile[]): QualityIssue[] {
  return [...sizeIssuesByAsset(assets).values()];
}
