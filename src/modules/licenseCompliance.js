// ============================================================================
// Per-download license and copyright compliance gate
// ============================================================================

import { showToast } from './toast.js';

let pendingResolution = null;
let pendingAsset = null;

const modal = () => document.getElementById('modal-license-confirm');
const acceptanceCheckbox = () => document.getElementById('license-confirm-checkbox');
const confirmButton = () => document.getElementById('btn-license-confirm');

function text(value, fallback = 'Not provided') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function sourceLabel(source) {
  return ({ sketchfab: 'Sketchfab', pixabay: 'Pixabay', itchio: 'itch.io' })[String(source || '').toLowerCase()]
    || 'Asset provider';
}

function assetIdentifier(asset) {
  return text(asset.uid || asset.id || `${asset.source}:${asset.name}`, '').slice(0, 256);
}

function listingUrl(asset) {
  try {
    const url = new URL(asset.sourceUrl);
    if (url.protocol === 'https:') return url.href;
  } catch {
    // The bridge will reject non-HTTPS or mismatched provider URLs too.
  }
  return '';
}

function unknownLicense(license) {
  return /unknown|unavailable|verify/i.test(text(license));
}

function finish(result) {
  const dialog = modal();
  dialog?.classList.add('hidden');
  pendingAsset = null;
  const resolve = pendingResolution;
  pendingResolution = null;
  resolve?.(result);
}

function populateModal(asset) {
  const source = String(asset.source || '').toLowerCase();
  const url = listingUrl(asset);
  document.getElementById('license-asset-name').textContent = text(asset.name, 'Untitled asset');
  document.getElementById('license-asset-provider').textContent = sourceLabel(source);
  document.getElementById('license-asset-license').textContent = text(asset.license);

  const sourceLink = document.getElementById('license-source-link');
  if (sourceLink) {
    sourceLink.href = url || '#';
    sourceLink.classList.toggle('disabled', !url);
    sourceLink.setAttribute('aria-disabled', String(!url));
  }

  const checkbox = acceptanceCheckbox();
  if (checkbox) checkbox.checked = false;
  const button = confirmButton();
  if (button) button.disabled = true;
}

export function initLicenseCompliance() {
  const checkbox = acceptanceCheckbox();
  const button = confirmButton();
  const cancel = document.getElementById('btn-license-cancel');
  const close = document.getElementById('btn-license-close');

  checkbox?.addEventListener('change', () => {
    if (button) button.disabled = !checkbox.checked;
  });

  const cancelAcceptance = () => finish(null);
  cancel?.addEventListener('click', cancelAcceptance);
  close?.addEventListener('click', cancelAcceptance);

  button?.addEventListener('click', async () => {
    if (!pendingAsset || !checkbox?.checked || !window.electronAPI) return;
    const source = String(pendingAsset.source || '').toLowerCase();
    const url = listingUrl(pendingAsset);
    const assetId = assetIdentifier(pendingAsset);
    if (!assetId || !url) {
      showToast('The official asset listing is required before downloading.', 'error');
      return;
    }

    button.disabled = true;
    button.textContent = 'Recording acceptance…';
    try {
      const result = await window.electronAPI.recordLicenseAcceptance({
        assetId,
        source,
        license: text(pendingAsset.license),
        listingUrl: url,
      });
      if (!result?.success || !result.acceptanceId) {
        throw new Error(result?.error || 'Could not record the license acceptance.');
      }
      finish({
        acceptanceId: result.acceptanceId,
        acceptedAt: result.acceptedAt,
        assetId,
        source,
        license: text(pendingAsset.license),
        listingUrl: url,
      });
    } catch (error) {
      showToast(error.message || 'License acceptance could not be recorded.', 'error');
      button.disabled = false;
    } finally {
      button.textContent = 'Accept license & download';
    }
  });
}

export function requireLicenseAcceptance(asset) {
  if (!asset) return Promise.resolve(null);
  if (!listingUrl(asset)) {
    showToast('This asset has no verified official listing. Download was blocked.', 'error');
    return Promise.resolve(null);
  }
  if (unknownLicense(asset.license)) {
    showToast('The license is unknown. Review the official listing; this download is blocked.', 'error');
    return Promise.resolve(null);
  }
  if (!String(asset.source || '').match(/^(sketchfab|pixabay|itchio)$/i)) {
    showToast('The asset provider is not approved for direct downloads.', 'error');
    return Promise.resolve(null);
  }

  if (pendingResolution) finish(null);
  pendingAsset = asset;
  populateModal(asset);
  modal()?.classList.remove('hidden');
  return new Promise((resolve) => {
    pendingResolution = resolve;
  });
}
