// ============================================================================
// Marketplace 3D Models Search & Browse Module
// ============================================================================

import { state } from './state.js';

const FILE_FORMAT_LABELS = {
  glb: '.glb',
  gltf: '.gltf',
  usdz: '.usdz',
  source: 'Source files',
};

const LICENSE_FILTER_LABELS = {
  cc0: 'CC0 / Public Domain',
  'cc-by': 'CC Attribution',
  'cc-by-sa': 'CC Attribution-ShareAlike',
  'cc-by-nc': 'CC Attribution-NonCommercial',
  standard: 'Standard license',
};

function normalizeFormat(format) {
  return String(format || '').trim().toLowerCase().replace(/^\./, '');
}

export function getModelFormats(model) {
  const listedFormats = Array.isArray(model.formats) ? model.formats : [];
  const inferredFormat = normalizeFormat((model.filename || '').split('.').pop());
  const formats = [...listedFormats, inferredFormat]
    .map(normalizeFormat)
    .filter((format) => Object.hasOwn(FILE_FORMAT_LABELS, format));

  return [...new Set(formats)];
}

function matchesLicenseFilter(license, licenseFilter) {
  if (licenseFilter === 'all') return true;

  const normalizedLicense = String(license || '').toLowerCase();
  if (licenseFilter === 'cc0') {
    return normalizedLicense.includes('cc0') || normalizedLicense.includes('public domain');
  }
  if (licenseFilter === 'cc-by-sa') {
    return normalizedLicense.includes('sharealike') || normalizedLicense.includes('cc-by-sa');
  }
  if (licenseFilter === 'cc-by-nc') {
    return normalizedLicense.includes('noncommercial') || normalizedLicense.includes('cc-by-nc');
  }
  if (licenseFilter === 'cc-by') {
    return (normalizedLicense.includes('attribution') || normalizedLicense.includes('cc-by'))
      && !normalizedLicense.includes('sharealike')
      && !normalizedLicense.includes('noncommercial')
      && !normalizedLicense.includes('cc-by-sa')
      && !normalizedLicense.includes('cc-by-nc');
  }
  return normalizedLicense.includes('standard');
}

export function filterModels(models, { fileFormat = 'all', license = 'all' } = {}) {
  return models.filter((model) => {
    const hasRequestedFormat = fileFormat === 'all' || getModelFormats(model).includes(fileFormat);
    return hasRequestedFormat && matchesLicenseFilter(model.license, license);
  });
}

function describeActiveFilters({ fileFormat, license }) {
  const labels = [];
  if (fileFormat !== 'all') labels.push(FILE_FORMAT_LABELS[fileFormat]);
  if (license !== 'all') labels.push(LICENSE_FILTER_LABELS[license]);
  return labels.length > 0 ? ` (${labels.join(' · ')})` : '';
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchSketchfabSearchWithRetry(endpoint) {
  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response;

      const isTemporaryFailure = response.status === 429 || response.status >= 500;
      lastError = new Error(`HTTP ${response.status}`);
      if (!isTemporaryFailure || attempt === maxAttempts) break;

      const retryAfter = Number.parseInt(response.headers.get('retry-after'), 10) || 0;
      const retryDelay = retryAfter > 0
        ? Math.min(retryAfter * 1_000, 10_000)
        : 500 * (2 ** (attempt - 1));
      await wait(retryDelay);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await wait(500 * (2 ** (attempt - 1)));
    }
  }

  throw lastError || new Error('Sketchfab search failed.');
}

