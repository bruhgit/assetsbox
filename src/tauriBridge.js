// Tauri compatibility bridge. The existing UI uses this stable surface; all privileged
// operations are handled by Rust commands rather than Node/Electron APIs.
(() => {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) {
    console.error('Assetsbox must be launched by the Tauri runtime.');
    return;
  }

  const invoke = tauri.core.invoke;
  const currentWindow = tauri.window?.getCurrentWindow?.();
  const errorMessage = (error, fallback = 'The desktop command failed.') => {
    if (typeof error === 'string' && error.trim()) return error;
    if (error?.message && typeof error.message === 'string') return error.message;
    if (error?.error && typeof error.error === 'string') return error.error;
    return fallback;
  };
  // Tauri command rejections can be plain strings. Normalize them once at the
  // boundary so the UI never renders "undefined" in an error notification.
  const invokeCommand = async (command, payload) => {
    try {
      return await invoke(command, payload);
    } catch (error) {
      throw new Error(errorMessage(error, `The ${command} command failed.`));
    }
  };
  const allowedStoreUrl = (listingUrl) => {
    try {
      const url = new URL(listingUrl);
      return url.protocol === 'https:' && (url.hostname === 'itch.io' || url.hostname.endsWith('.itch.io'));
    } catch {
      return false;
    }
  };

  window.electronAPI = {
    minimize: async () => {
      try {
        await invokeCommand('window_minimize');
      } catch {
        try {
          await currentWindow.minimize();
        } catch {}
      }
    },
    maximize: async () => {
      try {
        await invokeCommand('window_maximize');
      } catch {
        try {
          if (await currentWindow.isMaximized()) {
            await currentWindow.unmaximize();
          } else {
            await currentWindow.maximize();
          }
        } catch {}
      }
    },
    close: async () => {
      try {
        await invokeCommand('window_close');
      } catch {
        try {
          await currentWindow.close();
        } catch {
          window.close();
        }
      }
    },
    isMaximized: async () => {
      try {
        return await invokeCommand('window_is_maximized');
      } catch {
        try {
          return await currentWindow.isMaximized();
        } catch {
          return false;
        }
      }
    },
    onMaximizedChange: (callback) => {
      if (currentWindow?.onResized) {
        currentWindow.onResized(async () => {
          let max = false;
          try {
            max = await invokeCommand('window_is_maximized');
          } catch {
            try {
              max = await currentWindow.isMaximized();
            } catch {
              max = false;
            }
          }
          callback(max);
        });
      }
    },
    onOpenStore: () => {},
    onStoreViewOpened: () => {},
    onStoreViewClosed: () => {},

    selectDirectory: () => invokeCommand('select_directory'),
    scanAndSetupProject: (payload) => invokeCommand('scan_and_setup_project', payload),
    registerProjectRoot: (projectPath, engine) => invokeCommand('register_project_root', { projectPath, engine }),
    listProjectModels: (modelsDir) => invokeCommand('list_project_models', { modelsDir }),
    deleteProjectModel: (filePath) => invokeCommand('delete_project_model', { filePath }),
    importProjectModel: (targetDir) => invokeCommand('import_project_model', { targetDir }),
    importProjectModelPaths: (targetDir, sourcePaths) => invokeCommand('import_project_model_paths', { targetDir, sourcePaths }),
    installAssetsboxStore: (projectPath, engine) => invokeCommand('install_assetsbox_store', { projectPath, engine }),
    getAssetTargetDirectory: (payload) => invokeCommand('get_asset_target_directory', payload),
    openFolder: (folderPath) => invokeCommand('open_folder', { folderPath }),
    showItem: (filePath) => invokeCommand('show_item', { filePath }),
    getDefaultDirs: () => invokeCommand('get_default_dirs'),

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

    getSketchfabDownloadUrl: ({ modelUid }) => invokeCommand('get_sketchfab_download_url', { modelUid }),
    getSketchfabTokenStatus: () => invokeCommand('get_sketchfab_token_status'),
    setSketchfabToken: (value) => invokeCommand('set_sketchfab_token', { value }),
    recordLicenseAcceptance: (payload) => invokeCommand('record_license_acceptance', payload),
    searchItch2DAssets: (payload) => invokeCommand('search_itch_2d_assets', payload),
    searchPixabaySoundEffects: (payload) => invokeCommand('search_pixabay_sound_effects', payload),
    startDownload: (payload) => invokeCommand('start_download', payload),
    cancelDownload: (downloadId) => invokeCommand('cancel_download', { downloadId }),
    onDownloadProgress: (callback) => tauri.event.listen('download:progress', (event) => callback(event.payload)),
  };
})();
