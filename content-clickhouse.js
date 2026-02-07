// ClickHouse Cloud Tenant Name Extension - Content Script
// Adds tenant names next to UUID database names in the database picker dropdown

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
    console.error('[ClickHouse Extension] Shared utilities not loaded after retries');
    return;
  }

  // Process a single database name element
  function processDatabaseElement(element) {
    // Check if already processed
    if (element.hasAttribute('data-tenant-processed')) {
      return;
    }

    // Get text content, but exclude any existing tenant labels
    let databaseName = element.textContent.trim();
    const existingLabel = element.querySelector('.tenant-name-label');
    if (existingLabel) {
      databaseName = databaseName.replace(existingLabel.textContent, '').trim();
    }
    
    // Only process if it's a UUID
    if (!ext.isValidUUID(databaseName)) {
      element.setAttribute('data-tenant-processed', 'true');
      return;
    }

    const tenantName = ext.getTenantName(databaseName);
    
    // Only add tenant name if we have a mapping (not "Unknown")
    if (tenantName === 'Unknown') {
      element.setAttribute('data-tenant-processed', 'true');
      return;
    }

    // Check if tenant label already exists
    if (existingLabel) {
      element.setAttribute('data-tenant-processed', 'true');
      return;
    }

    // Create tenant name label
    const tenantLabel = document.createElement('span');
    tenantLabel.className = 'tenant-name-label';
    tenantLabel.textContent = ` (${tenantName})`;
    
    // Append to the database name element
    element.appendChild(tenantLabel);

    // Mark as processed
    element.setAttribute('data-tenant-processed', 'true');
    console.log('[ClickHouse Extension] Added tenant name for:', databaseName);
  }

  // Check if text content looks like a UUID (possibly with tenant label appended)
  function containsUUID(text) {
    if (!text) return false;
    // Check if text starts with a UUID pattern
    const uuidMatch = text.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuidMatch !== null;
  }

  // Process all database name elements
  function processAllDatabaseElements() {
    // Find all elements that might contain UUIDs
    const allElements = document.querySelectorAll('div, span');
    
    allElements.forEach(element => {
      // Skip if already processed
      if (element.hasAttribute('data-tenant-processed')) {
        return;
      }
      
      // Get direct text content (not from children)
      const directText = Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.trim())
        .join('');
      
      // Check if this element directly contains a UUID
      if (directText && ext.isValidUUID(directText)) {
        processDatabaseElement(element);
        return;
      }
      
      // Also check full text content for elements with minimal children
      if (element.childElementCount <= 1) {
        const text = element.textContent?.trim();
        if (text && containsUUID(text) && ext.isValidUUID(text.substring(0, 36))) {
          processDatabaseElement(element);
        }
      }
    });
  }

  // Process database names whenever they appear
  function processDropdown() {
    processAllDatabaseElements();
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
    console.log('[ClickHouse Extension] Mappings updated, reprocessing');
    clearProcessedMarkers();
    processDropdown();
  }

  // Set up observer for new database elements appearing
  function observeForDatabaseElements() {
    let debounceTimer = null;
    
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      
      // Check if any new elements were added that might contain UUIDs
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if this node or its children contain UUIDs
              const text = node.textContent?.trim();
              if (text && containsUUID(text)) {
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
          console.log('[ClickHouse Extension] New database elements detected');
          processAllDatabaseElements();
          debounceTimer = null;
        }, 150);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[ClickHouse Extension] Set up database element observer');
  }

  // Initialize the extension
  async function initExtension() {
    console.log('[ClickHouse Extension] Initializing...');

    // Check if extension context is still valid
    if (!ext.isContextValid()) {
      console.log('[ClickHouse Extension] Extension context invalidated, skipping initialization');
      return;
    }

    // Check if ClickHouse Cloud is enabled in settings
    let settings;
    try {
      settings = await chrome.storage.sync.get(['siteSettings']);
    } catch (error) {
      console.error('[ClickHouse Extension] Error accessing storage (context may be invalidated):', error);
      return;
    }
    
    const siteSettings = settings.siteSettings || { temporal: true, clickhouse: true };
    
    if (siteSettings.clickhouse === false) {
      console.log('[ClickHouse Extension] ClickHouse Cloud is disabled in settings');
      return;
    }

    // Load tenant mappings
    await ext.loadTenantMappings();

    // Try to process any existing database elements
    processDropdown();

    // Set up observer for new database elements
    observeForDatabaseElements();

    // Set up storage change listener
    ext.setupStorageListener(handleMappingsUpdate);

    // For SPAs: retry processing a few times during initial load
    // This catches elements that render after the initial scan
    let retryCount = 0;
    const maxRetries = 5;
    const retryInterval = setInterval(() => {
      retryCount++;
      processAllDatabaseElements();
      if (retryCount >= maxRetries) {
        clearInterval(retryInterval);
        console.log('[ClickHouse Extension] Initial retry scans complete');
      }
    }, 500);

    console.log('[ClickHouse Extension] Initialization complete');
  }

  // Listen for site settings changes
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!ext.isContextValid()) {
        console.log('[ClickHouse Extension] Extension context invalidated, ignoring storage change');
        return;
      }
      
      if (area === 'sync' && changes.siteSettings) {
        const newSettings = changes.siteSettings.newValue || { temporal: true, clickhouse: true };
        if (newSettings.clickhouse === false) {
          console.log('[ClickHouse Extension] Disabled via settings, cleaning up');
          // Remove any added tenant labels
          document.querySelectorAll('.tenant-name-label').forEach(label => label.remove());
          document.querySelectorAll('[data-tenant-processed]').forEach(el => {
            el.removeAttribute('data-tenant-processed');
          });
        } else {
          console.log('[ClickHouse Extension] Enabled via settings, reinitializing');
          initExtension();
        }
      }
    });
  } catch (error) {
    console.error('[ClickHouse Extension] Error setting up storage listener:', error);
  }

  // Start the extension
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExtension);
  } else {
    initExtension();
  }

})();
