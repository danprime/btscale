const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  use: {
    headless: true,
    viewport: { width: 800, height: 900 },
    screenshot: 'only-on-failure'
  }
});
