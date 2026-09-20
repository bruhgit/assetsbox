use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::MutexGuard;

use chrono::{DateTime, Local};
use futures_util::StreamExt;
use scraper::{Html, Selector};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use walkdir::WalkDir;

use crate::{license_ledger, secrets};
use crate::{ActiveDownloads, ManagedRoots};

const MODEL_EXTENSIONS: [&str; 11] = [
    "glb", "gltf", "fbx", "obj", "blend", "zip", "tscn", "dae", "stl", "ply", "3ds",
];
const EXTRACTABLE_MODEL_EXTENSIONS: [&str; 10] = [
    "glb", "gltf", "fbx", "obj", "blend", "tscn", "dae", "stl", "ply", "3ds",
];
const MAX_ZIP_ENTRIES: usize = 5_000;
const MAX_ZIP_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const SKETCHFAB_TOKEN_KEY: &str = "sketchfab_token";

#[derive(Serialize)]
pub struct BasicResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn result(success: bool, error: Option<String>) -> BasicResult {
    BasicResult { success, error }
}

fn is_supported_engine(engine: &str) -> bool {
    matches!(engine, "godot" | "unity" | "unreal" | "gamemaker")
}

fn is_model_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| MODEL_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_extractable_model(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            EXTRACTABLE_MODEL_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        })
        .unwrap_or(false)
}

fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|character| {
            if matches!(
                character,
                '/' | '\\' | '?' | '%' | '*' | ':' | '|' | '"' | '<' | '>'
            ) {
                '_'
            } else {
                character
            }
        })
        .collect();
    if sanitized.trim().is_empty() {
        "asset".to_string()
    } else {
        sanitized
    }
}

fn create_available_path(directory: &Path, filename: &str) -> PathBuf {
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("asset");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let mut candidate = directory.join(filename);
    let mut index = 1;
    while candidate.exists() {
        candidate = directory.join(format!("{stem} ({index}){extension}"));
        index += 1;
    }
    candidate
}

fn lock_roots(roots: &ManagedRoots) -> Result<MutexGuard<'_, HashSet<PathBuf>>, String> {
    roots
        .0
        .lock()
        .map_err(|_| "Could not access the managed project paths.".to_string())
}

fn register_root(roots: &State<ManagedRoots>, directory: &Path) -> Result<(), String> {
    let canonical = directory
        .canonicalize()
        .map_err(|error| format!("Could not resolve the project path: {error}"))?;
    lock_roots(roots)?.insert(canonical);
    Ok(())
}

fn is_inside(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn require_managed_directory(
    roots: &State<ManagedRoots>,
    directory: &Path,
) -> Result<PathBuf, String> {
    let canonical = directory
        .canonicalize()
        .map_err(|_| "The selected project folder is unavailable.".to_string())?;
    let is_managed = lock_roots(roots)?
        .iter()
        .any(|root| is_inside(&canonical, root));
    if !is_managed {
        return Err("This path is outside the selected Assetsbox project.".to_string());
    }
    Ok(canonical)
}

fn asset_directories(
    project_path: &Path,
    engine: &str,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    if !is_supported_engine(engine) {
        return Err("Please select a supported game engine first.".to_string());
    }
    let directories = match engine {
        "unity" => (
            project_path.join("Assets").join("Models"),
            project_path.join("Assets").join("2D"),
            project_path.join("Assets").join("Audio"),
        ),
        "unreal" => (
            project_path.join("Content").join("Models"),
            project_path.join("Content").join("2D"),
            project_path.join("Content").join("Audio"),
        ),
        _ => (
            project_path.join("Models"),
            project_path.join("Assets").join("2D"),
            project_path.join("Assets").join("Audio"),
        ),
    };
    Ok(directories)
}

fn ensure_asset_directories(
    project_path: &Path,
    engine: &str,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let directories = asset_directories(project_path, engine)?;
    for directory in [&directories.0, &directories.1, &directories.2] {
        fs::create_dir_all(directory)
            .map_err(|error| format!("Could not create asset directories: {error}"))?;
    }
    Ok(directories)
}

fn copy_directory_contents(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Could not create extension directory: {error}"))?;
    for entry in
        fs::read_dir(source).map_err(|error| format!("Could not read extension files: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read an extension entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory_contents(&source_path, &destination_path)?;
        } else if source_path.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("Could not copy an extension file: {error}"))?;
        }
    }
    Ok(())
}

