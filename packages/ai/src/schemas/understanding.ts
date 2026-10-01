import {
  ASSET_TYPES,
  AiResponseError,
  type AssetType,
  type UnderstandingResult,
} from '../types.js';

/**
 * AI response schema validation (V3 Feature 9 — "禁止直接相信 AI").
 * Hand-rolled validator, same style as the core preset validator: collect
 * problems, throw once, never trust partial payloads.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strips optional ```json fences some models add despite instructions. */
export function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const jsonText = unfenced === null ? trimmed : unfenced[1];
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new AiResponseError([`response is not valid JSON: ${String(error)}`]);
  }
}

export function validateUnderstanding(raw: unknown): UnderstandingResult {
  const problems: string[] = [];
  if (!isRecord(raw)) {
    throw new AiResponseError(['response must be a JSON object']);
  }

  let assetType: AssetType | undefined;
  if (typeof raw.assetType !== 'string' || !ASSET_TYPES.includes(raw.assetType as AssetType)) {
    problems.push(`assetType must be one of ${ASSET_TYPES.join(' | ')}`);
  } else {
    assetType = raw.assetType as AssetType;
  }

  let category = 'unknown';
  if (raw.category !== undefined) {
    if (typeof raw.category !== 'string' || raw.category.trim() === '') {
      problems.push('category must be a non-empty string when present');
    } else {
      category = raw.category;
    }
  }

  let description = '';
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      problems.push('description must be a string when present');
    } else {
      description = raw.description;
    }
  }

  let confidence = 0;
  if (raw.confidence !== undefined) {
    if (
      typeof raw.confidence !== 'number' ||
      !Number.isFinite(raw.confidence) ||
      raw.confidence < 0 ||
      raw.confidence > 1
    ) {
      problems.push('confidence must be a number in [0, 1]');
    } else {
      confidence = raw.confidence;
    }
  }

  if (problems.length > 0) throw new AiResponseError(problems);

  return {
    assetType: assetType as AssetType,
    category,
    description,
    confidence,
  };
}
