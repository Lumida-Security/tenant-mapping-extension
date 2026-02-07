// Temporal Cloud Tenant Name Extension - Content Script
// Adds a "Tenant Name" column to the Temporal Cloud workflows table

(async function() {
  'use strict';

  // Constants
  const SHARED_UTILS_MAX_ATTEMPTS = 50;
  const SHARED_UTILS_INTERVAL = 100;
  const SPA_NAVIGATION_DELAY = 500;
  const REPROCESS_DEBOUNCE_MS = 150;
  const TABLE_CHECK_INTERVAL_MS = 300;

  // Wait for shared utilities to be available
  let ext;
  try {
    ext = await window.TenantNameExtension.waitForReady(SHARED_UTILS_MAX_ATTEMPTS, SHARED_UTILS_INTERVAL);
  } catch (error) {
    console.error('[Temporal Extension] Shared utilities not loaded after retries:', error);
    return;
  }

  // Track whether the extension is enabled
  let extensionEnabled = true;

  // Debounce timer for reprocessing
  let reprocessTimer = null;

  // Find the Workflow ID column index dynamically by scanning headers
  function findWorkflowIdColumnIndex(table) {
    const headers = table.querySelectorAll('thead th');
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].textContent.trim() === 'Workflow ID') {
        return i + 1; // Convert to 1-based nth-child index
      }
    }
    return null;
  }

  // Check if the table already has our tenant name header
  function hasTenantHeader(table) {
    return table.querySelector('.tenant-name-header') !== null;
  }

  // Add tenant name header to the table
  function addTenantNameHeader(table) {
    const thead = table.querySelector('thead');
    if (!thead) return false;

    const headerRow = thead.querySelector('tr');
    if (!headerRow) return false;

    // Already has our header
    if (hasTenantHeader(table)) {
      return true;
    }

    // Find Workflow ID column dynamically
    const workflowIdIndex = findWorkflowIdColumnIndex(table);
    if (!workflowIdIndex) return false;

    const workflowIdHeader = headerRow.querySelector(`th:nth-child(${workflowIdIndex})`);
    if (!workflowIdHeader) return false;

    // Create and insert the new header after Workflow ID
    const tenantHeader = document.createElement('th');
    tenantHeader.textContent = 'Tenant Name';
    tenantHeader.className = 'tenant-name-header';
    
    // Insert after the Workflow ID header
    const nextHeader = headerRow.querySelector(`th:nth-child(${workflowIdIndex + 1})`);
    if (nextHeader) {
      headerRow.insertBefore(tenantHeader, nextHeader);
    } else {
      headerRow.appendChild(tenantHeader);
    }

    console.log('[Temporal Extension] Added tenant name header');
    return true;
  }

  // Process a single row to add tenant name cell
  function processRow(row, workflowIdIndex) {
    // Skip if already has a tenant cell
    if (row.querySelector('.tenant-name-cell')) {
      return;
    }

    // Get the Workflow ID cell using dynamic index
    const workflowIdCell = row.querySelector(`td:nth-child(${workflowIdIndex})`);
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

    // Insert after the Workflow ID cell
    const nextCell = row.querySelector(`td:nth-child(${workflowIdIndex + 1})`);
    if (nextCell) {
      row.insertBefore(tenantCell, nextCell);
    } else {
      row.appendChild(tenantCell);
    }
  }

  // Process all rows in the table
  function processAllRows(table) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    // Find Workflow ID column dynamically
    const workflowIdIndex = findWorkflowIdColumnIndex(table);
    if (!workflowIdIndex) return;

    const rows = tbody.querySelectorAll('tr');
    let processedCount = 0;
    rows.forEach(row => {
      if (!row.querySelector('.tenant-name-cell')) {
        processRow(row, workflowIdIndex);
        processedCount++;
      }
    });
    if (processedCount > 0) {
      console.log('[Temporal Extension] Processed', processedCount, 'new rows');
    }
  }

  // Process the table (add header and process rows)
  function processTable(table) {
    if (!table || !extensionEnabled) return;

    // Add header if not already added
    const headerAdded = addTenantNameHeader(table);
    if (!headerAdded) {
      return;
    }

    // Process all rows
    processAllRows(table);
  }

  // Debounced reprocessing - handles rapid Svelte re-renders
  function scheduleReprocess() {
    if (reprocessTimer) {
      clearTimeout(reprocessTimer);
    }
    reprocessTimer = setTimeout(() => {
      reprocessTimer = null;
      const table = document.querySelector('table.holocene-table');
      if (table && extensionEnabled) {
        processTable(table);
      }
    }, REPROCESS_DEBOUNCE_MS);
  }

  // Reprocess table when mappings change
  function handleMappingsUpdate() {
    const table = document.querySelector('table.holocene-table');
    if (table) {
      // Remove existing tenant cells so they get recreated with new names
      table.querySelectorAll('.tenant-name-cell').forEach(cell => cell.remove());
      table.querySelectorAll('.tenant-name-header').forEach(header => header.remove());
      
      // Reprocess
      processTable(table);
    }
  }

  // Main initialization function
  async function initExtension() {
    console.log('[Temporal Extension] Initializing...');

    // Use shared initSite utility
    const result = await ext.initSite('temporal');
    if (!result.ok) {
      if (result.disabled) {
        console.log('[Temporal Extension] Temporal Cloud is disabled in settings');
        extensionEnabled = false;
      } else {
        console.error('[Temporal Extension] Failed to initialize:', result.error || 'Unknown error');
      }
      return false;
    }

    extensionEnabled = true;

    // Find the table
    const table = document.querySelector('table.holocene-table');
    if (!table) {
      console.log('[Temporal Extension] Table not found, will retry');
      return false;
    }

    // Process the table
    processTable(table);

    console.log('[Temporal Extension] Initialization complete');
    return true;
  }

  // Persistent DOM observer that watches for table changes.
  // Svelte can re-render the entire table at any time, so we need
  // a resilient observer that never disconnects and re-injects our
  // column whenever it detects the table has been re-rendered.
  function setupPersistentObserver() {
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
      // Check for SPA navigation
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[Temporal Extension] URL changed, reinitializing');
        setTimeout(() => initExtension(), SPA_NAVIGATION_DELAY);
        return;
      }

      if (!extensionEnabled) return;

      // Check if the table exists but is missing our column
      const table = document.querySelector('table.holocene-table');
      if (table) {
        // If the table doesn't have our header, Svelte re-rendered it
        if (!hasTenantHeader(table)) {
          scheduleReprocess();
          return;
        }

        // Check if there are unprocessed rows (new rows added by pagination, etc.)
        const tbody = table.querySelector('tbody');
        if (tbody) {
          const unprocessedRows = tbody.querySelectorAll('tr:not(:has(.tenant-name-cell))');
          if (unprocessedRows.length > 0) {
            scheduleReprocess();
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[Temporal Extension] Set up persistent DOM observer');
  }

  // Set up storage change listener
  ext.setupStorageListener(handleMappingsUpdate);

  // Set up site settings listener
  ext.setupSiteSettingsListener('temporal', {
    onDisabled: () => {
      console.log('[Temporal Extension] Disabled via settings, stopping');
      extensionEnabled = false;
      // Remove any added columns
      const table = document.querySelector('table.holocene-table');
      if (table) {
        table.querySelectorAll('.tenant-name-cell').forEach(cell => cell.remove());
        table.querySelectorAll('.tenant-name-header').forEach(header => header.remove());
      }
    },
    onEnabled: () => {
      console.log('[Temporal Extension] Enabled via settings, reinitializing');
      extensionEnabled = true;
      initExtension();
    }
  });

  // Start the extension
  async function start() {
    // Set up the persistent observer first — it will catch any table
    // that appears or re-renders regardless of timing
    setupPersistentObserver();

    // Try immediate initialization
    const success = await initExtension();
    if (!success) {
      // Table not ready yet; the persistent observer will pick it up
      console.log('[Temporal Extension] Waiting for table to appear...');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
