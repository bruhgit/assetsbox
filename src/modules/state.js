// ============================================================================
// Application State & Storage Module
// ============================================================================

export const defaultProfile = {
  name: 'Developer',
  avatarUrl: '',
};

const savedProfileRaw = localStorage.getItem('user_profile');
let initialProfile = defaultProfile;
if (savedProfileRaw) {
  try {
    initialProfile = { ...defaultProfile, ...JSON.parse(savedProfileRaw) };
  } catch (e) {
    console.warn('Failed to parse saved profile:', e);
  }
}

const savedEngine = localStorage.getItem('selected_engine') || null;
const isSetupStored = localStorage.getItem('setup_completed') === 'true';
const hasEngineAndDir = Boolean(savedEngine && localStorage.getItem('download_directory'));

function loadCompletedDownloads() {
  try {
    const savedDownloads = JSON.parse(localStorage.getItem('completed_downloads') || '[]');
    if (!Array.isArray(savedDownloads)) return [];

    const knownDownloads = new Set();
    const uniqueDownloads = savedDownloads.filter((item) => {
      const key = item?.sourceId || item?.path || item?.filename;
      if (!key || knownDownloads.has(key)) return false;
      knownDownloads.add(key);
      return true;
    });

    if (uniqueDownloads.length !== savedDownloads.length) {
      localStorage.setItem('completed_downloads', JSON.stringify(uniqueDownloads));
    }
    return uniqueDownloads;
  } catch (error) {
    console.warn('Failed to load downloads history:', error);
    return [];
  }
}

export const state = {
  selectedEngine: savedEngine,
  setupCompleted: isSetupStored || hasEngineAndDir,
  projectPath: localStorage.getItem('project_directory') || '',
  downloadDir: localStorage.getItem('download_directory') || '',
  activeTabId: 'tab-engine-selector',
  activeStore: '3d',
  searchQuery: 'sword',
  activeCategory: 'sword',
  downloadableOnly: true,
  fileFormatFilter: 'all',
  licenseFilter: 'all',
  // Tokens never enter localStorage. Tauri keeps them in the AES-256-GCM vault.
  sketchfabTokenConfigured: false,
  activeDownloads: new Map(),
  completedDownloads: loadCompletedDownloads(),
  currentInspectingModel: null,
  dynamicTabs: new Map(),
  userProfile: initialProfile,
};

export const engineMeta = {
  godot: {
    title: 'Godot',
    icon: 'assets/icons/godot.webp',
    format: 'glTF 2.0 / .tscn',
    instruction: 'Seçtiğiniz klasör taranacak (project.godot). Kök dizine Models klasörü oluşturulacak.',
  },
  unity: {
    title: 'Unity',
    icon: 'assets/icons/unity.png',
    format: 'glTF / FBX',
    instruction: 'Seçtiğiniz klasör taranacak (Assets). Models klasörü oluşturulacak.',
  },
  unreal: {
    title: 'Unreal Engine',
    icon: 'assets/icons/unreal.svg',
    format: 'glTF / FBX',
    instruction: 'Seçtiğiniz klasör taranacak (.uproject/Content). Models klasörü açılıp dosyalar konulacak.',
  },
  gamemaker: {
    title: 'Game Maker',
    icon: 'assets/icons/gamemaker.webp',
    format: 'glTF / OBJ',
    instruction: 'Seçtiğiniz klasör taranacak (.yyp). Models klasörü açılıp dosyalar konulacak.',
  },
};

export function saveUserProfile(profile) {
  state.userProfile = { ...state.userProfile, ...profile };
  localStorage.setItem('user_profile', JSON.stringify(state.userProfile));
}

export function setEngine(engineKey) {
  state.selectedEngine = engineKey;
  if (engineKey) {
    localStorage.setItem('selected_engine', engineKey);
  } else {
    localStorage.removeItem('selected_engine');
  }
}

export function markSetupCompleted(completed = true) {
  state.setupCompleted = completed;
  localStorage.setItem('setup_completed', completed ? 'true' : 'false');
}

export function saveProjectPaths(projectPath, modelsPath) {
  state.projectPath = projectPath;
  state.downloadDir = modelsPath;
  localStorage.setItem('project_directory', projectPath);
  localStorage.setItem('download_directory', modelsPath);
  updateDirDisplays(modelsPath);
}

export function updateDirDisplays(dirPath) {
  const displayTargetDir = document.getElementById('display-target-dir');
  const inputDownloadPath = document.getElementById('input-download-path');
  if (displayTargetDir) displayTargetDir.textContent = dirPath;
  if (inputDownloadPath) inputDownloadPath.value = dirPath;
}
