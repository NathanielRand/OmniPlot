// ─────────────────────────────────────────────
// OmniPlot — PATTERN & VEHICLE STORE (Svelte 5 Runes)
// Shared source of truth for admin and library pages.
// ─────────────────────────────────────────────

import { uid } from "$lib/utils";
import type {
	Pattern,
	PatternCategory,
	PatternCoverage,
	PatternZone,
	VehicleEntry,
	PatternRequest,
	PatternStatus,
	RequestStatus,
} from "$lib/types";
import {
	subscribeVehicles,
	subscribePatterns,
	subscribeRequests,
	setVehicleDoc,
	updateVehicleDoc,
	deleteVehicleDoc,
	setPatternDoc,
	updatePatternDoc,
	deletePatternDoc,
	setRequestDoc,
	updateRequestDoc,
	batchSeedData,
} from "$lib/firebase/firestore";
import { toastStore } from "./stores.svelte";

export type { PatternStatus, RequestStatus, VehicleEntry, PatternRequest };

// ─── Seed: Vehicles ───────────────────────────

const INITIAL_VEHICLES: VehicleEntry[] = [
	{ id: "chevy-silverado1500-2014", make: "Chevrolet", model: "Silverado 1500", year: 2014, bodyStyle: "truck", tags: ["truck", "k2xx"], popular: false, status: "published", updatedAt: "2026-06-01" },
	{ id: "chevy-silverado1500-2015", make: "Chevrolet", model: "Silverado 1500", year: 2015, bodyStyle: "truck", tags: ["truck", "k2xx"], popular: false, status: "published", updatedAt: "2026-06-01" },
	{ id: "chevy-silverado1500-2016-crew", make: "Chevrolet", model: "Silverado 1500 Crew Cab", year: 2016, bodyStyle: "truck", tags: ["truck", "popular", "k2xx"], popular: true, status: "published", updatedAt: "2026-06-01" },
	{ id: "chevy-silverado1500-2017", make: "Chevrolet", model: "Silverado 1500", year: 2017, bodyStyle: "truck", tags: ["truck", "k2xx"], popular: false, status: "published", updatedAt: "2026-06-01" },
	{ id: "chevy-silverado1500-2018", make: "Chevrolet", model: "Silverado 1500", year: 2018, bodyStyle: "truck", tags: ["truck", "k2xx"], popular: false, status: "published", updatedAt: "2026-06-01" },
	{ id: "chevy-silverado1500-2019-limited", make: "Chevrolet", model: "Silverado 1500 Limited", year: 2019, bodyStyle: "truck", tags: ["truck", "k2xx", "limited"], popular: false, status: "published", updatedAt: "2026-06-01" },
];

// ─── Seed: Pattern Requests ───────────────────

const INITIAL_REQUESTS: PatternRequest[] = [];

// ─── Zone metadata ────────────────────────────

// Maps PatternZone values to human-readable group names (used for zone filter).
export const TINT_ZONE_GROUP: Partial<Record<PatternZone, string>> = {
	windshield:           "Windshield",
	"windshield-strip":   "Windshield",
	"rear-windshield":    "Rear Window",
	sunroof:              "Sunroof",
	moonroof:             "Sunroof",
	"window-front-left":  "Side Windows",
	"window-front-right": "Side Windows",
	"window-rear-left":   "Side Windows",
	"window-rear-right":  "Side Windows",
	"quarter-window-left":  "Quarter / Vent",
	"quarter-window-right": "Quarter / Vent",
	"vent-window-left":   "Quarter / Vent",
	"vent-window-right":  "Quarter / Vent",
};

export const PPF_ZONE_GROUP: Partial<Record<PatternZone, string>> = {
	hood: "Hood", "hood-edge-left": "Hood", "hood-edge-right": "Hood",
	"bumper-front": "Bumpers", "bumper-rear": "Bumpers",
	"fender-front-left": "Fenders", "fender-front-right": "Fenders",
	"fender-rear-left": "Fenders", "fender-rear-right": "Fenders",
	"door-front-left": "Doors", "door-front-right": "Doors",
	"door-rear-left": "Doors", "door-rear-right": "Doors",
	"rocker-left": "Rocker Panels", "rocker-right": "Rocker Panels",
	"mirror-left": "Mirrors", "mirror-right": "Mirrors",
	roof: "Roof", "a-pillar-left": "Roof", "a-pillar-right": "Roof",
	trunk: "Trunk",
	"headlight-left": "Lights", "headlight-right": "Lights",
	"foglight-left": "Lights", "foglight-right": "Lights",
};

