// ============================================================================
// Tab Management & Navigation Module
// ============================================================================

import { state } from './state.js';
import { showToast } from './toast.js';

let onTabChangedCallback = null;

export function setOnTabChanged(callback) {
  onTabChangedCallback = callback;
}

export function switchTab(tabId) {
  state.activeTabId = tabId;

  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tabId === tabId);
  });

  const views = [
    'view-engine-selector',
    'view-project-selector',
    'view-account-setup',
    'view-marketplace',
    'view-project-manager',
    'view-inspector',
    'view-downloads',
  ];

  views.forEach((vId) => {
    const el = document.getElementById(vId);
    if (el) el.classList.add('hidden');
  });

  if (tabId === 'tab-engine-selector') {
    document.getElementById('view-engine-selector')?.classList.remove('hidden');
  } else if (tabId === 'tab-project-selector') {
    document.getElementById('view-project-selector')?.classList.remove('hidden');
  } else if (tabId === 'tab-account-setup') {
    document.getElementById('view-account-setup')?.classList.remove('hidden');
  } else if (tabId === 'tab-marketplace') {
    document.getElementById('view-marketplace')?.classList.remove('hidden');
  } else if (tabId === 'tab-project-manager') {
    document.getElementById('view-project-manager')?.classList.remove('hidden');
  } else if (tabId === 'tab-downloads') {
    document.getElementById('view-downloads')?.classList.remove('hidden');
  } else if (tabId.startsWith('tab-model-')) {
    document.getElementById('view-inspector')?.classList.remove('hidden');
  }

  if (onTabChangedCallback) {
    onTabChangedCallback(tabId);
  }
}

export function openModelTab(modelData, onDisplayModel) {
  const tabsContainer = document.getElementById('tabs-container');
  const tabId = `tab-model-${modelData.uid}`;

  if (state.dynamicTabs.has(tabId)) {
    switchTab(tabId);
    if (onDisplayModel) onDisplayModel(modelData, false);
    return;
  }

  state.dynamicTabs.set(tabId, modelData);

  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.tabId = tabId;
  tab.title = modelData.name;

  const cleanName = modelData.name.length > 18 ? modelData.name.substring(0, 18) + '...' : modelData.name;

  tab.innerHTML = `
    <svg class="tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
    </svg>
    <span class="tab-label">${cleanName}</span>
    <span class="tab-close" title="Close">
      <svg width="10" height="10" viewBox="0 0 10 10">
        <path d="M 1,1 L 9,9 M 9,1 L 1,9" stroke="currentColor" stroke-width="1.2"></path>
      </svg>
    </span>
  `;

  tab.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    switchTab(tabId);
    if (onDisplayModel) onDisplayModel(modelData, false);
  });

  tabsContainer?.appendChild(tab);
  switchTab(tabId);
  if (onDisplayModel) onDisplayModel(modelData, false);
}

export function closeModelTab(tabId) {
  state.dynamicTabs.delete(tabId);
  const tabElem = document.querySelector(`[data-tab-id="${tabId}"]`);
  if (tabElem) tabElem.remove();

  if (state.activeTabId === tabId) {
    switchTab('tab-marketplace');
  }
}

export function initTabsModule({ onOpenSettings }) {
  const tabEngineHeader = document.getElementById('tab-engine-header');
  const tabProjectHeader = document.getElementById('tab-project-header');
  const tabMarketplaceHeader = document.getElementById('tab-marketplace-header');
  const tabProjectManagerHeader = document.getElementById('tab-project-manager-header');
  const tabDownloadsHeader = document.getElementById('tab-downloads-header');
  const btnAddTab = document.getElementById('btn-add-tab');
  const searchInput = document.getElementById('search-input');

  const titlebar = document.getElementById('titlebar');
  const titlebarContextMenu = document.getElementById('titlebar-context-menu');

  // Static tab headers
  tabEngineHeader?.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    switchTab('tab-engine-selector');
  });

  tabProjectHeader?.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    switchTab('tab-project-selector');
  });

  tabMarketplaceHeader?.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    switchTab('tab-marketplace');
  });

  tabProjectManagerHeader?.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    switchTab('tab-project-manager');
  });

  tabDownloadsHeader?.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    switchTab('tab-downloads');
  });

  btnAddTab?.addEventListener('click', () => {
    switchTab('tab-marketplace');
    searchInput?.focus();
    searchInput?.select();
  });

  // Global Tab Close Buttons handler
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.tab-close');
    if (!closeBtn) return;

    e.stopPropagation();
    e.preventDefault();

    const tab = closeBtn.closest('.tab');
    if (!tab) return;
    const tabId = tab.dataset.tabId;

    if (tabId && tabId.startsWith('tab-model-')) {
      closeModelTab(tabId);
      return;
    }

    tab.classList.add('hidden');

    if (state.activeTabId === tabId) {
      const visibleTabs = Array.from(document.querySelectorAll('.tab:not(.hidden)'));
      if (visibleTabs.length > 0) {
        const preferredTab = visibleTabs.find((t) => t.dataset.tabId === 'tab-project-manager')
          || visibleTabs.find((t) => t.dataset.tabId === 'tab-marketplace')
          || visibleTabs.find((t) => t.dataset.tabId === 'tab-downloads')
          || visibleTabs.find((t) => t.dataset.tabId === 'tab-project-selector')
          || visibleTabs[0];
        if (preferredTab && preferredTab.dataset.tabId) {
          switchTab(preferredTab.dataset.tabId);
        }
      }
    }
  });

  // Titlebar Right-Click Context Menu
  if (titlebar && titlebarContextMenu) {
    titlebar.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      const menuWidth = 220;
      const menuHeight = 220;
      let posX = e.clientX;
      let posY = e.clientY;

      if (posX + menuWidth > window.innerWidth) {
        posX = window.innerWidth - menuWidth - 10;
      }
      if (posY + menuHeight > window.innerHeight) {
        posY = window.innerHeight - menuHeight - 10;
      }

      titlebarContextMenu.style.left = `${posX}px`;
      titlebarContextMenu.style.top = `${posY}px`;
      titlebarContextMenu.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!titlebarContextMenu.contains(e.target)) {
        titlebarContextMenu.classList.add('hidden');
      }
    });

    document.getElementById('ctx-open-store')?.addEventListener('click', () => {
      titlebarContextMenu.classList.add('hidden');
      tabMarketplaceHeader?.classList.remove('hidden');
      switchTab('tab-marketplace');
    });

    document.getElementById('ctx-open-pm')?.addEventListener('click', () => {
      titlebarContextMenu.classList.add('hidden');
      tabProjectManagerHeader?.classList.remove('hidden');
      switchTab('tab-project-manager');
    });

    document.getElementById('ctx-open-downloads')?.addEventListener('click', () => {
      titlebarContextMenu.classList.add('hidden');
      tabDownloadsHeader?.classList.remove('hidden');
      switchTab('tab-downloads');
    });

    document.getElementById('ctx-open-folder')?.addEventListener('click', () => {
      titlebarContextMenu.classList.add('hidden');
      if (window.electronAPI && state.downloadDir) {
        window.electronAPI.openFolder(state.downloadDir);
      } else {
        showToast('No models folder selected yet.', 'info');
      }
    });

    document.getElementById('ctx-settings')?.addEventListener('click', () => {
      titlebarContextMenu.classList.add('hidden');
      if (onOpenSettings) onOpenSettings();
    });
  }
}
