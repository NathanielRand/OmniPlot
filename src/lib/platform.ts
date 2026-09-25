// ─────────────────────────────────────────────
// OmniPlot — PLATFORM FEATURE FLAGS
// ─────────────────────────────────────────────
// Stored at settings/platform.flags, edited from Admin → Settings, served
// publicly by GET /api/settings/platform. These defaults apply whenever a flag
// has never been saved. `openRegistration` is also enforced in firestore.rules.

export const PLATFORM_FLAGS = {
	maintenanceMode: {
		label: 'Maintenance mode',
		desc: 'Show a maintenance banner across the whole site.',
		default: false,
		built: true,
	},
	openRegistration: {
		label: 'Open registration',
		desc: 'Allow new accounts to be created. Existing users can still sign in.',
		default: true,
		built: true,
	},
	exportDXF: {
		label: 'DXF export',
		desc: 'Offer DXF as an export format in Studio.',
		default: true,
		built: true,
	},
	cutAgent: {
		label: 'Cut Agent',
		desc: 'Send jobs straight to a plotter through the local Cut Agent.',
		default: true,
		built: true,
	},
	aiAssist: {
		label: 'AI Assist',
		desc: 'Pattern suggestions and smart nesting.',
		default: false,
		built: false,
	},
	commandPalette: {
		label: 'Command palette',
		desc: 'Keyboard-driven command search (⌘K).',
		default: false,
		built: false,
	},
	exportPDF: {
		label: 'PDF export',
		desc: 'Export cut sheets as PDF.',
		default: false,
		built: false,
	},
} as const;

export type PlatformFlag = keyof typeof PLATFORM_FLAGS;
export type PlatformFlags = Record<PlatformFlag, boolean>;

export const DEFAULT_PLATFORM_FLAGS = Object.fromEntries(
	Object.entries(PLATFORM_FLAGS).map(([k, v]) => [k, v.default]),
) as PlatformFlags;

/** Stored flags over the defaults, ignoring unknown or non-boolean values. */
export function mergePlatformFlags(stored: unknown): PlatformFlags {
	const out = { ...DEFAULT_PLATFORM_FLAGS };
	if (stored && typeof stored === 'object') {
		for (const key of Object.keys(out) as PlatformFlag[]) {
			const v = (stored as Record<string, unknown>)[key];
			if (typeof v === 'boolean') out[key] = v;
		}
	}
	return out;
}
