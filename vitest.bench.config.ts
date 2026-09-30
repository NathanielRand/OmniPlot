import { defineConfig } from 'vitest/config';
import path from 'path';

// Vectorizer accuracy benchmark — run with:  npx vitest run -c vitest.bench.config.ts
export default defineConfig({
	test: {
		include: ['scripts/vectorize-bench/**/*.bench.test.ts'],
		alias: { '$lib': path.resolve('./src/lib') },
		testTimeout: 600_000,
	},
});
