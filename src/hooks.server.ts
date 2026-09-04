import type { HandleServerError } from '@sveltejs/kit';
import { logServerError } from '$lib/server/log-error';

// Catches anything that escapes a route's own try/catch — the backstop for
// the errors we didn't think to instrument manually.
export const handleError: HandleServerError = async ({ error, event }) => {
	await logServerError(error, {
		source: 'unhandled',
		route: event.route?.id ?? event.url.pathname,
	});
	// SvelteKit strips error details from the client response by default;
	// keep that behavior rather than leaking internals.
	return { message: 'An unexpected error occurred.' };
};
