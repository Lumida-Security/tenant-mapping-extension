// Tenant Name Mapper Extension - Options Page Script

(function() {
  'use strict';

  // DOM elements
  const newTenantIdInput = document.getElementById('newTenantId');
  const newTenantNameInput = document.getElementById('newTenantName');
  const addBtn = document.getElementById('addBtn');
  const mappingsContainer = document.getElementById('mappingsContainer');
  const messageDiv = document.getElementById('message');
  const totalMappingsSpan = document.getElementById('totalMappings');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const temporalEnabled = document.getElementById('temporalEnabled');
  const clickhouseEnabled = document.getElementById('clickhouseEnabled');
  const datadogEnabled = document.getElementById('datadogEnabled');

  let tenantMappings = {};
  let bundledMappings = {};
  let userMappings = {};
  let siteSettings = {
    temporal: true,
    clickhouse: true,
    datadog: true
  };

  // Show message
  function showMessage(text, type = 'success') {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    setTimeout(() => {
      messageDiv.className = 'message hidden';
    }, 3000);
  }

  // Load settings from storage
  async function loadSettings() {
    // Load bundled mappings first
    try {
      const url = chrome.runtime.getURL('tenant-mappings.json');
      const response = await fetch(url);
      bundledMappings = await response.json();
      console.log('Loaded bundled mappings:', Object.keys(bundledMappings).length);
    } catch (error) {
      console.warn('Could not load bundled mappings:', error);
      bundledMappings = {};
    }

    // Load user-specific mappings from storage
    chrome.storage.sync.get(['tenantMappings', 'siteSettings'], (result) => {
      userMappings = result.tenantMappings || {};
      siteSettings = result.siteSettings || { temporal: true, clickhouse: true, datadog: true };
      
      // Merge bundled and user mappings (user takes precedence)
      tenantMappings = { ...bundledMappings, ...userMappings };
      
      // If siteSettings wasn't in storage, save the defaults
      if (!result.siteSettings) {
        chrome.storage.sync.set({ siteSettings }, () => {
          console.log('Initialized default site settings');
        });
      }
      
      // Update UI
      temporalEnabled.checked = siteSettings.temporal !== false;
      clickhouseEnabled.checked = siteSettings.clickhouse !== false;
      datadogEnabled.checked = siteSettings.datadog !== false;
      
      renderMappings();
      updateStats();
    });
  }

  // Save mappings to storage
  function saveMappings(callback) {
    // Only save user mappings, not bundled ones
    chrome.storage.sync.set({ tenantMappings: userMappings }, () => {
      if (chrome.runtime.lastError) {
        showMessage('Error saving mappings: ' + chrome.runtime.lastError.message, 'error');
      } else {
        // Update merged mappings
        tenantMappings = { ...bundledMappings, ...userMappings };
        updateStats();
        if (callback) callback();
      }
    });
  }

  // Save site settings
  function saveSiteSettings() {
    chrome.storage.sync.set({ siteSettings }, () => {
      if (chrome.runtime.lastError) {
        showMessage('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showMessage('Site settings saved');
      }
    });
  }

  // Render mappings table
  function renderMappings() {
    const entries = Object.entries(tenantMappings);

    if (entries.length === 0) {
      mappingsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <p>No tenant mappings configured yet.</p>
          <p style="color: #888; font-size: 13px; margin-top: 10px;">
            Add your first mapping above to get started.
          </p>
        </div>
      `;
      return;
    }

    // Sort by tenant name
    entries.sort((a, b) => a[1].localeCompare(b[1]));

    const tableHtml = `
      <table class="mapping-table">
        <thead>
          <tr>
            <th style="width: 45%">Tenant ID</th>
            <th style="width: 30%">Tenant Name</th>
            <th style="width: 10%">Source</th>
            <th style="width: 15%">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(([id, name]) => {
            const isBundled = bundledMappings.hasOwnProperty(id);
            const isOverridden = isBundled && userMappings.hasOwnProperty(id);
            const sourceLabel = isOverridden ? 'Override' : (isBundled ? 'Bundled' : 'User');
            const sourceClass = isOverridden ? 'override' : (isBundled ? 'bundled' : 'user');
            
            return `
            <tr>
              <td class="tenant-id">${escapeHtml(id)}</td>
              <td>${escapeHtml(name)}</td>
              <td><span class="source-badge ${sourceClass}">${sourceLabel}</span></td>
              <td class="actions">
                <button class="small secondary edit-btn" data-id="${escapeHtml(id)}" data-is-bundled="${isBundled}">Edit</button>
                ${!isBundled || isOverridden ? `<button class="small danger delete-btn" data-id="${escapeHtml(id)}">Delete</button>` : ''}
              </td>
            </tr>
          `}).join('')}
        </tbody>
      </table>
    `;

    mappingsContainer.innerHTML = tableHtml;

    // Attach event listeners
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', handleEdit);
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', handleDelete);
    });
  }

  // Update statistics
  function updateStats() {
    const totalCount = Object.keys(tenantMappings).length;
    
    // Calculate how many are pure bundled, pure user, and overrides
    let pureBundledCount = 0;
    let pureUserCount = 0;
    let overrideCount = 0;
    
    Object.keys(tenantMappings).forEach(id => {
      const isBundled = bundledMappings.hasOwnProperty(id);
      const isUser = userMappings.hasOwnProperty(id);
      
      if (isBundled && isUser) {
        overrideCount++;
      } else if (isBundled) {
        pureBundledCount++;
      } else if (isUser) {
        pureUserCount++;
      }
    });
    
    // Display format based on what exists
    if (pureBundledCount === 0 && overrideCount === 0) {
      // Only user mappings
      totalMappingsSpan.textContent = totalCount;
    } else if (pureUserCount === 0 && overrideCount === 0) {
      // Only bundled mappings
      totalMappingsSpan.textContent = `${totalCount} (bundled)`;
    } else {
      // Mixed: show breakdown
      const parts = [];
      if (pureBundledCount > 0) parts.push(`${pureBundledCount} bundled`);
      if (pureUserCount > 0) parts.push(`${pureUserCount} user`);
      if (overrideCount > 0) parts.push(`${overrideCount} override${overrideCount > 1 ? 's' : ''}`);
      totalMappingsSpan.textContent = `${totalCount} (${parts.join(' + ')})`;
    }
  }

  // Add new mapping
  function handleAdd() {
    const tenantId = newTenantIdInput.value.trim();
    const tenantName = newTenantNameInput.value.trim();

    if (!tenantId) {
      showMessage('Please enter a tenant ID', 'error');
      newTenantIdInput.focus();
      return;
    }

    if (!tenantName) {
      showMessage('Please enter a tenant name', 'error');
      newTenantNameInput.focus();
      return;
    }

    // Validate tenant ID format (basic UUID check)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(tenantId)) {
      showMessage('Tenant ID should be a valid UUID format', 'error');
      newTenantIdInput.focus();
      return;
    }

    // Add or update mapping in user mappings
    const isBundled = bundledMappings.hasOwnProperty(tenantId);
    userMappings[tenantId] = tenantName;
    
    saveMappings(() => {
      renderMappings();
      // Clear inputs
      newTenantIdInput.value = '';
      newTenantNameInput.value = '';
      newTenantIdInput.focus();

      if (isBundled) {
        showMessage(`Override created: ${tenantName}`);
      } else {
        showMessage(`Mapping added: ${tenantName}`);
      }
    });
  }

  // Edit mapping
  function handleEdit(e) {
    const tenantId = e.target.dataset.id;
    const currentName = tenantMappings[tenantId];
    const isBundled = e.target.dataset.isBundled === 'true';

    const message = isBundled 
      ? `Enter new tenant name (will override bundled value):`
      : `Enter new tenant name:`;
    
    const newName = prompt(message, currentName);
    if (newName !== null && newName.trim() !== '') {
      userMappings[tenantId] = newName.trim();
      saveMappings(() => {
        renderMappings();
        showMessage('Mapping updated');
      });
    }
  }

  // Delete mapping
  function handleDelete(e) {
    const tenantId = e.target.dataset.id;
    const tenantName = tenantMappings[tenantId];
    const isBundled = bundledMappings.hasOwnProperty(tenantId);
    const isOverride = isBundled && userMappings.hasOwnProperty(tenantId);

    let confirmMessage;
    if (isOverride) {
      confirmMessage = `Remove your override for "${tenantName}"? The bundled mapping will be used instead.`;
    } else {
      confirmMessage = `Delete mapping for "${tenantName}"?`;
    }

    if (confirm(confirmMessage)) {
      delete userMappings[tenantId];
      saveMappings(() => {
        renderMappings();
        showMessage(isOverride ? 'Override removed' : 'Mapping deleted');
      });
    }
  }

  // Clear all user mappings
  function handleClearAll() {
    if (Object.keys(userMappings).length === 0) {
      showMessage('No user mappings to clear', 'error');
      return;
    }

    const count = Object.keys(userMappings).length;
    if (confirm(`Delete all ${count} user mappings? This cannot be undone. Bundled mappings will remain.`)) {
      userMappings = {};
      saveMappings(() => {
        renderMappings();
        showMessage('All user mappings cleared');
      });
    }
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Event listeners
  addBtn.addEventListener('click', handleAdd);
  newTenantNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAdd();
  });
  clearAllBtn.addEventListener('click', handleClearAll);
  
  // Site toggle listeners
  temporalEnabled.addEventListener('change', (e) => {
    siteSettings.temporal = e.target.checked;
    saveSiteSettings();
  });
  
  clickhouseEnabled.addEventListener('change', (e) => {
    siteSettings.clickhouse = e.target.checked;
    saveSiteSettings();
  });
  
  datadogEnabled.addEventListener('change', (e) => {
    siteSettings.datadog = e.target.checked;
    saveSiteSettings();
  });

  // Initialize
  loadSettings();
})();
