/**
 * ui.js — UI Utility Functions
 * Handles loading overlay, toast notifications, sidebar toggle, and stats updates.
 */

const UI = (() => {

  // --- Loading Overlay ---
  function showLoading(message = 'Memuatkan data...') {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    if (overlay) {
      overlay.classList.remove('hidden');
      if (textEl) textEl.textContent = message;
    }
  }

  function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function updateLoadingText(message) {
    const textEl = document.getElementById('loading-text');
    if (textEl) textEl.textContent = message;
  }

  // --- Toast Notifications ---
  function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
      success: '✅',
      error: '❌',
      info: 'ℹ️',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    container.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // --- Sidebar Toggle ---
  function initSidebarToggle() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');

    if (toggle && sidebar) {
      toggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        toggle.innerHTML = sidebar.classList.contains('collapsed') ? '☰' : '✕';
      });
    }
  }

  // --- Stats Update ---
  function updateStats(totalResidents, pinCount, matchedCount) {
    const elTotal = document.getElementById('stat-total');
    const elPins = document.getElementById('stat-pins');
    const elMatched = document.getElementById('stat-matched');

    if (elTotal) elTotal.textContent = totalResidents.toLocaleString();
    if (elPins) elPins.textContent = pinCount.toLocaleString();
    if (elMatched) elMatched.textContent = matchedCount.toLocaleString();
  }

  // --- Taman Search Button Loading State ---
  function setTamanSearchLoading(isLoading) {
    const btn = document.getElementById('btn-taman-search');
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = 'Mencari…';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || 'Cari';
    }
  }

  return {
    showLoading,
    hideLoading,
    updateLoadingText,
    showToast,
    initSidebarToggle,
    updateStats,
    setTamanSearchLoading,
  };
})();
