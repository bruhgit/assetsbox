// ============================================================================
// Application Entry Point & Orchestrator (ES Module)
// ============================================================================

import {
  state,
  engineMeta,
  setEngine,
  saveUserProfile,
  saveProjectPaths,
  markSetupCompleted,
  updateDirDisplays,
} from './modules/state.js';
import { showToast } from './modules/toast.js';
import { initAccountModule, bindAvatarCircleUploader, updateAccountWidget } from './modules/account.js';
import {
  initTabsModule,
  switchTab,
  openModelTab,
  closeModelTab,
  setOnTabChanged,
} from './modules/tabs.js';
import { initEngineSelectorModule } from './modules/engineSelector.js';
import { initMarketplaceModule, loadActiveStore, setActiveMarketplaceStore } from './modules/marketplace.js';
import { initInspectorModule, displayModelInInspector } from './modules/inspector.js';
import { initProjectManagerModule, loadProjectModels } from './modules/projectManager.js';
import { initDownloadsModule, initiateDownload, renderDownloadsLibrary } from './modules/downloads.js';
import { initLicenseCompliance } from './modules/licenseCompliance.js';

let storeOpenRequested = false;
let storeNavigationReady = false;
let lastWorkspaceEngine = null;

function openAssetsboxStoreFromLink() {
  if (!storeNavigationReady) {
    storeOpenRequested = true;
    return;
  }

  document.getElementById('tab-marketplace-header')?.classList.remove('hidden');
  document.getElementById('btn-add-tab')?.classList.remove('hidden');
  enterWorkspace();
  showToast('Opened from an engine integration.', 'info', 2200);
}

async function openStoreListing(asset) {
  const result = await window.electronAPI?.openStorePage({
    listingUrl: asset?.sourceUrl,
  });
  if (!result?.success) {
    showToast(result?.error || 'Could not open the store page.', 'error');
  }
}

const btnReturnStorePage = document.getElementById('btn-return-store-page');
btnReturnStorePage?.addEventListener('click', () => window.electronAPI?.closeStorePage());
window.electronAPI?.onStoreViewOpened(() => btnReturnStorePage?.classList.remove('hidden'));
window.electronAPI?.onStoreViewClosed(() => btnReturnStorePage?.classList.add('hidden'));

window.electronAPI?.onOpenStore(openAssetsboxStoreFromLink);

// ============================================================================
// Window Controls & Window State
// ============================================================================
const btnMin = document.getElementById('btn-min');
const btnMax = document.getElementById('btn-max');
const btnClose = document.getElementById('btn-close');
const iconMaximize = document.getElementById('icon-maximize');
const iconRestore = document.getElementById('icon-restore');

if (window.electronAPI) {
  btnMin?.addEventListener('click', () => window.electronAPI.minimize());
  btnMax?.addEventListener('click', () => window.electronAPI.maximize());
  btnClose?.addEventListener('click', () => window.electronAPI.close());

  function updateMaximizeIcons(isMaximized) {
    if (isMaximized) {
      iconMaximize?.classList.add('hidden');
      iconRestore?.classList.remove('hidden');
      btnMax?.setAttribute('title', 'Restore');
    } else {
      iconMaximize?.classList.remove('hidden');
      iconRestore?.classList.add('hidden');
      btnMax?.setAttribute('title', 'Maximize');
    }
  }

  window.electronAPI.onMaximizedChange(updateMaximizeIcons);
  window.electronAPI.isMaximized().then(updateMaximizeIcons);

  const savedDir = localStorage.getItem('download_directory');
  if (savedDir) {
    state.downloadDir = savedDir;
    updateDirDisplays(savedDir);
  } else {
    window.electronAPI.getDefaultDirs().then((dirs) => {
      state.downloadDir = dirs.downloads;
      localStorage.setItem('download_directory', dirs.downloads);
      updateDirDisplays(dirs.downloads);
    });
  }
}

// ============================================================================
// Engine Visual Synchronizer
// ============================================================================
function updateEngineVisuals(engineKey) {
  const meta = engineMeta[engineKey] || engineMeta.godot;
  const labelActiveEngine = document.getElementById('label-active-engine');
  const inspectorFormatTarget = document.getElementById('inspector-format-target');
  const pmEngineBadge = document.getElementById('pm-engine-badge');

  if (labelActiveEngine) labelActiveEngine.textContent = `${meta.title} Project`;
  if (inspectorFormatTarget) inspectorFormatTarget.textContent = meta.format;
  if (pmEngineBadge) pmEngineBadge.textContent = meta.title;
}

