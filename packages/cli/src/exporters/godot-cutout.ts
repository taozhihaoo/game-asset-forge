import { join } from 'node:path';

/**
 * Godot cutout export (V4 Feature 9, prototype): Skeleton2D + Bone2D chain
 * from the proposed rig; each layer renders as a Sprite2D parented to its
 * nearest bone (rigid cutout binding) with a preview script that sways the
 * bones ±8° (limited deformation, D3). Smooth Polygon2D skinning and
 * AnimationPlayer tracks are V5 backlog — documented honestly (§20).
 *
 * The exported project is verified headless in the real Godot runtime:
 * scene loads, Skeleton2D exists with the authored bones, layers attached.
 */

export interface CutoutLayerInput {
  readonly name: string;
  readonly textureFile: string;
  /** Expanded cell raster in SOURCE pixels. */
  readonly cellRect: { x: number; y: number; width: number; height: number };
  readonly z: number;
}

export interface CutoutBoneInput {
  readonly name: string;
  readonly parent: string | null;
  readonly x: number;
  readonly y: number;
}

export interface CutoutExportInput {
  readonly projectName: string;
  readonly layers: readonly CutoutLayerInput[];
  readonly bones: readonly CutoutBoneInput[];
}

export interface GodotCutoutFiles {
  readonly scene: string;
  readonly script: string;
  readonly projectGodot: string;
}

const PREVIEW_SCRIPT = `extends Node2D
# Generated preview: limited-deformation sway (+/-8 deg, amendment D3).
# This is a preview, not an animation editor (V5).

var _t := 0.0

func _process(delta: float) -> void:
	_t += delta
	var index := 0
	for bone in $Skeleton2D.get_children():
		if bone is Bone2D:
			bone.rotation = sin(_t * 2.0 + float(index)) * deg_to_rad(8.0)
			index += 1
`;

function buildScene(input: CutoutExportInput): string {
  const lines: string[] = [];
  const loadSteps = input.layers.length + 2;

  lines.push(`[gd_scene load_steps=${loadSteps} format=3]`);
  lines.push('');

  input.layers.forEach((layer, index) => {
    lines.push(
      `[ext_resource type="Texture2D" path="res://${layer.textureFile}" id="Tex_${index + 1}"]`,
    );
  });
  lines.push(`[ext_resource type="Script" path="res://cutout_preview.gd" id="Script_1"]`);
  lines.push('');

  const nodeName = new Map<string, string>();
  input.bones.forEach((bone, index) => nodeName.set(bone.name, `Bone_${index + 1}`));

  // scene root first (declaration order = tree order in .tscn)
  lines.push(`[node name="CutoutRoot" type="Node2D"]`);
  lines.push(`script = ExtResource("Script_1")`);
  lines.push('');
  lines.push(`[node name="Skeleton2D" type="Skeleton2D" parent="."]`);
  lines.push('');

  const nearestBoneName = (x: number, y: number): string => {
    let best = input.bones[0];
    let bestDistance = Infinity;
    for (const bone of input.bones) {
      const d = Math.hypot(bone.x - x, bone.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = bone;
      }
    }
    return best.name;
  };

  input.bones.forEach((bone) => {
    const name = nodeName.get(bone.name);
    const parentPath =
      bone.parent === null ? 'Skeleton2D' : `Skeleton2D/${nodeName.get(bone.parent)}`;
    lines.push(`[node name="${name}" type="Bone2D" parent="${parentPath}"]`);
    lines.push(`position = Vector2(${bone.x}, ${bone.y})`);
    lines.push(`rest = Transform2D(1, 0, 0, 1, ${bone.x}, ${bone.y})`);
    lines.push('');
  });

  for (const layer of [...input.layers].sort((a, b) => a.z - b.z)) {
    const boneName = nearestBoneName(
      layer.cellRect.x + layer.cellRect.width / 2,
      layer.cellRect.y + layer.cellRect.height / 2,
    );
    const bone = input.bones.find((b) => b.name === boneName) ?? input.bones[0];
    const offset =
      `Vector2(${layer.cellRect.x + layer.cellRect.width / 2 - bone.x}, ` +
      `${layer.cellRect.y + layer.cellRect.height / 2 - bone.y})`;
    lines.push(
      `[node name="Layer_${layer.name}" type="Sprite2D" parent="Skeleton2D/${nodeName.get(bone.name)}"]`,
    );
    lines.push(`texture = ExtResource("Tex_${input.layers.indexOf(layer) + 1}")`);
    lines.push(`offset = ${offset}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function buildGodotCutoutFiles(input: CutoutExportInput): GodotCutoutFiles {
  return {
    scene: buildScene(input),
    script: PREVIEW_SCRIPT + '\n',
    projectGodot:
      `config_version=5\n\n[application]\n\nconfig/name="${input.projectName}"\n` +
      `config/features=PackedStringArray("4.2")\n`,
  };
}

export function godotCutoutFileNames(outputDir: string): {
  scene: string;
  script: string;
  projectGodot: string;
} {
  return {
    scene: join(outputDir, 'godot-export', 'cutout.tscn'),
    script: join(outputDir, 'godot-export', 'cutout_preview.gd'),
    projectGodot: join(outputDir, 'godot-export', 'project.godot'),
  };
}
