// ─────────────────────────────────────────────
// OmniPlot — PATTERN & VEHICLE STORE (Svelte 5 Runes)
// Shared source of truth for admin and library pages.
// ─────────────────────────────────────────────

import { uid } from "$lib/utils";
import type { Pattern, PatternCategory, PatternCoverage, PatternZone } from "$lib/types";

// ─── Types ────────────────────────────────────

export type PatternStatus = "published" | "draft" | "review";
export type RequestStatus = "queued" | "in-progress" | "done";

export interface VehicleEntry {
	id: string;
	make: string;
	model: string;
	year: number;
	bodyStyle: "sedan" | "coupe" | "suv" | "truck" | "convertible" | "wagon" | "hatchback";
	tags: string[];
	popular?: boolean;
	status: PatternStatus;
	updatedAt: string;
}

export interface PatternRequest {
	id: string;
	vehicle: string;
	make: string;
	model: string;
	year: number;
	notes: string;
	votes: number;
	status: RequestStatus;
	requestedAt: string;
}

// ─── Seed: Vehicles ───────────────────────────

const INITIAL_VEHICLES: VehicleEntry[] = [
	{ id: "bmw-m4-2024",           make: "BMW",          model: "M4",                 year: 2024, bodyStyle: "coupe",     tags: ["popular", "sport"], popular: true, status: "published", updatedAt: "2024-11-12" },
	{ id: "bmw-m3-2024",           make: "BMW",          model: "M3",                 year: 2024, bodyStyle: "sedan",     tags: ["sport"],                            status: "published", updatedAt: "2024-10-20" },
	{ id: "bmw-x5-2024",           make: "BMW",          model: "X5",                 year: 2024, bodyStyle: "suv",       tags: [],                                   status: "published", updatedAt: "2024-10-05" },
	{ id: "bmw-m5-2025",           make: "BMW",          model: "M5",                 year: 2025, bodyStyle: "sedan",     tags: [],                                   status: "draft",     updatedAt: "2024-12-14" },
	{ id: "tesla-model3-2024",     make: "Tesla",        model: "Model 3",            year: 2024, bodyStyle: "sedan",     tags: ["popular", "ev"],    popular: true, status: "published", updatedAt: "2024-11-08" },
	{ id: "tesla-models-2024",     make: "Tesla",        model: "Model S",            year: 2024, bodyStyle: "sedan",     tags: ["ev"],                               status: "published", updatedAt: "2024-10-15" },
	{ id: "tesla-modelx-2024",     make: "Tesla",        model: "Model X",            year: 2024, bodyStyle: "suv",       tags: ["ev"],                               status: "published", updatedAt: "2024-10-08" },
	{ id: "porsche-911-2024",      make: "Porsche",      model: "911 GT3",            year: 2024, bodyStyle: "coupe",     tags: ["sport", "popular"], popular: true, status: "published", updatedAt: "2024-10-31" },
	{ id: "porsche-cayenne-24",    make: "Porsche",      model: "Cayenne GTS",        year: 2024, bodyStyle: "suv",       tags: [],                                   status: "published", updatedAt: "2024-09-15" },
	{ id: "ford-f150-2024",        make: "Ford",         model: "F-150",              year: 2024, bodyStyle: "truck",     tags: ["truck"],                            status: "published", updatedAt: "2024-10-14" },
	{ id: "ford-mustang-2024",     make: "Ford",         model: "Mustang GT",         year: 2024, bodyStyle: "coupe",     tags: ["sport"],                            status: "published", updatedAt: "2024-10-01" },
	{ id: "mercedes-c300-2024",    make: "Mercedes",     model: "C300",               year: 2024, bodyStyle: "sedan",     tags: [],                                   status: "published", updatedAt: "2024-09-30" },
	{ id: "mercedes-g63-2024",     make: "Mercedes",     model: "G 63 AMG",           year: 2024, bodyStyle: "suv",       tags: ["popular"],          popular: true, status: "review",    updatedAt: "2024-12-02" },
	{ id: "audi-rs6-2024",         make: "Audi",         model: "RS6 Avant",          year: 2024, bodyStyle: "wagon",     tags: ["sport"],                            status: "published", updatedAt: "2024-11-01" },
	{ id: "toyota-supra-2024",     make: "Toyota",       model: "GR Supra",           year: 2024, bodyStyle: "coupe",     tags: ["sport"],                            status: "published", updatedAt: "2024-09-22" },
	{ id: "toyota-gr86-2024",      make: "Toyota",       model: "GR86",               year: 2024, bodyStyle: "coupe",     tags: [],                                   status: "published", updatedAt: "2024-09-22" },
	{ id: "dodge-hellcat-2024",    make: "Dodge",        model: "Challenger Hellcat", year: 2024, bodyStyle: "coupe",     tags: ["sport"],                            status: "published", updatedAt: "2024-09-10" },
	{ id: "honda-civic-2024",      make: "Honda",        model: "Civic Type R",       year: 2024, bodyStyle: "hatchback", tags: [],                                   status: "published", updatedAt: "2024-09-05" },
	{ id: "lamborghini-urus-2024", make: "Lamborghini",  model: "Urus",               year: 2024, bodyStyle: "suv",       tags: [],                                   status: "draft",     updatedAt: "2024-12-10" },
	{ id: "corvette-z06-2024",     make: "Chevrolet",    model: "Corvette Z06",       year: 2024, bodyStyle: "coupe",     tags: [],                                   status: "published", updatedAt: "2024-10-05" },
];