fn find_project_file(project_path: &Path, extension: &str) -> Option<PathBuf> {
    fs::read_dir(project_path)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_ascii_lowercase().ends_with(extension))
                .unwrap_or(false)
        })
}

fn extension_source(app: &AppHandle, engine: &str) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .ok()
        .map(|directory| directory.join("extensions").join(engine));
    if let Some(path) = packaged.filter(|path| path.exists()) {
        return Ok(path);
    }
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("extensions")
        .join(engine);
    if development.exists() {
        Ok(development)
    } else {
        Err("Assetsbox Store extension files are missing.".to_string())
    }
}

fn enable_godot_plugin(project_path: &Path) -> Result<(), String> {
    let project_file = project_path.join("project.godot");
    let plugin_path = "res://addons/assetsbox_store/plugin.cfg";
    let mut config = fs::read_to_string(&project_file)
        .map_err(|_| "project.godot was not found.".to_string())?;
    if config.contains(plugin_path) {
        return Ok(());
    }
    if let Some(section_start) = config.find("[editor_plugins]") {
        let line_end = config[section_start..]
            .find('\n')
            .map(|offset| section_start + offset + 1)
            .unwrap_or(config.len());
        let section_end = config[line_end..]
            .find("\n[")
            .map(|offset| line_end + offset)
            .unwrap_or(config.len());
        let section = &config[line_end..section_end];
        if let Some(enabled_start) = section.find("enabled=PackedStringArray(") {
            let absolute_start = line_end + enabled_start;
            let closing = config[absolute_start..]
                .find(')')
                .ok_or_else(|| "The Godot editor_plugins configuration is invalid.".to_string())?
                + absolute_start;
            let values_start = absolute_start + "enabled=PackedStringArray(".len();
            let values = config[values_start..closing].trim();
            let separator = if values.is_empty() { "" } else { ", " };
            config.replace_range(
                values_start..closing,
                &format!("{values}{separator}\"{plugin_path}\""),
            );
        } else {
            config.insert_str(
                section_end,
                &format!("\nenabled=PackedStringArray(\"{plugin_path}\")\n"),
            );
        }
    } else {
        if !config.ends_with('\n') {
            config.push('\n');
        }
        config.push_str(&format!(
            "\n[editor_plugins]\nenabled=PackedStringArray(\"{plugin_path}\")\n"
        ));
    }
    fs::write(project_file, config)
        .map_err(|error| format!("Could not enable the Godot extension: {error}"))
}

fn enable_unreal_plugin(project_path: &Path) -> Result<(), String> {
    let project_file = find_project_file(project_path, ".uproject")
        .ok_or_else(|| "The .uproject file was not found.".to_string())?;
    let mut descriptor: Value = serde_json::from_slice(
        &fs::read(&project_file)
            .map_err(|error| format!("Could not read the .uproject file: {error}"))?,
    )
    .map_err(|error| format!("Could not parse the .uproject file: {error}"))?;
    let plugins = descriptor
        .as_object_mut()
        .ok_or_else(|| "The .uproject file is invalid.".to_string())?
        .entry("Plugins")
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| "The .uproject Plugins field is invalid.".to_string())?;
    if let Some(plugin) = plugins
        .iter_mut()
        .find(|plugin| plugin.get("Name").and_then(Value::as_str) == Some("AssetsboxStore"))
    {
        plugin["Enabled"] = Value::Bool(true);
    } else {
        plugins.push(json!({ "Name": "AssetsboxStore", "Enabled": true }));
    }
    fs::write(
        project_file,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&descriptor).map_err(|error| error.to_string())?
        ),
    )
    .map_err(|error| format!("Could not update the .uproject file: {error}"))
}

fn register_gamemaker_bridge(project_path: &Path) -> Result<(), String> {
    let project_file = find_project_file(project_path, ".yyp")
        .ok_or_else(|| "The .yyp project file was not found.".to_string())?;
    let mut project: Value = serde_json::from_slice(
        &fs::read(&project_file)
            .map_err(|error| format!("Could not read the .yyp project file: {error}"))?,
    )
    .map_err(|error| format!("Could not parse the .yyp project file: {error}"))?;
    let resources = project
        .as_object_mut()
        .ok_or_else(|| "The .yyp project file is invalid.".to_string())?
        .entry("resources")
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| "The .yyp resources field is invalid.".to_string())?;
    let bridge_path = "scripts/AssetsboxStore/AssetsboxStore.yy";
    let exists = resources
        .iter()
        .any(|resource| resource.pointer("/id/path").and_then(Value::as_str) == Some(bridge_path));
    if !exists {
        resources.push(json!({ "id": { "name": "AssetsboxStore", "path": bridge_path } }));
    }
    fs::write(
        project_file,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&project).map_err(|error| error.to_string())?
        ),
    )
    .map_err(|error| format!("Could not update the .yyp project file: {error}"))
}

