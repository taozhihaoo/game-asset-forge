import type { ExportManifest } from '@gameasset-forge/core';

/**
 * Godot 4 exporter (charter §20): converts the generic ExportManifest into a
 * SpriteFrames .tres text resource. Core never learns about Godot — this
 * module is a pure manifest → text function in the CLI layer.
 *
 * V1 shape: one "default" animation containing every sprite in manifest
 * order, at `animationSpeed` fps, looping. Per-sprite pivots live in
 * atlas.json (AnimatedSprite2D has no per-frame pivot).
 *
 * ext_resource paths are relative (files sit next to the .tres in the output
 * directory); Godot 4 resolves them relative to the resource file.
 */
export function buildSpriteFramesTres(manifest: ExportManifest, animationSpeed = 5.0): string {
  const lines: string[] = [];
  const loadSteps = manifest.pages.length + manifest.sprites.length + 1;
  lines.push(`[gd_resource type="SpriteFrames" load_steps=${loadSteps} format=3]`);
  lines.push('');
  manifest.pages.forEach((page, index) => {
    lines.push(`[ext_resource type="Texture2D" path="${page.file}" id="${index + 1}"]`);
  });
  lines.push('');
  manifest.sprites.forEach((sprite, index) => {
    lines.push(`[sub_resource type="AtlasTexture" id="AtlasTexture_${index + 1}"]`);
    lines.push(`atlas = ExtResource("${sprite.page + 1}")`);
    lines.push(
      `region = Rect2(${sprite.rect.x}, ${sprite.rect.y}, ${sprite.rect.width}, ${sprite.rect.height})`,
    );
    lines.push('');
  });

  lines.push('[resource]');
  lines.push('animations = [{');
  lines.push('"frames": [');
  manifest.sprites.forEach((_sprite, index) => {
    lines.push('{');
    lines.push('"duration": 1.0,');
    lines.push(`"texture": SubResource("AtlasTexture_${index + 1}")`);
    lines.push(index === manifest.sprites.length - 1 ? '}' : '},');
  });
  lines.push('],');
  lines.push('"loop": true,');
  lines.push('"name": &"default",');
  lines.push(`"speed": ${animationSpeed}`);
  lines.push('}]');
  return `${lines.join('\n')}\n`;
}