// ─── Seed: Chevrolet Silverado 1500 Crew Cab 2016 (K2XX) ─────────────────────
// Window dimensions sourced from NAGS glass catalogs and diyautoglass.net.
// PPF dimensions calibrated from F-150 measurements with Silverado adjustments.
// SVG paths are in 0-100 normalized coordinate space; nesting.ts scales to inches.
//
// IMPORTANT: These are starting-point templates. Community-verified measurements
// should be used for production cutting. Dimensions marked UNVERIFIED require
// confirmation against a physical vehicle or professional cut template.

const D_CS16 = new Date("2026-05-27");

const CHEVY_SILVERADO1500_2016_CREW_TINT: Pattern[] = [
	{
		// Windshield: trapezoidal — wider at cowl, narrower at header. Swept A-pillar
		// sides follow the ~20° rake of the K2XX windshield from vertical.
		id: "cs16-ws", vehicleId: "chevy-silverado1500-2016-crew", category: "window-tint",
		zone: "windshield", name: "Windshield", coverage: "full",
		svgPath: "M4,93 Q6,20 15,6 L85,6 Q94,20 96,93 Q50,96 4,93 Z",
		widthInches: 60.5, heightInches: 31.0, revision: "2026-06",
		notes: "Width ~60.5\" corroborated; height 31.0\" UNCITED — verify before cutting. Front tint restricted in most states.",
		isPublished: true, createdAt: D_CS16, updatedAt: D_CS16,
	},
	{
		// Windshield visor strip: spans full width, slight arch following header curve.
		id: "cs16-wss", vehicleId: "chevy-silverado1500-2016-crew", category: "window-tint",
		zone: "windshield-strip", name: "Windshield Strip", coverage: "partial",
		svgPath: "M15,5 Q50,2 85,5 L83,92 Q50,88 17,92 Z",
		widthInches: 60.5, heightInches: 5.5, revision: "2026-06",
		notes: "Top visor strip — legal in all states. Height uncited.",
		isPublished: true, createdAt: D_CS16, updatedAt: D_CS16,
	},
	{
		// Front driver window: A-pillar (left edge) rakes ~10° rearward from vertical —
		// top-left corner is ~15 normalized units right of bottom-left corner.
		// Top edge has a very slight outward arch following the greenhouse crown.
		// Bottom edge (belt line) rises ~3° toward B-pillar.
		// B-pillar (right edge) is nearly vertical (2–3° lean).
		id: "cs16-wfl", vehicleId: "chevy-silverado1500-2016-crew", category: "window-tint",
		zone: "window-front-left", name: "Front Driver Window", coverage: "full",
		svgPath: "M4,90 L19,8 Q55,5 93,6 L95,88 Q50,93 4,90 Z",
		widthInches: 26.0, heightInches: 22.0, revision: "2026-06",
		notes: "UNVERIFIED dimensions — verify against NAGS DW catalog or physical template before cutting. Shape reflects K2XX A-pillar geometry.",
		isPublished: true, createdAt: D_CS16, updatedAt: D_CS16,
	},
	{
		// Front passenger window: mirror image of driver. A-pillar now on right edge.
		id: "cs16-wfr", vehicleId: "chevy-silverado1500-2016-crew", category: "window-tint",
		zone: "window-front-right", name: "Front Passenger Window", coverage: "full",
		svgPath: "M96,90 L81,8 Q45,5 7,6 L5,88 Q50,93 96,90 Z",
		widthInches: 26.0, heightInches: 22.0, revision: "2026-06",
		notes: "UNVERIFIED dimensions — verify against NAGS DW catalog or physical template before cutting. Shape reflects K2XX A-pillar geometry.",
		isPublished: true, createdAt: D_CS16, updatedAt: D_CS16,
	},
	{
		// Rear driver window (crew cab): more upright than front door — B-pillar (left)
		// is nearly vertical (~5° lean). C-pillar (right) has a lean similar to A-pillar.
		// Slightly more rectangular overall than the front door glass.
		id: "cs16-wrl", vehicleId: "chevy-silverado1500-2016-crew", category: "window-tint",
		zone: "window-rear-left", name: "Rear Driver Window", coverage: "full",
		svgPath: "M5,90 L8,8 Q52,4 92,6 L95,89 Q52,93 5,90 Z",
		widthInches: 24.0, heightInches: 21.0, revision: "2026-06",
		notes: "UNVERIFIED dimensions — verify against NAGS DW catalog or physical template before cutting. Shape reflects K2XX B/C-pillar geometry.",
		isPublished: true, createdAt: D_CS16, updatedAt: D_CS16,
	},
	{
		// Rear passenger window: mirror of rear driver.
		id: "cs16-wrr", vehicleId: "chevy-silverado1500-2016-crew", category: "window-tint",
		zone: "window-rear-right", name: "Rear Passenger Window", coverage: "full",
		svgPath: "M95,90 L92,8 Q48,4 8,6 L5,89 Q48,93 95,90 Z",
		widthInches: 24.0, heightInches: 21.0, revision: "2026-06",
		notes: "UNVERIFIED dimensions — verify against NAGS DW catalog or physical template before cutting. Shape reflects K2XX B/C-pillar geometry.",
		isPublished: true, createdAt: D_CS16, updatedAt: D_CS16,
	},
	{
		// Rear back glass: 64"×17" is the documented block size for the K2XX 1500 Crew Cab.
		// Shape: nearly rectangular. Top edge follows flat cab roofline — essentially straight.
		// Sides have very slight inward curve (taper ~1–2" narrower at bottom over 17" height).
		// Bottom has a gentle arch following the rear window molding.
		// Corners have moderate radii.
		id: "cs16-rws", vehicleId: "chevy-silverado1500-2016-crew", category: "window-tint",
		zone: "rear-windshield", name: "Rear Window", coverage: "full",
		svgPath: "M5,88 L5,12 Q8,5 14,4 L86,4 Q92,5 95,12 L95,88 Q88,95 12,95 Z",
		widthInches: 64.0, heightInches: 17.0, revision: "2026-06",
		notes: "64\"×17\" VERIFIED: diyautoglass.net + consistent across K2XX 2014–2018 glass replacement catalogs.",
		isPublished: true, createdAt: D_CS16, updatedAt: D_CS16,
	},
];


