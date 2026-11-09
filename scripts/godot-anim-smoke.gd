extends SceneTree

# Result path is configurable — no machine-specific absolute path is baked in.
# Set GAF_SMOKE_RESULT to an absolute path, or accept the default file next to
# the Godot project. A result that cannot be written must fail loudly.
func _result_path() -> String:
	var path: String = OS.get_environment("GAF_SMOKE_RESULT")
	if path.is_empty():
		path = ProjectSettings.globalize_path("res://").path_join("anim-smoke-result.txt")
	return path

func _write_result(verdict: String) -> bool:
	var path: String = _result_path()
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("ANIM_SMOKE_FAIL: cannot write result to %s" % [path])
		return false
	file.store_string(verdict)
	file.close()
	return true

var frames = 0
var player: AnimationPlayer
var failures: Array[String] = []

func _initialize() -> void:
	print("ANIM_SMOKE_START")
	process_frame.connect(_tick)
	var packed: PackedScene = load("res://cutout.tscn")
	if packed == null:
		failures.append("cannot load res://cutout.tscn")
		_finish()
		return
	var node: Node = packed.instantiate()
	if node == null:
		failures.append("cannot instantiate cutout.tscn")
		_finish()
		return
	root.add_child(node)
	player = node.get_node_or_null("AnimationPlayer")
	if player == null:
		failures.append("AnimationPlayer node missing")
		_finish()
		return
	var names: PackedStringArray = player.get_animation_list()
	if not names.has("idle"):
		failures.append("idle animation missing (got %s)" % [names])
	if not names.has("breathing"):
		failures.append("breathing animation missing")

func _tick() -> void:
	if not failures.is_empty():
		_finish()
		return
	frames += 1
	if frames == 10:
		var pos: float = player.current_animation_position
		if pos <= 0.0:
			failures.append("idle animation position not advancing (autoplay off?)")
	if frames >= 40:
		_finish()

func _finish() -> void:
	var verdict: String
	if failures.is_empty():
		verdict = "PASS animations=%s playing=%s frames=%d" % [
			str(player.get_animation_list()), str(player.is_playing()), frames,
		]
		print("ANIM_SMOKE_PASS ", verdict)
	else:
		verdict = "FAIL " + "; ".join(failures)
		for failure in failures:
			printerr("ANIM_SMOKE_FAIL: ", failure)
	var ok: bool = _write_result(verdict)
	quit(0 if failures.is_empty() and ok else 1)
