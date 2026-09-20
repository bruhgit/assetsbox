// ============================================================================
// Project Manager Module (Engine-Specific Model Management)
// ============================================================================

import { state, engineMeta } from './state.js';
import { showToast } from './toast.js';
import { switchTab } from './tabs.js';

export function getEngineAssetPath(engine, filename) {
  const cleanName = filename
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
  switch (engine) {
    case 'godot':
      return `res://Models/${cleanName}`;
    case 'unity':
      return `Assets/Models/${cleanName}`;
    case 'unreal':
      return `/Game/Models/${cleanName.replace(/\.[^/.]+$/, '')}`;
    case 'gamemaker':
      return `Models/${cleanName}`;
    default:
      return `Models/${cleanName}`;
  }
}

function getImportSuccessMessage(result) {
  const modelLabel = `model${result.count === 1 ? '' : 's'}`;
  const notes = [];

  if (result.renamedCount > 0) {
    notes.push(`${result.renamedCount} duplicate${result.renamedCount === 1 ? ' was' : 's were'} renamed`);
  }
  if (result.skippedCount > 0) {
    notes.push(`${result.skippedCount} unsupported file${result.skippedCount === 1 ? ' was' : 's were'} skipped`);
  }

  return `Imported ${result.count} ${modelLabel}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}.`;
}

async function handleImportResult(result) {
  if (result?.canceled) return;

  if (result?.success) {
    showToast(getImportSuccessMessage(result), 'success');
    await loadProjectModels();
    return;
  }

  showToast(result?.error || 'Could not import the selected model files.', 'error');
}

