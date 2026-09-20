mod commands;
mod secrets;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::Manager;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct ManagedRoots(pub Mutex<HashSet<PathBuf>>);

#[derive(Default)]
pub struct ActiveDownloads(pub Arc<Mutex<HashMap<String, CancellationToken>>>);

pub fn run() {
    tauri::Builder::default()
        .manage(ManagedRoots::default())
        .manage(ActiveDownloads::default())
        .setup(|app| {
            let app_data = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(app_data)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::select_directory,
            commands::scan_and_setup_project,
            commands::register_project_root,
            commands::get_asset_target_directory,
            commands::install_assetsbox_store,
            commands::open_folder,
            commands::show_item,
            commands::get_default_dirs,
            commands::list_project_models,
            commands::delete_project_model,
            commands::import_project_model,
            commands::import_project_model_paths,
            commands::search_itch_2d_assets,
            commands::search_pixabay_sound_effects,
            commands::get_sketchfab_download_url,
            commands::start_download,
            commands::cancel_download,
            commands::get_sketchfab_token_status,
            commands::set_sketchfab_token,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Assetsbox");
}