// ─── Seed: Silverado 1500 Windshield Visor Strip Kit (2014-2019) ─────────────
// Source: precut tint kit dimensions, "2014-2018 & (2019 Limited) Chevrolet
// Silverado 1500 Visor/Eyebrow Precut Tint Kit". Fits all cab styles.
// 2014-2016: symmetric two-piece kit (L = R dimensions, both arch-cut from same path).
// 2017-2019 Limited: asymmetric two-piece kit (driver side wider than passenger).
// SVG paths in 0-100 normalized coordinate space.

const D_K2XX_VISOR = new Date("2026-06-01");
const REV_K2XX     = "2026-06";

// Shared SVG paths
// Symmetric arch/crescent — used for both pieces on 2014-2016 (identical cut)
const SVG_VISOR_ARCH = "M 3,88 Q 50,8 97,88 L 95,98 Q 50,74 5,98 Z";
// Asymmetric driver (left) — tall on left, tapers toward center-right
const SVG_VISOR_L    = "M 3,92 L 3,22 Q 50,5 97,38 L 97,92 Z";
// Asymmetric passenger (right) — mirror: low on left center, tall toward right A-pillar
const SVG_VISOR_R    = "M 3,38 Q 50,5 97,22 L 97,92 L 3,92 Z";

const NOTE_SYM  = "Symmetric 2-piece kit — cut two identical pieces. Fits all cab styles (Regular, Double, Crew). Verify against physical vehicle before cutting.";
const NOTE_ASYM = "Asymmetric 2-piece kit — driver side wider than passenger. Fits all cab styles. Verify against physical vehicle before cutting.";

