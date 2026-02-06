// Datadog Log Explorer Tenant Name Extension - Content Script
// Adds tenant names next to accountId UUIDs in the JSON viewer panel

(async function() {
  'use strict';

  // Wait for shared utilities to be available (with retry)
  async function waitForSharedUtilities(maxAttempts = 10, interval = 100) {
    for (let i = 0; i < maxAttempts; i++) {
      if (window.TenantNameExtension) {
        return window.TenantNameExtension;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    return null;
  }

  const ext = await waitForSharedUtilities();
  if (!ext) {
    console.error('[Datadog Extension] Shared utilities not loaded after retries');
    return;
  }

  // Process all accountId rows in the JSON viewer (at any nesting level)
  function processAccountIdRows() {
    // Find ALL rows with the JSON viewer row class (works at any depth)
    const allRows = document.querySelectorAll('.druids_misc_json-viewer_row-layout');
    
    allRows.forEach(row => {
      // Get the key cell and value cell
      const keyCell = row.querySelector('.druids_misc_json-viewer_row-layout__key');
      const valueCell = row.querySelector('.druids_misc_json-viewer_row-layout__value');
      
      if (!keyCell || !valueCell) return;
      
      // Check if key is "accountId" (exact match)
      const keyText = keyCell.textContent?.trim();
      if (keyText !== 'accountId') return;
      
      // Skip if already processed
      if (valueCell.hasAttribute('data-tenant-processed')) return;
      
      // Get the value and validate it's a UUID
      const valueText = valueCell.textContent?.trim();
      if (!ext.isValidUUID(valueText)) {
        valueCell.setAttribute('data-tenant-processed', 'true');
        return;
      }
      
      // Get tenant name
      const tenantName = ext.getTenantName(valueText);
      
      // Only add tenant name if we have a mapping (not "Unknown")
      if (tenantName === 'Unknown') {
        valueCell.setAttribute('data-tenant-processed', 'true');
        return;
      }
      
      // Append tenant name to the value cell
      const label = document.createElement('span');
      label.className = 'tenant-name-label';
      label.textContent = tenantName;
      valueCell.appendChild(label);
      
      valueCell.setAttribute('data-tenant-processed', 'true');
      console.log('[Datadog Extension] Added tenant name for accountId:', valueText);
    });
  }

  // Clear processed markers to allow reprocessing
  function clearProcessedMarkers() {
    document.querySelectorAll('[data-tenant-processed]').forEach(item => {
      item.removeAttribute('data-tenant-processed');
      // Remove existing tenant labels
      const labels = item.querySelectorAll('.tenant-name-label');
      labels.forEach(label => label.remove());
    });
  }

  // Handle when mappings are updated
  function handleMappingsUpdate() {
    console.log('[Datadog Extension] Mappings updated, reprocessing');
    clearProcessedMarkers();
    processAccountIdRows();
  }

  // Set up observer for new JSON viewer elements appearing
  function observeForJsonViewer() {
    let debounceTimer = null;
    
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      
      // Check if any new JSON viewer rows were added
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if this is or contains JSON viewer rows
              if (node.classList?.contains('druids_misc_json-viewer_row-layout') ||
                  node.querySelector?.('.druids_misc_json-viewer_row-layout')) {
                shouldProcess = true;
                break;
              }
            }
          }
          if (shouldProcess) break;
        }
      }

      if (shouldProcess) {
        // Debounce to avoid processing too frequently during rapid DOM updates
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          console.log('[Datadog Extension] New JSON viewer elements detected');
          processAccountIdRows();
          debounceTimer = null;
        }, 150);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[Datadog Extension] Set up JSON viewer observer');
  }

  // Initialize the extension
  async function initExtension() {
    console.log('[Datadog Extension] Initializing...');

    // Check if Datadog is enabled in settings
    const settings = await chrome.storage.sync.get(['siteSettings']);
    const siteSettings = settings.siteSettings || { temporal: true, clickhouse: true, datadog: true };
    
    if (siteSettings.datadog === false) {
      console.log('[Datadog Extension] Datadog is disabled in settings');
      return;
    }

    // Load tenant mappings
    await ext.loadTenantMappings();

    // Try to process any existing accountId rows
    processAccountIdRows();

    // Set up observer for new JSON viewer elements
    observeForJsonViewer();

    // Set up storage change listener
    ext.setupStorageListener(handleMappingsUpdate);

    // For SPAs: retry processing a few times during initial load
    // This catches elements that render after the initial scan
    let retryCount = 0;
    const maxRetries = 5;
    const retryInterval = setInterval(() => {
      retryCount++;
      processAccountIdRows();
      if (retryCount >= maxRetries) {
        clearInterval(retryInterval);
        console.log('[Datadog Extension] Initial retry scans complete');
      }
    }, 500);

    console.log('[Datadog Extension] Initialization complete');
  }

  // Listen for site settings changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.siteSettings) {
      const newSettings = changes.siteSettings.newValue || { temporal: true, clickhouse: true, datadog: true };
      if (newSettings.datadog === false) {
        console.log('[Datadog Extension] Disabled via settings, cleaning up');
        // Remove any added tenant labels
        document.querySelectorAll('.tenant-name-label').forEach(label => label.remove());
        document.querySelectorAll('[data-tenant-processed]').forEach(el => {
          el.removeAttribute('data-tenant-processed');
        });
      } else {
        console.log('[Datadog Extension] Enabled via settings, reinitializing');
        initExtension();
      }
    }
  });

  // Start the extension
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExtension);
  } else {
    initExtension();
  }

})();
