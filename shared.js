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
   * Check if extension context is still valid
   * @returns {boolean} True if context is valid
   */
  function isContextValid() {
    try {
      // Try to access chrome.runtime.id - this will throw if context is invalidated
      return chrome.runtime?.id !== undefined;
    } catch (error) {
      return false;
    }
  }

  /**
   * Load tenant mappings from storage
   * @returns {Promise<Object>} Promise resolving to tenant mappings
   */
  async function loadTenantMappings() {
    // Check if extension context is valid before accessing Chrome APIs
    if (!isContextValid()) {
      console.warn('[Tenant Extension] Extension context invalidated, cannot load mappings');
      return {};
    }

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
        if (!isContextValid()) {
          resolve({});
          return;
        }
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
        // Check if context is still valid before processing changes
        if (!isContextValid()) {
          console.log('[Tenant Extension] Extension context invalidated, ignoring storage change');
          return;
        }
        
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

  /**
   * Wait for TenantNameExtension to be ready
   * Returns a Promise that resolves to the TenantNameExtension object once it's ready.
   * Resolves immediately if already loaded, or waits with retries.
   * @param {number} maxRetries - Maximum number of retry attempts (default: 50)
   * @param {number} retryDelay - Delay between retries in milliseconds (default: 100)
   * @returns {Promise<Object>} Promise resolving to TenantNameExtension object
   */
  function waitForReady(maxRetries = 50, retryDelay = 100) {
    return new Promise((resolve, reject) => {
      // Check if already ready
      if (window.TenantNameExtension && 
          typeof window.TenantNameExtension.loadTenantMappings === 'function') {
        resolve(window.TenantNameExtension);
        return;
      }

      // Wait with retries
      let attempts = 0;
      const checkReady = () => {
        attempts++;
        
        if (window.TenantNameExtension && 
            typeof window.TenantNameExtension.loadTenantMappings === 'function') {
          resolve(window.TenantNameExtension);
          return;
        }

        if (attempts >= maxRetries) {
          reject(new Error('TenantNameExtension failed to load after maximum retries'));
          return;
        }

        setTimeout(checkReady, retryDelay);
      };

      checkReady();
    });
  }

  /**
   * Initialize a site with tenant mappings
   * Checks site settings and loads tenant mappings if enabled.
   * @param {string} siteKey - The site key (e.g., 'temporal', 'clickhouse', 'datadog')
   * @returns {Promise<Object>} Result object with {ok: boolean, mappings?: Object, disabled?: boolean, error?: string}
   */
  async function initSite(siteKey) {
    try {
      // Check if extension context is valid
      if (!isContextValid()) {
        return { ok: false, error: 'Extension context invalidated' };
      }

      // Read siteSettings from chrome.storage.sync
      const siteSettings = await new Promise((resolve) => {
        try {
          if (!isContextValid()) {
            resolve({});
            return;
          }
          chrome.storage.sync.get(['siteSettings'], (result) => {
            if (chrome.runtime.lastError) {
              console.error('[Tenant Extension] Error loading site settings:', chrome.runtime.lastError);
              resolve({});
              return;
            }
            resolve(result.siteSettings || {});
          });
        } catch (error) {
          console.error('[Tenant Extension] Exception loading site settings:', error);
          resolve({});
        }
      });

      // Use defaults if siteSettings is empty
      const defaults = { temporal: true, clickhouse: true, datadog: true };
      const settings = Object.keys(siteSettings).length > 0 ? siteSettings : defaults;

      // Check if site is disabled
      if (settings[siteKey] === false) {
        return { ok: false, disabled: true };
      }

      // Load tenant mappings
      const mappings = await loadTenantMappings();

      return { ok: true, mappings };
    } catch (error) {
      console.error('[Tenant Extension] Error initializing site:', error);
      return { ok: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Set up a listener for site settings changes
   * Monitors chrome.storage.onChanged for siteSettings and calls appropriate callbacks.
   * @param {string} siteKey - The site key to monitor (e.g., 'temporal', 'clickhouse', 'datadog')
   * @param {Object} callbacks - Callback functions {onDisabled?: Function, onEnabled?: Function}
   */
  function setupSiteSettingsListener(siteKey, callbacks) {
    try {
      if (!isContextValid()) {
        console.warn('[Tenant Extension] Extension context invalidated, cannot setup site settings listener');
        return;
      }

      chrome.storage.onChanged.addListener(async (changes, area) => {
        // Check if context is still valid before processing changes
        if (!isContextValid()) {
          console.log('[Tenant Extension] Extension context invalidated, ignoring site settings change');
          return;
        }

        // Only process sync area changes for siteSettings
        if (area === 'sync' && changes.siteSettings) {
          try {
            const newSettings = changes.siteSettings.newValue || {};
            const oldSettings = changes.siteSettings.oldValue || {};
            
            // Check if the site key changed state
            const wasEnabled = oldSettings[siteKey] !== false;
            const isEnabled = newSettings[siteKey] !== false;

            // Site was disabled
            if (wasEnabled && !isEnabled) {
              if (callbacks.onDisabled && typeof callbacks.onDisabled === 'function') {
                callbacks.onDisabled();
              }
            }
            // Site was enabled
            else if (!wasEnabled && isEnabled) {
              if (callbacks.onEnabled && typeof callbacks.onEnabled === 'function') {
                callbacks.onEnabled();
              }
            }
          } catch (error) {
            console.error('[Tenant Extension] Error processing site settings change:', error);
          }
        }
      });
    } catch (error) {
      console.error('[Tenant Extension] Error setting up site settings listener:', error);
    }
  }

  // Export utilities to global namespace
  window.TenantNameExtension = {
    loadTenantMappings,
    getTenantName,
    isValidUUID,
    extractTenantIdFromWorkflowId,
    setupStorageListener,
    getCachedMappings,
    isContextValid,
    UUID_PATTERN,
    waitForReady,
    initSite,
    setupSiteSettingsListener
  };

  console.log('[Tenant Extension] Shared utilities loaded');

})();