// ============================================================================
// Enterprise Settings Modal Controller
// ============================================================================
const modalSettings = document.getElementById('modal-settings');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');

// Settings Navigation Tabs
const settingsNavBtns = document.querySelectorAll('.settings-nav-btn');
const settingsSections = document.querySelectorAll('.settings-section');

// Section 1: Engine & Project
const settingsEngineCards = document.querySelectorAll('.settings-engine-card');
const settingsProjectPath = document.getElementById('settings-project-path');
const btnSettingsBrowseProject = document.getElementById('btn-settings-browse-project');
const settingsDownloadPath = document.getElementById('settings-download-path');
const btnSettingsOpenFolder = document.getElementById('btn-settings-open-folder');
const btnSettingsBrowseDownload = document.getElementById('btn-settings-browse-download');

// Section 2: Developer Profile
const settingsProfileName = document.getElementById('settings-profile-name');
const settingsAvatarCircle = document.getElementById('settings-avatar-circle');
const settingsAvatarFileInput = document.getElementById('settings-avatar-file-input');
const settingsAvatarImg = document.getElementById('settings-avatar-img');
const settingsAvatarPlaceholder = document.getElementById('settings-avatar-placeholder');

// Section 3: API & Services
const settingsSketchfabToken = document.getElementById('settings-sketchfab-token');
const btnSettingsToggleToken = document.getElementById('btn-settings-toggle-token');
const settingsApiIndicator = document.getElementById('settings-api-indicator');
const settingsApiStatusTitle = document.getElementById('settings-api-status-title');
const settingsApiStatusDesc = document.getElementById('settings-api-status-desc');

// Section 4: System & Setup
const btnSettingsRelaunchWizard = document.getElementById('btn-settings-relaunch-wizard');
const btnSettingsClearHistory = document.getElementById('btn-settings-clear-history');

let tempSettingsAvatarUrl = state.userProfile?.avatarUrl || '';
let sketchfabTokenDirty = false;

bindAvatarCircleUploader({
  circleEl: settingsAvatarCircle,
  fileInputEl: settingsAvatarFileInput,
  imgEl: settingsAvatarImg,
  placeholderEl: settingsAvatarPlaceholder,
  initialUrl: tempSettingsAvatarUrl,
  onImageLoaded: (url) => {
    tempSettingsAvatarUrl = url;
  },
});

function updateApiStatusBox(configured) {
  if (configured) {
    settingsApiIndicator?.classList.add('valid');
    if (settingsApiStatusTitle) settingsApiStatusTitle.textContent = 'Sketchfab API configured';
    if (settingsApiStatusDesc) settingsApiStatusDesc.textContent = 'The token stays on this device and is sent only to Sketchfab.';
  } else {
    settingsApiIndicator?.classList.remove('valid');
    if (settingsApiStatusTitle) settingsApiStatusTitle.textContent = 'No API credential configured';
    if (settingsApiStatusDesc) settingsApiStatusDesc.textContent = 'Only Sketchfab 3D downloads require a token.';
  }
}

