@tool
extends EditorPlugin

const STORE_URI := "assetsbox://store"

var main_panel: VBoxContainer


func _enter_tree() -> void:
    main_panel = VBoxContainer.new()
    main_panel.name = "AssetsboxStore"
    main_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    main_panel.alignment = BoxContainer.ALIGNMENT_CENTER

    var title := Label.new()
    title.text = "Assetsbox Store"
    title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    title.add_theme_font_size_override("font_size", 28)
    main_panel.add_child(title)

    var description := Label.new()
    description.text = "Browse and manage 3D assets in the Assetsbox desktop app."
    description.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    description.add_theme_font_size_override("font_size", 16)
    main_panel.add_child(description)

    var open_button := Button.new()
    open_button.text = "Open Assetsbox Store"
    open_button.custom_minimum_size = Vector2(220, 42)
    open_button.pressed.connect(_open_assetsbox_store)
    main_panel.add_child(open_button)

    get_editor_interface().get_editor_main_screen().add_child(main_panel)
    _make_visible(false)


func _exit_tree() -> void:
    if main_panel:
        main_panel.queue_free()


func _has_main_screen() -> bool:
    return true


func _make_visible(visible: bool) -> void:
    if main_panel:
        main_panel.visible = visible


func _get_plugin_name() -> String:
    return "Assetsbox Store"


func _get_plugin_icon() -> Texture2D:
    return get_editor_interface().get_editor_theme().get_icon("AssetLib", "EditorIcons")


func _open_assetsbox_store() -> void:
    OS.shell_open(STORE_URI)
