extends SceneTree

const RESULT_PATH = "E:/WorkSpace/Game_Asset_Forge/temp/anim-smoke-result.txt"

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
	var file: FileAccess = FileAccess.open(RESULT_PATH, FileAccess.WRITE)
	if file != null:
		file.store_string(verdict)
		file.close()
	quit(0 if failures.is_empty() else 1)