// ─── Seed: Tesla Model 3 2024 Window Tint Patterns ───
// Dimensions based on the 2024 Tesla Model 3 Highland (4th gen).
// All measurements in inches from professional tint cut templates.
// SVG paths are in 0-100 coordinate space; nesting scales to inch dims.

const D = new Date("2024-11-01");

const TM3_2024_TINT: Pattern[] = [
	{
		id: "tm3-tint-windshield",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "windshield",
		name: "Windshield",
		coverage: "full",
		svgPath: "M6,95 Q10,28 28,6 L72,6 Q90,28 94,95 Z",
		widthInches: 57,
		heightInches: 26,
		revision: "2024-11",
		notes: "Check state regulations — front windshield tint is restricted in many states",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
	{
		id: "tm3-tint-ws-strip",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "windshield-strip",
		name: "Windshield Strip",
		coverage: "partial",
		svgPath: "M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",
		widthInches: 57,
		heightInches: 5,
		revision: "2024-11",
		notes: "Top visor strip only — legal in all states",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
	{
		id: "tm3-tint-win-fl",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "window-front-left",
		name: "Front Driver Window",
		coverage: "full",
		svgPath: "M5,8 L85,5 L90,92 L8,95 Z",
		widthInches: 24,
		heightInches: 17,
		revision: "2024-11",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
	{
		id: "tm3-tint-win-fr",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "window-front-right",
		name: "Front Passenger Window",
		coverage: "full",
		svgPath: "M15,5 L95,8 L92,95 L10,92 Z",
		widthInches: 24,
		heightInches: 17,
		revision: "2024-11",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
	{
		id: "tm3-tint-win-rl",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "window-rear-left",
		name: "Rear Driver Window",
		coverage: "full",
		svgPath: "M5,8 L92,8 L95,92 L8,92 Z",
		widthInches: 29,
		heightInches: 13,
		revision: "2024-11",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
	{
		id: "tm3-tint-win-rr",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "window-rear-right",
		name: "Rear Passenger Window",
		coverage: "full",
		svgPath: "M8,8 L95,8 L92,92 L5,92 Z",
		widthInches: 29,
		heightInches: 13,
		revision: "2024-11",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
	{
		id: "tm3-tint-rear-ws",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "rear-windshield",
		name: "Rear Windshield",
		coverage: "full",
		svgPath: "M8,92 Q12,25 15,8 L85,8 Q88,25 92,92 Z",
		widthInches: 52,
		heightInches: 20,
		revision: "2024-11",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
	{
		id: "tm3-tint-pano-front",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "sunroof",
		name: "Panoramic Roof (Front)",
		coverage: "full",
		svgPath: "M10,5 Q5,5 5,10 L5,90 Q5,95 10,95 L90,95 Q95,95 95,90 L95,10 Q95,5 90,5 Z",
		widthInches: 45,
		heightInches: 34,
		revision: "2024-11",
		notes: "Main glass roof panel — A-pillar to B-pillar",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
	{
		id: "tm3-tint-pano-rear",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "moonroof",
		name: "Panoramic Roof (Rear)",
		coverage: "full",
		svgPath: "M8,5 Q5,5 5,8 L5,92 Q5,95 8,95 L92,95 Q95,95 95,92 L95,8 Q95,5 92,5 Z",
		widthInches: 42,
		heightInches: 18,
		revision: "2024-11",
		notes: "Rear glass roof panel — B-pillar to C-pillar",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
	{
		id: "tm3-tint-qw-left",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "quarter-window-left",
		name: "Quarter Window Left",
		coverage: "full",
		svgPath: "M5,8 L82,18 L78,82 L5,90 Z",
		widthInches: 7,
		heightInches: 10,
		revision: "2024-11",
		notes: "Small triangular piece at C-pillar (driver side)",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
	{
		id: "tm3-tint-qw-right",
		vehicleId: "tesla-model3-2024",
		category: "window-tint",
		zone: "quarter-window-right",
		name: "Quarter Window Right",
		coverage: "full",
		svgPath: "M95,8 L18,18 L22,82 L95,90 Z",
		widthInches: 7,
		heightInches: 10,
		revision: "2024-11",
		notes: "Small triangular piece at C-pillar (passenger side)",
		isPublished: true,
		createdAt: D,
		updatedAt: D,
	},
];

// ─── Seed: Pattern Requests ───────────────────

const INITIAL_REQUESTS: PatternRequest[] = [
	{ id: "r1", vehicle: "2025 BMW M5",             make: "BMW",         model: "M5",          year: 2025, notes: "", votes: 34, status: "in-progress", requestedAt: "2024-11-20" },
	{ id: "r2", vehicle: "2025 Mercedes CLE",        make: "Mercedes",    model: "CLE",         year: 2025, notes: "", votes: 28, status: "queued",      requestedAt: "2024-11-22" },
	{ id: "r3", vehicle: "2025 Tesla Model Y",       make: "Tesla",       model: "Model Y",     year: 2025, notes: "", votes: 22, status: "queued",      requestedAt: "2024-11-25" },
	{ id: "r4", vehicle: "2024 Lamborghini Urus",    make: "Lamborghini", model: "Urus",        year: 2024, notes: "", votes: 18, status: "queued",      requestedAt: "2024-12-01" },
	{ id: "r5", vehicle: "2024 Rivian R1T",          make: "Rivian",      model: "R1T",         year: 2024, notes: "", votes: 14, status: "queued",      requestedAt: "2024-12-03" },
	{ id: "r6", vehicle: "2025 Ford Mustang GT500",  make: "Ford",        model: "Mustang GT500", year: 2025, notes: "", votes: 11, status: "queued",    requestedAt: "2024-12-05" },
];

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

// ─── Store Factory ────────────────────────────

function createPatternStore() {
	let vehicles = $state<VehicleEntry[]>(INITIAL_VEHICLES);
	let patterns = $state<Record<string, Pattern[]>>({ "tesla-model3-2024": TM3_2024_TINT });
	let requests = $state<PatternRequest[]>(INITIAL_REQUESTS);

	function getPatterns(vehicleId: string, category?: PatternCategory): Pattern[] {
		const all = patterns[vehicleId] ?? [];
		return category ? all.filter((p) => p.category === category) : all;
	}

	function hasPatterns(vehicleId: string, category?: PatternCategory): boolean {
		return getPatterns(vehicleId, category).length > 0;
	}

	function addVehicle(entry: Omit<VehicleEntry, "id">): VehicleEntry {
		const v: VehicleEntry = { ...entry, id: uid("v_") };
		vehicles = [...vehicles, v];
		return v;
	}

	function updateVehicle(id: string, patch: Partial<VehicleEntry>) {
		vehicles = vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v));
	}

	function deleteVehicle(id: string) {
		vehicles = vehicles.filter((v) => v.id !== id);
		const next = { ...patterns };
		delete next[id];
		patterns = next;
	}

	function addPattern(p: Omit<Pattern, "id" | "createdAt" | "updatedAt">): Pattern {
		const now = new Date();
		const pattern: Pattern = { ...p, id: uid("pat_"), createdAt: now, updatedAt: now };
		patterns = { ...patterns, [p.vehicleId]: [...(patterns[p.vehicleId] ?? []), pattern] };
		updateVehicle(p.vehicleId, { updatedAt: now.toISOString().split("T")[0] });
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
	}

	function deletePattern(id: string) {
		const next: Record<string, Pattern[]> = {};
		for (const [vid, pats] of Object.entries(patterns)) {
			next[vid] = pats.filter((p) => p.id !== id);
		}
		patterns = next;
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
		return req;
	}

	function advanceRequest(id: string) {
		requests = requests.map((r) => {
			if (r.id !== id) return r;
			if (r.status === "queued") return { ...r, status: "in-progress" as RequestStatus };
			if (r.status === "in-progress") return { ...r, status: "done" as RequestStatus };
			return r;
		});
	}

	function voteRequest(id: string) {
		requests = requests.map((r) => (r.id === id ? { ...r, votes: r.votes + 1 } : r));
	}

	return {
		get vehicles() { return vehicles; },
		get requests() { return requests; },
		getPatterns,
		hasPatterns,
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
