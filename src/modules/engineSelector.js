// ============================================================================
// Engine & Project Selection Module
// ============================================================================

import { state, engineMeta, setEngine, saveProjectPaths, updateDirDisplays } from './state.js';
import { showToast } from './toast.js';
import { switchTab } from './tabs.js';

export function initEngineSelectorModule({ onProjectVerified }) {
  const tabEngineHeader = document.getElementById('tab-engine-header');
  const tabProjectHeader = document.getElementById('tab-project-header');
  const projectEngineIcon = document.getElementById('project-engine-icon');
  const projectEngineName = document.getElementById('project-engine-name');
  const projectSubTitle = document.getElementById('project-sub-title');
  const labelActiveEngine = document.getElementById('label-active-engine');
  const inspectorFormatTarget = document.getElementById('inspector-format-target');
  const btnChooseProject = document.getElementById('btn-choose-project');
  const projectVerifiedBox = document.getElementById('project-verified-box');
  const verifiedProjectName = document.getElementById('verified-project-name');
  const verifiedProjectPath = document.getElementById('verified-project-path');
  const verifiedModelsPath = document.getElementById('verified-models-path');
  const verifiedIntegration = document.getElementById('verified-integration');
  const btnContinueMarketplace = document.getElementById('btn-continue-marketplace');
  const btnSwitchEngine = document.getElementById('btn-switch-engine');

  function handleEngineSelected(engineKey) {
    setEngine(engineKey);
    const meta = engineMeta[engineKey];

    // 1. Hide Engine Selection tab
    tabEngineHeader?.classList.add('hidden');

    // 2. Open "Select Project" tab
    tabProjectHeader?.classList.remove('hidden');

    if (projectEngineIcon) projectEngineIcon.src = meta.icon;
    if (projectEngineName) projectEngineName.textContent = meta.title;
    if (projectSubTitle) projectSubTitle.textContent = meta.instruction;
    if (labelActiveEngine) labelActiveEngine.textContent = `${meta.title} Project`;
    if (inspectorFormatTarget) inspectorFormatTarget.textContent = meta.format;

    projectVerifiedBox?.classList.add('hidden');
    switchTab('tab-project-selector');
    showToast(`Selected ${meta.title}. Please choose your project folder.`, 'info');
  }

  document.querySelectorAll('.engine-card').forEach((card) => {
    card.addEventListener('click', () => {
      const engineKey = card.dataset.engine;
      handleEngineSelected(engineKey);
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const engineKey = card.dataset.engine;
        handleEngineSelected(engineKey);
      }
    });
  });

  btnChooseProject?.addEventListener('click', async () => {
    if (!window.electronAPI) {
      showToast('Desktop bridge is not ready.', 'error');
      return;
    }

    const selectedPath = await window.electronAPI.selectDirectory();
    if (!selectedPath) return;

    const scanResult = await window.electronAPI.scanAndSetupProject({
      folderPath: selectedPath,
      engine: state.selectedEngine,
    });

    if (!scanResult.success) {
      showToast(`Error: ${scanResult.error}`, 'error');
      return;
    }

    saveProjectPaths(scanResult.projectPath, scanResult.modelsPath);

    const folderName = selectedPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Project';

    if (verifiedProjectName) verifiedProjectName.textContent = `${folderName} (${engineMeta[state.selectedEngine]?.title || 'Engine'})`;
    if (verifiedProjectPath) verifiedProjectPath.textContent = scanResult.projectPath;
    if (verifiedModelsPath) verifiedModelsPath.innerHTML = `Models directory: <strong>${scanResult.modelsPath}</strong>`;
    if (verifiedIntegration) {
      if (scanResult.integration?.success) {
        const restartNote = scanResult.integration.requiresRestart ? ' Restart the editor to load it.' : '';
        verifiedIntegration.textContent = `Assetsbox Store: ${scanResult.integration.entryPoint}.${restartNote}`;
      } else {
        verifiedIntegration.textContent = `Assetsbox Store could not be installed: ${scanResult.integration?.error || 'Unknown error.'}`;
      }
    }
    projectVerifiedBox?.classList.remove('hidden');

    showToast(scanResult.message || 'Models folder ready!', 'success');
  });

  btnContinueMarketplace?.addEventListener('click', () => {
    // Transition to Account Setup if in onboarding, or directly to workspace
    if (onProjectVerified) {
      onProjectVerified();
    }
  });

  btnSwitchEngine?.addEventListener('click', () => {
    tabEngineHeader?.classList.remove('hidden');
    tabProjectHeader?.classList.add('hidden');
    document.getElementById('tab-marketplace-header')?.classList.add('hidden');
    document.getElementById('tab-project-manager-header')?.classList.add('hidden');
    document.getElementById('tab-downloads-header')?.classList.add('hidden');
    document.getElementById('btn-add-tab')?.classList.add('hidden');
    switchTab('tab-engine-selector');
  });
}
