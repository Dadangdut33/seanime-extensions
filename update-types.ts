import fs from 'node:fs';
import path from 'node:path';

// Types: https://github.com/5rahim/seanime/tree/main/internal/extension_repo/goja_plugin_types
const BASE_URL =
  'https://raw.githubusercontent.com/5rahim/seanime/refs/heads/main/internal/extension_repo/goja_plugin_types/';
const FILES = [
  'app.d.ts',
  'core.d.ts',
  'plugin.d.ts',
  'system.d.ts',
  // 'tsconfig.json',
];
const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

async function updateTypes() {
  console.log('Updating type definitions...');

  try {
    if (!fs.existsSync(PLUGINS_DIR)) {
      console.error('Plugins directory not found');
      return;
    }

    const plugins = fs.readdirSync(PLUGINS_DIR).filter((file) => {
      return fs.statSync(path.join(PLUGINS_DIR, file)).isDirectory();
    });

    if (plugins.length === 0) {
      console.log('No plugins found.');
      return;
    }

    for (const plugin of plugins) {
      console.log(`\nUpdating types for plugin: ${plugin}`);
      const pluginDirPath = path.join(PLUGINS_DIR, plugin);

      for (const filename of FILES) {
        const url = `${BASE_URL}${filename}`;
        const targetPath = path.join(pluginDirPath, filename);

        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch ${filename}: ${response.statusText}`,
            );
          }

          const content = await response.text();
          fs.writeFileSync(targetPath, content);
          console.log(`  [OK] ${filename}`);
        } catch (error: any) {
          console.error(
            `  [ERROR] Failed to update ${filename}: ${error.message}`,
          );
        }
      }
    }

    console.log('\nType definitions update complete!');
  } catch (error: any) {
    console.error('An error occurred:', error.message);
  }
}

updateTypes();
