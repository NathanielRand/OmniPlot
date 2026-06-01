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
	{ id: "chevy-silverado1500-2016-crew", make: "Chevrolet", model: "Silverado 1500 Crew Cab", year: 2016, bodyStyle: "truck", tags: ["truck", "popular"], popular: true, status: "published", updatedAt: "2026-05-27" },
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

const CHEVY_SILVERADO1500_2016_CREW_PPF: Pattern[] = [
	{ id: "cs16-ppf-hd",  vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M5,4 L95,4 L97,96 L3,96 Z",                                 widthInches: 72.0, heightInches: 52.0, revision: "2026-05", notes: "Calibrated from F-150 (74\"×60\"); K2XX hood shorter due to lower cowl height",          isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-bf",  vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 76.0, heightInches: 15.0, revision: "2026-05", notes: "Silverado full-width painted bumper cover; width from 80\" overall minus fender returns", isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-br",  vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "bumper-rear",        name: "Rear Bumper",        coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 74.0, heightInches: 13.0, revision: "2026-05",                                                                                               isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-ffl", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 36.0, heightInches: 25.0, revision: "2026-05", notes: "Calibrated from F-150 (38\"×28\") adjusted for Silverado proportions",                   isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-ffr", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 36.0, heightInches: 25.0, revision: "2026-05", notes: "Calibrated from F-150 (38\"×28\") adjusted for Silverado proportions",                   isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-hl",  vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 22.0, heightInches:  9.0, revision: "2026-05", notes: "K2XX horizontal composite headlight unit",                                              isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-hr",  vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 22.0, heightInches:  9.0, revision: "2026-05", notes: "K2XX horizontal composite headlight unit",                                              isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-fgl", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "foglight-left",      name: "Fog Light Left",     coverage: "full", svgPath: "M5,50 Q5,5 50,5 Q95,5 95,50 Q95,95 50,95 Q5,95 5,50 Z",   widthInches:  5.0, heightInches:  5.0, revision: "2026-05", notes: "Round fog light in bumper corner; most trims equipped",                                 isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-fgr", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "foglight-right",     name: "Fog Light Right",    coverage: "full", svgPath: "M5,50 Q5,5 50,5 Q95,5 95,50 Q95,95 50,95 Q5,95 5,50 Z",   widthInches:  5.0, heightInches:  5.0, revision: "2026-05", notes: "Round fog light in bumper corner; most trims equipped",                                 isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-ml",  vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 12.0, heightInches:  7.0, revision: "2026-05", notes: "Standard power heated mirror; Silverado tow mirrors are larger — use 14\"×9\" if equipped", isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-mr",  vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 12.0, heightInches:  7.0, revision: "2026-05", notes: "Standard power heated mirror; Silverado tow mirrors are larger — use 14\"×9\" if equipped", isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-dfl", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 40.0, heightInches: 50.0, revision: "2026-05", notes: "Calibrated from F-150 (42\"×54\") adjusted for Silverado's 73.8\" overall height",       isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-dfr", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 40.0, heightInches: 50.0, revision: "2026-05", notes: "Calibrated from F-150 (42\"×54\") adjusted for Silverado's 73.8\" overall height",       isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-drl", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 50.0, revision: "2026-05", notes: "Calibrated from F-150 (38\"×54\"); crew cab rear door is slightly narrower",             isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-drr", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 50.0, revision: "2026-05", notes: "Calibrated from F-150 (38\"×54\"); crew cab rear door is slightly narrower",             isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-rkl", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "rocker-left",        name: "Rocker Left",        coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 78.0, heightInches:  6.0, revision: "2026-05", notes: "Full-length rocker panel — crew cab spans all 4 doors; chrome or body-color depending on trim", isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-rkr", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "rocker-right",       name: "Rocker Right",       coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 78.0, heightInches:  6.0, revision: "2026-05", notes: "Full-length rocker panel — crew cab spans all 4 doors; chrome or body-color depending on trim", isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-apl", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "a-pillar-left",      name: "A-Pillar Left",      coverage: "full", svgPath: "M15,5 L85,5 L88,95 L12,95 Z",                               widthInches:  4.5, heightInches: 26.0, revision: "2026-05",                                                                                               isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
	{ id: "cs16-ppf-apr", vehicleId: "chevy-silverado1500-2016-crew", category: "ppf", zone: "a-pillar-right",     name: "A-Pillar Right",     coverage: "full", svgPath: "M12,5 L88,5 L85,95 L15,95 Z",                               widthInches:  4.5, heightInches: 26.0, revision: "2026-05",                                                                                               isPublished: true, createdAt: D_CS16, updatedAt: D_CS16 },
];

// ─── Seed map (used as fallback and for seeding Firestore) ───
const SEED_PATTERNS: Record<string, Pattern[]> = {
	"chevy-silverado1500-2016-crew": [...CHEVY_SILVERADO1500_2016_CREW_TINT, ...CHEVY_SILVERADO1500_2016_CREW_PPF],
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
