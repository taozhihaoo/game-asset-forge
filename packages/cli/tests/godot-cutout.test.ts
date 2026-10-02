import { describe, expect, it } from 'vitest';
import { buildGodotCutoutFiles } from '../src/exporters/godot-cutout.js';

const bones = [
  { name: 'root', parent: null, x: 24, y: 35 },
  { name: 'body', parent: 'root', x: 24, y: 22 },
  { name: 'head', parent: 'body', x: 24, y: 6 },
];
const layers = [
  {
    name: 'layer_01',
    textureFile: 'layers/layer_01.png',
    cellRect: { x: 0, y: 0, width: 16, height: 16 },
    z: 0,
  },
  {
    name: 'layer_02',
    textureFile: 'layers/layer_02.png',
    cellRect: { x: 16, y: 0, width: 16, height: 16 },
    z: 1,
  },
];
const input = { projectName: 'test', layers, bones };

describe('buildGodotCutoutFiles field-level assertions', () => {
  const files = buildGodotCutoutFiles(input);

  it('load_steps equals ext_resources + animations + library + 1', () => {
    const match = files.scene.match(/load_steps=(\d+)/);
    expect(match).not.toBeNull();
    // 2 textures + 1 script + 2 animations + 1 library + 1 scene = 7
    expect(Number(match![1])).toBe(7);
  });

  it('generates ext_resource for each layer texture', () => {
    const extMatches = files.scene.match(/\[ext_resource type="Texture2D"/g);
    expect(extMatches).toHaveLength(2);
    expect(files.scene).toContain('path="res://layers/layer_01.png"');
    expect(files.scene).toContain('path="res://layers/layer_02.png"');
  });

  it('generates Script ext_resource', () => {
    expect(files.scene).toContain('[ext_resource type="Script" path="res://cutout_preview.gd"');
  });

  it('Bone2D rest uses Transform2D format with correct position', () => {
    expect(files.scene).toContain('rest = Transform2D(1, 0, 0, 1, 24, 35)');
    expect(files.scene).toContain('rest = Transform2D(1, 0, 0, 1, 24, 22)');
    expect(files.scene).toContain('rest = Transform2D(1, 0, 0, 1, 24, 6)');
  });

  it('generates Skeleton2D with parent="."', () => {
    expect(files.scene).toContain('[node name="Skeleton2D" type="Skeleton2D" parent="."]');
  });

  it('generates Bone2D nodes with correct parent paths', () => {
    expect(files.scene).toContain('[node name="Bone_1" type="Bone2D" parent="Skeleton2D"]');
    expect(files.scene).toContain('[node name="Bone_2" type="Bone2D" parent="Skeleton2D/Bone_1"]');
    expect(files.scene).toContain('[node name="Bone_3" type="Bone2D" parent="Skeleton2D/Bone_2"]');
  });

  it('preview script contains limited-deformation sway', () => {
    expect(files.script).toContain('deg_to_rad(8.0)');
    expect(files.script).toContain('Bone2D');
  });

  it('project.godot has correct application name and features', () => {
    expect(files.projectGodot).toContain('config/name="test"');
    expect(files.projectGodot).toContain('config/features=PackedStringArray("4.2")');
  });

  it('is deterministic: same input produces same output', () => {
    const again = buildGodotCutoutFiles(input);
    expect(again.scene).toBe(files.scene);
    expect(again.script).toBe(files.script);
    expect(again.projectGodot).toBe(files.projectGodot);
  });

  it('no timestamps or uids in output', () => {
    expect(files.scene).not.toContain('uid=');
    expect(files.scene).not.toContain('timestamp');
  });
});

// --- V5.3 AnimationPlayer tracks ---

describe('AnimationPlayer generation (V5.3)', () => {
  it('generates idle animation at ±8° in radians with 2s loop', () => {
    const files = buildGodotCutoutFiles(input);
    expect(files.scene).toContain('[sub_resource type="Animation" id="Animation_idle"]');
    expect(files.scene).toContain('resource_name = "idle"');
    expect(files.scene).toContain('length = 2');
    expect(files.scene).toContain('loop_mode = 1');
    // ±8° = 0.13963 rad (5-decimal deterministic formatting)
    expect(files.scene).toContain('0.13963');
  });

  it('generates breathing animation at ±2° with 4s loop', () => {
    const files = buildGodotCutoutFiles(input);
    expect(files.scene).toContain('[sub_resource type="Animation" id="Animation_breathing"]');
    expect(files.scene).toContain('resource_name = "breathing"');
    expect(files.scene).toContain('length = 4');
    expect(files.scene).toContain('0.03491'); // ±2°
  });

  it('tracks target Bone2D rotation via NodePath', () => {
    const files = buildGodotCutoutFiles(input);
    expect(files.scene).toContain('tracks/0/type = "value"');
    expect(files.scene).toContain('tracks/0/path = NodePath("Skeleton2D")'); // root bone
    expect(files.scene).toContain('NodePath("Skeleton2D/Bone_2")');
  });

  it('generates AnimationLibrary with both animations and AnimationPlayer with autoplay', () => {
    const files = buildGodotCutoutFiles(input);
    expect(files.scene).toContain('[sub_resource type="AnimationLibrary" id="AnimationLibrary_1"]');
    expect(files.scene).toContain('"idle": SubResource("Animation_idle")');
    expect(files.scene).toContain('"breathing": SubResource("Animation_breathing")');
    expect(files.scene).toContain(
      '[node name="AnimationPlayer" type="AnimationPlayer" parent="."]',
    );
    expect(files.scene).toContain('autoplay = "idle"');
  });

  it('disabling animations falls back to the V4 shape', () => {
    const files = buildGodotCutoutFiles({ ...input, generateAnimations: false });
    expect(files.scene).not.toContain('AnimationPlayer');
    expect(files.scene).not.toContain('[sub_resource type="Animation"');
    // load_steps: 2 textures + 1 script + 1 scene = 4 (V4 formula)
    const match = files.scene.match(/load_steps=(\d+)/);
    expect(Number(match![1])).toBe(4);
  });

  it('animation output remains deterministic', () => {
    const a = buildGodotCutoutFiles(input);
    const b = buildGodotCutoutFiles(input);
    expect(a.scene).toBe(b.scene);
  });
});