fn install_extension(app: &AppHandle, project_path: &Path, engine: &str) -> Result<Value, String> {
    if !is_supported_engine(engine) {
        return Err("Unsupported engine.".to_string());
    }
    let source = extension_source(app, engine)?;
    copy_directory_contents(&source, project_path)?;
    match engine {
        "godot" => {
            enable_godot_plugin(project_path)?;
            Ok(
                json!({"success": true, "entryPoint": "the top workspace selector beside 2D, 3D, and Script", "requiresRestart": true, "message": "Assetsbox Store was added to the Godot workspace selector."}),
            )
        }
        "unity" => Ok(
            json!({"success": true, "entryPoint": "Window > Assetsbox Store", "requiresRestart": false, "message": "Assetsbox Store was added to the Unity Window menu."}),
        ),
        "unreal" => {
            enable_unreal_plugin(project_path)?;
            Ok(
                json!({"success": true, "entryPoint": "Window > Assetsbox Store", "requiresRestart": true, "message": "Assetsbox Store was installed and enabled for this Unreal project."}),
            )
        }
        "gamemaker" => {
            register_gamemaker_bridge(project_path)?;
            Ok(
                json!({"success": true, "entryPoint": "Asset Browser > Scripts > AssetsboxStore", "requiresRestart": true, "limitation": "GameMaker does not provide a public API for adding a custom IDE menu item.", "message": "Assetsbox Store bridge script was added to the GameMaker project."}),
            )
        }
        _ => unreachable!(),
    }
}

#[tauri::command]
pub fn select_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Select Game Engine Project Folder")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command(rename_all = "camelCase")]
pub fn scan_and_setup_project(
    app: AppHandle,
    roots: State<ManagedRoots>,
    folder_path: String,
    engine: String,
) -> Result<Value, String> {
    let project_path = PathBuf::from(&folder_path);
    if !project_path.is_dir() {
        return Ok(json!({ "success": false, "error": "Directory does not exist." }));
    }
    if !is_supported_engine(&engine) {
        return Ok(json!({ "success": false, "error": "Unsupported engine." }));
    }

    let directory_names: Vec<String> = fs::read_dir(&project_path)
        .map_err(|error| format!("Could not read the selected directory: {error}"))?
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    let has_name = |name: &str| {
        directory_names
            .iter()
            .any(|entry| entry.eq_ignore_ascii_case(name))
    };
    let godot = project_path.join("project.godot").exists()
        || project_path.join(".godot").exists()
        || has_name("project.godot")
        || has_name(".godot");
    let unity =
        project_path.join("Assets").exists() || project_path.join("ProjectSettings").exists();
    let unreal = project_path.join("Content").exists()
        || directory_names
            .iter()
            .any(|name| name.to_ascii_lowercase().ends_with(".uproject"));
    let gamemaker = directory_names
        .iter()
        .any(|name| name.to_ascii_lowercase().ends_with(".yyp"));
    let detected = if godot {
        Some("Godot")
    } else if unity {
        Some("Unity")
    } else if unreal {
        Some("Unreal Engine")
    } else if gamemaker {
        Some("GameMaker")
    } else {
        None
    };
    let expected = match engine.as_str() {
        "godot" => godot,
        "unity" => unity,
        "unreal" => unreal,
        "gamemaker" => gamemaker,
        _ => false,
    };
    if !expected {
        let hint = detected
            .map(|actual| format!("Bu klasör bir {actual} projesine benziyor."))
            .unwrap_or_else(|| "Seçilen motorun proje dosyaları bulunamadı.".to_string());
        return Ok(json!({ "success": false, "error": format!("Geçersiz proje! {hint}") }));
    }

    let asset_directories = ensure_asset_directories(&project_path, &engine)?;
    register_root(&roots, &project_path)?;
    let integration = install_extension(&app, &project_path, &engine);
    let (integration_value, integration_message) = match integration {
        Ok(value) => {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            (value, message)
        }
        Err(error) => (
            json!({ "success": false, "error": error }),
            "Models folder is ready, but Assetsbox Store could not be installed.".to_string(),
        ),
    };
    let engine_message = match engine.as_str() {
        "godot" => "Godot projesi doğrulandı (project.godot / .godot tespit edildi).",
        "unity" => "Unity projesi doğrulandı (Assets klasörü tespit edildi).",
        "unreal" => "Unreal Engine projesi doğrulandı (.uproject / Content tespit edildi).",
        "gamemaker" => "GameMaker projesi doğrulandı (.yyp tespit edildi).",
        _ => "Project verified.",
    };
    Ok(json!({
        "success": true,
        "isMatchingEngine": true,
        "detectedType": engine,
        "projectPath": project_path,
        "modelsPath": asset_directories.0,
        "assetDirectories": { "model": asset_directories.0, "image": asset_directories.1, "sound": asset_directories.2 },
        "message": format!("{engine_message} {integration_message}"),
        "integration": integration_value,
    }))
}