export function openSettingsModal(targetSectionId = 'section-settings-engine') {
  // 1. Sync active engine card
  const currentEngine = state.selectedEngine || 'godot';
  settingsEngineCards.forEach((card) => {
    card.classList.toggle('selected', card.dataset.engineChoice === currentEngine);
  });

  // 2. Sync paths
  if (settingsProjectPath) {
    settingsProjectPath.value = state.projectPath || '';
    settingsProjectPath.placeholder = state.projectPath ? state.projectPath : 'No project selected';
  }
  if (settingsDownloadPath) {
    settingsDownloadPath.value = state.downloadDir || '';
  }

  // 3. Sync profile
  if (settingsProfileName) settingsProfileName.value = state.userProfile?.name || 'Developer';
  tempSettingsAvatarUrl = state.userProfile?.avatarUrl || '';

  if (settingsAvatarImg && settingsAvatarPlaceholder) {
    if (tempSettingsAvatarUrl) {
      settingsAvatarImg.src = tempSettingsAvatarUrl;
      settingsAvatarImg.classList.remove('hidden');
      settingsAvatarPlaceholder.classList.add('hidden');
      settingsAvatarCircle?.classList.add('has-image');
    } else {
      settingsAvatarImg.src = '';
      settingsAvatarImg.classList.add('hidden');
      settingsAvatarPlaceholder.classList.remove('hidden');
      settingsAvatarCircle?.classList.remove('has-image');
    }
  }

  // 4. Sync API token
  if (settingsSketchfabToken) settingsSketchfabToken.value = '';
  sketchfabTokenDirty = false;
  updateApiStatusBox(state.sketchfabTokenConfigured);
  window.electronAPI?.getSketchfabTokenStatus?.().then((status) => {
    state.sketchfabTokenConfigured = Boolean(status?.configured);
    updateApiStatusBox(state.sketchfabTokenConfigured);
  }).catch(() => updateApiStatusBox(false));

  // 5. Activate requested tab section
  settingsNavBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.settingsTarget === targetSectionId);
  });
  settingsSections.forEach((sec) => {
    const isTarget = sec.id === targetSectionId;
    sec.classList.toggle('active', isTarget);
    sec.classList.toggle('hidden', !isTarget);
  });

  modalSettings?.classList.remove('hidden');
}

btnSettings?.addEventListener('click', () => openSettingsModal('section-settings-engine'));
btnCloseSettings?.addEventListener('click', () => modalSettings?.classList.add('hidden'));
btnCancelSettings?.addEventListener('click', () => modalSettings?.classList.add('hidden'));

// Nav button tab switching
settingsNavBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.settingsTarget;
    settingsNavBtns.forEach((b) => b.classList.toggle('active', b === btn));
    settingsSections.forEach((sec) => {
      const isTarget = sec.id === targetId;
      sec.classList.toggle('active', isTarget);
      sec.classList.toggle('hidden', !isTarget);
    });
  });
});

// Engine switching directly inside Settings
settingsEngineCards.forEach((card) => {
  card.addEventListener('click', () => {
    settingsEngineCards.forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    const engineKey = card.dataset.engineChoice;
    setEngine(engineKey);
    updateEngineVisuals(engineKey);
    showToast(`Switched target engine to ${engineMeta[engineKey]?.title || engineKey}`, 'info');
  });
});

// Project folder selection from Settings
btnSettingsBrowseProject?.addEventListener('click', async () => {
  if (!window.electronAPI) return;
  const selectedPath = await window.electronAPI.selectDirectory();
  if (!selectedPath) return;

  const currentEngine = state.selectedEngine || 'godot';
  const scanResult = await window.electronAPI.scanAndSetupProject({
    folderPath: selectedPath,
    engine: currentEngine,
  });

  if (!scanResult.success) {
    showToast(`Error: ${scanResult.error}`, 'error');
    return;
  }

  saveProjectPaths(scanResult.projectPath, scanResult.modelsPath);
  if (settingsProjectPath) settingsProjectPath.value = scanResult.projectPath;
  if (settingsDownloadPath) settingsDownloadPath.value = scanResult.modelsPath;
  showToast(scanResult.message || 'Project verified and configured successfully!', 'success');
});

// Models folder browse from Settings
btnSettingsBrowseDownload?.addEventListener('click', async () => {
  if (!window.electronAPI) return;
  const selected = await window.electronAPI.selectDirectory();
  if (selected) {
    state.downloadDir = selected;
    localStorage.setItem('download_directory', selected);
    updateDirDisplays(selected);
    if (settingsDownloadPath) settingsDownloadPath.value = selected;
    showToast('3D Models destination updated.', 'info');
  }
});

// Open models folder in Explorer
btnSettingsOpenFolder?.addEventListener('click', () => {
  if (window.electronAPI && state.downloadDir) {
    window.electronAPI.openFolder(state.downloadDir);
  } else {
    showToast('No models folder configured yet.', 'error');
  }
});

// Toggle Sketchfab token visibility
btnSettingsToggleToken?.addEventListener('click', () => {
  if (!settingsSketchfabToken || !btnSettingsToggleToken) return;
  const isPassword = settingsSketchfabToken.type === 'password';
  settingsSketchfabToken.type = isPassword ? 'text' : 'password';
  btnSettingsToggleToken.textContent = isPassword ? 'Hide' : 'Show';
});

settingsSketchfabToken?.addEventListener('input', () => {
  sketchfabTokenDirty = true;
  updateApiStatusBox(Boolean(settingsSketchfabToken.value.trim()) || state.sketchfabTokenConfigured);
});

