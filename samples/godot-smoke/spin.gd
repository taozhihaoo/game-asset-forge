extends AnimatedSprite2D
# Godot smoke test: the GameAsset Forge generated SpriteFrames resource
# should play automatically (autoplay = "default" in main.tscn).


func _ready() -> void:
	play("default")
