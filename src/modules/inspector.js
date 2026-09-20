// ============================================================================
// 3D Model Inspector Module
// ============================================================================

import { state, updateDirDisplays } from './state.js';
import { switchTab } from './tabs.js';
import { showToast } from './toast.js';

export function displayModelInInspector(model, activateTab = true) {
  state.currentInspectingModel = model;

  const inspectorTitle = document.getElementById('inspector-title');
  const inspectorAuthor = document.getElementById('inspector-author');
  const inspectorFaces = document.getElementById('inspector-faces');
  const inspectorVertices = document.getElementById('inspector-vertices');
  const inspectorLicense = document.getElementById('inspector-license');
  const viewerFrame = document.getElementById('sketchfab-viewer-frame');
  const viewerPlaceholder = document.getElementById('viewer-placeholder');
  const inspectorDownloadStatus = document.getElementById('inspector-download-status');

  if (inspectorTitle) inspectorTitle.textContent = model.name;
  if (inspectorAuthor) inspectorAuthor.textContent = model.author;
  if (inspectorFaces) inspectorFaces.textContent = Number(model.faceCount).toLocaleString();
  if (inspectorVertices) inspectorVertices.textContent = Number(model.vertexCount).toLocaleString();
  if (inspectorLicense) inspectorLicense.textContent = model.license;

  if (viewerPlaceholder) viewerPlaceholder.classList.remove('hidden');
  if (inspectorDownloadStatus) inspectorDownloadStatus.classList.add('hidden');

  if (viewerFrame) {
    viewerFrame.src = model.embedUrl;
    viewerFrame.onload = () => {
      viewerPlaceholder?.classList.add('hidden');
    };
  }

  if (activateTab) {
    switchTab(`tab-model-${model.uid}`);
  }
}

export function initInspectorModule({ onDownloadInitiated }) {
  const btnBackToMarket = document.getElementById('btn-back-to-market');
  const btnInspectDownload = document.getElementById('btn-inspect-download');
  const btnChangeDirInspector = document.getElementById('btn-change-dir-inspector');

  btnBackToMarket?.addEventListener('click', () => {
    switchTab('tab-marketplace');
  });

  btnInspectDownload?.addEventListener('click', () => {
    if (state.currentInspectingModel && onDownloadInitiated) {
      onDownloadInitiated(state.currentInspectingModel);
    }
  });

  btnChangeDirInspector?.addEventListener('click', async () => {
    if (window.electronAPI) {
      const selected = await window.electronAPI.selectDirectory();
      if (selected) {
        state.downloadDir = selected;
        localStorage.setItem('download_directory', selected);
        updateDirDisplays(selected);
        showToast(`Models folder updated: ${selected}`, 'info');
      }
    }
  });
}
