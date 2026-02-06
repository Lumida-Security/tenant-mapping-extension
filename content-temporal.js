// Temporal Cloud Tenant Name Extension - Content Script
// Adds a "Tenant Name" column to the Temporal Cloud workflows table

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
    console.error('[Temporal Extension] Shared utilities not loaded after retries');
    return;
  }

  // Add tenant name header to the table
  function addTenantNameHeader(table) {
    const thead = table.querySelector('thead');
    if (!thead) return false;

    const headerRow = thead.querySelector('tr');
    if (!headerRow) return false;

    // Check if already processed
    if (headerRow.hasAttribute('data-tenant-header-added')) {
      return true;
    }

    // Get the Workflow ID header (index 3)
    const workflowIdHeader = headerRow.querySelector('th:nth-child(4)');
    if (!workflowIdHeader) return false;

    // Create and insert the new header after Workflow ID
    const tenantHeader = document.createElement('th');
    tenantHeader.textContent = 'Tenant Name';
    tenantHeader.className = 'tenant-name-header';
    
    // Insert after the Workflow ID header (at index 4)
    const runIdHeader = headerRow.querySelector('th:nth-child(5)');
    if (runIdHeader) {
      headerRow.insertBefore(tenantHeader, runIdHeader);
    } else {
      headerRow.appendChild(tenantHeader);
    }

    // Mark as processed
    headerRow.setAttribute('data-tenant-header-added', 'true');
    console.log('[Temporal Extension] Added tenant name header');
    return true;
  }

  // Process a single row to add tenant name cell
  function processRow(row) {
    // Check if already processed
    if (row.hasAttribute('data-tenant-processed')) {
      return;
    }

    // Get the Workflow ID cell (index 3, but in DOM it's 4th child)
    const workflowIdCell = row.querySelector('td:nth-child(4)');
    if (!workflowIdCell) return;

    // Extract the workflow ID from the link text
    const workflowIdLink = workflowIdCell.querySelector('a');
    const workflowId = workflowIdLink ? workflowIdLink.textContent.trim() : workflowIdCell.textContent.trim();

    if (!workflowId) return;

    // Extract tenant ID and get tenant name
    const tenantId = ext.extractTenantIdFromWorkflowId(workflowId);
    const tenantName = ext.getTenantName(tenantId);

    // Create the new cell
    const tenantCell = document.createElement('td');
    tenantCell.textContent = tenantName;
    tenantCell.className = 'workflows-summary-table-body-cell tenant-name-cell';
    tenantCell.setAttribute('data-tenant-id', tenantId || '');

    // Insert after the Workflow ID cell (at position 4)
    const runIdCell = row.querySelector('td:nth-child(5)');
    if (runIdCell) {
      row.insertBefore(tenantCell, runIdCell);
    } else {
      row.appendChild(tenantCell);
    }

    // Mark as processed
    row.setAttribute('data-tenant-processed', 'true');
  }

  // Process all rows in the table
  function processAllRows(table) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = tbody.querySelectorAll('tr');
    rows.forEach(processRow);
    console.log('[Temporal Extension] Processed', rows.length, 'rows');
  }

  // Process the table (add header and process rows)
  function processTable(table) {
    if (!table) return;

    // Add header if not already added
    const headerAdded = addTenantNameHeader(table);
    if (!headerAdded) {
      console.warn('[Temporal Extension] Failed to add header');
      return;
    }

    // Process all rows
    processAllRows(table);
  }

  // Set up observer for table body changes (pagination, filters, sorting)
  function observeTableChanges(table) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    // Disconnect existing observer if any
    if (table._tenantObserver) {
      table._tenantObserver.disconnect();
    }

    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check if new rows were added
          if (mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.tagName === 'TR') {
                shouldProcess = true;
                break;
              }
            }
          }
        }
      }

      if (shouldProcess) {
        console.log('[Temporal Extension] Table changed, reprocessing rows');
        processAllRows(table);
      }
    });

    observer.observe(tbody, {
      childList: true,
      subtree: false
    });

    // Store observer on table element
    table._tenantObserver = observer;
    console.log('[Temporal Extension] Set up table observer');
  }

  // Reprocess table when mappings change
  function handleMappingsUpdate() {
    const table = document.querySelector('table.holocene-table');
    if (table) {
      // Remove processing markers
      table.querySelectorAll('[data-tenant-processed]').forEach(row => {
        row.removeAttribute('data-tenant-processed');
        // Remove existing tenant cells
        const tenantCell = row.querySelector('.tenant-name-cell');
        if (tenantCell) {
          tenantCell.remove();
        }
      });
      
      // Reprocess
      processAllRows(table);
    }
  }

  // Main initialization function
  async function initExtension() {
    console.log('[Temporal Extension] Initializing...');

    // Check if Temporal Cloud is enabled in settings
    const settings = await chrome.storage.sync.get(['siteSettings']);
    const siteSettings = settings.siteSettings || { temporal: true, clickhouse: true };
    
    if (siteSettings.temporal === false) {
      console.log('[Temporal Extension] Temporal Cloud is disabled in settings');
      return false;
    }

    // Load tenant mappings first
    await ext.loadTenantMappings();

    // Find the table
    const table = document.querySelector('table.holocene-table');
    if (!table) {
      console.log('[Temporal Extension] Table not found, will retry');
      return false;
    }

    // Process the table
    processTable(table);

    // Set up observer for dynamic changes
    observeTableChanges(table);

    console.log('[Temporal Extension] Initialization complete');
    return true;
  }

  // Set up mutation observer to detect when table appears
  function waitForTable() {
    // Try immediate initialization
    initExtension().then(success => {
      if (success) {
        // Still set up observer for SPA navigation
        setupSPAObserver();
      }
    });

    // Set up observer for delayed table rendering
    const bodyObserver = new MutationObserver((mutations, obs) => {
      const table = document.querySelector('table.holocene-table');
      if (table) {
        console.log('[Temporal Extension] Table detected');
        initExtension();
      }
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Set up observer for SPA navigation
    setupSPAObserver();
  }

  // Set up observer for SPA navigation (URL changes without page reload)
  function setupSPAObserver() {
    let lastUrl = location.href;
    const navigationObserver = new MutationObserver(() => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[Temporal Extension] URL changed, reinitializing');
        // Wait a bit for the new page to render
        setTimeout(() => {
          initExtension();
        }, 500);
      }
    });

    navigationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Set up storage change listener
  ext.setupStorageListener(handleMappingsUpdate);

  // Also listen for site settings changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.siteSettings) {
      const newSettings = changes.siteSettings.newValue || { temporal: true, clickhouse: true };
      if (newSettings.temporal === false) {
        console.log('[Temporal Extension] Disabled via settings, stopping');
        // Remove any added columns
        const table = document.querySelector('table.holocene-table');
        if (table) {
          // Remove tenant name cells and header
          table.querySelectorAll('.tenant-name-cell').forEach(cell => cell.remove());
          table.querySelectorAll('.tenant-name-header').forEach(header => header.remove());
        }
      } else {
        console.log('[Temporal Extension] Enabled via settings, reinitializing');
        initExtension();
      }
    }
  });

  // Start the extension
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForTable);
  } else {
    waitForTable();
  }

})();
