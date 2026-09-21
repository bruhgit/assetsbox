// ============================================================================
// Downloads & Local Library Module
// ============================================================================

import { state } from './state.js';
import { showToast } from './toast.js';
import { switchTab } from './tabs.js';
import { loadProjectModels } from './projectManager.js';
import { requireLicenseAcceptance } from './licenseCompliance.js';

function errorMessage(error, fallback = 'The download could not be started.') {
  if (typeof error === 'string' && error.trim()) return error;
  if (error?.message && typeof error.message === 'string') return error.message;
  if (error?.error && typeof error.error === 'string') return error.error;
  return fallback;
}

export async function initiateDownload(model) {
  if (!window.electronAPI) {
    showToast('Desktop bridge is not initialized', 'error');
    return;
  }

  const assetKind = model.assetKind || 'model';
  const destinationLabel = assetKind === 'image' ? '2D Assets folder'
    : assetKind === 'sound' ? 'Audio folder' : 'Models folder';
  let targetDir = state.downloadDir;

  if (state.projectPath && state.selectedEngine) {
    const directoryResult = await window.electronAPI.getAssetTargetDirectory({
      projectPath: state.projectPath,
      engine: state.selectedEngine,
      assetKind,
    });
    if (!directoryResult.success) {
      showToast(directoryResult.error || 'Could not prepare the asset folder.', 'error');
      return;
    }
    targetDir = directoryResult.path;
  } else if (assetKind !== 'model') {
    showToast('Please select your project folder first.', 'error');
    switchTab('tab-project-selector');
    return;
  }

  if (!targetDir) {
    showToast('Please select your project folder first.', 'error');
    switchTab('tab-project-selector');
    return;
  }

  const inspectorDownloadStatus = document.getElementById('inspector-download-status');
  const modalSettings = document.getElementById('modal-settings');
  const inputSketchfabToken = document.getElementById('settings-sketchfab-token');

  if (inspectorDownloadStatus) {
    inspectorDownloadStatus.classList.remove('hidden');
    inspectorDownloadStatus.textContent = 'Resolving asset download endpoint...';
  }
  showToast(`Adding ${model.name} to ${destinationLabel}...`, 'info');

  try {
    let downloadUrl = model.directUrl;
    let filename = model.filename || `${model.name}.glb`;

    if (model.isSketchfabApi) {
      const modelUid = String(model.uid || '').trim();
      if (!modelUid) {
        throw new Error('This Sketchfab result has no model ID. Refresh the search and try again.');
      }
      const tokenStatus = await window.electronAPI.getSketchfabTokenStatus();
      if (!tokenStatus?.configured) {
        if (inspectorDownloadStatus) {
          inspectorDownloadStatus.textContent = 'Sketchfab API Token required. Opening settings...';
        }
        showToast('Please enter your free Sketchfab API Token to download', 'info');
        setTimeout(() => {
          modalSettings?.classList.remove('hidden');
          inputSketchfabToken?.focus();
        }, 500);
        return;
      }

      if (inspectorDownloadStatus) {
        inspectorDownloadStatus.textContent = 'Connecting to Sketchfab API...';
      }
      const downloadResponse = await window.electronAPI.getSketchfabDownloadUrl({
        modelUid,
      });

      if (downloadResponse.gltf && downloadResponse.gltf.url) {
        downloadUrl = downloadResponse.gltf.url;
        filename = `${model.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_gltf.zip`;
      } else if (downloadResponse.source && downloadResponse.source.url) {
        downloadUrl = downloadResponse.source.url;
        filename = `${model.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_source.zip`;
      } else {
        throw new Error('No compatible 3D format found in response.');
      }
    }

    if (!downloadUrl) {
      throw new Error('The selected asset does not have a downloadable file URL.');
    }

    const licenseAcceptance = await requireLicenseAcceptance(model);
    if (!licenseAcceptance) {
      if (inspectorDownloadStatus) inspectorDownloadStatus.textContent = 'Download canceled: license acceptance is required.';
      return;
    }

    const downloadId = `dl-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    const downloadItem = {
      id: downloadId,
      name: model.name,
      filename,
      thumbnail: model.thumbnail,
      targetDir,
      assetKind,
      sourceId: model.uid || model.id || `${model.source || 'asset'}:${filename}`,
      license: licenseAcceptance.license,
      licenseSourceUrl: licenseAcceptance.listingUrl,
      licenseAcceptedAt: licenseAcceptance.acceptedAt,
      receivedBytes: 0,
      totalBytes: 0,
      percent: 0,
      speedBps: 0,
      status: 'downloading',
    };

    state.activeDownloads.set(downloadId, downloadItem);
    updateDownloadsBadge();
    renderActiveDownloads();

    if (inspectorDownloadStatus) {
      inspectorDownloadStatus.textContent = `Downloading ${filename} to ${destinationLabel}...`;
    }

    await window.electronAPI.startDownload({
      id: downloadId,
      url: downloadUrl,
      filename,
      targetDirectory: targetDir,
      licenseAcceptanceId: licenseAcceptance.acceptanceId,
      assetId: licenseAcceptance.assetId,
    });
  } catch (error) {
    console.error('[Download] Failed to start:', error);
    const message = errorMessage(error);
    if (inspectorDownloadStatus) {
      inspectorDownloadStatus.textContent = `Download failed: ${message}`;
    }
    showToast(`Download failed: ${message}`, 'error');
  }
}

export function handleDownloadProgress(data) {
  const item = state.activeDownloads.get(data.id);
  if (!item) return;

  const inspectorDownloadStatus = document.getElementById('inspector-download-status');

  item.receivedBytes = data.receivedBytes ?? item.receivedBytes;
  item.totalBytes = data.totalBytes ?? item.totalBytes;
  item.percent = data.percent ?? item.percent;
  item.speedBps = data.speedBps ?? item.speedBps;
  item.status = data.status;

  if (data.status === 'extracting') {
    updateActiveDownloadCard(item, data.message || 'Extracting ZIP archive...');
    if (inspectorDownloadStatus) {
      inspectorDownloadStatus.textContent = data.message || 'Extracting ZIP archive into Models...';
    }
  } else if (data.status === 'completed') {
    state.activeDownloads.delete(data.id);
    updateDownloadsBadge();

    const completedItem = {
      name: item.name,
      filename: item.filename,
      thumbnail: item.thumbnail,
      path: data.destPath,
      sourceId: item.sourceId,
      extractionDirectory: data.extractionDirectory || '',
      extractedModelCount: data.extractedModelCount || 0,
      completedAt: new Date().toLocaleDateString(),
    };

    state.completedDownloads = [
      completedItem,
      ...state.completedDownloads.filter((existingItem) => (
        existingItem.path !== completedItem.path
        && existingItem.sourceId !== completedItem.sourceId
      )),
    ];
    localStorage.setItem('completed_downloads', JSON.stringify(state.completedDownloads));

    renderActiveDownloads();
    renderDownloadsLibrary();

    if (state.activeTabId === 'tab-project-manager') {
      loadProjectModels();
    }

    const isZipDownload = item.filename.toLowerCase().endsWith('.zip');
    if (data.extractionError) {
      const message = `ZIP downloaded, but extraction failed: ${data.extractionError}`;
      if (inspectorDownloadStatus) inspectorDownloadStatus.textContent = message;
      showToast(message, 'error');
    } else if (isZipDownload && data.extractedModelCount > 0) {
      const message = `Extracted ${data.extractedModelCount} model${data.extractedModelCount === 1 ? '' : 's'} into Models.`;
      if (inspectorDownloadStatus) inspectorDownloadStatus.textContent = message;
      showToast(message, 'success');
    } else if (isZipDownload) {
      const message = 'ZIP saved to Models. No supported 3D model was found inside.';
      if (inspectorDownloadStatus) inspectorDownloadStatus.textContent = message;
      showToast(message, 'info');
    } else {
      if (inspectorDownloadStatus) {
        inspectorDownloadStatus.textContent = `Completed! Saved to: ${data.destPath}`;
      }
      showToast(`Saved to ${item.assetKind === 'image' ? '2D Assets' : item.assetKind === 'sound' ? 'Audio' : 'Models'}: ${item.filename}`, 'success');
    }
  } else if (data.status === 'error') {
    state.activeDownloads.delete(data.id);
    updateDownloadsBadge();
    renderActiveDownloads();
    if (inspectorDownloadStatus) {
      inspectorDownloadStatus.textContent = `Error: ${data.error}`;
    }
    showToast(`Download failed: ${data.error}`, 'error');
  } else {
    updateActiveDownloadCard(item);
  }
}

export function updateDownloadsBadge() {
  const downloadsBadge = document.getElementById('downloads-badge');
  if (!downloadsBadge) return;
  const count = state.activeDownloads.size;
  if (count > 0) {
    downloadsBadge.textContent = count;
    downloadsBadge.classList.remove('hidden');
  } else {
    downloadsBadge.classList.add('hidden');
  }
}

export function renderActiveDownloads() {
  const container = document.getElementById('active-downloads-list');
  const emptyState = document.getElementById('empty-active-downloads');
  if (!container) return;

  if (state.activeDownloads.size === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  container.innerHTML = '';
  state.activeDownloads.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'download-item-card';
    card.id = `card-${item.id}`;

    const speedMb = (item.speedBps / (1024 * 1024)).toFixed(2);
    const receivedMb = (item.receivedBytes / (1024 * 1024)).toFixed(1);
    const totalMb = (item.totalBytes / (1024 * 1024)).toFixed(1);

    card.innerHTML = `
      <div class="download-item-header">
        <span class="download-item-title">${item.filename}</span>
        <span class="download-item-stats" id="stats-${item.id}">${item.percent}% • ${receivedMb}/${totalMb} MB (${speedMb} MB/s)</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" id="fill-${item.id}" style="width: ${item.percent}%;"></div>
      </div>
    `;
    container.appendChild(card);
  });
}

function updateActiveDownloadCard(item, statusMessage = '') {
  const fill = document.getElementById(`fill-${item.id}`);
  const stats = document.getElementById(`stats-${item.id}`);
  if (fill) fill.style.width = `${item.percent}%`;
  if (stats) {
    const speedMb = (item.speedBps / (1024 * 1024)).toFixed(2);
    const receivedMb = (item.receivedBytes / (1024 * 1024)).toFixed(1);
    const totalMb = item.totalBytes > 0 ? (item.totalBytes / (1024 * 1024)).toFixed(1) : '?';
    stats.textContent = statusMessage || `${item.percent}% • ${receivedMb}/${totalMb} MB (${speedMb} MB/s)`;
  }
}

export function renderDownloadsLibrary() {
  const container = document.getElementById('completed-downloads-list');
  const emptyState = document.getElementById('empty-completed-downloads');
  if (!container) return;

  if (state.completedDownloads.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  container.innerHTML = '';
  state.completedDownloads.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'completed-card';
    card.innerHTML = `
      ${item.thumbnail
    ? `<img src="${item.thumbnail}" class="completed-thumb" alt="${item.name}">`
    : '<div class="completed-thumb completed-thumb-fallback" aria-hidden="true">Asset</div>'}
      <div class="completed-info">
        <h4 class="completed-title" title="${item.name}">${item.name}</h4>
        <p class="completed-path" title="${item.path}">${item.filename}${item.extractedModelCount ? ` · ${item.extractedModelCount} model${item.extractedModelCount === 1 ? '' : 's'} extracted` : ''}</p>
      </div>
      <button class="btn-small btn-show-folder" title="Show in Folder">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>
    `;

    const thumbImg = card.querySelector('img.completed-thumb');
    if (thumbImg) {
      thumbImg.onerror = function () {
        const parent = this.parentElement;
        this.remove();
        const fallback = document.createElement('div');
        fallback.className = 'thumbnail-error-fallback thumb-small';
        fallback.setAttribute('data-error', 'Thumbail load error');
        fallback.innerHTML = `
          <svg class="thumbnail-error-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
            <line x1="2" y1="2" x2="22" y2="22" stroke-width="1.5"></line>
          </svg>
          <span class="thumbnail-error-text">Thumbail load error</span>
        `;
        parent.prepend(fallback);
      };
    }

    card.querySelector('.btn-show-folder')?.addEventListener('click', () => {
      if (window.electronAPI) {
        window.electronAPI.showItem(item.path);
      }
    });

    container.appendChild(card);
  });
}

export function initDownloadsModule() {
  const btnOpenDownloadsFolder = document.getElementById('btn-open-downloads-folder');
  btnOpenDownloadsFolder?.addEventListener('click', () => {
    if (window.electronAPI && state.downloadDir) {
      window.electronAPI.openFolder(state.downloadDir);
    }
  });

  if (window.electronAPI) {
    window.electronAPI.onDownloadProgress((data) => {
      handleDownloadProgress(data);
    });
  }
}
