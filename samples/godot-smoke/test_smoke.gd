extends SceneTree
# Godot runtime smoke test (charter §20, DoD [16]): loads res://main.tscn in
# the real engine, asserts the GameAsset Forge generated SpriteFrames
# resource loads, the animation plays, and frames advance.
#
# Run headless:
#   godot --headless --path samples/godot-smoke --script res://test_smoke.gd
# (add --import first if the .godot cache does not exist yet)
#
# Writes the verdict to a configurable path (stdout may be lost on quit()):
# set GAF_SMOKE_RESULT to an absolute path, or accept the default file next to
# the Godot project. A result that cannot be written must fail loudly.
# Notes (Godot 4.7):
# - SceneTree scripts do not receive the _process virtual — frame counting
#   uses the process_frame signal.
# - Headless script mode runs the loop uncapped (tiny deltas), so time-based
#   frame progression is accelerated via speed_scale instead of waiting.

func _result_path() -> String:
	var path: String = OS.get_environment("GAF_SMOKE_RESULT")
	if path.is_empty():
		path = ProjectSettings.globalize_path("res://").path_join("smoke-result.txt")
	return path

func _write_result(verdict: String) -> bool:
	var path: String = _result_path()
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("SMOKE_TEST_FAIL: cannot write result to %s" % [path])
		return false
	file.store_string(verdict)
	file.close()
	return true

var frames: int = 0
var sprite: AnimatedSprite2D
var frames_seen: Dictionary = {}
var delta_min: float = 9999999.0
var delta_max: float = -1.0
var failures: Array[String] = []

func _initialize() -> void:
	print("SMOKE_START")
	process_frame.connect(_tick)
	var packed: PackedScene = load("res://main.tscn")
	if packed == null:
		failures.append("cannot load res://main.tscn")
		_finish()
		return
	var node: Node = packed.instantiate()
	if node == null:
		failures.append("cannot instantiate main.tscn")
		_finish()
		return
	root.add_child(node)
	sprite = node as AnimatedSprite2D
	if sprite == null:
		failures.append("root node is not an AnimatedSprite2D")

func _tick() -> void:
	if not failures.is_empty():
		_finish()
		return
	frames += 1
	var delta: float = root.get_process_delta_time()
	delta_min = minf(delta_min, delta)
	delta_max = maxf(delta_max, delta)
	if frames == 10:
		sprite.speed_scale = 200.0
	if frames >= 10:
		frames_seen[sprite.frame] = true
	if frames >= 80:
		if sprite == null:
			failures.append("sprite missing after scene setup")
		else:
			if sprite.sprite_frames == null:
				failures.append("sprite_frames resource not loaded")
			else:
				var names: PackedStringArray = sprite.sprite_frames.get_animation_names()
				if not names.has("default"):
					failures.append("generated 'default' animation missing (got %s)" % [names])
				elif sprite.sprite_frames.get_frame_count("default") < 2:
					failures.append("'default' animation has fewer than 2 frames")
			if not sprite.is_playing():
				failures.append("animation is not playing (autoplay failed)")
			if frames_seen.size() < 2:
				failures.append(
					"frame never advanced across %d ticks (delta %f..%f, speed_scale 200)" % [
						frames, delta_min, delta_max,
					],
				)
		_finish()

func _finish() -> void:
	var verdict: String
	if failures.is_empty():
		verdict = "PASS ticks=%d frames_observed=%s playing=%s delta=[%f..%f]" % [
			frames, str(frames_seen.keys()), str(sprite.is_playing()), delta_min, delta_max,
		]
		print("SMOKE_TEST_PASS ", verdict)
	else:
		verdict = "FAIL " + "; ".join(failures)
		for failure in failures:
			printerr("SMOKE_TEST_FAIL: ", failure)
	var ok: bool = _write_result(verdict)
	quit(0 if failures.is_empty() and ok else 1)
