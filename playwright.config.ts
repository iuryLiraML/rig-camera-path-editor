import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/** Dedicated port so this suite never attaches to another clone's `npm run dev` on :5173. */
const PORT = 5174

/**
 * Linux WebKit records through GStreamer. The MiniBrowser links the system
 * `libgstreamer-1.0` and looks up VP8/WebM and H.264/MP4 as plugins, not as
 * sonames. `npm run webkit:gst` unpacks those plugins into this directory;
 * when it is absent the loader uses whatever the distro already shipped.
 * Unlike `LD_LIBRARY_PATH`, the bundle launcher does not overwrite this, so
 * the content process sees it.
 */
const GST_PLUGIN_PATH = join(homedir(), '.local', 'lib', 'gstreamer-1.0')
if (existsSync(GST_PLUGIN_PATH)) {
  process.env.GST_PLUGIN_PATH = [GST_PLUGIN_PATH, process.env.GST_PLUGIN_PATH]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(':')
}
const GST_PRESET_PATH = join(homedir(), '.local', 'share', 'gstreamer-1.0', 'presets')
if (existsSync(GST_PRESET_PATH)) {
  process.env.GST_PRESET_PATH = [GST_PRESET_PATH, process.env.GST_PRESET_PATH]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(':')
}

/**
 * Chromium is `npm run test:browser`; WebKit is `npm run test:browser:webkit`.
 * The WebKit payload is built for Ubuntu 24.04, so a host without that
 * release's `libicu*.so.74`, `libxml2.so.2` and `libflite*.so.1` needs
 * `npm run webkit:libs` once — the browser's own launcher hard-sets
 * `LD_LIBRARY_PATH`, so there is nothing to configure from here.
 *
 * Real Safari on macOS remains a human gate: this payload is WebKit, not Safari.
 */
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
})