export function mapSketchfabModel(item) {
  let thumbUrl = 'https://media.sketchfab.com/models/placeholder.jpg';
  if (item.thumbnails && item.thumbnails.images && item.thumbnails.images.length > 0) {
    const sorted = [...item.thumbnails.images].sort((a, b) => (b.width || 0) - (a.width || 0));
    thumbUrl = sorted[0].url;
  }

  let avatarUrl = '';
  if (item.user && item.user.avatars && item.user.avatars.images && item.user.avatars.images.length > 0) {
    avatarUrl = item.user.avatars.images[0].url;
  }

  return {
    uid: item.uid,
    name: item.name || 'Untitled 3D Asset',
    author: item.user ? item.user.username : 'Unknown Artist',
    authorAvatar: avatarUrl,
    faceCount: item.faceCount || 0,
    vertexCount: item.vertexCount || 0,
    license: item.license?.label?.trim() || 'License unavailable — verify at source',
    source: 'sketchfab',
    sourceUrl: `https://sketchfab.com/3d-models/${item.uid}`,
    formats: Object.keys(item.archives || {}),
    thumbnail: thumbUrl,
    embedUrl: `https://sketchfab.com/models/${item.uid}/embed?autostart=1&ui_theme=dark`,
    filename: `${(item.name || 'Model').replace(/[^a-zA-Z0-9_-]/g, '_')}_${item.uid.substring(0, 6)}.zip`,
    isSketchfabApi: true,
  };
}

