import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rasterHash64 } from '@gameasset-forge/core';
import {
  AiDisabledError,
  cacheKey,
  createProvider,
  deriveSuggestions,
  understandAsset,
  validateUnderstanding,
  PROMPT_VERSION,
  type AiConfig,
  type AiCacheStore,
  type UnderstandingResult,
  type VisionProvider,
} from '@gameasset-forge/ai';
import { discoverPngFiles } from '../discover.js';
import { assertPngFile, decodePng } from '../png.js';
import { JsonFileCacheStore } from '../ai-cache.js';

/**
 * `gameassetforge ai analyze` (V3): AI-assisted asset understanding over a
 * folder. Advisory only — writes three sidecar artifacts and never touches
 * the source files or the deterministic pipeline outputs (C3/C6).
 *
 * Cost control (C4): results are cached by
 * imageHash + promptVersion + provider + model; a cache hit costs zero API
 * calls, so re-running the same folder is free.
 */

export type AiLog = (line: string) => void;

export interface AiAnalyzeOptions {
  readonly root: string;
  readonly outputDir: string;
  readonly config: AiConfig;
  readonly useCache?: boolean;
  /** Test seam: override provider construction (defaults to createProvider). */
  readonly providerFactory?: (config: AiConfig) => VisionProvider;
  readonly log?: AiLog;
}

export interface AiAnalyzeResult {
  readonly summary: {
    total: number;
    analyzed: number;
    failed: number;
    cacheHits: number;
    cacheMisses: number;
    outputFiles: string[];
    errors: { source: string; error: string }[];
  };
  readonly report: unknown;
}

interface NamedUnderstanding {
  readonly source: string;
  readonly result: UnderstandingResult;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function runAiAnalyze(options: AiAnalyzeOptions): Promise<AiAnalyzeResult> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const useCache = options.useCache ?? true;

  if (!existsSync(options.root)) {
    throw new AiDisabledError(`input not found: ${options.root}`);
  }
  const provider = options.providerFactory
    ? options.providerFactory(options.config)
    : createProvider(options.config);

  const files = discoverPngFiles({
    root: options.root,
    recursive: true,
    include: ['**/*.png'],
    exclude: ['**/output/**', '**/ai-cache.json'],
  });

  const cache: AiCacheStore = new JsonFileCacheStore(join(options.outputDir, 'ai-cache.json'));

  const named: NamedUnderstanding[] = [];
  const errors: { source: string; error: string }[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const file of files) {
    try {
      assertPngFile(file.relativePath);
      const buffer = readFileSync(file.absolutePath);
      const raster = decodePng(buffer, file.relativePath);
      const key = cacheKey({
        imageHash: rasterHash64(raster),
        providerId: provider.id,
        model: provider.model,
        promptVersion: options.config.promptVersion ?? PROMPT_VERSION,
      });

      let result: UnderstandingResult;
      const cached = useCache ? cache.get(key) : null;
      if (cached !== null) {
        result = validateUnderstanding(cached);
        cacheHits += 1;
        log(`cache hit ${file.relativePath}`);
      } else {
        cacheMisses += 1;
        result = await understandAsset({ image: raster, name: file.relativePath }, provider);
        cache.set(key, result);
        log(`understood ${file.relativePath}`);
      }
      named.push({ source: file.relativePath, result });
    } catch (error) {
      errors.push({
        source: file.relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      log(`fail ${file.relativePath} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const suggestions = deriveSuggestions(
    named.map((entry) => ({ name: entry.source, result: entry.result })),
  );

  const reportJson = {
    version: 1,
    provider: provider.id,
    model: provider.model,
    promptVersion: options.config.promptVersion ?? PROMPT_VERSION,
    summary: {
      assets: named.length,
      errors: errors.length,
      cacheHits,
      cacheMisses,
    },
    results: named.map((entry) => ({ source: entry.source, ...entry.result })),
    suggestions: {
      naming: suggestions.naming,
      pivot: suggestions.pivot,
      animation: suggestions.animation,
    },
    errors,
  };

  const classificationJson = {
    version: 1,
    note: 'Suggested classification only — no files were moved. Review and execute moves yourself.',
    items: reportJson.results.map((result) => ({
      source: result.source,
      suggestedFolder: `${result.assetType}s`,
      assetType: result.assetType,
      category: result.category,
      confidence: result.confidence,
    })),
  };

  const namingBySource = new Map(suggestions.naming.map((n) => [n.source, n.suggestedName]));
  const animationBySource = new Map(suggestions.animation.map((a) => [a.source, a.recommended]));
  const metadataJson = {
    version: 1,
    assets: reportJson.results.map((result) => ({
      source: result.source,
      name: namingBySource.get(result.source) ?? null,
      type: result.assetType,
      category: result.category,
      description: result.description,
      style: { genre: 'unknown' },
      animationSuggestions: animationBySource.get(result.source) ?? [],
    })),
  };

  const reportFile = join(options.outputDir, 'ai_report.json');
  const classificationFile = join(options.outputDir, 'classification.json');
  const metadataFile = join(options.outputDir, 'asset_metadata.json');
  writeJson(reportFile, reportJson);
  writeJson(classificationFile, classificationJson);
  writeJson(metadataFile, metadataJson);

  const summary = {
    total: files.length,
    analyzed: named.length,
    failed: errors.length,
    cacheHits,
    cacheMisses,
    outputFiles: [reportFile, classificationFile, metadataFile],
    errors,
  };

  log(
    `ai analyze done: ${summary.analyzed}/${summary.total} understood ` +
      `(provider ${provider.id}/${provider.model}, cache ${cacheHits} hits / ${cacheMisses} misses)`,
  );
  return { summary, report: reportJson };
}
