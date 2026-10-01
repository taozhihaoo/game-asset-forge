/**
 * Minimal glob matcher for include/exclude patterns.
 * Supported syntax: `**` (any segments), `*` (within one segment), `?`
 * (one non-separator char). Patterns match '/'-separated relative paths.
 * Deliberately tiny — no dependency; extend only when a real need appears.
 */

export function globToRegExp(pattern: string): RegExp {
  let source = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 3;
        } else {
          source += '.*';
          i += 2;
        }
      } else {
        source += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      source += '[^/]';
      i += 1;
    } else {
      source += escapeRegExp(c);
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(c: string): string {
  return /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}
