#!/usr/bin/env node
import { CommanderError, Command } from 'commander';
import { basename, resolve } from 'node:path';
import {
  ForgeError,
  InvalidPresetError,
  UnsupportedFormatError,
  type Pipeline,
} from '@gameasset-forge/core';
import {
  errorMessage,
  loadPipeline,
  runBatch,
  runInit,
  runInspect,
  runProcess,
  runValidate,
} from './commands/index.js';

const CLI_VERSION = '0.1.0';

/** Exit codes (charter §16): 0 success, 1 processing failure, 2 invalid input/preset/usage. */
const EXIT_SUCCESS = 0;
const EXIT_PROCESSING_FAILURE = 1;
const EXIT_USAGE = 2;

const USAGE_CODES = new Set([
  'INPUT_NOT_FOUND',
  'PRESET_MALFORMED',
  'PRESET_MIGRATION_MISSING',
  'PRESET_SCHEMA_VERSION_UNSUPPORTED',
  'PRESET_UNKNOWN_KEY',
  'PRESET_INVALID_VALUE',
  'PRESET_INVALID',
]);

function buildProgram(): Command {
  const program = new Command();
  program
    .name('gameassetforge')
    .description('Local-first deterministic 2D game asset preparation pipeline.')
    .version(CLI_VERSION)
    .exitOverride();

  program
    .command('init')
    .description('write a default preset file')
    .option('-o, --output <file>', 'preset file to write', 'preset.json')
    .option('--force', 'overwrite an existing preset file', false)
    .action((opts: { output: string; force: boolean }) => {
      runInit(opts.output, opts.force);
    });

  program
    .command('inspect')
    .description('analyze a PNG (format, alpha, detections, estimate) without producing outputs')
    .argument('<file>')
    .option('-p, --preset <file>', 'preset file (default: built-in default preset)')
    .action((file: string, opts: { preset?: string }) => {
      runInspect({ input: resolve(file), presetFile: opts.preset });
    });

  program
    .command('validate')
    .description('validate a preset file without processing images')
    .argument('<preset>')
    .action((preset: string) => {
      runValidate(preset);
    });

  program
    .command('process')
    .description('process a single PNG through the full pipeline')
    .argument('<file>')
    .option('-p, --preset <file>', 'preset file (default: built-in default preset)')
    .requiredOption('-o, --output <dir>', 'output directory')
    .action((file: string, opts: { preset?: string; output: string }) => {
      const pipeline = loadPipeline(opts.preset);
      const outcome = runProcess(
        { absolutePath: resolve(file), relativePath: basename(file) },
        pipeline,
        resolve(opts.output),
      );
      process.stdout.write(`output: ${outcome.outputFiles.join(', ')}\n`);
    });

  program
    .command('batch')
    .description('process a folder of PNGs; writes summary.json into the output directory')
    .argument('<directory>')
    .option('-p, --preset <file>', 'preset file (default: built-in default preset)')
    .requiredOption('-o, --output <dir>', 'output directory')
    .option('--recursive', 'recurse into subfolders (overrides preset)')
    .option('--no-recursive', 'do not recurse into subfolders (overrides preset)')
    .option('-i, --include <glob...>', 'include globs (overrides preset)')
    .option('-e, --exclude <glob...>', 'exclude globs (overrides preset)')
    .action(
      (
        directory: string,
        opts: {
          preset?: string;
          output: string;
          recursive?: boolean;
          include?: string[];
          exclude?: string[];
        },
      ) => {
        const pipeline = applyBatchOverrides(loadPipeline(opts.preset), opts);
        const { summary } = runBatch({
          root: resolve(directory),
          pipeline,
          outputDir: resolve(opts.output),
        });
        if (summary.failed > 0) process.exit(EXIT_PROCESSING_FAILURE);
      },
    );

  return program;
}

function applyBatchOverrides(
  pipeline: Pipeline,
  opts: { recursive?: boolean; include?: string[]; exclude?: string[] },
): Pipeline {
  if (opts.recursive === undefined && opts.include === undefined && opts.exclude === undefined) {
    return pipeline;
  }
  return {
    ...pipeline,
    input: {
      ...pipeline.input,
      recursive: opts.recursive ?? pipeline.input.recursive,
      include: opts.include ?? pipeline.input.include,
      exclude: opts.exclude ?? pipeline.input.exclude,
    },
  };
}

function exitCodeFor(error: unknown): number {
  if (error instanceof InvalidPresetError || error instanceof UnsupportedFormatError) {
    return EXIT_USAGE;
  }
  if (error instanceof ForgeError) {
    return USAGE_CODES.has(error.code) ? EXIT_USAGE : EXIT_PROCESSING_FAILURE;
  }
  return EXIT_PROCESSING_FAILURE;
}

async function main(): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
    return EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === EXIT_SUCCESS ? EXIT_SUCCESS : EXIT_USAGE;
    }
    process.stderr.write(`error: ${errorMessage(error)}\n`);
    if (error instanceof Error && process.argv.includes('--verbose')) {
      process.stderr.write(`${error.stack ?? ''}\n`);
    }
    return exitCodeFor(error);
  }
}

main().then((code) => process.exit(code));
