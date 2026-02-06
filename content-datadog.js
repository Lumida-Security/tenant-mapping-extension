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

  // Extract account UUID from URL paths matching /accounts/{uuid}/...
  function extractAccountIdFromPath(pathOrUrl) {
    if (!pathOrUrl) return null;
    const match = pathOrUrl.match(/\/accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return match ? match[1] : null;
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

  // Process URL elements in HTTP Requests and Span Attributes sections
  function processUrlElements() {
    // Target 1: Buttons in HTTP Requests section containing URLs
    const buttons = document.querySelectorAll('button');
    
    buttons.forEach(button => {
      // Skip if already processed
      if (button.hasAttribute('data-tenant-url-processed')) return;
      
      const buttonText = button.textContent || '';
      
      // Look for buttons that contain URL-related labels and account paths
      // Check for various patterns: "URL:", "URL", "HTTP Path:", "HTTP Path", etc.
      const isUrlButton = buttonText.includes('URL') || 
                          buttonText.includes('HTTP Path') ||
                          buttonText.includes('http.url') ||
                          buttonText.includes('http.path');
      
      // Also check if the button contains an account UUID path
      const hasAccountPath = buttonText.includes('/accounts/');
      
      if (isUrlButton && hasAccountPath) {
        const accountId = extractAccountIdFromPath(buttonText);
        
        if (accountId) {
          const tenantName = ext.getTenantName(accountId);
          
          // Only add tenant name if we have a mapping (not "Unknown")
          if (tenantName !== 'Unknown') {
            // Check if we already have a label inside this button
            if (!button.querySelector('.tenant-name-label-url')) {
              const label = document.createElement('span');
              label.className = 'tenant-name-label-url';
              label.textContent = tenantName;
              // Append directly to button
              button.appendChild(label);
              console.log('[Datadog Extension] Added tenant name for URL button:', accountId, 'buttonText:', buttonText.substring(0, 50));
            }
          }
        }
        
        button.setAttribute('data-tenant-url-processed', 'true');
      }
    });

    // Target 2: Simple key-value rows in HTTP Requests section (non-button format)
    // These appear as div elements with key/value structure
    processHttpRequestsKeyValueRows();

    // Target 3: JSON viewer rows with path-containing values
    processJsonViewerPathRows();
  }

  // Process simple key-value rows in HTTP Requests section
  function processHttpRequestsKeyValueRows() {
    // Look for elements that show HTTP Path, URL, etc. in a key-value format
    // Target spans and divs that directly contain path values
    
    // Strategy: Find elements whose text starts with / or http and contains /accounts/{uuid}
    // These are typically the value part of key-value displays
    const candidates = document.querySelectorAll('span, div');
    
    candidates.forEach(el => {
      // Skip if already processed
      if (el.hasAttribute('data-tenant-url-kv-processed')) return;
      
      // Get direct text content (not nested)
      const directText = getDirectTextContent(el);
      
      // Check if this looks like a URL or path value (starts with / or http)
      if (!directText.match(/^(\/|https?:\/\/)/)) return;
      
      // Check if it contains an account UUID
      const accountId = extractAccountIdFromPath(directText);
      if (!accountId) return;
      
      // Make sure this isn't a container element (should be a leaf or near-leaf)
      // Check that the element doesn't have too many children
      if (el.children.length > 2) return;
      
      // Skip if inside a button (handled separately)
      if (el.closest('button')) return;
      
      // Skip if inside JSON viewer (handled by processJsonViewerPathRows)
      if (el.closest('.druids_misc_json-viewer_row-layout')) return;
      
      const tenantName = ext.getTenantName(accountId);
      
      if (tenantName !== 'Unknown') {
        // Check if we already have a label
        if (!el.querySelector('.tenant-name-label-url')) {
          const label = document.createElement('span');
          label.className = 'tenant-name-label-url';
          label.textContent = tenantName;
          el.appendChild(label);
          console.log('[Datadog Extension] Added tenant name for KV path:', accountId);
        }
      }
      
      el.setAttribute('data-tenant-url-kv-processed', 'true');
    });
  }
  
  // Helper to get direct text content (excluding nested element text)
  function getDirectTextContent(element) {
    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim();
  }

  // Process JSON viewer rows that contain path values with account UUIDs
  function processJsonViewerPathRows() {
    // Find JSON viewer rows
    const allRows = document.querySelectorAll('.druids_misc_json-viewer_row-layout');
    
    allRows.forEach(row => {
      // Skip if already processed for URL
      if (row.hasAttribute('data-tenant-url-path-processed')) return;
      
      // Get the key cell and value cell
      const keyCell = row.querySelector('.druids_misc_json-viewer_row-layout__key');
      const valueCell = row.querySelector('.druids_misc_json-viewer_row-layout__value');
      
      if (!keyCell || !valueCell) return;
      
      const keyText = keyCell.textContent?.trim().toLowerCase();
      const valueText = valueCell.textContent?.trim();
      
      // Only process rows where key is 'path' or 'url' (specific keys, not parent containers)
      if (keyText === 'path' || keyText === 'url') {
        // Check if value contains an account UUID in path format
        const accountId = extractAccountIdFromPath(valueText);
        
        if (accountId) {
          const tenantName = ext.getTenantName(accountId);
          
          if (tenantName !== 'Unknown') {
            // Check if we already have a label in this value cell
            if (!valueCell.querySelector('.tenant-name-label-url')) {
              const label = document.createElement('span');
              label.className = 'tenant-name-label-url';
              label.textContent = tenantName;
              valueCell.appendChild(label);
              console.log('[Datadog Extension] Added tenant name for JSON path row:', accountId);
            }
          }
        }
      }
      
      row.setAttribute('data-tenant-url-path-processed', 'true');
    });
  }

  // Clear processed markers to allow reprocessing
  function clearProcessedMarkers() {
    // Clear accountId JSON viewer markers
    document.querySelectorAll('[data-tenant-processed]').forEach(item => {
      item.removeAttribute('data-tenant-processed');
      const labels = item.querySelectorAll('.tenant-name-label');
      labels.forEach(label => label.remove());
    });
    
    // Clear URL button markers
    document.querySelectorAll('[data-tenant-url-processed]').forEach(item => {
      item.removeAttribute('data-tenant-url-processed');
      const labels = item.querySelectorAll('.tenant-name-label-url');
      labels.forEach(label => label.remove());
    });
    
    // Clear JSON viewer path row markers
    document.querySelectorAll('[data-tenant-url-path-processed]').forEach(item => {
      item.removeAttribute('data-tenant-url-path-processed');
      const labels = item.querySelectorAll('.tenant-name-label-url');
      labels.forEach(label => label.remove());
    });
    
    // Clear key-value row markers
    document.querySelectorAll('[data-tenant-url-kv-processed]').forEach(item => {
      item.removeAttribute('data-tenant-url-kv-processed');
      const labels = item.querySelectorAll('.tenant-name-label-url');
      labels.forEach(label => label.remove());
    });
  }

  // Handle when mappings are updated
  function handleMappingsUpdate() {
    console.log('[Datadog Extension] Mappings updated, reprocessing');
    clearProcessedMarkers();
    processAccountIdRows();
    processUrlElements();
  }

  // Set up observer for new JSON viewer elements and URL elements appearing
  function observeForJsonViewer() {
    let debounceTimer = null;
    
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      
      // Check if any new JSON viewer rows or URL elements were added
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
              // Check if this is or contains buttons (for HTTP Requests section)
              if (node.tagName === 'BUTTON' || node.querySelector?.('button')) {
                shouldProcess = true;
                break;
              }
              // Check if this is or contains table cells (for Span Attributes section)
              if (node.tagName === 'TD' || 
                  node.getAttribute?.('role') === 'cell' ||
                  node.querySelector?.('[role="cell"], td')) {
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
          console.log('[Datadog Extension] New elements detected');
          processAccountIdRows();
          processUrlElements();
          debounceTimer = null;
        }, 150);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[Datadog Extension] Set up observer for JSON viewer and URL elements');
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

    // Try to process any existing accountId rows and URL elements
    processAccountIdRows();
    processUrlElements();

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
      processUrlElements();
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
        document.querySelectorAll('.tenant-name-label-url').forEach(label => label.remove());
        document.querySelectorAll('[data-tenant-processed]').forEach(el => {
          el.removeAttribute('data-tenant-processed');
        });
        document.querySelectorAll('[data-tenant-url-processed]').forEach(el => {
          el.removeAttribute('data-tenant-url-processed');
        });
        document.querySelectorAll('[data-tenant-url-path-processed]').forEach(el => {
          el.removeAttribute('data-tenant-url-path-processed');
        });
        document.querySelectorAll('[data-tenant-url-kv-processed]').forEach(el => {
          el.removeAttribute('data-tenant-url-kv-processed');
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
