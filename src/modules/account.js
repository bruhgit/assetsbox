// ============================================================================
// Account & Profile Management Module (.png upload & circular display)
// ============================================================================

import { state, saveUserProfile, markSetupCompleted } from './state.js';
import { showToast } from './toast.js';

export function getAvatarHtml(userProfile, size = 24) {
  if (userProfile && userProfile.avatarUrl) {
    return `<img src="${userProfile.avatarUrl}" class="avatar-circle-img-rendered" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; display:block;" alt="${userProfile.name || 'User'}">`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
}

export function updateAccountWidget() {
  const widget = document.getElementById('account-widget');
  const widgetAvatar = document.getElementById('account-widget-avatar');
  const widgetName = document.getElementById('account-widget-name');

  if (!widget) return;

  const profile = state.userProfile || { name: 'Developer', avatarUrl: '' };
  if (widgetName) widgetName.textContent = profile.name || 'Developer';
  if (widgetAvatar) widgetAvatar.innerHTML = getAvatarHtml(profile, 24);
}

export function bindAvatarCircleUploader({ circleEl, fileInputEl, imgEl, placeholderEl, initialUrl, onImageLoaded }) {
  if (!circleEl || !fileInputEl || !imgEl || !placeholderEl) return;

  function renderImage(url) {
    if (url && url.length > 0) {
      imgEl.src = url;
      imgEl.classList.remove('hidden');
      placeholderEl.classList.add('hidden');
      circleEl.classList.add('has-image');
    } else {
      imgEl.src = '';
      imgEl.classList.add('hidden');
      placeholderEl.classList.remove('hidden');
      circleEl.classList.remove('has-image');
    }
  }

  if (initialUrl) {
    renderImage(initialUrl);
  }

  circleEl.addEventListener('click', () => {
    fileInputEl.click();
  });

  fileInputEl.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file (.png, .jpg, .webp)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const dataUrl = loadEvent.target.result;
      renderImage(dataUrl);
      if (onImageLoaded) onImageLoaded(dataUrl);
      showToast('Profile icon loaded successfully!', 'success');
    };
    reader.onerror = () => {
      showToast('Failed to read image file.', 'error');
    };
    reader.readAsDataURL(file);
  });
}

export function initAccountModule({ onSetupComplete, onOpenProfileSettings }) {
  const setupCircle = document.getElementById('setup-avatar-circle');
  const setupFileInput = document.getElementById('setup-avatar-file-input');
  const setupImg = document.getElementById('setup-avatar-img');
  const setupPlaceholder = document.getElementById('setup-avatar-placeholder');
  const inputSetupName = document.getElementById('setup-account-name');
  const btnCompleteSetup = document.getElementById('btn-complete-account-setup');
  const accountWidget = document.getElementById('account-widget');

  let currentAvatarUrl = state.userProfile?.avatarUrl || '';

  if (inputSetupName && state.userProfile?.name) {
    inputSetupName.value = state.userProfile.name;
  }

  bindAvatarCircleUploader({
    circleEl: setupCircle,
    fileInputEl: setupFileInput,
    imgEl: setupImg,
    placeholderEl: setupPlaceholder,
    initialUrl: currentAvatarUrl,
    onImageLoaded: (url) => {
      currentAvatarUrl = url;
    },
  });

  btnCompleteSetup?.addEventListener('click', () => {
    const name = inputSetupName?.value.trim() || 'Developer';
    saveUserProfile({
      name,
      avatarUrl: currentAvatarUrl,
    });
    markSetupCompleted(true);
    updateAccountWidget();
    showToast(`Welcome, ${name}! Your workspace is ready.`, 'success');
    if (onSetupComplete) onSetupComplete();
  });

  accountWidget?.addEventListener('click', () => {
    if (onOpenProfileSettings) {
      onOpenProfileSettings();
    }
  });

  // Initial widget render
  updateAccountWidget();
}