// Relaunch Setup Wizard from step 1
btnSettingsRelaunchWizard?.addEventListener('click', () => {
  modalSettings?.classList.add('hidden');
  markSetupCompleted(false);

  // Show setup tab, hide workspace tabs
  document.getElementById('tab-engine-header')?.classList.remove('hidden');
  document.getElementById('tab-project-header')?.classList.add('hidden');
  document.getElementById('tab-marketplace-header')?.classList.add('hidden');
  document.getElementById('tab-project-manager-header')?.classList.add('hidden');
  document.getElementById('tab-downloads-header')?.classList.add('hidden');
  document.getElementById('btn-add-tab')?.classList.add('hidden');

  switchTab('tab-engine-selector');
  showToast('Setup wizard relaunched. Choose your game engine to begin.', 'info');
});

// Clear local downloads history
btnSettingsClearHistory?.addEventListener('click', () => {
  state.completedDownloads = [];
  localStorage.setItem('completed_downloads', '[]');
  renderDownloadsLibrary();
  showToast('Downloads history cleared.', 'info');
});

// Save all settings
btnSaveSettings?.addEventListener('click', () => {
  const token = settingsSketchfabToken?.value.trim() || '';
  const saveSettings = async () => {
    if (sketchfabTokenDirty) {
      const secretResult = await window.electronAPI?.setSketchfabToken?.(token);
      state.sketchfabTokenConfigured = Boolean(secretResult?.configured);
    }

    const name = settingsProfileName?.value.trim() || 'Developer';
    saveUserProfile({ name, avatarUrl: tempSettingsAvatarUrl });
    updateAccountWidget();
    modalSettings?.classList.add('hidden');
    if (settingsSketchfabToken) settingsSketchfabToken.value = '';
    updateApiStatusBox(state.sketchfabTokenConfigured);
    showToast('Settings saved successfully.', 'success');
  };
  saveSettings().catch((error) => showToast(`Settings could not be saved: ${error.message}`, 'error'));
});

// ============================================================================
// Quick Menu Dropdown
// ============================================================================
const btnChevron = document.getElementById('btn-chevron');
const dropdownMenu = document.getElementById('dropdown-menu');

btnChevron?.addEventListener('click', (e) => {
  e.stopPropagation();
  dropdownMenu?.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (dropdownMenu && !dropdownMenu.contains(e.target) && e.target !== btnChevron) {
    dropdownMenu.classList.add('hidden');
  }
});

document.getElementById('menu-choose-engine')?.addEventListener('click', () => {
  dropdownMenu?.classList.add('hidden');
  openSettingsModal('section-settings-engine');
});

document.getElementById('menu-open-folder')?.addEventListener('click', () => {
  dropdownMenu?.classList.add('hidden');
  if (window.electronAPI && state.downloadDir) {
    window.electronAPI.openFolder(state.downloadDir);
  }
});

document.getElementById('menu-settings')?.addEventListener('click', () => {
  dropdownMenu?.classList.add('hidden');
  openSettingsModal();
});

const btnSave = document.getElementById('btn-save');
btnSave?.addEventListener('click', () => {
  btnSave.style.transform = 'scale(0.88)';
  setTimeout(() => (btnSave.style.transform = ''), 150);
  localStorage.setItem('completed_downloads', JSON.stringify(state.completedDownloads));
  showToast(`Saved library state (${state.completedDownloads.length} models)`, 'success');
});

// Switch Engine button on the marketplace header
document.getElementById('btn-switch-engine')?.addEventListener('click', () => {
  openSettingsModal('section-settings-engine');
});

// ============================================================================
// Setup Flow & Module Orchestration
// ============================================================================

