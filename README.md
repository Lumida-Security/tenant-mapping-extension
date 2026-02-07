# Tenant Name Mapper Chrome Extension

A Chrome extension that adds tenant names to Temporal Cloud workflows, ClickHouse Cloud databases, and Datadog traces, making it easy to identify which tenant each workflow, database, or trace belongs to.

## Features

- **Temporal Cloud**: Adds a "Tenant Name" column after the "Workflow ID" column
- **ClickHouse Cloud**: Adds tenant names next to UUID database names in the database picker
- **Datadog**: Adds tenant name badges next to account UUIDs in trace panel URLs and JSON attributes
- Automatically extracts tenant IDs from workflow IDs, database names, and URL paths
- Configurable tenant ID to name mappings via options page
- Enable/disable functionality per site
- Settings sync across Chrome browsers
- Supports both Light and Dark themes

## Installation

### From Source (Development)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked"
5. Select the extension folder
6. Verify "Tenant Name Mapper" appears with no errors

### From Chrome Web Store

*Coming soon*

## Quick Start

### 1. Configure Your First Tenant

1. Click **Details** on the extension card in `chrome://extensions/`
2. Click **Extension options**
3. Verify both sites are enabled (Temporal Cloud and ClickHouse Cloud)
4. Add a mapping:
   - **Tenant ID**: `0197cb9b-86b6-7173-8d49-440f0943a662`
   - **Tenant Name**: `Customer A`
5. Click **Add Mapping**

### 2. Test on Temporal Cloud

1. Navigate to your Temporal Cloud workflows page
2. Wait for the table to load
3. Look for the new **"Tenant Name"** column after "Workflow ID"

### 3. Test on ClickHouse Cloud

1. Navigate to your ClickHouse Cloud console
2. Click the database picker dropdown
3. Look for tenant names appended to UUID database names

### 4. Test on Datadog

1. Navigate to Datadog trace panel (APM traces)
2. Open a trace that contains URLs with `/accounts/{uuid}/` pattern
3. Look for green tenant name badges next to:
   - HTTP Path in the URL Details section
   - URL button in the HTTP Requests section
   - `url` and `path` attributes in the Span Attributes table

## Configuration

### Example UUID Formats

#### Temporal Workflow ID
```
0197cb9b-86b6-7173-8d49-440f0943a662__assetOwnershipWorkflow__e1bd7b9c-c88c-4375-a069-66a11a004f92__skip-524000
└────────────────┬────────────────┘
              Tenant ID (extract this)
```

#### ClickHouse Database Name
```
0197cb9b-86b6-7173-8d49-440f0943a662
└────────────────┬────────────────┘
              Tenant ID (entire name)
```

### Finding Your Tenant IDs

#### From Temporal Cloud
1. Navigate to your Temporal Cloud workflows page
2. Look at the Workflow ID column
3. Copy the UUID portion before the first `__`
4. Add it to the extension options with a friendly name

#### From ClickHouse Cloud
1. Navigate to your ClickHouse Cloud console
2. Click the database picker dropdown
3. Copy any UUID database name
4. Add it to the extension options with a friendly name

## Usage

### Temporal Cloud

Once configured, the extension automatically:
1. Detects when you're on a Temporal Cloud workflows page
2. Adds a "Tenant Name" column after the Workflow ID column
3. Displays the configured tenant name for each workflow
4. Shows "Unknown" for unmapped tenant IDs

The column updates automatically when:
- You navigate between pages
- You filter or sort workflows
- You add/update tenant mappings in the options

### ClickHouse Cloud

Once configured, the extension automatically:
1. Detects when you're on a ClickHouse Cloud console page
2. Monitors the database picker dropdown
3. Appends tenant names next to UUID database names
4. Format: `0197cb9b-... (Tenant Name)`

### Datadog

Once configured, the extension automatically:
1. Detects when you're on a Datadog page with trace panels
2. Scans for URLs containing `/accounts/{uuid}/` pattern
3. Adds green tenant name badges next to account UUIDs in:
   - HTTP Requests section (URL and HTTP Path buttons)
   - Span Attributes table (url and path cells)
   - JSON viewer panel (accountId keys)