#[tauri::command(rename_all = "camelCase")]
pub fn register_project_root(
    roots: State<ManagedRoots>,
    project_path: String,
    engine: String,
) -> Result<BasicResult, String> {
    let project_path = PathBuf::from(project_path);
    if !project_path.is_dir() || !is_supported_engine(&engine) {
        return Ok(result(
            false,
            Some("A valid project and supported engine are required.".to_string()),
        ));
    }

    // This command restores a project selected in a previous app session. It
    // deliberately does not create directories or access arbitrary files.
    register_root(&roots, &project_path)?;
    Ok(result(true, None))
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_asset_target_directory(
    roots: State<ManagedRoots>,
    project_path: String,
    engine: String,
    asset_kind: String,
) -> Result<Value, String> {
    let project_path = PathBuf::from(project_path);
    if !project_path.is_dir() || !is_supported_engine(&engine) {
        return Ok(
            json!({ "success": false, "error": "Please select a valid project folder and engine first." }),
        );
    }
    let directories = ensure_asset_directories(&project_path, &engine)?;
    register_root(&roots, &project_path)?;
    let path = match asset_kind.as_str() {
        "model" => directories.0,
        "image" => directories.1,
        "sound" => directories.2,
        _ => return Ok(json!({ "success": false, "error": "Unsupported asset type." })),
    };
    Ok(json!({ "success": true, "path": path }))
}

#[tauri::command(rename_all = "camelCase")]
pub fn install_assetsbox_store(
    app: AppHandle,
    roots: State<ManagedRoots>,
    project_path: String,
    engine: String,
) -> Result<Value, String> {
    let project_path = PathBuf::from(project_path);
    if !project_path.is_dir() {
        return Ok(json!({ "success": false, "error": "A valid project folder is required." }));
    }
    register_root(&roots, &project_path)?;
    match install_extension(&app, &project_path, &engine) {
        Ok(value) => Ok(value),
        Err(error) => Ok(json!({ "success": false, "error": error })),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_default_dirs(app: AppHandle) -> Result<Value, String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|error| format!("Could not find the Downloads directory: {error}"))?
        .join("3D_Marketplace_Models");
    fs::create_dir_all(&downloads)
        .map_err(|error| format!("Could not create the default download directory: {error}"))?;
    Ok(
        json!({ "downloads": downloads, "appPath": app.path().app_data_dir().map_err(|error| error.to_string())? }),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn open_folder(roots: State<ManagedRoots>, folder_path: String) -> Result<bool, String> {
    let path = require_managed_directory(&roots, Path::new(&folder_path))?;
    open_in_explorer(&path, false)?;
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn show_item(roots: State<ManagedRoots>, file_path: String) -> Result<bool, String> {
    let path = PathBuf::from(file_path);
    if !path.is_file() || !is_model_file(&path) {
        return Ok(false);
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve the model path: {error}"))?;
    let is_managed = lock_roots(&roots)?
        .iter()
        .any(|root| is_inside(&canonical, root));
    if !is_managed {
        return Err("This file is outside the selected Assetsbox project.".to_string());
    }
    open_in_explorer(&canonical, true)?;
    Ok(true)
}

fn open_in_explorer(path: &Path, select_file: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = std::process::Command::new("explorer.exe");
        if select_file {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(path);
        }
        command
            .spawn()
            .map_err(|error| format!("Could not open File Explorer: {error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (path, select_file);
        Err("Opening folders is currently supported on Windows builds only.".to_string())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_project_models(
    roots: State<ManagedRoots>,
    models_dir: String,
) -> Result<Vec<Value>, String> {
    let directory = require_managed_directory(&roots, Path::new(&models_dir))?;
    let mut models = Vec::new();
    for entry in WalkDir::new(&directory)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !path.is_file() || !is_model_file(path) {
            continue;
        }
        let metadata = fs::metadata(path)
            .map_err(|error| format!("Could not read a project model: {error}"))?;
        let relative = path
            .strip_prefix(&directory)
            .map_err(|_| "Could not resolve a project model path.".to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .map(|time| DateTime::<Local>::from(time).format("%x %H:%M").to_string())
            .unwrap_or_default();
        models.push(json!({
            "name": relative.to_string_lossy().replace('\\', "/"),
            "relativePath": relative.to_string_lossy().replace('\\', "/"),
            "ext": path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_uppercase(),
            "fullPath": path,
            "sizeBytes": metadata.len(),
            "modifiedAt": modified,
        }));
    }
    models.sort_by(|left, right| left["name"].as_str().cmp(&right["name"].as_str()));
    Ok(models)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_project_model(
    roots: State<ManagedRoots>,
    file_path: String,
) -> Result<BasicResult, String> {
    let path = PathBuf::from(file_path);
    if !path.is_file() || !is_model_file(&path) {
        return Ok(result(
            false,
            Some("File not found or unsupported.".to_string()),
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve the model path: {error}"))?;
    let is_managed = lock_roots(&roots)?
        .iter()
        .any(|root| is_inside(&canonical, root));
    if !is_managed {
        return Err("This file is outside the selected Assetsbox project.".to_string());
    }
    fs::remove_file(canonical).map_err(|error| format!("Could not delete the model: {error}"))?;
    Ok(result(true, None))
}

fn import_files(target_directory: &Path, source_paths: &[PathBuf]) -> Result<Value, String> {
    if !target_directory.is_dir() {
        return Ok(
            json!({ "success": false, "error": "The project Models folder is unavailable." }),
        );
    }
    let target_canonical = target_directory
        .canonicalize()
        .map_err(|error| format!("Could not resolve the Models folder: {error}"))?;
    let mut imported = 0;
    let mut skipped = 0;
    let mut renamed = 0;
    for source in source_paths {
        let source_canonical = match source.canonicalize() {
            Ok(path) => path,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if !source_canonical.is_file()
            || !is_model_file(&source_canonical)
            || source_canonical.parent() == Some(target_canonical.as_path())
        {
            skipped += 1;
            continue;
        }
        let filename = match source_canonical
            .file_name()
            .and_then(|value| value.to_str())
        {
            Some(value) => value,
            None => {
                skipped += 1;
                continue;
            }
        };
        let destination = create_available_path(&target_canonical, filename);
        if destination.file_name() != source_canonical.file_name() {
            renamed += 1;
        }
        match fs::copy(&source_canonical, &destination) {
            Ok(_) => imported += 1,
            Err(_) => skipped += 1,
        }
    }
    if imported == 0 {
        return Ok(
            json!({ "success": false, "error": if skipped > 0 { "No supported model files could be imported." } else { "No model files were selected." }, "skippedCount": skipped }),
        );
    }
    Ok(
        json!({ "success": true, "count": imported, "renamedCount": renamed, "skippedCount": skipped }),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn import_project_model(
    roots: State<ManagedRoots>,
    target_dir: String,
) -> Result<Value, String> {
    let directory = require_managed_directory(&roots, Path::new(&target_dir))?;
    let files = rfd::FileDialog::new()
        .set_title("Import 3D Model into Project Models Folder")
        .add_filter("3D Models", &MODEL_EXTENSIONS)
        .pick_files();
    match files {
        Some(files) if !files.is_empty() => import_files(&directory, &files),
        _ => Ok(json!({ "success": false, "canceled": true })),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn import_project_model_paths(
    roots: State<ManagedRoots>,
    target_dir: String,
    source_paths: Vec<String>,
) -> Result<Value, String> {
    let directory = require_managed_directory(&roots, Path::new(&target_dir))?;
    import_files(
        &directory,
        &source_paths
            .into_iter()
            .map(PathBuf::from)
            .collect::<Vec<_>>(),
    )
}

fn extract_zip(archive_path: &Path, target_directory: &Path) -> Result<(PathBuf, usize), String> {
    let archive_name = archive_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Asset");
    let extraction_root = target_directory.join("Assetsbox_Extracted");
    fs::create_dir_all(&extraction_root)
        .map_err(|error| format!("Could not create the extraction directory: {error}"))?;
    let extraction_directory = create_available_path(&extraction_root, archive_name);
    fs::create_dir_all(&extraction_directory)
        .map_err(|error| format!("Could not create the extraction directory: {error}"))?;
    let archive_file = fs::File::open(archive_path)
        .map_err(|error| format!("Could not open ZIP archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|error| format!("Could not read ZIP archive: {error}"))?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err("ZIP archive exceeds the safe extraction entry limit.".to_string());
    }
    let mut total_uncompressed = 0_u64;
    let mut extracted_models = 0_usize;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not read ZIP entry: {error}"))?;
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_ZIP_UNCOMPRESSED_BYTES {
            return Err("ZIP archive exceeds the safe extraction size limit.".to_string());
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "ZIP archive contains an unsafe file path.".to_string())?
            .to_owned();
        if enclosed.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err("ZIP archive contains an unsafe file path.".to_string());
        }
        let destination = extraction_directory.join(&enclosed);
        if !destination.starts_with(&extraction_directory) {
            return Err("ZIP archive attempted to write outside the Models folder.".to_string());
        }
        if entry.is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|error| format!("Could not extract ZIP directory: {error}"))?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create ZIP output directory: {error}"))?;
        }
        let mut output = fs::File::create(&destination)
            .map_err(|error| format!("Could not write ZIP entry: {error}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Could not extract ZIP entry: {error}"))?;
        if is_extractable_model(&destination) {
            extracted_models += 1;
        }
    }
    Ok((extraction_directory, extracted_models))
}

fn text_from_element(element: scraper::ElementRef<'_>) -> String {
    element
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command(rename_all = "camelCase")]
pub async fn search_itch_2d_assets(query: String, limit: Option<usize>) -> Result<Value, String> {
    let response = reqwest::Client::builder()
        .user_agent("Assetsbox Desktop/1.0 (+https://github.com/bruhgit/assetsbox)")
        .build()
        .map_err(|error| format!("Could not initialize the itch.io client: {error}"))?
        .get("https://itch.io/game-assets/tag-2d")
        .send()
        .await
        .map_err(|error| format!("Could not reach itch.io: {error}"))?
        .error_for_status()
        .map_err(|error| format!("itch.io returned an error: {error}"))?;
    let html = response
        .text()
        .await
        .map_err(|error| format!("Could not read the itch.io catalog: {error}"))?;
    let document = Html::parse_document(&html);
    let card_selector =
        Selector::parse(".game_cell").map_err(|_| "Could not parse itch.io cards.".to_string())?;
    let title_selector = Selector::parse(".game_title a")
        .map_err(|_| "Could not parse itch.io titles.".to_string())?;
    let author_selector = Selector::parse(".game_author a")
        .map_err(|_| "Could not parse itch.io authors.".to_string())?;
    let description_selector = Selector::parse(".game_text")
        .map_err(|_| "Could not parse itch.io descriptions.".to_string())?;
    let image_selector =
        Selector::parse("img").map_err(|_| "Could not parse itch.io images.".to_string())?;
    let price_selector = Selector::parse(".price_tag, .price_value")
        .map_err(|_| "Could not parse itch.io prices.".to_string())?;
    let query_terms: Vec<String> = query
        .to_ascii_lowercase()
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect();
    let max_items = limit.unwrap_or(30).clamp(1, 60);
    let mut assets = Vec::new();
    for card in document.select(&card_selector) {
        let Some(title) = card.select(&title_selector).next() else {
            continue;
        };
        let Some(url) = title.value().attr("href") else {
            continue;
        };
        if !url.contains(".itch.io/") {
            continue;
        }
        let name = text_from_element(title);
        let author = card
            .select(&author_selector)
            .next()
            .map(text_from_element)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "itch.io creator".to_string());
        let description = card
            .select(&description_selector)
            .next()
            .map(text_from_element)
            .unwrap_or_default();
        let searchable = format!("{name} {author} {description}").to_ascii_lowercase();
        if !query_terms.iter().all(|term| searchable.contains(term)) {
            continue;
        }
        let thumbnail = card
            .select(&image_selector)
            .next()
            .and_then(|image| {
                image
                    .value()
                    .attr("data-lazy_src")
                    .or_else(|| image.value().attr("data-src"))
                    .or_else(|| image.value().attr("src"))
            })
            .unwrap_or_default();
        let price = card
            .select(&price_selector)
            .next()
            .map(text_from_element)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "See itch.io".to_string());
        assets.push(json!({
            "id": format!("itchio:{url}"),
            "name": name,
            "author": author,
            "description": description,
            "thumbnail": thumbnail,
            "price": price,
            "format": "itch.io listing",
            "tags": ["2D", "itch.io"],
            "source": "itchio",
            "sourceUrl": url,
        }));
        if assets.len() >= max_items {
            break;
        }
    }
    Ok(json!({ "success": true, "assets": assets }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn search_pixabay_sound_effects(
    _query: String,
    _limit: Option<usize>,
) -> Result<Value, String> {
    // Pixabay's public API currently does not expose audio search. The Electron implementation used an
    // off-screen webview for this; Tauri intentionally does not scrape around Cloudflare protections.
    Ok(
        json!({ "success": false, "error": "Pixabay sound effects are temporarily unavailable in the Tauri build." }),
    )
}

#[tauri::command]
pub fn get_sketchfab_token_status(app: AppHandle) -> Result<Value, String> {
    Ok(json!({ "configured": secrets::has(&app, SKETCHFAB_TOKEN_KEY)? }))
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_sketchfab_token(app: AppHandle, value: String) -> Result<Value, String> {
    let token = value.trim();
    if token.is_empty() {
        secrets::remove(&app, SKETCHFAB_TOKEN_KEY)?;
        return Ok(json!({ "success": true, "configured": false }));
    }
    if token.len() > 4_096 {
        return Err("The API token is too long.".to_string());
    }
    secrets::set(&app, SKETCHFAB_TOKEN_KEY, token)?;
    Ok(json!({ "success": true, "configured": true }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_sketchfab_download_url(
    app: AppHandle,
    model_uid: String,
) -> Result<Value, String> {
    let token = secrets::get(&app, SKETCHFAB_TOKEN_KEY)?
        .ok_or_else(|| "Sketchfab API Token is required.".to_string())?;
    if model_uid.trim().is_empty() {
        return Err("Model UID is required.".to_string());
    }
    let endpoint = format!(
        "https://api.sketchfab.com/v3/models/{}/download",
        urlencoding::encode(model_uid.trim())
    );
    let response = reqwest::Client::builder()
        .user_agent("Assetsbox/1.0")
        .build()
        .map_err(|error| format!("Could not initialize Sketchfab client: {error}"))?
        .get(endpoint)
        .header(reqwest::header::AUTHORIZATION, format!("Token {token}"))
        .send()
        .await
        .map_err(|error| format!("Could not reach Sketchfab: {error}"))?;
    let status = response.status();
    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Sketchfab returned an invalid response: {error}"))?;
    if !status.is_success() {
        return Err(payload
            .get("detail")
            .or_else(|| payload.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Sketchfab download request failed.")
            .to_string());
    }
    Ok(payload)
}

#[tauri::command(rename_all = "camelCase")]
pub fn record_license_acceptance(
    app: AppHandle,
    asset_id: String,
    source: String,
    license: String,
    listing_url: String,
) -> Result<Value, String> {
    let acceptance = license_ledger::record(&app, &asset_id, &source, &license, &listing_url)?;
    Ok(json!({
        "success": true,
        "acceptanceId": acceptance.id,
        "acceptedAt": acceptance.accepted_at.to_rfc3339(),
    }))
}

fn emit_download(app: &AppHandle, payload: Value) {
    let _ = app.emit("download:progress", payload);
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_download(
    app: AppHandle,
    roots: State<'_, ManagedRoots>,
    downloads: State<'_, ActiveDownloads>,
    id: String,
    url: String,
    filename: String,
    target_directory: String,
    license_acceptance_id: String,
    asset_id: String,
) -> Result<Value, String> {
    license_ledger::consume(&app, &license_acceptance_id, &asset_id)?;
    let destination_directory = require_managed_directory(&roots, Path::new(&target_directory))?;
    let parsed_url =
        reqwest::Url::parse(&url).map_err(|_| "The asset download URL is invalid.".to_string())?;
    if parsed_url.scheme() != "https" {
        return Err("Only HTTPS asset downloads are supported.".to_string());
    }
    let safe_filename = sanitize_filename(&filename);
    let destination_path = create_available_path(&destination_directory, &safe_filename);
    let cancellation = CancellationToken::new();
    downloads
        .0
        .lock()
        .map_err(|_| "Could not register the download.".to_string())?
        .insert(id.clone(), cancellation.clone());
    let app_handle = app.clone();
    let registry = downloads.0.clone();
    let task_destination_path = destination_path.clone();
    tokio::spawn(async move {
        let download_result = async {
            let response = reqwest::Client::builder()
                .user_agent("Assetsbox/1.0")
                .build().map_err(|error| format!("Could not initialize the downloader: {error}"))?
                .get(parsed_url).send().await.map_err(|error| format!("Could not start the download: {error}"))?
                .error_for_status().map_err(|error| format!("Asset server returned an error: {error}"))?;
            let total_bytes = response.content_length().unwrap_or(0);
            let mut stream = response.bytes_stream();
            let mut output = tokio::fs::File::create(&task_destination_path).await.map_err(|error| format!("Could not create the asset file: {error}"))?;
            let mut received_bytes = 0_u64;
            let started = std::time::Instant::now();
            while let Some(chunk) = stream.next().await {
                if cancellation.is_cancelled() { return Err("Download canceled.".to_string()); }
                let chunk = chunk.map_err(|error| format!("Download interrupted: {error}"))?;
                output.write_all(&chunk).await.map_err(|error| format!("Could not write the asset file: {error}"))?;
                received_bytes += chunk.len() as u64;
                let elapsed = started.elapsed().as_secs_f64().max(0.001);
                let percent = if total_bytes > 0 { ((received_bytes * 100) / total_bytes).min(100) } else { 0 };
                emit_download(&app_handle, json!({
                    "id": id,
                    "receivedBytes": received_bytes,
                    "totalBytes": total_bytes,
                    "percent": percent,
                    "speedBps": (received_bytes as f64 / elapsed) as u64,
                    "status": "downloading",
                    "destPath": task_destination_path,
                }));
            }
            output.flush().await.map_err(|error| format!("Could not finalize the asset file: {error}"))?;
            let mut extraction_directory = String::new();
            let mut extracted_model_count = 0_usize;
            let mut extraction_error = String::new();
            if task_destination_path.extension().and_then(|extension| extension.to_str()).map(|extension| extension.eq_ignore_ascii_case("zip")).unwrap_or(false) {
                emit_download(&app_handle, json!({ "id": id, "status": "extracting", "percent": 100, "message": "Extracting ZIP archive into Models...", "destPath": task_destination_path }));
                let archive_path = task_destination_path.clone();
                let model_directory = destination_directory.clone();
                match tokio::task::spawn_blocking(move || extract_zip(&archive_path, &model_directory)).await {
                    Ok(Ok((directory, count))) => { extraction_directory = directory.to_string_lossy().to_string(); extracted_model_count = count; }
                    Ok(Err(error)) => extraction_error = error,
                    Err(error) => extraction_error = format!("ZIP extraction task failed: {error}"),
                }
            }
            let size = fs::metadata(&task_destination_path).map(|metadata| metadata.len()).unwrap_or(received_bytes);
            emit_download(&app_handle, json!({
                "id": id,
                "receivedBytes": size,
                "totalBytes": size,
                "percent": 100,
                "speedBps": 0,
                "status": "completed",
                "destPath": task_destination_path,
                "extractionDirectory": extraction_directory,
                "extractedModelCount": extracted_model_count,
                "extractionError": extraction_error,
            }));
            Ok::<(), String>(())
        }.await;
        if let Err(error) = download_result {
            let _ = tokio::fs::remove_file(&task_destination_path).await;
            emit_download(
                &app_handle,
                json!({ "id": id, "status": "error", "error": error }),
            );
        }
        if let Ok(mut active) = registry.lock() {
            active.remove(&id);
        }
    });
    Ok(json!({ "success": true, "destPath": destination_path }))
}

#[tauri::command(rename_all = "camelCase")]
pub fn cancel_download(
    downloads: State<ActiveDownloads>,
    download_id: String,
) -> Result<bool, String> {
    let cancellation = downloads
        .0
        .lock()
        .map_err(|_| "Could not access active downloads.".to_string())?
        .remove(&download_id);
    if let Some(cancellation) = cancellation {
        cancellation.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_maximize(window: tauri::Window) -> Result<(), String> {
    let is_max = window.is_maximized().map_err(|e| e.to_string())?;
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn window_is_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}