// 2014 — symmetric, 26.58" × 6.07"
const CHEVY_SILVERADO1500_2014_VISOR: Pattern[] = [
	{ id: "cs14-wsvl", vehicleId: "chevy-silverado1500-2014", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Left",  coverage: "partial", svgPath: SVG_VISOR_ARCH, widthInches: 26.58, heightInches: 6.07, revision: REV_K2XX, notes: NOTE_SYM,  isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
	{ id: "cs14-wsvr", vehicleId: "chevy-silverado1500-2014", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Right", coverage: "partial", svgPath: SVG_VISOR_ARCH, widthInches: 26.58, heightInches: 6.07, revision: REV_K2XX, notes: NOTE_SYM,  isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
];

// 2015 — symmetric, 27.01" × 7.31"
const CHEVY_SILVERADO1500_2015_VISOR: Pattern[] = [
	{ id: "cs15-wsvl", vehicleId: "chevy-silverado1500-2015", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Left",  coverage: "partial", svgPath: SVG_VISOR_ARCH, widthInches: 27.01, heightInches: 7.31, revision: REV_K2XX, notes: NOTE_SYM,  isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
	{ id: "cs15-wsvr", vehicleId: "chevy-silverado1500-2015", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Right", coverage: "partial", svgPath: SVG_VISOR_ARCH, widthInches: 27.01, heightInches: 7.31, revision: REV_K2XX, notes: NOTE_SYM,  isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
];

// 2016 — symmetric, 27.36" × 8.77" (added to existing 2016 Crew Cab vehicle)
const CHEVY_SILVERADO1500_2016_VISOR: Pattern[] = [
	{ id: "cs16-wsvl", vehicleId: "chevy-silverado1500-2016-crew", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Left",  coverage: "partial", svgPath: SVG_VISOR_ARCH, widthInches: 27.36, heightInches: 8.77, revision: REV_K2XX, notes: NOTE_SYM,  isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
	{ id: "cs16-wsvr", vehicleId: "chevy-silverado1500-2016-crew", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Right", coverage: "partial", svgPath: SVG_VISOR_ARCH, widthInches: 27.36, heightInches: 8.77, revision: REV_K2XX, notes: NOTE_SYM,  isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
];

// 2017 — asymmetric, driver 25.83" × 5.86" / passenger 21.82" × 5.86"
const CHEVY_SILVERADO1500_2017_VISOR: Pattern[] = [
	{ id: "cs17-wsvl", vehicleId: "chevy-silverado1500-2017", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Driver",    coverage: "partial", svgPath: SVG_VISOR_L,    widthInches: 25.83, heightInches: 5.86, revision: REV_K2XX, notes: NOTE_ASYM, isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
	{ id: "cs17-wsvr", vehicleId: "chevy-silverado1500-2017", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Passenger", coverage: "partial", svgPath: SVG_VISOR_R,    widthInches: 21.82, heightInches: 5.86, revision: REV_K2XX, notes: NOTE_ASYM, isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
];

// 2018 — asymmetric, driver 27.09" × 7.90" / passenger 23.01" × 7.90"
const CHEVY_SILVERADO1500_2018_VISOR: Pattern[] = [
	{ id: "cs18-wsvl", vehicleId: "chevy-silverado1500-2018", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Driver",    coverage: "partial", svgPath: SVG_VISOR_L,    widthInches: 27.09, heightInches: 7.90, revision: REV_K2XX, notes: NOTE_ASYM, isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
	{ id: "cs18-wsvr", vehicleId: "chevy-silverado1500-2018", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Passenger", coverage: "partial", svgPath: SVG_VISOR_R,    widthInches: 23.01, heightInches: 7.90, revision: REV_K2XX, notes: NOTE_ASYM, isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
];

// 2019 Limited — asymmetric, driver 27.44" × 9.30" / passenger 23.37" × 9.30"
const CHEVY_SILVERADO1500_2019_LIMITED_VISOR: Pattern[] = [
	{ id: "cs19l-wsvl", vehicleId: "chevy-silverado1500-2019-limited", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Driver",    coverage: "partial", svgPath: SVG_VISOR_L, widthInches: 27.44, heightInches: 9.30, revision: REV_K2XX, notes: NOTE_ASYM, isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
	{ id: "cs19l-wsvr", vehicleId: "chevy-silverado1500-2019-limited", category: "window-tint", zone: "windshield-strip", name: "Windshield Visor Strip Passenger", coverage: "partial", svgPath: SVG_VISOR_R, widthInches: 23.37, heightInches: 9.30, revision: REV_K2XX, notes: NOTE_ASYM, isPublished: true, createdAt: D_K2XX_VISOR, updatedAt: D_K2XX_VISOR },
];

// ─── Seed map (used as fallback and for seeding Firestore) ───
const SEED_PATTERNS: Record<string, Pattern[]> = {
	"chevy-silverado1500-2014":         CHEVY_SILVERADO1500_2014_VISOR,
	"chevy-silverado1500-2015":         CHEVY_SILVERADO1500_2015_VISOR,
	"chevy-silverado1500-2016-crew":    [...CHEVY_SILVERADO1500_2016_CREW_TINT, ...CHEVY_SILVERADO1500_2016_VISOR],
	"chevy-silverado1500-2017":         CHEVY_SILVERADO1500_2017_VISOR,
	"chevy-silverado1500-2018":         CHEVY_SILVERADO1500_2018_VISOR,
	"chevy-silverado1500-2019-limited": CHEVY_SILVERADO1500_2019_LIMITED_VISOR,
};

// ─── Store Factory ────────────────────────────

function createPatternStore() {
	let vehicles  = $state<VehicleEntry[]>(INITIAL_VEHICLES);
	let patterns  = $state<Record<string, Pattern[]>>(SEED_PATTERNS);
	let requests  = $state<PatternRequest[]>(INITIAL_REQUESTS);
	let loading   = $state(false);
	let firestoreReady = false;

	// ─ Internal: rebuild pattern map from flat Firestore array ─
	function mapPatterns(flat: Pattern[]): Record<string, Pattern[]> {
		const m: Record<string, Pattern[]> = {};
		for (const p of flat) {
			m[p.vehicleId] = [...(m[p.vehicleId] ?? []), p];
		}
		return m;
	}

	// ─ Firestore write helpers ─────────────────────────────────
	function syncVehicle(v: VehicleEntry) {
		if (!firestoreReady) return;
		setVehicleDoc(v).catch(() => toastStore.error("Sync error", "Could not save vehicle"));
	}
	function syncVehicleUpdate(id: string, patch: Partial<VehicleEntry>) {
		if (!firestoreReady) return;
		updateVehicleDoc(id, patch).catch(() => toastStore.error("Sync error", "Could not update vehicle"));
	}
	function syncVehicleDelete(id: string) {
		if (!firestoreReady) return;
		deleteVehicleDoc(id).catch(() => toastStore.error("Sync error", "Could not delete vehicle"));
	}
	function syncPattern(p: Pattern) {
		if (!firestoreReady) return;
		setPatternDoc(p).catch(() => toastStore.error("Sync error", "Could not save pattern"));
	}
	function syncPatternUpdate(id: string, patch: Partial<Pattern>) {
		if (!firestoreReady) return;
		updatePatternDoc(id, patch).catch(() => toastStore.error("Sync error", "Could not update pattern"));
	}
	function syncPatternDelete(id: string) {
		if (!firestoreReady) return;
		deletePatternDoc(id).catch(() => toastStore.error("Sync error", "Could not delete pattern"));
	}
	function syncRequest(r: PatternRequest) {
		if (!firestoreReady) return;
		setRequestDoc(r).catch(() => toastStore.error("Sync error", "Could not save request"));
	}
	function syncRequestUpdate(id: string, patch: Partial<PatternRequest>) {
		if (!firestoreReady) return;
		updateRequestDoc(id, patch).catch(() => toastStore.error("Sync error", "Could not update request"));
	}

	// ─ Lifecycle ───────────────────────────────────────────────
	function init(): () => void {
		if (firestoreReady) return () => {};
		loading = true;

		let vReady = false, pReady = false, rReady = false;
		function checkReady() {
			if (vReady && pReady && rReady) {
				loading = false;
				firestoreReady = true;
			}
		}

		const unsubV = subscribeVehicles(
			(entries) => {
				if (entries.length > 0) vehicles = entries;
				vReady = true;
				checkReady();
			},
			() => { vReady = true; checkReady(); }, // keep seed on error
		);

		const unsubP = subscribePatterns(
			(flat) => {
				if (flat.length > 0) patterns = mapPatterns(flat);
				pReady = true;
				checkReady();
			},
			() => { pReady = true; checkReady(); },
		);

		const unsubR = subscribeRequests(
			(reqs) => {
				requests = reqs;
				rReady = true;
				checkReady();
			},
			() => { rReady = true; checkReady(); },
		);

		return () => { unsubV(); unsubP(); unsubR(); firestoreReady = false; };
	}

	async function seedFirestore(): Promise<void> {
		try {
			await batchSeedData(INITIAL_VEHICLES, SEED_PATTERNS, INITIAL_REQUESTS);
			toastStore.success("Seeded", "All vehicles, patterns, and requests written to Firestore");
		} catch (e) {
			toastStore.error("Seed failed", String(e));
		}
	}

	// ─ Queries ─────────────────────────────────────────────────
	function getPatterns(vehicleId: string, category?: PatternCategory): Pattern[] {
		const all = patterns[vehicleId] ?? [];
		return category ? all.filter((p) => p.category === category) : all;
	}

	function hasPatterns(vehicleId: string, category?: PatternCategory): boolean {
		return getPatterns(vehicleId, category).length > 0;
	}

	// ─ Mutations ────────────────────────────────────────────────
	function addVehicle(entry: Omit<VehicleEntry, "id">): VehicleEntry {
		const v: VehicleEntry = { ...entry, id: uid("v_") };
		vehicles = [...vehicles, v];
		syncVehicle(v);
		return v;
	}

	function updateVehicle(id: string, patch: Partial<VehicleEntry>) {
		vehicles = vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v));
		syncVehicleUpdate(id, patch);
	}

	function deleteVehicle(id: string) {
		vehicles = vehicles.filter((v) => v.id !== id);
		const next = { ...patterns };
		delete next[id];
		patterns = next;
		syncVehicleDelete(id);
	}

	function addPattern(p: Omit<Pattern, "id" | "createdAt" | "updatedAt">): Pattern {
		const now = new Date();
		const pattern: Pattern = { ...p, id: uid("pat_"), createdAt: now, updatedAt: now };
		patterns = { ...patterns, [p.vehicleId]: [...(patterns[p.vehicleId] ?? []), pattern] };
		updateVehicle(p.vehicleId, { updatedAt: now.toISOString().split("T")[0] });
		syncPattern(pattern);
		return pattern;
	}

	function updatePattern(id: string, patch: Partial<Pattern>) {
		const next: Record<string, Pattern[]> = {};
		for (const [vid, pats] of Object.entries(patterns)) {
			next[vid] = pats.map((p) =>
				p.id === id ? { ...p, ...patch, updatedAt: new Date() } : p,
			);
		}
		patterns = next;
		syncPatternUpdate(id, { ...patch, updatedAt: new Date() });
	}

	function deletePattern(id: string) {
		const next: Record<string, Pattern[]> = {};
		for (const [vid, pats] of Object.entries(patterns)) {
			next[vid] = pats.filter((p) => p.id !== id);
		}
		patterns = next;
		syncPatternDelete(id);
	}

	function addRequest(r: { make: string; model: string; year: number; notes: string }): PatternRequest {
		const req: PatternRequest = {
			id: uid("req_"),
			vehicle: `${r.year} ${r.make} ${r.model}`,
			make: r.make,
			model: r.model,
			year: r.year,
			notes: r.notes,
			votes: 1,
			status: "queued",
			requestedAt: new Date().toISOString().split("T")[0],
		};
		requests = [...requests, req];
		syncRequest(req);
		return req;
	}

	function advanceRequest(id: string) {
		requests = requests.map((r) => {
			if (r.id !== id) return r;
			if (r.status === "queued") return { ...r, status: "in-progress" as RequestStatus };
			if (r.status === "in-progress") return { ...r, status: "done" as RequestStatus };
			return r;
		});
		const updated = requests.find((r) => r.id === id);
		if (updated) syncRequestUpdate(id, { status: updated.status });
	}

	function voteRequest(id: string) {
		requests = requests.map((r) => (r.id === id ? { ...r, votes: r.votes + 1 } : r));
		const updated = requests.find((r) => r.id === id);
		if (updated) syncRequestUpdate(id, { votes: updated.votes });
	}

	return {
		get vehicles() { return vehicles; },
		get requests() { return requests; },
		get loading() { return loading; },
		getPatterns,
		hasPatterns,
		init,
		seedFirestore,
		addVehicle,
		updateVehicle,
		deleteVehicle,
		addPattern,
		updatePattern,
		deletePattern,
		addRequest,
		advanceRequest,
		voteRequest,
	};
}

export const patternStore = createPatternStore();

// ─── Vehicle name lookup ──────────────────────
export function getVehicleName(vehicleId: string): string {
	const v = INITIAL_VEHICLES.find((e) => e.id === vehicleId);
	if (!v) return vehicleId;
	return `${v.year} ${v.make} ${v.model}`;
}

// ─── Zone options (for admin add-pattern form) ─

export const PPF_ZONES_LIST: Array<{ value: PatternZone; label: string }> = [
	{ value: "hood",              label: "Hood" },
	{ value: "hood-edge-left",    label: "Hood Edge Left" },
	{ value: "hood-edge-right",   label: "Hood Edge Right" },
	{ value: "bumper-front",      label: "Front Bumper" },
	{ value: "bumper-rear",       label: "Rear Bumper" },
	{ value: "fender-front-left", label: "Fender Front Left" },
	{ value: "fender-front-right",label: "Fender Front Right" },
	{ value: "fender-rear-left",  label: "Fender Rear Left" },
	{ value: "fender-rear-right", label: "Fender Rear Right" },
	{ value: "door-front-left",   label: "Door Front Left" },
	{ value: "door-front-right",  label: "Door Front Right" },
	{ value: "door-rear-left",    label: "Door Rear Left" },
	{ value: "door-rear-right",   label: "Door Rear Right" },
	{ value: "rocker-left",       label: "Rocker Left" },
	{ value: "rocker-right",      label: "Rocker Right" },
	{ value: "mirror-left",       label: "Mirror Left" },
	{ value: "mirror-right",      label: "Mirror Right" },
	{ value: "a-pillar-left",     label: "A-Pillar Left" },
	{ value: "a-pillar-right",    label: "A-Pillar Right" },
	{ value: "roof",              label: "Roof" },
	{ value: "trunk",             label: "Trunk" },
	{ value: "headlight-left",    label: "Headlight Left" },
	{ value: "headlight-right",   label: "Headlight Right" },
	{ value: "foglight-left",     label: "Foglight Left" },
	{ value: "foglight-right",    label: "Foglight Right" },
	{ value: "custom",            label: "Custom" },
];

// Mirror pairs — selecting one side suggests adding the other.
// Only zones that have a geometric mirror are listed; symmetric zones (hood, roof, etc.) are absent.
export const MIRROR_PAIRS: Partial<Record<PatternZone, PatternZone>> = {
	"hood-edge-left":       "hood-edge-right",
	"hood-edge-right":      "hood-edge-left",
	"fender-front-left":    "fender-front-right",
	"fender-front-right":   "fender-front-left",
	"fender-rear-left":     "fender-rear-right",
	"fender-rear-right":    "fender-rear-left",
	"door-front-left":      "door-front-right",
	"door-front-right":     "door-front-left",
	"door-rear-left":       "door-rear-right",
	"door-rear-right":      "door-rear-left",
	"rocker-left":          "rocker-right",
	"rocker-right":         "rocker-left",
	"mirror-left":          "mirror-right",
	"mirror-right":         "mirror-left",
	"a-pillar-left":        "a-pillar-right",
	"a-pillar-right":       "a-pillar-left",
	"headlight-left":       "headlight-right",
	"headlight-right":      "headlight-left",
	"foglight-left":        "foglight-right",
	"foglight-right":       "foglight-left",
	"window-front-left":    "window-front-right",
	"window-front-right":   "window-front-left",
	"window-rear-left":     "window-rear-right",
	"window-rear-right":    "window-rear-left",
	"quarter-window-left":  "quarter-window-right",
	"quarter-window-right": "quarter-window-left",
	"vent-window-left":     "vent-window-right",
	"vent-window-right":    "vent-window-left",
};

export const TINT_ZONES_LIST: Array<{ value: PatternZone; label: string }> = [
	{ value: "windshield",          label: "Windshield (Full)" },
	{ value: "windshield-strip",    label: "Windshield Strip" },
	{ value: "window-front-left",   label: "Front Driver Window" },
	{ value: "window-front-right",  label: "Front Passenger Window" },
	{ value: "window-rear-left",    label: "Rear Driver Window" },
	{ value: "window-rear-right",   label: "Rear Passenger Window" },
	{ value: "rear-windshield",     label: "Rear Windshield" },
	{ value: "sunroof",             label: "Sunroof / Panoramic Roof" },
	{ value: "moonroof",            label: "Moonroof / Rear Panel" },
	{ value: "quarter-window-left", label: "Quarter Window Left" },
	{ value: "quarter-window-right",label: "Quarter Window Right" },
	{ value: "vent-window-left",    label: "Vent Window Left" },
	{ value: "vent-window-right",   label: "Vent Window Right" },
	{ value: "custom",              label: "Custom" },
];
