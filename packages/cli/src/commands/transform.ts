import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  computeWeights,
  createMask,
  extractLayer,
  gridMeshFromMask,
  parsePreset,
  proposeRig,
  runPipeline,
  type ForgeProject,
  type RasterImage,
} from '@gameasset-forge/core';
import { assertPngFile, decodePng, encodePng } from '../png.js';
import { buildGodotCutoutFiles } from '../exporters/godot-cutout.js';

/**
 * `gameassetforge transform <file>` (V4): single-image cutout prototype.
 * Segmentation (mock = alpha-CC proposals) → layer extraction with occlusion
 * levels → rig proposal (template) → grid mesh + distance weights →
 * artifacts: <base>.forge, layers/*.png, godot-export/ (Skeleton2D scene +
 * preview script). Advisory/prototype — everything regenerable.
 */

export type TransformLog = (line: string) => void;

export interface TransformOptions {
  readonly file: string;
  readonly outputDir: string;
  readonly template?: 'human' | 'animal' | 'monster';
  readonly dilation?: number;
  readonly diffusionIterations?: number;
  readonly meshStep?: number;
  readonly log?: TransformLog;
}

export interface TransformResult {
  readonly summary: {
    layers: number;
    bones: number;
    meshTriangles: number;
    outputFiles: string[];
  };
  readonly project: ForgeProject;
}

