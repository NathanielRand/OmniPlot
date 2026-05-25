import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

const BUILD_VERSION = Date.now().toString();

function versionStampPlugin() {
	return {
		name: 'build-version-stamp',
		// configResolved runs in both `vite dev` and `vite build`
		configResolved() {
			fs.writeFileSync('static/version.json', JSON.stringify({ version: BUILD_VERSION }));
		},
	};
}

export default defineConfig({
	define: {
		__BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
	},
	plugins: [tailwindcss(), sveltekit(), versionStampPlugin()],
	test: {
		include: ['src/**/*.test.ts'],
		alias: {
			'$lib': path.resolve('./src/lib'),
		},
	},
});
