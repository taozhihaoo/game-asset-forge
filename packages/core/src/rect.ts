import { InvalidRectError } from './errors.js';
import type { ImageSize, Rect } from './types.js';

/** Returns a list of problems (empty = valid). Pure, throws nothing. */
export function rectProblems(
  rect: unknown,
  path: string,
  bounds?: ImageSize,
): { path: string; message: string; code: string }[] {
  const problems: { path: string; message: string; code: string }[] = [];
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

  if (!isRecord(rect)) {
    return [{ path, message: 'must be an object { x, y, width, height }', code: 'RECT_INVALID' }];
  }

  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = rect[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      problems.push({
        path: `${path}.${key}`,
        message: 'must be a safe integer',
        code: 'RECT_INVALID',
      });
    }
  }
  if (problems.length > 0) return problems;

  const r = rect as unknown as Rect;
  if (r.x < 0) problems.push({ path: `${path}.x`, message: 'must be >= 0', code: 'RECT_INVALID' });
  if (r.y < 0) problems.push({ path: `${path}.y`, message: 'must be >= 0', code: 'RECT_INVALID' });
  if (r.width < 1)
    problems.push({
      path: `${path}.width`,
      message: 'must be >= 1 (zero-area rects are invalid)',
      code: 'RECT_INVALID',
    });
  if (r.height < 1)
    problems.push({
      path: `${path}.height`,
      message: 'must be >= 1 (zero-area rects are invalid)',
      code: 'RECT_INVALID',
    });
  if (bounds !== undefined) {
    if (r.x + r.width > bounds.width)
      problems.push({
        path: `${path}`,
        message: `extends past image width (${r.x + r.width} > ${bounds.width})`,
        code: 'RECT_OUT_OF_BOUNDS',
      });
    if (r.y + r.height > bounds.height)
      problems.push({
        path: `${path}`,
        message: `extends past image height (${r.y + r.height} > ${bounds.height})`,
        code: 'RECT_OUT_OF_BOUNDS',
      });
  }
  return problems;
}

/** Validates and throws InvalidRectError on the first problem. */
export function assertValidRect(rect: unknown, path: string, bounds?: ImageSize): Rect {
  const problems = rectProblems(rect, path, bounds);
  if (problems.length > 0) {
    const p = problems[0];
    throw new InvalidRectError(`${p.path}: ${p.message}`);
  }
  return rect as Rect;
}
