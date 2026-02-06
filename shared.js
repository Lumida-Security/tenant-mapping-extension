// Shared utilities for Tenant Name Extension
// Used across multiple content scripts (Temporal, ClickHouse, etc.)

(function() {
  'use strict';

  // Make utilities available globally for content scripts
  window.TenantNameExtension = window.TenantNameExtension || {};

  // Cache for tenant mappings
  let tenantMappings = {};

  // UUID pattern for validation
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Load tenant mappings from storage
   * @returns {Promise<Object>} Promise resolving to tenant mappings
   */
  async function loadTenantMappings() {
    // 1. Load bundled mappings from repo file
    let bundledMappings = {};
    try {
      const url = chrome.runtime.getURL('tenant-mappings.json');
      const response = await fetch(url);
      if (response.ok) {
        bundledMappings = await response.json();
        console.log('[Tenant Extension] Loaded bundled mappings:', Object.keys(bundledMappings).length);
      }
    } catch (error) {
      console.warn('[Tenant Extension] Could not load bundled mappings:', error);
    }

    // 2. Load user overrides from Chrome storage
    const userMappings = await new Promise((resolve) => {
      try {
        chrome.storage.sync.get(['tenantMappings'], (result) => {
          if (chrome.runtime.lastError) {
            console.error('[Tenant Extension] Error loading user mappings:', chrome.runtime.lastError);
            resolve({});
            return;
          }
          resolve(result.tenantMappings || {});
        });
      } catch (error) {
        console.error('[Tenant Extension] Exception loading user mappings:', error);
        resolve({});
      }
    });

    console.log('[Tenant Extension] Loaded user mappings:', Object.keys(userMappings).length);

    // 3. Merge (user overrides take precedence)
    tenantMappings = { ...bundledMappings, ...userMappings };
    console.log('[Tenant Extension] Total tenant mappings:', Object.keys(tenantMappings).length);
    
    return tenantMappings;
  }

  /**
   * Get tenant name from mapping or return "Unknown"
   * @param {string} tenantId - The tenant UUID
   * @returns {string} The tenant name or "Unknown"
   */
  function getTenantName(tenantId) {
    if (!tenantId) return 'Unknown';
    return tenantMappings[tenantId] || 'Unknown';
  }

  /**
   * Check if a string is a valid UUID
   * @param {string} str - String to check
   * @returns {boolean} True if valid UUID
   */
  function isValidUUID(str) {
    if (!str) return false;
    return UUID_PATTERN.test(str);
  }

  /**
   * Extract tenant ID from a workflow ID (Temporal format)
   * Format: {tenant-uuid}__{workflowType}__{other-uuid}__suffix
   * @param {string} workflowId - The workflow ID
   * @returns {string|null} The extracted tenant UUID or null
   */
  function extractTenantIdFromWorkflowId(workflowId) {
    if (!workflowId) return null;
    const parts = workflowId.split('__');
    const potentialUUID = parts[0] || null;
    return isValidUUID(potentialUUID) ? potentialUUID : null;
  }

  /**
   * Set up listener for storage changes to update mappings in real-time
   * @param {Function} callback - Function to call when mappings change
   */
  function setupStorageListener(callback) {
    try {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area === 'sync' && changes.tenantMappings) {
          console.log('[Tenant Extension] User mappings updated, reloading all mappings');
          // Reload all mappings to ensure bundled + user merge is correct
          await loadTenantMappings();
          if (callback) {
            callback(tenantMappings);
          }
        }
      });
    } catch (error) {
      console.error('[Tenant Extension] Error setting up storage listener:', error);
    }
  }

  /**
   * Get current tenant mappings from cache
   * @returns {Object} Current tenant mappings
   */
  function getCachedMappings() {
    return tenantMappings;
  }

  // Export utilities to global namespace
  window.TenantNameExtension = {
    loadTenantMappings,
    getTenantName,
    isValidUUID,
    extractTenantIdFromWorkflowId,
    setupStorageListener,
    getCachedMappings,
    UUID_PATTERN
  };

  console.log('[Tenant Extension] Shared utilities loaded');

})();
