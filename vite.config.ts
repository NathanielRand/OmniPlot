import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// Prevent Vite from bundling sharp's native binary into the SSR output.
	// Without this, the linux-x64 binary Vercel installs at build time is
	// unreachable at runtime because the bundled path no longer resolves.
	ssr: {
		external: ['sharp'],
	},
	test: {
		include: ['src/**/*.test.ts'],
		alias: {
			'$lib': path.resolve('./src/lib'),
		},
	},
});
