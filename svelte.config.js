import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		version: {
			// Unique per build — SvelteKit writes this to /_app/version.json and
			// exposes it via the `updated` store, which becomes true when the
			// deployed version.name differs from the one baked into the client bundle.
			name: Date.now().toString(),
			pollInterval: 5 * 60 * 1000,  // check every 5 min
		},
	}
};

export default config;