export async function loadProjectModels() {
  const engine = state.selectedEngine || 'godot';
  const meta = engineMeta[engine] || { title: 'Generic Engine' };

  const pmEngineBadge = document.getElementById('pm-engine-badge');
  const pmModelsDirLabel = document.getElementById('pm-models-dir-label');
  const pmEnginePattern = document.getElementById('pm-engine-pattern');
  const pmEngineDesc = document.getElementById('pm-engine-desc');
  const pmModelsCount = document.getElementById('pm-models-count');
  const pmModelsGrid = document.getElementById('pm-models-grid');

  if (pmEngineBadge) {
    pmEngineBadge.textContent = meta.title;
  }

  if (pmModelsDirLabel) {
    pmModelsDirLabel.textContent = state.downloadDir
      ? state.downloadDir
      : 'No project models folder selected.';
  }

  if (pmEnginePattern) {
    switch (engine) {
      case 'godot':
        pmEnginePattern.textContent = 'res://Models/<model_name>';
        if (pmEngineDesc) pmEngineDesc.textContent = 'Godot indexes models inside res://Models/. Directly instantiable in scenes.';
        break;
      case 'unity':
        pmEnginePattern.textContent = 'Assets/Models/<model_name>';
        if (pmEngineDesc) pmEngineDesc.textContent = 'Unity Project window maps to Assets/Models/. Usable as Prefabs or Mesh Filters.';
        break;
      case 'unreal':
        pmEnginePattern.textContent = '/Game/Models/<model_name>';
        if (pmEngineDesc) pmEngineDesc.textContent = 'Unreal Engine Content Browser mounts Content/ as /Game/. StaticMesh assets.';
        break;
      case 'gamemaker':
        pmEnginePattern.textContent = 'Models/<model_name>';
        if (pmEngineDesc) pmEngineDesc.textContent = 'GameMaker recognizes vertex buffers and 3D assets in the Models folder.';
        break;
      default:
        pmEnginePattern.textContent = 'Models/<model_name>';
        if (pmEngineDesc) pmEngineDesc.textContent = '3D models are stored in the Models folder.';
    }
  }

  if (!state.downloadDir) {
    if (pmModelsCount) pmModelsCount.textContent = '0 Models';
    if (pmModelsGrid) {
      pmModelsGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 12px; display: block; opacity: 0.5;">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span style="font-weight: 500;">No project selected</span>
          <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Choose a project first to manage its 3D models.</p>
          <button id="btn-pm-go-project" class="btn-primary-action" style="margin-top: 14px;">Select Project Folder</button>
        </div>
      `;
      document.getElementById('btn-pm-go-project')?.addEventListener('click', () => {
        document.getElementById('tab-project-header')?.classList.remove('hidden');
        switchTab('tab-project-selector');
      });
    }
    return;
  }

  if (!window.electronAPI || !pmModelsGrid) return;

  pmModelsGrid.innerHTML = `
    <div class="empty-state" style="grid-column: 1 / -1;">
      <div class="spinner" style="margin: 0 auto 12px auto;"></div>
      <span>Scanning project models...</span>
    </div>
  `;

  try {
    const models = await window.electronAPI.listProjectModels(state.downloadDir);
    if (pmModelsCount) {
      pmModelsCount.textContent = `${models.length} Model${models.length === 1 ? '' : 's'}`;
    }

    if (models.length === 0) {
      pmModelsGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 12px; display: block; opacity: 0.4;">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          </svg>
          <span style="font-size: 15px; font-weight: 500;">No 3D Models in Models Directory</span>
          <p style="font-size: 12px; color: var(--text-muted); margin-top: 6px; max-width: 420px; line-height: 1.5;">
            No 3D files found in <code>${state.downloadDir}</code>. Import files or download from the Asset Store.
          </p>
          <div style="display: flex; gap: 10px; margin-top: 16px;">
            <button id="btn-pm-empty-import" class="btn-primary-action">Import 3D Model</button>
            <button id="btn-pm-empty-store" class="btn-secondary">Browse Asset Store</button>
          </div>
        </div>
      `;

      document.getElementById('btn-pm-empty-import')?.addEventListener('click', () => {
        document.getElementById('btn-pm-import')?.click();
      });

      document.getElementById('btn-pm-empty-store')?.addEventListener('click', () => {
        document.getElementById('tab-marketplace-header')?.classList.remove('hidden');
        switchTab('tab-marketplace');
      });
      return;
    }

    pmModelsGrid.innerHTML = '';
    models.forEach((model) => {
      const card = document.createElement('div');
      card.className = 'pm-model-card';

      const sizeFormatted = model.sizeBytes > 1024 * 1024
        ? `${(model.sizeBytes / (1024 * 1024)).toFixed(2)} MB`
        : `${Math.round(model.sizeBytes / 1024)} KB`;

      const engineUri = getEngineAssetPath(engine, model.name);
      card.innerHTML = `
        <div class="pm-card-top">
          <div class="pm-card-icon-frame">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
          </div>
          <div class="pm-card-main">
            <h4 class="pm-card-filename" title="${model.name}">${model.name}</h4>
            <div class="pm-card-meta">
              <span class="pm-ext-badge">${model.ext}</span>
              <span>${sizeFormatted}</span>
              <span>•</span>
              <span>${model.modifiedAt}</span>
            </div>
          </div>
        </div>

        <div class="pm-uri-box" title="Engine reference URI">
          <span class="pm-uri-text">${engineUri}</span>
          <button class="btn-copy-uri" title="Copy Engine URI" data-uri="${engineUri}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>

        <div class="pm-card-bottom">
          <button class="btn-pm-action-small btn-show-item" title="Show in File Explorer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>Show in Folder</span>
          </button>
          <button class="btn-pm-action-small btn-danger-action btn-delete-item" title="Delete model from project">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Delete</span>
          </button>
        </div>
      `;

      card.querySelector('.btn-copy-uri')?.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(engineUri);
        showToast(`Copied ${engineUri} to clipboard`, 'info');
      });

      card.querySelector('.btn-show-item')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.electronAPI) {
          window.electronAPI.showItem(model.fullPath);
        }
      });

      card.querySelector('.btn-delete-item')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!window.electronAPI) return;
        const res = await window.electronAPI.deleteProjectModel(model.fullPath);
        if (res.success) {
          showToast(`Deleted ${model.name}`, 'info');
          loadProjectModels();
        } else {
          showToast(`Delete failed: ${res.error}`, 'error');
        }
      });

      pmModelsGrid.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading project models:', err);
    pmModelsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <span style="color: #ff6b6b;">Failed to read models directory.</span>
      </div>
    `;
  }
}

export function initProjectManagerModule() {
  const btnPmImport = document.getElementById('btn-pm-import');
  const btnPmInstallStore = document.getElementById('btn-pm-install-store');
  const btnPmRefresh = document.getElementById('btn-pm-refresh');
  const btnPmOpenFolder = document.getElementById('btn-pm-open-folder');
  const pmModelsGrid = document.getElementById('pm-models-grid');
  let dragDepth = 0;

  btnPmImport?.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    if (!state.downloadDir) {
      showToast('Please choose a project first.', 'error');
      return;
    }
    const result = await window.electronAPI.importProjectModel(state.downloadDir);
    await handleImportResult(result);
  });

  btnPmInstallStore?.addEventListener('click', async () => {
    if (!window.electronAPI) return;
    if (!state.projectPath || !state.selectedEngine) {
      showToast('Please choose an engine project before installing the store extension.', 'error');
      return;
    }

    const result = await window.electronAPI.installAssetsboxStore(state.projectPath, state.selectedEngine);
    if (!result?.success) {
      showToast(result?.error || 'Could not install the Assetsbox Store extension.', 'error');
      return;
    }

    const restartNote = result.requiresRestart ? ' Restart the editor to load it.' : '';
    showToast(`${result.message}${restartNote}`, 'success', 5000);
    if (result.limitation) showToast(result.limitation, 'info', 5000);
  });

  btnPmRefresh?.addEventListener('click', () => {
    loadProjectModels();
    showToast('Refreshed project models', 'info', 1500);
  });

  btnPmOpenFolder?.addEventListener('click', () => {
    if (window.electronAPI && state.downloadDir) {
      window.electronAPI.openFolder(state.downloadDir);
    }
  });

  const hasDraggedFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

  pmModelsGrid?.addEventListener('dragenter', (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    if (state.downloadDir) pmModelsGrid.classList.add('is-dragging');
  });

  pmModelsGrid?.addEventListener('dragover', (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });

  pmModelsGrid?.addEventListener('dragleave', (event) => {
    if (!hasDraggedFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) pmModelsGrid.classList.remove('is-dragging');
  });

  pmModelsGrid?.addEventListener('drop', async (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    pmModelsGrid.classList.remove('is-dragging');

    if (!window.electronAPI || !state.downloadDir) {
      showToast('Please choose a project before importing models.', 'error');
      return;
    }

    const sourcePaths = Array.from(event.dataTransfer?.files || [])
      .map((file) => file.path)
      .filter(Boolean);

    if (sourcePaths.length === 0) {
      showToast('Could not read the dropped files. Use Import Model instead.', 'error');
      return;
    }

    const result = await window.electronAPI.importProjectModelPaths(state.downloadDir, sourcePaths);
    await handleImportResult(result);
  });
}