export async function fetchModels(query, downloadable = true, { onInspect, onDownload }) {
  const resultsCount = document.getElementById('results-count');
  const modelsGrid = document.getElementById('models-grid');
  const activeFilters = {
    fileFormat: state.fileFormatFilter,
    license: state.licenseFilter,
  };
  const filtersDescription = describeActiveFilters(activeFilters);
  if (!modelsGrid) return;

  if (resultsCount) resultsCount.textContent = 'Searching 3D marketplace...';
  modelsGrid.innerHTML = `
    <div class="empty-state" style="grid-column: 1 / -1;">
      <div class="spinner" style="margin: 0 auto 12px auto;"></div>
      <span>Searching 3D assets...</span>
    </div>
  `;

  try {
    const encodedQuery = encodeURIComponent(query.trim() || '3d');
    const endpoint = `https://api.sketchfab.com/v3/search?type=models&q=${encodedQuery}&downloadable=${downloadable}&sort_by=-likeCount`;

    const response = await fetchSketchfabSearchWithRetry(endpoint);

    const data = await response.json();
    const fetchedResults = data.results || [];

    const filteredModels = filterModels(fetchedResults.map(mapSketchfabModel), activeFilters);

    if (filteredModels.length === 0) {
      if (resultsCount) resultsCount.textContent = `No models found for "${query}"${filtersDescription}`;
      modelsGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <span>No 3D models matched this search and filter combination. Try a different keyword or clear the filters.</span>
        </div>
      `;
      return;
    }

    if (resultsCount) resultsCount.textContent = `Found ${filteredModels.length} models for "${query}"${filtersDescription}`;
    renderModelsGrid(filteredModels, { onInspect, onDownload });
  } catch (error) {
    console.warn('[Marketplace] Sketchfab search failed:', error);
    if (resultsCount) resultsCount.textContent = 'Sketchfab is temporarily unavailable.';
    modelsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <span>Sketchfab results could not be loaded. Please try again shortly.</span>
      </div>
    `;
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

let activeAudio = null;
let activeAudioBtn = null;

export function stopActiveAudio() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
  if (activeAudioBtn) {
    activeAudioBtn.querySelector('.icon-play')?.classList.remove('hidden');
    activeAudioBtn.querySelector('.icon-pause')?.classList.add('hidden');
    activeAudioBtn.classList.remove('playing');
    activeAudioBtn = null;
  }
}

function renderExternalAssets(assets, { storeKey, onDownload, onOpenSource }) {
  stopActiveAudio();
  const resultsCount = document.getElementById('results-count');
  const modelsGrid = document.getElementById('models-grid');
  if (!modelsGrid) return;
  const storeTitle = storeKey === 'sound' ? 'sound results' : 'itch.io 2D listings';
  if (resultsCount) {
    resultsCount.textContent = assets.length > 0
      ? `${assets.length} ${storeTitle} found`
      : `No ${storeTitle} matched "${state.searchQuery}"`;
  }

  modelsGrid.innerHTML = '';
  if (assets.length === 0) {
    modelsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <span>Try another keyword or clear the search.</span>
      </div>
    `;
    return;
  }

  assets.forEach((asset) => {
    const card = document.createElement('div');
    card.className = 'model-card external-asset-card';
    const isItchListing = asset.source === 'itchio';
    const isPixabayListing = asset.source === 'pixabay';
    const targetLabel = isItchListing ? 'View / Buy on itch.io' : 'Download MP3';
    const duration = asset.durationSeconds ? ` · ${asset.durationSeconds.toFixed(1)}s` : '';
    const sourceMeta = isItchListing ? asset.price : asset.license;
    const tags = (asset.tags || []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    const hasThumb = Boolean(asset.thumbnail && asset.thumbnail.trim());
    const hasAudioDirect = Boolean(asset.directUrl && asset.directUrl.startsWith('http'));

    card.innerHTML = `
      <div class="card-media">
        ${hasThumb ? `
          <img src="${escapeHtml(asset.thumbnail)}" class="card-thumbnail" alt="${escapeHtml(asset.name)}" loading="lazy">
        ` : `
          <div class="audio-card-placeholder">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
            <span class="audio-card-duration">${asset.durationSeconds ? `${asset.durationSeconds.toFixed(1)}s` : 'Audio'}</span>
          </div>
        `}
        <span class="card-format-badge">${escapeHtml(asset.format)}</span>
      </div>
      <div class="card-content">
        <h4 class="card-title" title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</h4>
        <div class="card-author"><span>${escapeHtml(asset.author)}${isItchListing ? '' : ` · ${escapeHtml(sourceMeta)}${duration}`}</span></div>
        ${isItchListing ? `<div class="itch-price">${escapeHtml(sourceMeta)}</div>` : ''}
        <p class="external-asset-description">${escapeHtml(asset.description || 'No description provided by the source.')}</p>
        <div class="external-asset-tags">${tags}</div>
        <div class="card-actions">
          ${hasAudioDirect ? `
            <button class="btn-card-audio-preview" data-action="preview" title="Play / Pause Audio Preview">
              <svg class="icon-play" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <svg class="icon-pause hidden" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
              <span>Preview</span>
            </button>
          ` : ''}
          <button class="btn-card-inspect btn-card-download-external" data-action="download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>${targetLabel}</span>
          </button>
        </div>
      </div>
    `;

    card.querySelector('[data-action="preview"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const btn = event.currentTarget;
      if (activeAudio && activeAudioBtn === btn) {
        stopActiveAudio();
        return;
      }
      stopActiveAudio();
      const audio = new Audio(asset.directUrl);
      activeAudio = audio;
      activeAudioBtn = btn;
      btn.querySelector('.icon-play')?.classList.add('hidden');
      btn.querySelector('.icon-pause')?.classList.remove('hidden');
      btn.classList.add('playing');
      audio.play().catch((err) => {
        console.warn('Audio preview error:', err);
        stopActiveAudio();
      });
      audio.addEventListener('ended', () => stopActiveAudio());
      audio.addEventListener('error', () => stopActiveAudio());
    });

    card.querySelector('[data-action="download"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (isItchListing) onOpenSource?.(asset);
      else onDownload?.(asset);
    });

    const thumb = card.querySelector('.card-thumbnail');
    thumb?.addEventListener('error', () => {
      thumb.remove();
      const fallback = document.createElement('div');
      fallback.className = 'thumbnail-error-fallback';
      fallback.textContent = 'Thumbnail load error';
      card.querySelector('.card-media')?.prepend(fallback);
    });
    modelsGrid.appendChild(card);
  });
}

async function fetchItch2DAssets(query, { onOpenSource }) {
  stopActiveAudio();
  const resultsCount = document.getElementById('results-count');
  const modelsGrid = document.getElementById('models-grid');
  if (!modelsGrid) return;
  if (resultsCount) resultsCount.textContent = 'Searching itch.io 2D listings...';
  modelsGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div class="spinner" style="margin: 0 auto 12px auto;"></div><span>Loading itch.io listings...</span></div>';

  const result = await window.electronAPI.searchItch2DAssets({ query, limit: 30 });
  if (!result.success) {
    if (resultsCount) resultsCount.textContent = 'itch.io listings could not be loaded.';
    modelsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><span>${escapeHtml(result.error || 'Could not load itch.io listings.')}</span></div>`;
    return;
  }
  renderExternalAssets(result.assets, { storeKey: '2d', onOpenSource });
}

async function fetchPixabaySoundAssets(query, { onDownload, onOpenSource } = {}) {
  stopActiveAudio();
  const resultsCount = document.getElementById('results-count');
  const modelsGrid = document.getElementById('models-grid');
  if (!modelsGrid) return;
  if (resultsCount) resultsCount.textContent = 'Loading live Pixabay sound effects...';
  modelsGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div class="spinner" style="margin: 0 auto 12px auto;"></div><span>Loading live sound effects...</span></div>';

  const result = await window.electronAPI.searchPixabaySoundEffects({ query, limit: 30 });
  if (!result.success) {
    if (resultsCount) resultsCount.textContent = 'Sound effects could not be loaded.';
    modelsGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><span>${escapeHtml(result.error || 'Could not load sound effects.')}</span></div>`;
    return;
  }
  renderExternalAssets(result.assets, { storeKey: 'sound', onDownload, onOpenSource });
}

export function loadActiveStore({ onInspect, onDownload, onOpenSource }) {
  if (state.activeStore === '3d') {
    fetchModels(state.searchQuery || 'sword', state.downloadableOnly, { onInspect, onDownload });
    return;
  }
  if (state.activeStore === '2d') {
    fetchItch2DAssets(state.searchQuery, { onOpenSource });
    return;
  }
  fetchPixabaySoundAssets(state.searchQuery, { onDownload, onOpenSource });
}

export function setActiveMarketplaceStore(storeKey) {
  if (!['3d', '2d', 'sound'].includes(storeKey)) return false;

  stopActiveAudio();
  state.activeStore = storeKey;
  state.searchQuery = storeKey === '3d' ? 'sword' : '';

  document.querySelectorAll('[data-store]').forEach((button) => {
    const isActive = button.dataset.store === storeKey;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.store-3d-controls').forEach((element) => {
    element.classList.toggle('hidden', storeKey !== '3d');
  });

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = state.searchQuery;
    searchInput.placeholder = storeKey === '3d'
      ? 'Search 3D models (characters, weapons, vehicles, props)...'
      : storeKey === '2d' ? 'Search 2D assets...' : 'Search sound effects...';
  }
  document.getElementById('btn-clear-search')?.classList.toggle('hidden', !state.searchQuery);

  const sourceTag = document.getElementById('marketplace-source-tag');
  if (sourceTag) {
    sourceTag.textContent = storeKey === '3d'
      ? 'Sketchfab API'
      : storeKey === '2d' ? 'itch.io 2D catalog' : 'Pixabay Sound Catalog';
  }
  return true;
}

export function renderModelsGrid(models, { onInspect, onDownload }) {
  const modelsGrid = document.getElementById('models-grid');
  if (!modelsGrid) return;
  modelsGrid.innerHTML = '';

  models.forEach((model) => {
    const card = document.createElement('div');
    card.className = 'model-card';

    const polyDisplay = model.faceCount > 1000
      ? `${(model.faceCount / 1000).toFixed(1)}k polys`
      : `${model.faceCount} polys`;

    const avatarHtml = model.authorAvatar
      ? `<img src="${model.authorAvatar}" class="author-avatar" alt="${model.author}">`
      : '';

    const formats = getModelFormats(model);
    const formatLabel = formats.length > 0
      ? formats.map((format) => FILE_FORMAT_LABELS[format]).join(' · ')
      : 'Format unavailable';

    card.innerHTML = `
      <div class="card-media">
        <img src="${model.thumbnail}" class="card-thumbnail" alt="${model.name}" loading="lazy">
        <span class="card-poly-badge">${polyDisplay}</span>
        <span class="card-format-badge">${formatLabel}</span>
      </div>
      <div class="card-content">
        <h4 class="card-title" title="${model.name}">${model.name}</h4>
        <div class="card-author">
          ${avatarHtml}
          <span>${model.author}</span>
        </div>
        <div class="card-actions">
          <button class="btn-card-inspect" data-action="inspect">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Inspect 3D</span>
          </button>
          <button class="btn-card-download" data-action="download" title="Download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
        </div>
      </div>
    `;

    const thumbImg = card.querySelector('.card-thumbnail');
    if (thumbImg) {
      thumbImg.onerror = function () {
        const mediaContainer = this.closest('.card-media');
        if (mediaContainer) {
          this.remove();
          const fallback = document.createElement('div');
          fallback.className = 'thumbnail-error-fallback';
          fallback.setAttribute('data-error', 'Thumbail load error');
          fallback.innerHTML = `
            <svg class="thumbnail-error-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
              <line x1="2" y1="2" x2="22" y2="22" stroke-width="1.5"></line>
            </svg>
            <span class="thumbnail-error-text">Thumbail load error</span>
          `;
          mediaContainer.prepend(fallback);
        }
      };
    }

    card.querySelector('[data-action="inspect"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (onInspect) onInspect(model);
    });

    card.querySelector('[data-action="download"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (onDownload) onDownload(model);
    });

    card.addEventListener('click', () => {
      if (onInspect) onInspect(model);
    });

    modelsGrid.appendChild(card);
  });
}

export function initMarketplaceModule({ onInspect, onDownload, onOpenSource }) {
  const searchInput = document.getElementById('search-input');
  const btnSearch = document.getElementById('btn-search');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const categoryChips = document.getElementById('category-chips');
  const chkDownloadable = document.getElementById('chk-downloadable-only');
  const fileFormatFilter = document.getElementById('filter-file-format');
  const licenseFilter = document.getElementById('filter-license');
  const btnClearFilters = document.getElementById('btn-clear-filters');
  const storeTabs = document.getElementById('store-tabs');

  const refreshResults = () => {
    const query = searchInput?.value.trim() || (state.activeStore === '3d' ? 'sword' : '');
    state.searchQuery = query;
    state.downloadableOnly = chkDownloadable ? chkDownloadable.checked : true;
    loadActiveStore({ onInspect, onDownload, onOpenSource });
  };

  const setActiveStore = (storeKey) => {
    if (!setActiveMarketplaceStore(storeKey)) return;
    refreshResults();
  };

  const updateClearFiltersButton = () => {
    if (btnClearFilters) {
      btnClearFilters.disabled = state.fileFormatFilter === 'all' && state.licenseFilter === 'all';
    }
  };

  if (fileFormatFilter) fileFormatFilter.value = state.fileFormatFilter;
  if (licenseFilter) licenseFilter.value = state.licenseFilter;
  updateClearFiltersButton();

  btnSearch?.addEventListener('click', () => {
    refreshResults();
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnSearch?.click();
    }
  });

  searchInput?.addEventListener('input', () => {
    if (btnClearSearch && searchInput) {
      btnClearSearch.classList.toggle('hidden', searchInput.value.length === 0);
    }
  });

  btnClearSearch?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      btnClearSearch.classList.add('hidden');
      searchInput.focus();
    }
  });

  chkDownloadable?.addEventListener('change', () => {
    refreshResults();
  });

  fileFormatFilter?.addEventListener('change', () => {
    state.fileFormatFilter = fileFormatFilter.value;
    updateClearFiltersButton();
    refreshResults();
  });

  licenseFilter?.addEventListener('change', () => {
    state.licenseFilter = licenseFilter.value;
    updateClearFiltersButton();
    refreshResults();
  });

  btnClearFilters?.addEventListener('click', () => {
    state.fileFormatFilter = 'all';
    state.licenseFilter = 'all';
    if (fileFormatFilter) fileFormatFilter.value = 'all';
    if (licenseFilter) licenseFilter.value = 'all';
    updateClearFiltersButton();
    refreshResults();
  });

  categoryChips?.addEventListener('click', (e) => {
    if (state.activeStore !== '3d') return;
    const chip = e.target.closest('.chip');
    if (!chip) return;

    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');

    const category = chip.dataset.category;
    state.activeCategory = category;
    if (searchInput) {
      searchInput.value = category;
      btnClearSearch?.classList.remove('hidden');
    }
    state.searchQuery = category;
    refreshResults();
  });

  storeTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-store]');
    if (button) setActiveStore(button.dataset.store);
  });
}
