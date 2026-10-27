import type { ManifestV3Export } from '@crxjs/vite-plugin'

const manifest: ManifestV3Export = {
  manifest_version: 3,
  minimum_chrome_version: '116',
  name: 'AI Video Notes',
  version: '0.1.0',
  description: 'Create timestamped study notes from web videos and courses.',
  permissions: ['activeTab', 'sidePanel', 'storage', 'tabs', 'scripting'],
  optional_permissions: ['offscreen', 'tabCapture'],
  host_permissions: [
    'http://127.0.0.1:8080/*',
    'http://localhost:8080/*',
    'http://127.0.0.1/*',
    'http://localhost/*',
    '<all_urls>',
  ],
  action: {
    default_title: 'AI Video Notes',
    default_popup: 'index.html',
  },
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'sidepanel.html',
  },
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content.ts'],
      all_frames: true,
      run_at: 'document_idle',
    },
  ],
}

export default manifest
