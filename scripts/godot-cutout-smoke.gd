extends SceneTree

const RESULT_PATH = "E:/WorkSpace/Game_Asset_Forge/temp/cutout-smoke-result.txt"

var frames = 0
var skeleton: Skeleton2D
var failures: Array[String] = []
var max_bones: int = 0
var bone_seen := false

func _initialize() -> void:
	print("CUTOUT_SMOKE_START")
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
	skeleton = node.get_node_or_null("Skeleton2D")
	if skeleton == null:
		failures.append("Skeleton2D node missing")
		_finish()
		return

func _tick() -> void:
	if not failures.is_empty():
		_finish()
		return
	frames += 1
	max_bones = maxi(max_bones, skeleton.get_bone_count())
	if not bone_seen:
		for child in skeleton.get_children():
			if child is Bone2D:
				bone_seen = true
	if frames >= 60:
		if not bone_seen:
			failures.append("no Bone2D children found")
		elif max_bones < 2:
			failures.append("Skeleton2D never registered 2 bones (max %d)" % max_bones)
		_finish()

func _finish() -> void:
	var verdict: String
	if failures.is_empty():
		verdict = "PASS bones=%d frames=%d" % [max_bones, frames]
		print("CUTOUT_SMOKE_PASS ", verdict)
	else:
		verdict = "FAIL " + "; ".join(failures)
		for failure in failures:
			printerr("CUTOUT_SMOKE_FAIL: ", failure)
	var file: FileAccess = FileAccess.open(RESULT_PATH, FileAccess.WRITE)
	if file != null:
		file.store_string(verdict)
		file.close()
	quit(0 if failures.is_empty() else 1)