4. Updates automatically when navigating between traces

## Theme Support

The extension supports both **Light Mode** and **Dark Mode** in Temporal Cloud. It detects the theme using the `data-theme` attribute and automatically applies appropriate styling. No reload required when switching themes.

## Supported Sites

| Site | URL Pattern | Feature |
|------|-------------|---------|
| Temporal Cloud | `https://cloud.temporal.io/namespaces/*/workflows*` | Adds "Tenant Name" column |
| ClickHouse Cloud | `https://console.clickhouse.cloud/services/*` | Appends names to UUID databases |
| Datadog | `https://app.datadoghq.com/*` | Adds badges to account UUIDs in traces |

## File Structure

```
tenant-mapping-extension/
├── manifest.json            # Extension configuration
├── shared.js                # Shared utilities for all sites
├── content-temporal.js      # Temporal Cloud DOM manipulation
├── content-clickhouse.js    # ClickHouse Cloud DOM manipulation
├── content-datadog.js       # Datadog trace panel DOM manipulation
├── options.html             # Settings page UI
├── options.js               # Settings page logic
├── styles-temporal.css      # Temporal column styling
├── styles-clickhouse.css    # ClickHouse label styling
├── styles-datadog.css       # Datadog badge styling
├── icons/                   # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── tenant-mappings.json     # Default tenant mappings
└── README.md                # This file
```

## Technical Details

- **Manifest Version**: 3
- **Permissions**: `storage` (for saving tenant mappings and site settings)
- **Storage**: Uses `chrome.storage.sync` (max ~100KB, syncs across devices)
- **Architecture**: Modular design with shared utilities and site-specific content scripts

## Development

### Making Changes

1. Edit the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Reload the target page to see changes

### Debugging

- Open Chrome DevTools on the target page to see content script logs
- Look for messages starting with `[Temporal Extension]`, `[ClickHouse Extension]`, or `[Datadog Extension]`
- Visit `chrome://extensions/` → Click "Errors" to see any errors

## Browser Compatibility

- Chrome/Chromium 88+
- Edge 88+
- Brave
- Firefox (requires manifest v2 conversion)

## Troubleshooting

### Temporal: Column not appearing

1. Make sure you're on `https://cloud.temporal.io/namespaces/*/workflows*`
2. Check that Temporal Cloud is enabled in extension options
3. Refresh the page
4. Check the browser console for errors
5. Verify the extension is enabled in `chrome://extensions/`

### ClickHouse: Tenant names not appearing

1. Make sure you're on `https://console.clickhouse.cloud/services/*`
2. Check that ClickHouse Cloud is enabled in extension options
3. Click the database picker to open the dropdown
4. Verify tenant mappings are configured in Options
5. Check that the database name is a valid UUID

### Tenant names showing "Unknown"

1. Verify tenant mappings are configured in Options
2. Check that the tenant ID matches the UUID exactly
3. Try exporting your mappings to verify the format
4. Ensure the UUID is a valid format (8-4-4-4-12 hexadecimal)

### Datadog: Badges not appearing

1. Make sure you're on `https://app.datadoghq.com/*`
2. Check that Datadog is enabled in extension options
3. Open a trace panel with URLs containing `/accounts/{uuid}/` pattern
4. Verify tenant mappings are configured in Options
5. Check the browser console for `[Datadog Extension]` logs
6. Ensure the account UUID in the URL matches your mappings

### Extension not loading

1. Check for errors in `chrome://extensions/`
2. Verify all required files are present
3. Ensure you're using Chrome 88 or later

## Privacy

- This extension only runs on Temporal Cloud, ClickHouse Cloud, and Datadog pages
- All data is stored locally in your browser's sync storage
- No data is sent to external servers
- The extension does not modify any functionality of the target sites
- Source code is available for review

## License

MIT License - feel free to modify and distribute

---

**Note**: This is an unofficial extension and is not affiliated with or endorsed by Temporal Technologies Inc., ClickHouse Inc., or Datadog Inc.