function enterWorkspace() {
  // The Rust side intentionally keeps its allowed project roots in memory.
  // Restore the persisted, user-selected root after an application restart.
  if (state.projectPath && state.selectedEngine) {
    window.electronAPI?.registerProjectRoot(state.projectPath, state.selectedEngine).catch((error) => {
      console.warn('Could not restore project access:', error);
    });
  }

  // Hide setup wizard tabs
  document.getElementById('tab-engine-header')?.classList.add('hidden');
  document.getElementById('tab-project-header')?.classList.add('hidden');
  document.getElementById('view-engine-selector')?.classList.add('hidden');
  document.getElementById('view-project-selector')?.classList.add('hidden');
  document.getElementById('view-account-setup')?.classList.add('hidden');

  // Reveal workspace tabs
  document.getElementById('tab-marketplace-header')?.classList.remove('hidden');
  document.getElementById('tab-project-manager-header')?.classList.remove('hidden');
  document.getElementById('tab-downloads-header')?.classList.remove('hidden');
  document.getElementById('btn-add-tab')?.classList.remove('hidden');

  const activeEngine = state.selectedEngine || 'godot';
  if (lastWorkspaceEngine !== activeEngine) {
    // GameMaker projects are primarily 2D, so their first marketplace view is the 2D Store.
    setActiveMarketplaceStore(activeEngine === 'gamemaker' ? '2d' : '3d');
    lastWorkspaceEngine = activeEngine;
  }

  updateEngineVisuals(activeEngine);
  updateAccountWidget();

  switchTab('tab-marketplace');
  loadActiveStore({
    onInspect: (model) => openModelTab(model, displayModelInInspector),
    onDownload: (model) => initiateDownload(model),
    onOpenSource: openStoreListing,
  });
}

// 1. Initialize Account Module (setup screen & bottom-left widget)
initAccountModule({
  onSetupComplete: () => {
    enterWorkspace();
  },
  onOpenProfileSettings: () => {
    openSettingsModal('section-settings-profile');
  },
});

// 2. Initialize Tabs Module
initTabsModule({
  onOpenSettings: () => openSettingsModal(),
});

setOnTabChanged((tabId) => {
  if (tabId === 'tab-project-manager') {
    loadProjectModels();
  } else if (tabId === 'tab-downloads') {
    renderDownloadsLibrary();
  } else if (tabId.startsWith('tab-model-')) {
    const modelData = state.dynamicTabs.get(tabId);
    if (modelData) {
      displayModelInInspector(modelData, false);
    }
  }
});

// 3. Initialize Engine Selector Module
initEngineSelectorModule({
  onProjectVerified: () => {
    if (state.setupCompleted) {
      // User already has identity setup: go straight to workspace
      enterWorkspace();
      showToast(`Switched project to ${engineMeta[state.selectedEngine]?.title || 'Engine'}!`, 'success');
    } else {
      // First-time onboarding only
      switchTab('tab-account-setup');
    }
  },
});

// 4. Initialize Marketplace Module
initMarketplaceModule({
  onInspect: (model) => openModelTab(model, displayModelInInspector),
  onDownload: (model) => initiateDownload(model),
  onOpenSource: openStoreListing,
});

// 5. Initialize 3D Inspector Module
initInspectorModule({
  onDownloadInitiated: (model) => initiateDownload(model),
});

// 6. Initialize Project Manager Module
initProjectManagerModule();

// 7. Initialize Downloads Module
initDownloadsModule();

// 8. Every provider download is gated by a one-time, locally recorded license acceptance.
initLicenseCompliance();

storeNavigationReady = true;
if (storeOpenRequested) openAssetsboxStoreFromLink();

// ============================================================================
// Application Startup Dispatcher (Bypass Setup if already configured)
// ============================================================================
if (state.setupCompleted && state.selectedEngine && state.downloadDir) {
  // Directly launch into workspace, bypassing wizard!
  enterWorkspace();
} else {
  // First time launch: start at engine selector
  switchTab('tab-engine-selector');
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modalSettings && !modalSettings.classList.contains('hidden')) {
      modalSettings.classList.add('hidden');
    } else if (state.activeTabId === 'tab-project-selector') {
      openSettingsModal('section-settings-engine');
    } else if (state.activeTabId === 'tab-account-setup') {
      switchTab('tab-project-selector');
    }
  } else if (e.ctrlKey || e.metaKey) {
    if (e.key === 'o') {
      e.preventDefault();
      if (window.electronAPI && state.downloadDir) {
        window.electronAPI.openFolder(state.downloadDir);
      }
    } else if (e.key === ',') {
      e.preventDefault();
      openSettingsModal();
    } else if (e.key === 't') {
      e.preventDefault();
      document.getElementById('btn-add-tab')?.click();
    } else if (e.key === 'w') {
      e.preventDefault();
      if (state.activeTabId.startsWith('tab-model-')) {
        closeModelTab(state.activeTabId);
      }
    }
  }
});
