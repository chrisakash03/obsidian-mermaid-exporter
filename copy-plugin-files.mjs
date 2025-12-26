import { mkdir, copyFile, access } from 'fs/promises';
import { join } from 'path';

const pluginFolder = 'obsidian-plugin';
const filesToCopy = ['main.js', 'manifest.json'];

async function copyPluginFiles() {
	try {
		// Create the plugin folder if it doesn't exist
		await mkdir(pluginFolder, { recursive: true });

		// Copy each file
		for (const file of filesToCopy) {
			try {
				await access(file);
				await copyFile(file, join(pluginFolder, file));
				console.log(`✓ Copied ${file} to ${pluginFolder}/`);
			} catch (error) {
				if (error.code === 'ENOENT') {
					console.warn(`⚠ Warning: ${file} not found, skipping...`);
				} else {
					throw error;
				}
			}
		}

		console.log(`\n✅ Plugin files ready in ./${pluginFolder}/ folder`);
		console.log(`   Copy this folder to your Obsidian vault's .obsidian/plugins/ directory\n`);
	} catch (error) {
		console.error('Error copying plugin files:', error);
		process.exit(1);
	}
}

copyPluginFiles();

