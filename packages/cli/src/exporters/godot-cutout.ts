/**
 * Godot cutout export (V4 Feature 9 + V5.3): Skeleton2D + Bone2D chain from
 * the proposed rig; each layer renders as a Sprite2D rigid-bound to its
 * nearest bone. V5.3 adds AnimationPlayer with generated idle (±8°) and
 * breathing (±2°) value tracks on Bone2D:rotation — both inside the D3
 * limited-deformation envelope. The preview script remains as the
 * AnimationPlayer-less fallback (V4 behavior preserved when animations
 * are disabled).
 *
 * The exported project is verified headless in the real Godot runtime:
 * scene loads, Skeleton2D has the authored bones, AnimationPlayer exposes
 * the generated animations (charter §20 honesty: runtime smoke, not claims).
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
  /** V5.3: generate AnimationPlayer with idle/breathing tracks (default true). */
  readonly generateAnimations?: boolean;
}

export interface GodotCutoutFiles {
  readonly scene: string;
  readonly script: string;
  readonly projectGodot: string;
}

const PREVIEW_SCRIPT = `extends Node2D
# Generated preview: limited-deformation sway (+/-8 deg, amendment D3).
# Used when AnimationPlayer generation is disabled; otherwise the
# AnimationPlayer drives the bones.

var _t := 0.0

func _process(delta: float) -> void:
	_t += delta
	var index := 0
	for bone in $Skeleton2D.get_children():
		if bone is Bone2D:
			bone.rotation = sin(_t * 2.0 + float(index)) * deg_to_rad(8.0)
			index += 1
`;

const DEG8 = (8 * Math.PI) / 180;
const DEG2 = (2 * Math.PI) / 180;

function fmt(value: number): string {
  // 5 significant decimals, trailing zeros trimmed — deterministic output
  return String(Math.round(value * 100000) / 100000);
}

/** Builds one Animation sub_resource rotating every bone by ±amplitude. */
function buildAnimationResource(
  animationName: string,
  lengthSeconds: number,
  amplitudeRad: number,
  bones: readonly CutoutBoneInput[],
  nodeName: Map<string, string>,
): string[] {
  const lines: string[] = [];
  const half = lengthSeconds / 2;
  const times = [0, half / 2, half, half + half / 2, lengthSeconds];
  const values = [0, amplitudeRad, 0, -amplitudeRad, 0];

  lines.push(`[sub_resource type="Animation" id="Animation_${animationName}"]`);
  lines.push(`resource_name = "${animationName}"`);
  lines.push(`length = ${lengthSeconds}`);
  lines.push('loop_mode = 1');
  bones.forEach((bone, index) => {
    const path = bone.parent === null ? 'Skeleton2D' : `Skeleton2D/${nodeName.get(bone.name)}`;
    lines.push(`tracks/${index}/type = "value"`);
    lines.push(`tracks/${index}/imported = false`);
    lines.push(`tracks/${index}/enabled = true`);
    lines.push(`tracks/${index}/path = NodePath("${path}")`);
    lines.push(`tracks/${index}/interp = 1`);
    lines.push(`tracks/${index}/loop_wrap = true`);
    lines.push(`tracks/${index}/keys = {`);
    lines.push(`"times": PackedFloat32Array(${times.map((t) => fmt(t)).join(', ')}),`);
    lines.push(`"transitions": PackedFloat32Array(1, 1, 1, 1, 1),`);
    lines.push('"update": 0,');
    lines.push(`"values": [${values.map((v) => fmt(v)).join(', ')}]`);
    lines.push('}');
  });
  return lines;
}

function buildScene(input: CutoutExportInput): string {
  const generateAnimations = input.generateAnimations ?? true;
  const lines: string[] = [];
  const animationCount = generateAnimations ? 2 : 0; // idle + breathing
  const libraryCount = generateAnimations ? 1 : 0;
  const loadSteps = input.layers.length + 1 + animationCount + libraryCount + 1;

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

  if (generateAnimations) {
    lines.push(...buildAnimationResource('idle', 2.0, DEG8, input.bones, nodeName));
    lines.push('');
    lines.push(...buildAnimationResource('breathing', 4.0, DEG2, input.bones, nodeName));
    lines.push('');
    lines.push('[sub_resource type="AnimationLibrary" id="AnimationLibrary_1"]');
    lines.push('_data = {');
    lines.push('"breathing": SubResource("Animation_breathing"),');
    lines.push('"idle": SubResource("Animation_idle")');
    lines.push('}');
    lines.push('');
  }

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
    const offsetX = Math.round(layer.cellRect.x + layer.cellRect.width / 2 - bone.x);
    const offsetY = Math.round(layer.cellRect.y + layer.cellRect.height / 2 - bone.y);
    lines.push(
      `[node name="Layer_${layer.name}" type="Sprite2D" parent="Skeleton2D/${nodeName.get(boneName)}"]`,
    );
    lines.push(`texture = ExtResource("Tex_${input.layers.indexOf(layer) + 1}")`);
    lines.push(`offset = Vector2(${offsetX}, ${offsetY})`);
    lines.push('');
  }

  if (generateAnimations) {
    lines.push(`[node name="AnimationPlayer" type="AnimationPlayer" parent="."]`);
    lines.push('libraries = {');
    lines.push('"": SubResource("AnimationLibrary_1")');
    lines.push('}');
    lines.push('autoplay = "idle"');
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