function sanitizeBase(file: string): string {
  const base = file.replace(/\.[^.]+$/, '');
  return base.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() || 'asset';
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function runTransform(options: TransformOptions): TransformResult {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (!existsSync(options.file)) {
    throw new Error(`input not found: ${options.file}`);
  }
  assertPngFile(options.file);
  const buffer = readFileSync(options.file);
  const source: RasterImage = decodePng(buffer, options.file);

  // --- segmentation (mock = alpha-CC proposals through the standard pipeline)
  const detection = runPipeline(source, parsePreset({ schemaVersion: 2 }), {
    sourcePath: options.file,
  });

  const regions = detection.sprites.map((sprite, index) => {
    const mask = createMask(source.width, source.height);
    const rect = sprite.sourceRect;
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        mask.data[y * source.width + x] = 255;
      }
    }
    const name = `layer_${String(index + 1).padStart(2, '0')}`;
    return { name, mask, contentRect: rect };
  });
  if (regions.length === 0) {
    throw new Error('no sprites detected — nothing to transform');
  }
  log(`segmentation: ${regions.length} layer proposal(s) (mock = alpha-CC)`);

  // --- extraction (occlusion levels 1+2) --------------------------------------
  const layers = regions.map((region) =>
    extractLayer(
      source,
      { id: region.name, mask: region.mask },
      {
        dilation: options.dilation ?? 8,
        diffusionIterations: options.diffusionIterations ?? 16,
      },
    ),
  );

  // --- rig proposal (normalized layer coords → source px) ---------------------
  const template = options.template ?? 'human';
  const rig = proposeRig(template);
  const bonesSource = rig.map((bone) => ({
    name: bone.name,
    parent: bone.parent,
    x: Math.round(bone.x * source.width),
    y: Math.round(bone.y * source.height),
  }));

  // --- mesh + weights per layer -----------------------------------------------
  const meshStep = options.meshStep ?? 16;
  const layerMeshes = layers.map((layer, index) => ({
    layerId: regions[index]?.name ?? `layer_${index}`,
    mesh: gridMeshFromMask(layer.mask, meshStep),
  }));

  const layerWeights = layers.map((_layer, index) => {
    const mesh = layerMeshes[index].mesh;
    const bonesInCell = bonesSource.map((bone) => ({
      id: bone.name,
      name: bone.name,
      parent: bone.parent,
      x: bone.x - layers[index].cellRect.x,
      y: bone.y - layers[index].cellRect.y,
    }));
    const weights = computeWeights(mesh.vertices, bonesInCell);
    return {
      layerId: regions[index]?.name ?? `layer_${index}`,
      weights,
    };
  });

  // --- .forge project ----------------------------------------------------------
  const base = sanitizeBase(options.file.split(/[\\/]/).pop() ?? 'asset');
  const project: ForgeProject = {
    forgeVersion: 1,
    asset: { source: options.file, width: source.width, height: source.height },
    layers: layers.map((_layer, index) => ({
      id: regions[index]?.name ?? `layer_${index}`,
      name: regions[index]?.name ?? `layer_${index}`,
      z: index,
      sourceRect: regions[index]?.contentRect ?? {
        x: 0,
        y: 0,
        width: source.width,
        height: source.height,
      },
      dilation: options.dilation ?? 8,
      rasterFile: `layers/${regions[index]?.name ?? `layer_${index}`}.png`,
    })),
    bones: bonesSource.map((bone) => ({
      id: bone.name,
      name: bone.name,
      parent: bone.parent,
      x: bone.x / source.width,
      y: bone.y / source.height,
    })),
    mesh: layerMeshes.map((entry, index) => ({
      layerId: regions[index]?.name ?? `layer_${index}`,
      vertices: entry.mesh.vertices,
      triangles: entry.mesh.triangles,
    })),
    weights: layerWeights.map((entry) => ({
      layerId: entry.layerId,
      vertices: entry.weights.vertices,
    })),
    animationTemplates: ['idle', 'breathing'],
  };

  // --- write artifacts -----------------------------------------------------------
  mkdirSync(join(options.outputDir, 'layers'), { recursive: true });
  const outputFiles: string[] = [];

  const writtenLayers: { layerId: string; file: string }[] = [];
  layers.forEach((layer, index) => {
    const name = regions[index]?.name ?? `layer_${index}`;
    const file = join(options.outputDir, 'layers', `${name}.png`);
    writeFileSync(file, encodePng(layer.raster));
    outputFiles.push(file);
    writtenLayers.push({ layerId: name, file });
  });

  const forgeFile = join(options.outputDir, `${base}.forge`);
  writeJson(forgeFile, project);
  outputFiles.push(forgeFile);

  // --- godot cutout export -------------------------------------------------------
  const godotDir = join(options.outputDir, 'godot-export');
  mkdirSync(godotDir, { recursive: true });
  const cutout = {
    projectName: base,
    layers: writtenLayers.map((written, index) => ({
      name: written.layerId,
      textureFile: `layers/${written.layerId}.png`,
      cellRect: layers[index].cellRect,
      z: index,
    })),
    bones: bonesSource.map((bone) => ({
      name: bone.name,
      parent: bone.parent,
      x: bone.x,
      y: bone.y,
    })),
  };
  const godotFiles = buildGodotCutoutFiles(cutout);
  const sceneFile = join(godotDir, 'cutout.tscn');
  const scriptFile = join(godotDir, 'cutout_preview.gd');
  const godotProjectFile = join(godotDir, 'project.godot');
  writeFileSync(sceneFile, godotFiles.scene, 'utf8');
  writeFileSync(scriptFile, godotFiles.script, 'utf8');
  // copy layer PNGs into godot-export/layers/ so res:// paths resolve
  for (const written of writtenLayers) {
    const src = join(options.outputDir, 'layers', `${written.layerId}.png`);
    const dst = join(godotDir, 'layers', `${written.layerId}.png`);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(src));
  }
  writeFileSync(godotProjectFile, godotFiles.projectGodot, 'utf8');
  outputFiles.push(sceneFile, scriptFile, godotProjectFile);

  const meshTriangles = layerMeshes.reduce((sum, entry) => sum + entry.mesh.triangles.length, 0);
  const summary = {
    layers: layers.length,
    bones: bonesSource.length,
    meshTriangles,
    outputFiles,
  };

  log(
    `transform done: ${summary.layers} layers, ${summary.bones} bones, ` +
      `${summary.meshTriangles} triangles → ${options.outputDir}`,
  );
  return { summary, project };
}
