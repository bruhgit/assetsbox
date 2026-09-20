// Tauri compatibility bridge. The existing UI uses this stable surface; all privileged
// operations are handled by Rust commands rather than Node/Electron APIs.
(() => {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) {
    console.error('Assetsbox must be launched by the Tauri runtime.');
    return;
  }

  const invoke = tauri.core.invoke;
  const currentWindow = tauri.window.getCurrentWindow();
  const allowedStoreUrl = (listingUrl) => {
    try {
      const url = new URL(listingUrl);
      return url.protocol === 'https:' && (url.hostname === 'itch.io' || url.hostname.endsWith('.itch.io'));
    } catch {
      return false;
    }
  };

  window.electronAPI = {
    minimize: () => currentWindow.minimize(),
    maximize: async () => (await currentWindow.isMaximized() ? currentWindow.unmaximize() : currentWindow.maximize()),
    close: () => currentWindow.close(),
    isMaximized: () => currentWindow.isMaximized(),
    onMaximizedChange: (callback) => currentWindow.onResized(async () => callback(await currentWindow.isMaximized())),
    onOpenStore: () => {},
    onStoreViewOpened: () => {},
    onStoreViewClosed: () => {},

    selectDirectory: () => invoke('select_directory'),
    scanAndSetupProject: (payload) => invoke('scan_and_setup_project', payload),
    registerProjectRoot: (projectPath, engine) => invoke('register_project_root', { projectPath, engine }),
    listProjectModels: (modelsDir) => invoke('list_project_models', { modelsDir }),
    deleteProjectModel: (filePath) => invoke('delete_project_model', { filePath }),
    importProjectModel: (targetDir) => invoke('import_project_model', { targetDir }),
    importProjectModelPaths: (targetDir, sourcePaths) => invoke('import_project_model_paths', { targetDir, sourcePaths }),
    installAssetsboxStore: (projectPath, engine) => invoke('install_assetsbox_store', { projectPath, engine }),
    getAssetTargetDirectory: (payload) => invoke('get_asset_target_directory', payload),
    openFolder: (folderPath) => invoke('open_folder', { folderPath }),
    showItem: (filePath) => invoke('show_item', { filePath }),
    getDefaultDirs: () => invoke('get_default_dirs'),

    openStorePage: async ({ listingUrl }) => {
      if (!allowedStoreUrl(listingUrl)) return { success: false, error: 'Only supported store pages can be opened here.' };
      try {
        new tauri.webviewWindow.WebviewWindow('itch-store', {
          url: listingUrl,
          title: 'Assetsbox Store',
          width: 1180,
          height: 760,
          minWidth: 640,
          minHeight: 480,
        });
        return { success: true };
      } catch {
        return { success: false, error: 'Could not open the store page.' };
      }
    },
    closeStorePage: async () => {
      const storeWindow = await tauri.webviewWindow.getByLabel('itch-store');
      if (storeWindow) await storeWindow.close();
      return { success: true };
    },

    getSketchfabDownloadUrl: ({ modelUid }) => invoke('get_sketchfab_download_url', { modelUid }),
    getSketchfabTokenStatus: () => invoke('get_sketchfab_token_status'),
    setSketchfabToken: (value) => invoke('set_sketchfab_token', { value }),
    recordLicenseAcceptance: (payload) => invoke('record_license_acceptance', payload),
    searchItch2DAssets: (payload) => invoke('search_itch_2d_assets', payload),
    searchPixabaySoundEffects: (payload) => invoke('search_pixabay_sound_effects', payload),
    startDownload: (payload) => invoke('start_download', payload),
    cancelDownload: (downloadId) => invoke('cancel_download', { downloadId }),
    onDownloadProgress: (callback) => tauri.event.listen('download:progress', (event) => callback(event.payload)),
  };
})();
