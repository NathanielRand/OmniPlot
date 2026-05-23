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

// ─── Seed: Remaining Vehicle Window Tint Patterns ─────────────────────────────
// Dimensions from professional tint cut templates; SVG paths normalized 0-100.
// Body-style path conventions:
//   Coupe WS  — steeply raked  | Sedan WS  — moderate rake
//   SUV WS    — more upright   | Truck WS  — near-vertical

// BMW M4 2024 (G82 — coupe, no rear side windows)
const BMW_M4_2024_TINT: Pattern[] = [
	{ id:"bm4-ws",   vehicleId:"bmw-m4-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M9,92 Q12,28 28,8 L72,8 Q88,28 91,92 Z",  widthInches:56, heightInches:29, revision:"2024-11", notes:"Front tint restricted in many states", isPublished:true, createdAt:new Date("2024-11-12"), updatedAt:new Date("2024-11-12") },
	{ id:"bm4-wss",  vehicleId:"bmw-m4-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:56, heightInches:5,  revision:"2024-11", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-11-12"), updatedAt:new Date("2024-11-12") },
	{ id:"bm4-wfl",  vehicleId:"bmw-m4-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:23, heightInches:19, revision:"2024-11",                                                            isPublished:true, createdAt:new Date("2024-11-12"), updatedAt:new Date("2024-11-12") },
	{ id:"bm4-wfr",  vehicleId:"bmw-m4-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:23, heightInches:19, revision:"2024-11",                                                            isPublished:true, createdAt:new Date("2024-11-12"), updatedAt:new Date("2024-11-12") },
	{ id:"bm4-qwl",  vehicleId:"bmw-m4-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:8,  heightInches:12, revision:"2024-11", notes:"C-pillar triangle — driver side",       isPublished:true, createdAt:new Date("2024-11-12"), updatedAt:new Date("2024-11-12") },
	{ id:"bm4-qwr",  vehicleId:"bmw-m4-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:8,  heightInches:12, revision:"2024-11", notes:"C-pillar triangle — passenger side",    isPublished:true, createdAt:new Date("2024-11-12"), updatedAt:new Date("2024-11-12") },
	{ id:"bm4-rws",  vehicleId:"bmw-m4-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 Q14,20 20,8 L80,8 Q86,20 92,92 Z",  widthInches:50, heightInches:17, revision:"2024-11",                                                            isPublished:true, createdAt:new Date("2024-11-12"), updatedAt:new Date("2024-11-12") },
];

// BMW M3 2024 (G80 — sedan)
const BMW_M3_2024_TINT: Pattern[] = [
	{ id:"bm3-ws",   vehicleId:"bmw-m3-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M6,95 Q10,28 28,6 L72,6 Q90,28 94,95 Z",  widthInches:57, heightInches:30, revision:"2024-10", notes:"Front tint restricted in many states", isPublished:true, createdAt:new Date("2024-10-20"), updatedAt:new Date("2024-10-20") },
	{ id:"bm3-wss",  vehicleId:"bmw-m3-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:57, heightInches:5,  revision:"2024-10", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-10-20"), updatedAt:new Date("2024-10-20") },
	{ id:"bm3-wfl",  vehicleId:"bmw-m3-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:24, heightInches:19, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-20"), updatedAt:new Date("2024-10-20") },
	{ id:"bm3-wfr",  vehicleId:"bmw-m3-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:24, heightInches:19, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-20"), updatedAt:new Date("2024-10-20") },
	{ id:"bm3-wrl",  vehicleId:"bmw-m3-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:22, heightInches:15, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-20"), updatedAt:new Date("2024-10-20") },
	{ id:"bm3-wrr",  vehicleId:"bmw-m3-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:22, heightInches:15, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-20"), updatedAt:new Date("2024-10-20") },
	{ id:"bm3-qwl",  vehicleId:"bmw-m3-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:9,  heightInches:10, revision:"2024-10", notes:"C-pillar triangle — driver side",       isPublished:true, createdAt:new Date("2024-10-20"), updatedAt:new Date("2024-10-20") },
	{ id:"bm3-qwr",  vehicleId:"bmw-m3-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:9,  heightInches:10, revision:"2024-10", notes:"C-pillar triangle — passenger side",    isPublished:true, createdAt:new Date("2024-10-20"), updatedAt:new Date("2024-10-20") },
	{ id:"bm3-rws",  vehicleId:"bmw-m3-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 Q12,25 15,8 L85,8 Q88,25 92,92 Z",  widthInches:52, heightInches:20, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-20"), updatedAt:new Date("2024-10-20") },
];

// BMW X5 2024 (G05 — SUV)
const BMW_X5_2024_TINT: Pattern[] = [
	{ id:"bx5-ws",   vehicleId:"bmw-x5-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M8,92 Q10,32 20,8 L80,8 Q90,32 92,92 Z",  widthInches:60, heightInches:34, revision:"2024-10", notes:"Front tint restricted in many states", isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"bx5-wss",  vehicleId:"bmw-x5-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:60, heightInches:6,  revision:"2024-10", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"bx5-wfl",  vehicleId:"bmw-x5-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:26, heightInches:22, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"bx5-wfr",  vehicleId:"bmw-x5-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:26, heightInches:22, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"bx5-wrl",  vehicleId:"bmw-x5-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:24, heightInches:19, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"bx5-wrr",  vehicleId:"bmw-x5-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:24, heightInches:19, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"bx5-qwl",  vehicleId:"bmw-x5-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:10, heightInches:12, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"bx5-qwr",  vehicleId:"bmw-x5-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:10, heightInches:12, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"bx5-rws",  vehicleId:"bmw-x5-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,90 Q10,28 14,8 L86,8 Q90,28 92,90 Z",  widthInches:54, heightInches:25, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
];

// BMW M5 2025 (G90 — sedan, draft)
const BMW_M5_2025_TINT: Pattern[] = [
	{ id:"bm5-ws",   vehicleId:"bmw-m5-2025", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M6,95 Q10,28 28,6 L72,6 Q90,28 94,95 Z",  widthInches:58, heightInches:30, revision:"2024-12", notes:"Front tint restricted in many states", isPublished:true, createdAt:new Date("2024-12-14"), updatedAt:new Date("2024-12-14") },
	{ id:"bm5-wss",  vehicleId:"bmw-m5-2025", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:58, heightInches:5,  revision:"2024-12", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-12-14"), updatedAt:new Date("2024-12-14") },
	{ id:"bm5-wfl",  vehicleId:"bmw-m5-2025", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:24, heightInches:19, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-14"), updatedAt:new Date("2024-12-14") },
	{ id:"bm5-wfr",  vehicleId:"bmw-m5-2025", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:24, heightInches:19, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-14"), updatedAt:new Date("2024-12-14") },
	{ id:"bm5-wrl",  vehicleId:"bmw-m5-2025", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:22, heightInches:16, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-14"), updatedAt:new Date("2024-12-14") },
	{ id:"bm5-wrr",  vehicleId:"bmw-m5-2025", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:22, heightInches:16, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-14"), updatedAt:new Date("2024-12-14") },
	{ id:"bm5-qwl",  vehicleId:"bmw-m5-2025", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:9,  heightInches:11, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-14"), updatedAt:new Date("2024-12-14") },
	{ id:"bm5-qwr",  vehicleId:"bmw-m5-2025", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:9,  heightInches:11, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-14"), updatedAt:new Date("2024-12-14") },
	{ id:"bm5-rws",  vehicleId:"bmw-m5-2025", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 Q12,25 15,8 L85,8 Q88,25 92,92 Z",  widthInches:53, heightInches:21, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-14"), updatedAt:new Date("2024-12-14") },
];

// Tesla Model S 2024 (sedan + full panoramic glass roof)
const TESLA_MS_2024_TINT: Pattern[] = [
	{ id:"tms-ws",   vehicleId:"tesla-models-2024", category:"window-tint", zone:"windshield",            name:"Windshield",               coverage:"full",    svgPath:"M6,95 Q10,28 28,6 L72,6 Q90,28 94,95 Z",  widthInches:57, heightInches:30, revision:"2024-10", notes:"Front tint restricted in many states",   isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
	{ id:"tms-wss",  vehicleId:"tesla-models-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",         coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:57, heightInches:5,  revision:"2024-10", notes:"Top visor strip — legal in all states",   isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
	{ id:"tms-wfl",  vehicleId:"tesla-models-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",      coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:24, heightInches:19, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
	{ id:"tms-wfr",  vehicleId:"tesla-models-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window",   coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:24, heightInches:19, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
	{ id:"tms-wrl",  vehicleId:"tesla-models-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",       coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:22, heightInches:15, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
	{ id:"tms-wrr",  vehicleId:"tesla-models-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",    coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:22, heightInches:15, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
	{ id:"tms-qwl",  vehicleId:"tesla-models-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",      coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:8,  heightInches:10, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
	{ id:"tms-qwr",  vehicleId:"tesla-models-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",     coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:8,  heightInches:10, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
	{ id:"tms-pf",   vehicleId:"tesla-models-2024", category:"window-tint", zone:"sunroof",                name:"Panoramic Roof (Front)",   coverage:"full",    svgPath:"M10,5 Q5,5 5,10 L5,90 Q5,95 10,95 L90,95 Q95,95 95,90 L95,10 Q95,5 90,5 Z", widthInches:48, heightInches:36, revision:"2024-10", notes:"Glass roof front section — A to B pillar", isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
	{ id:"tms-pr",   vehicleId:"tesla-models-2024", category:"window-tint", zone:"moonroof",               name:"Panoramic Roof (Rear)",    coverage:"full",    svgPath:"M8,5 Q5,5 5,8 L5,92 Q5,95 8,95 L92,95 Q95,95 95,92 L95,8 Q95,5 92,5 Z",    widthInches:44, heightInches:20, revision:"2024-10", notes:"Glass roof rear section — B to C pillar",  isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
	{ id:"tms-rws",  vehicleId:"tesla-models-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",          coverage:"full",    svgPath:"M8,92 Q12,25 15,8 L85,8 Q88,25 92,92 Z",  widthInches:53, heightInches:21, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-15"), updatedAt:new Date("2024-10-15") },
];

// Tesla Model X 2024 (SUV + full panoramic roof)
const TESLA_MX_2024_TINT: Pattern[] = [
	{ id:"tmx-ws",   vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"windshield",            name:"Windshield",               coverage:"full",    svgPath:"M8,92 Q10,32 20,8 L80,8 Q90,32 92,92 Z",  widthInches:57, heightInches:32, revision:"2024-10", notes:"Front tint restricted in many states",   isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
	{ id:"tmx-wss",  vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",         coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:57, heightInches:6,  revision:"2024-10", notes:"Top visor strip — legal in all states",   isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
	{ id:"tmx-wfl",  vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",      coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:26, heightInches:22, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
	{ id:"tmx-wfr",  vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window",   coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:26, heightInches:22, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
	{ id:"tmx-wrl",  vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",       coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:24, heightInches:18, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
	{ id:"tmx-wrr",  vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",    coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:24, heightInches:18, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
	{ id:"tmx-qwl",  vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",      coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:10, heightInches:12, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
	{ id:"tmx-qwr",  vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",     coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:10, heightInches:12, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
	{ id:"tmx-pf",   vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"sunroof",                name:"Panoramic Roof (Front)",   coverage:"full",    svgPath:"M10,5 Q5,5 5,10 L5,90 Q5,95 10,95 L90,95 Q95,95 95,90 L95,10 Q95,5 90,5 Z", widthInches:50, heightInches:38, revision:"2024-10", notes:"Front glass roof panel",                   isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
	{ id:"tmx-pr",   vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"moonroof",               name:"Panoramic Roof (Rear)",    coverage:"full",    svgPath:"M8,5 Q5,5 5,8 L5,92 Q5,95 8,95 L92,95 Q95,95 95,92 L95,8 Q95,5 92,5 Z",    widthInches:46, heightInches:22, revision:"2024-10", notes:"Rear glass roof panel",                    isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
	{ id:"tmx-rws",  vehicleId:"tesla-modelx-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",          coverage:"full",    svgPath:"M8,90 Q10,28 14,8 L86,8 Q90,28 92,90 Z",  widthInches:56, heightInches:26, revision:"2024-10",                                                              isPublished:true, createdAt:new Date("2024-10-08"), updatedAt:new Date("2024-10-08") },
];

// Porsche 911 GT3 2024 (992 — coupe, no rear side windows)
const PORSCHE_911_2024_TINT: Pattern[] = [
	{ id:"p9-ws",    vehicleId:"porsche-911-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M9,92 Q12,28 28,8 L72,8 Q88,28 91,92 Z",  widthInches:50, heightInches:26, revision:"2024-10", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-10-31"), updatedAt:new Date("2024-10-31") },
	{ id:"p9-wss",   vehicleId:"porsche-911-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:50, heightInches:5,  revision:"2024-10", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-10-31"), updatedAt:new Date("2024-10-31") },
	{ id:"p9-wfl",   vehicleId:"porsche-911-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:22, heightInches:16, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-31"), updatedAt:new Date("2024-10-31") },
	{ id:"p9-wfr",   vehicleId:"porsche-911-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:22, heightInches:16, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-31"), updatedAt:new Date("2024-10-31") },
	{ id:"p9-qwl",   vehicleId:"porsche-911-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:9,  heightInches:13, revision:"2024-10", notes:"Rear quarter — driver side",            isPublished:true, createdAt:new Date("2024-10-31"), updatedAt:new Date("2024-10-31") },
	{ id:"p9-qwr",   vehicleId:"porsche-911-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:9,  heightInches:13, revision:"2024-10", notes:"Rear quarter — passenger side",         isPublished:true, createdAt:new Date("2024-10-31"), updatedAt:new Date("2024-10-31") },
	{ id:"p9-rws",   vehicleId:"porsche-911-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 Q14,20 20,8 L80,8 Q86,20 92,92 Z",  widthInches:46, heightInches:16, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-31"), updatedAt:new Date("2024-10-31") },
];

// Porsche Cayenne GTS 2024 (E3 — SUV)
const PORSCHE_CAYENNE_2024_TINT: Pattern[] = [
	{ id:"pcy-ws",   vehicleId:"porsche-cayenne-24", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M8,92 Q10,32 20,8 L80,8 Q90,32 92,92 Z",  widthInches:58, heightInches:32, revision:"2024-09", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-09-15"), updatedAt:new Date("2024-09-15") },
	{ id:"pcy-wss",  vehicleId:"porsche-cayenne-24", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:58, heightInches:6,  revision:"2024-09", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-09-15"), updatedAt:new Date("2024-09-15") },
	{ id:"pcy-wfl",  vehicleId:"porsche-cayenne-24", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:26, heightInches:21, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-15"), updatedAt:new Date("2024-09-15") },
	{ id:"pcy-wfr",  vehicleId:"porsche-cayenne-24", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:26, heightInches:21, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-15"), updatedAt:new Date("2024-09-15") },
	{ id:"pcy-wrl",  vehicleId:"porsche-cayenne-24", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:24, heightInches:18, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-15"), updatedAt:new Date("2024-09-15") },
	{ id:"pcy-wrr",  vehicleId:"porsche-cayenne-24", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:24, heightInches:18, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-15"), updatedAt:new Date("2024-09-15") },
	{ id:"pcy-qwl",  vehicleId:"porsche-cayenne-24", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:10, heightInches:12, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-15"), updatedAt:new Date("2024-09-15") },
	{ id:"pcy-qwr",  vehicleId:"porsche-cayenne-24", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:10, heightInches:12, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-15"), updatedAt:new Date("2024-09-15") },
	{ id:"pcy-rws",  vehicleId:"porsche-cayenne-24", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,90 Q10,28 14,8 L86,8 Q90,28 92,90 Z",  widthInches:52, heightInches:24, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-15"), updatedAt:new Date("2024-09-15") },
];

// Ford F-150 2024 (P702 — SuperCrew truck, no quarter windows)
const FORD_F150_2024_TINT: Pattern[] = [
	{ id:"ff1-ws",   vehicleId:"ford-f150-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M8,92 L10,8 L90,8 L92,92 Z",              widthInches:63, heightInches:35, revision:"2024-10", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-10-14"), updatedAt:new Date("2024-10-14") },
	{ id:"ff1-wss",  vehicleId:"ford-f150-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:63, heightInches:6,  revision:"2024-10", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-10-14"), updatedAt:new Date("2024-10-14") },
	{ id:"ff1-wfl",  vehicleId:"ford-f150-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:29, heightInches:24, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-14"), updatedAt:new Date("2024-10-14") },
	{ id:"ff1-wfr",  vehicleId:"ford-f150-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:29, heightInches:24, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-14"), updatedAt:new Date("2024-10-14") },
	{ id:"ff1-wrl",  vehicleId:"ford-f150-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:25, heightInches:21, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-14"), updatedAt:new Date("2024-10-14") },
	{ id:"ff1-wrr",  vehicleId:"ford-f150-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:25, heightInches:21, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-14"), updatedAt:new Date("2024-10-14") },
	{ id:"ff1-rws",  vehicleId:"ford-f150-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 L10,8 L90,8 L92,92 Z",              widthInches:62, heightInches:29, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-14"), updatedAt:new Date("2024-10-14") },
];

// Ford Mustang GT 2024 (S650 — coupe, no rear side windows)
const FORD_MUSTANG_2024_TINT: Pattern[] = [
	{ id:"fmu-ws",   vehicleId:"ford-mustang-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M9,92 Q12,28 28,8 L72,8 Q88,28 91,92 Z",  widthInches:54, heightInches:28, revision:"2024-10", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-10-01"), updatedAt:new Date("2024-10-01") },
	{ id:"fmu-wss",  vehicleId:"ford-mustang-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:54, heightInches:5,  revision:"2024-10", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-10-01"), updatedAt:new Date("2024-10-01") },
	{ id:"fmu-wfl",  vehicleId:"ford-mustang-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:22, heightInches:17, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-01"), updatedAt:new Date("2024-10-01") },
	{ id:"fmu-wfr",  vehicleId:"ford-mustang-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:22, heightInches:17, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-01"), updatedAt:new Date("2024-10-01") },
	{ id:"fmu-qwl",  vehicleId:"ford-mustang-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:7,  heightInches:10, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-01"), updatedAt:new Date("2024-10-01") },
	{ id:"fmu-qwr",  vehicleId:"ford-mustang-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:7,  heightInches:10, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-01"), updatedAt:new Date("2024-10-01") },
	{ id:"fmu-rws",  vehicleId:"ford-mustang-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 Q14,20 20,8 L80,8 Q86,20 92,92 Z",  widthInches:49, heightInches:18, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-01"), updatedAt:new Date("2024-10-01") },
];

// Mercedes C300 2024 (W206 — sedan)
const MERC_C300_2024_TINT: Pattern[] = [
	{ id:"mc3-ws",   vehicleId:"mercedes-c300-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M6,95 Q10,28 28,6 L72,6 Q90,28 94,95 Z",  widthInches:56, heightInches:30, revision:"2024-09", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-09-30"), updatedAt:new Date("2024-09-30") },
	{ id:"mc3-wss",  vehicleId:"mercedes-c300-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:56, heightInches:5,  revision:"2024-09", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-09-30"), updatedAt:new Date("2024-09-30") },
	{ id:"mc3-wfl",  vehicleId:"mercedes-c300-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:23, heightInches:19, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-30"), updatedAt:new Date("2024-09-30") },
	{ id:"mc3-wfr",  vehicleId:"mercedes-c300-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:23, heightInches:19, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-30"), updatedAt:new Date("2024-09-30") },
	{ id:"mc3-wrl",  vehicleId:"mercedes-c300-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:22, heightInches:16, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-30"), updatedAt:new Date("2024-09-30") },
	{ id:"mc3-wrr",  vehicleId:"mercedes-c300-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:22, heightInches:16, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-30"), updatedAt:new Date("2024-09-30") },
	{ id:"mc3-qwl",  vehicleId:"mercedes-c300-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:8,  heightInches:10, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-30"), updatedAt:new Date("2024-09-30") },
	{ id:"mc3-qwr",  vehicleId:"mercedes-c300-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:8,  heightInches:10, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-30"), updatedAt:new Date("2024-09-30") },
	{ id:"mc3-rws",  vehicleId:"mercedes-c300-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 Q12,25 15,8 L85,8 Q88,25 92,92 Z",  widthInches:51, heightInches:21, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-30"), updatedAt:new Date("2024-09-30") },
];

// Mercedes G63 AMG 2024 (W464 — SUV, boxy/upright greenhouse)
const MERC_G63_2024_TINT: Pattern[] = [
	{ id:"mg6-ws",   vehicleId:"mercedes-g63-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M8,92 L10,8 L90,8 L92,92 Z",              widthInches:55, heightInches:32, revision:"2024-12", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-12-02"), updatedAt:new Date("2024-12-02") },
	{ id:"mg6-wss",  vehicleId:"mercedes-g63-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:55, heightInches:6,  revision:"2024-12", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-12-02"), updatedAt:new Date("2024-12-02") },
	{ id:"mg6-wfl",  vehicleId:"mercedes-g63-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L88,5 L92,92 L8,95 Z",               widthInches:26, heightInches:23, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-02"), updatedAt:new Date("2024-12-02") },
	{ id:"mg6-wfr",  vehicleId:"mercedes-g63-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M12,5 L95,8 L92,95 L8,92 Z",              widthInches:26, heightInches:23, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-02"), updatedAt:new Date("2024-12-02") },
	{ id:"mg6-wrl",  vehicleId:"mercedes-g63-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:24, heightInches:20, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-02"), updatedAt:new Date("2024-12-02") },
	{ id:"mg6-wrr",  vehicleId:"mercedes-g63-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:24, heightInches:20, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-02"), updatedAt:new Date("2024-12-02") },
	{ id:"mg6-vwl",  vehicleId:"mercedes-g63-2024", category:"window-tint", zone:"vent-window-left",       name:"Vent Window Left",       coverage:"full",    svgPath:"M5,10 L25,5 L28,45 L5,50 Z",              widthInches:8,  heightInches:12, revision:"2024-12", notes:"Small vent — B-pillar driver side",     isPublished:true, createdAt:new Date("2024-12-02"), updatedAt:new Date("2024-12-02") },
	{ id:"mg6-vwr",  vehicleId:"mercedes-g63-2024", category:"window-tint", zone:"vent-window-right",      name:"Vent Window Right",      coverage:"full",    svgPath:"M95,10 L75,5 L72,45 L95,50 Z",            widthInches:8,  heightInches:12, revision:"2024-12", notes:"Small vent — B-pillar passenger side",  isPublished:true, createdAt:new Date("2024-12-02"), updatedAt:new Date("2024-12-02") },
	{ id:"mg6-rws",  vehicleId:"mercedes-g63-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 L10,8 L90,8 L92,92 Z",              widthInches:50, heightInches:27, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-02"), updatedAt:new Date("2024-12-02") },
];

// Audi RS6 Avant 2024 (C8 — wagon)
const AUDI_RS6_2024_TINT: Pattern[] = [
	{ id:"ar6-ws",   vehicleId:"audi-rs6-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M6,95 Q10,28 28,6 L72,6 Q90,28 94,95 Z",  widthInches:58, heightInches:30, revision:"2024-11", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-11-01"), updatedAt:new Date("2024-11-01") },
	{ id:"ar6-wss",  vehicleId:"audi-rs6-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:58, heightInches:5,  revision:"2024-11", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-11-01"), updatedAt:new Date("2024-11-01") },
	{ id:"ar6-wfl",  vehicleId:"audi-rs6-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:24, heightInches:19, revision:"2024-11",                                                            isPublished:true, createdAt:new Date("2024-11-01"), updatedAt:new Date("2024-11-01") },
	{ id:"ar6-wfr",  vehicleId:"audi-rs6-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:24, heightInches:19, revision:"2024-11",                                                            isPublished:true, createdAt:new Date("2024-11-01"), updatedAt:new Date("2024-11-01") },
	{ id:"ar6-wrl",  vehicleId:"audi-rs6-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:24, heightInches:17, revision:"2024-11",                                                            isPublished:true, createdAt:new Date("2024-11-01"), updatedAt:new Date("2024-11-01") },
	{ id:"ar6-wrr",  vehicleId:"audi-rs6-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:24, heightInches:17, revision:"2024-11",                                                            isPublished:true, createdAt:new Date("2024-11-01"), updatedAt:new Date("2024-11-01") },
	{ id:"ar6-qwl",  vehicleId:"audi-rs6-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:10, heightInches:11, revision:"2024-11",                                                            isPublished:true, createdAt:new Date("2024-11-01"), updatedAt:new Date("2024-11-01") },
	{ id:"ar6-qwr",  vehicleId:"audi-rs6-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:10, heightInches:11, revision:"2024-11",                                                            isPublished:true, createdAt:new Date("2024-11-01"), updatedAt:new Date("2024-11-01") },
	{ id:"ar6-rws",  vehicleId:"audi-rs6-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,90 Q10,28 14,8 L86,8 Q90,28 92,90 Z",  widthInches:54, heightInches:24, revision:"2024-11",                                                            isPublished:true, createdAt:new Date("2024-11-01"), updatedAt:new Date("2024-11-01") },
];

// Toyota GR Supra 2024 (A90 — coupe, no rear side windows)
const TOYOTA_SUPRA_2024_TINT: Pattern[] = [
	{ id:"tgs-ws",   vehicleId:"toyota-supra-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M9,92 Q12,28 28,8 L72,8 Q88,28 91,92 Z",  widthInches:48, heightInches:24, revision:"2024-09", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"tgs-wss",  vehicleId:"toyota-supra-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:48, heightInches:5,  revision:"2024-09", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"tgs-wfl",  vehicleId:"toyota-supra-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:20, heightInches:15, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"tgs-wfr",  vehicleId:"toyota-supra-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:20, heightInches:15, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"tgs-qwl",  vehicleId:"toyota-supra-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:7,  heightInches:10, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"tgs-qwr",  vehicleId:"toyota-supra-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:7,  heightInches:10, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"tgs-rws",  vehicleId:"toyota-supra-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 Q14,20 20,8 L80,8 Q86,20 92,92 Z",  widthInches:43, heightInches:15, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
];

// Toyota GR86 2024 (ZN8 — coupe, no rear side windows)
const TOYOTA_GR86_2024_TINT: Pattern[] = [
	{ id:"t86-ws",   vehicleId:"toyota-gr86-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M9,92 Q12,28 28,8 L72,8 Q88,28 91,92 Z",  widthInches:50, heightInches:25, revision:"2024-09", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"t86-wss",  vehicleId:"toyota-gr86-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:50, heightInches:5,  revision:"2024-09", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"t86-wfl",  vehicleId:"toyota-gr86-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:21, heightInches:15, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"t86-wfr",  vehicleId:"toyota-gr86-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:21, heightInches:15, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"t86-qwl",  vehicleId:"toyota-gr86-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:8,  heightInches:11, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"t86-qwr",  vehicleId:"toyota-gr86-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:8,  heightInches:11, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
	{ id:"t86-rws",  vehicleId:"toyota-gr86-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 Q14,20 20,8 L80,8 Q86,20 92,92 Z",  widthInches:44, heightInches:16, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-22"), updatedAt:new Date("2024-09-22") },
];

// Dodge Challenger Hellcat 2024 (LC — coupe with small rear side windows)
const DODGE_HELLCAT_2024_TINT: Pattern[] = [
	{ id:"dch-ws",   vehicleId:"dodge-hellcat-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M9,92 Q12,28 28,8 L72,8 Q88,28 91,92 Z",  widthInches:55, heightInches:27, revision:"2024-09", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-09-10"), updatedAt:new Date("2024-09-10") },
	{ id:"dch-wss",  vehicleId:"dodge-hellcat-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:55, heightInches:5,  revision:"2024-09", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-09-10"), updatedAt:new Date("2024-09-10") },
	{ id:"dch-wfl",  vehicleId:"dodge-hellcat-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:24, heightInches:18, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-10"), updatedAt:new Date("2024-09-10") },
	{ id:"dch-wfr",  vehicleId:"dodge-hellcat-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:24, heightInches:18, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-10"), updatedAt:new Date("2024-09-10") },
	{ id:"dch-wrl",  vehicleId:"dodge-hellcat-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:18, heightInches:14, revision:"2024-09", notes:"Small rear side glass",                 isPublished:true, createdAt:new Date("2024-09-10"), updatedAt:new Date("2024-09-10") },
	{ id:"dch-wrr",  vehicleId:"dodge-hellcat-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:18, heightInches:14, revision:"2024-09", notes:"Small rear side glass",                 isPublished:true, createdAt:new Date("2024-09-10"), updatedAt:new Date("2024-09-10") },
	{ id:"dch-qwl",  vehicleId:"dodge-hellcat-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:9,  heightInches:12, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-10"), updatedAt:new Date("2024-09-10") },
	{ id:"dch-qwr",  vehicleId:"dodge-hellcat-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:9,  heightInches:12, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-10"), updatedAt:new Date("2024-09-10") },
	{ id:"dch-rws",  vehicleId:"dodge-hellcat-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 Q14,20 20,8 L80,8 Q86,20 92,92 Z",  widthInches:51, heightInches:19, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-10"), updatedAt:new Date("2024-09-10") },
];

// Honda Civic Type R 2024 (FL5 — hatchback)
const HONDA_CIVIC_2024_TINT: Pattern[] = [
	{ id:"hcr-ws",   vehicleId:"honda-civic-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M6,95 Q10,28 28,6 L72,6 Q90,28 94,95 Z",  widthInches:53, heightInches:28, revision:"2024-09", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-09-05"), updatedAt:new Date("2024-09-05") },
	{ id:"hcr-wss",  vehicleId:"honda-civic-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:53, heightInches:5,  revision:"2024-09", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-09-05"), updatedAt:new Date("2024-09-05") },
	{ id:"hcr-wfl",  vehicleId:"honda-civic-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:23, heightInches:18, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-05"), updatedAt:new Date("2024-09-05") },
	{ id:"hcr-wfr",  vehicleId:"honda-civic-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:23, heightInches:18, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-05"), updatedAt:new Date("2024-09-05") },
	{ id:"hcr-wrl",  vehicleId:"honda-civic-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:22, heightInches:15, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-05"), updatedAt:new Date("2024-09-05") },
	{ id:"hcr-wrr",  vehicleId:"honda-civic-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:22, heightInches:15, revision:"2024-09",                                                            isPublished:true, createdAt:new Date("2024-09-05"), updatedAt:new Date("2024-09-05") },
	{ id:"hcr-qwl",  vehicleId:"honda-civic-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:8,  heightInches:10, revision:"2024-09", notes:"Rear hatch quarter glass — driver side", isPublished:true, createdAt:new Date("2024-09-05"), updatedAt:new Date("2024-09-05") },
	{ id:"hcr-qwr",  vehicleId:"honda-civic-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:8,  heightInches:10, revision:"2024-09", notes:"Rear hatch quarter glass — pass side",  isPublished:true, createdAt:new Date("2024-09-05"), updatedAt:new Date("2024-09-05") },
	{ id:"hcr-rws",  vehicleId:"honda-civic-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,90 Q10,28 14,8 L86,8 Q90,28 92,90 Z",  widthInches:48, heightInches:24, revision:"2024-09", notes:"Large hatchback rear glass",            isPublished:true, createdAt:new Date("2024-09-05"), updatedAt:new Date("2024-09-05") },
];

// Lamborghini Urus 2024 (S — SUV, draft)
const LAMBO_URUS_2024_TINT: Pattern[] = [
	{ id:"lur-ws",   vehicleId:"lamborghini-urus-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M8,92 Q10,32 20,8 L80,8 Q90,32 92,92 Z",  widthInches:58, heightInches:31, revision:"2024-12", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-12-10"), updatedAt:new Date("2024-12-10") },
	{ id:"lur-wss",  vehicleId:"lamborghini-urus-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:58, heightInches:5,  revision:"2024-12", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-12-10"), updatedAt:new Date("2024-12-10") },
	{ id:"lur-wfl",  vehicleId:"lamborghini-urus-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:24, heightInches:20, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-10"), updatedAt:new Date("2024-12-10") },
	{ id:"lur-wfr",  vehicleId:"lamborghini-urus-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:24, heightInches:20, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-10"), updatedAt:new Date("2024-12-10") },
	{ id:"lur-wrl",  vehicleId:"lamborghini-urus-2024", category:"window-tint", zone:"window-rear-left",       name:"Rear Driver Window",     coverage:"full",    svgPath:"M5,8 L92,8 L95,92 L8,92 Z",               widthInches:22, heightInches:17, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-10"), updatedAt:new Date("2024-12-10") },
	{ id:"lur-wrr",  vehicleId:"lamborghini-urus-2024", category:"window-tint", zone:"window-rear-right",      name:"Rear Passenger Window",  coverage:"full",    svgPath:"M8,8 L95,8 L92,92 L5,92 Z",               widthInches:22, heightInches:17, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-10"), updatedAt:new Date("2024-12-10") },
	{ id:"lur-qwl",  vehicleId:"lamborghini-urus-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:9,  heightInches:11, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-10"), updatedAt:new Date("2024-12-10") },
	{ id:"lur-qwr",  vehicleId:"lamborghini-urus-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:9,  heightInches:11, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-10"), updatedAt:new Date("2024-12-10") },
	{ id:"lur-rws",  vehicleId:"lamborghini-urus-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,90 Q10,28 14,8 L86,8 Q90,28 92,90 Z",  widthInches:52, heightInches:22, revision:"2024-12",                                                            isPublished:true, createdAt:new Date("2024-12-10"), updatedAt:new Date("2024-12-10") },
];

// Chevrolet Corvette Z06 2024 (C8 — coupe, flying buttress roof)
const CORVETTE_Z06_2024_TINT: Pattern[] = [
	{ id:"cvz-ws",   vehicleId:"corvette-z06-2024", category:"window-tint", zone:"windshield",            name:"Windshield",             coverage:"full",    svgPath:"M9,92 Q12,28 28,8 L72,8 Q88,28 91,92 Z",  widthInches:51, heightInches:25, revision:"2024-10", notes:"Front tint restricted in many states",  isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"cvz-wss",  vehicleId:"corvette-z06-2024", category:"window-tint", zone:"windshield-strip",       name:"Windshield Strip",       coverage:"partial", svgPath:"M28,5 Q50,2 72,5 L70,22 Q50,18 30,22 Z",  widthInches:51, heightInches:5,  revision:"2024-10", notes:"Top visor strip — legal in all states", isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"cvz-wfl",  vehicleId:"corvette-z06-2024", category:"window-tint", zone:"window-front-left",      name:"Front Driver Window",    coverage:"full",    svgPath:"M5,8 L85,5 L90,92 L8,95 Z",               widthInches:21, heightInches:16, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"cvz-wfr",  vehicleId:"corvette-z06-2024", category:"window-tint", zone:"window-front-right",     name:"Front Passenger Window", coverage:"full",    svgPath:"M15,5 L95,8 L92,95 L10,92 Z",             widthInches:21, heightInches:16, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"cvz-qwl",  vehicleId:"corvette-z06-2024", category:"window-tint", zone:"quarter-window-left",    name:"Quarter Window Left",    coverage:"full",    svgPath:"M5,8 L82,18 L78,82 L5,90 Z",              widthInches:8,  heightInches:14, revision:"2024-10", notes:"Flying buttress rear glass — driver",   isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"cvz-qwr",  vehicleId:"corvette-z06-2024", category:"window-tint", zone:"quarter-window-right",   name:"Quarter Window Right",   coverage:"full",    svgPath:"M18,8 L95,8 L95,90 L22,82 Z",             widthInches:8,  heightInches:14, revision:"2024-10", notes:"Flying buttress rear glass — passenger", isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
	{ id:"cvz-rws",  vehicleId:"corvette-z06-2024", category:"window-tint", zone:"rear-windshield",        name:"Rear Windshield",        coverage:"full",    svgPath:"M8,92 Q14,20 20,8 L80,8 Q86,20 92,92 Z",  widthInches:45, heightInches:15, revision:"2024-10",                                                            isPublished:true, createdAt:new Date("2024-10-05"), updatedAt:new Date("2024-10-05") },
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

// ─── PPF Patterns ─────────────────────────────

const BMW_M4_2024_PPF: Pattern[] = [
	{ id: "bm4-ppf-hd",  vehicleId: "bmw-m4-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 64.0, heightInches: 52.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-ffl", vehicleId: "bmw-m4-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 30.0, heightInches: 24.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-ffr", vehicleId: "bmw-m4-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 30.0, heightInches: 24.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-bf",  vehicleId: "bmw-m4-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 72.0, heightInches: 14.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-hl",  vehicleId: "bmw-m4-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 26.0, heightInches:  9.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-hr",  vehicleId: "bmw-m4-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 26.0, heightInches:  9.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-ml",  vehicleId: "bmw-m4-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.5, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-mr",  vehicleId: "bmw-m4-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.5, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-dfl", vehicleId: "bmw-m4-2024", category: "ppf", zone: "door-front-left",    name: "Door Left",          coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 44.0, heightInches: 48.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-dfr", vehicleId: "bmw-m4-2024", category: "ppf", zone: "door-front-right",   name: "Door Right",         coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 44.0, heightInches: 48.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-rkl", vehicleId: "bmw-m4-2024", category: "ppf", zone: "rocker-left",        name: "Rocker Left",        coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 74.0, heightInches:  8.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
	{ id: "bm4-ppf-rkr", vehicleId: "bmw-m4-2024", category: "ppf", zone: "rocker-right",       name: "Rocker Right",       coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 74.0, heightInches:  8.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-12"), updatedAt: new Date("2024-11-12") },
];

const BMW_M3_2024_PPF: Pattern[] = [
	{ id: "bm3-ppf-hd",  vehicleId: "bmw-m3-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 63.0, heightInches: 50.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-ffl", vehicleId: "bmw-m3-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 29.0, heightInches: 23.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-ffr", vehicleId: "bmw-m3-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 29.0, heightInches: 23.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-bf",  vehicleId: "bmw-m3-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 70.0, heightInches: 13.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-hl",  vehicleId: "bmw-m3-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 25.0, heightInches:  9.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-hr",  vehicleId: "bmw-m3-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 25.0, heightInches:  9.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-ml",  vehicleId: "bmw-m3-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-mr",  vehicleId: "bmw-m3-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-dfl", vehicleId: "bmw-m3-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 46.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-dfr", vehicleId: "bmw-m3-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 46.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-drl", vehicleId: "bmw-m3-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 34.0, heightInches: 46.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-drr", vehicleId: "bmw-m3-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 34.0, heightInches: 46.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-frl", vehicleId: "bmw-m3-2024", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 20.0, heightInches: 22.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
	{ id: "bm3-ppf-frr", vehicleId: "bmw-m3-2024", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 20.0, heightInches: 22.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-20"), updatedAt: new Date("2024-10-20") },
];

const BMW_X5_2024_PPF: Pattern[] = [
	{ id: "bx5-ppf-hd",  vehicleId: "bmw-x5-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 70.0, heightInches: 56.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-ffl", vehicleId: "bmw-x5-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 34.0, heightInches: 26.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-ffr", vehicleId: "bmw-x5-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 34.0, heightInches: 26.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-bf",  vehicleId: "bmw-x5-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 76.0, heightInches: 16.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-br",  vehicleId: "bmw-x5-2024", category: "ppf", zone: "bumper-rear",        name: "Rear Bumper",        coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 74.0, heightInches: 14.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-hl",  vehicleId: "bmw-x5-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 28.0, heightInches: 10.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-hr",  vehicleId: "bmw-x5-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 28.0, heightInches: 10.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-ml",  vehicleId: "bmw-x5-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 12.0, heightInches:  7.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-mr",  vehicleId: "bmw-x5-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 12.0, heightInches:  7.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-dfl", vehicleId: "bmw-x5-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 40.0, heightInches: 52.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-dfr", vehicleId: "bmw-x5-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 40.0, heightInches: 52.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-drl", vehicleId: "bmw-x5-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 52.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-drr", vehicleId: "bmw-x5-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 52.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-frl", vehicleId: "bmw-x5-2024", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 22.0, heightInches: 24.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "bx5-ppf-frr", vehicleId: "bmw-x5-2024", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 22.0, heightInches: 24.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
];

const BMW_M5_2025_PPF: Pattern[] = [
	{ id: "bm5-ppf-hd",  vehicleId: "bmw-m5-2025", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 65.0, heightInches: 52.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-ffl", vehicleId: "bmw-m5-2025", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 30.0, heightInches: 24.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-ffr", vehicleId: "bmw-m5-2025", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 30.0, heightInches: 24.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-bf",  vehicleId: "bmw-m5-2025", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 72.0, heightInches: 14.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-hl",  vehicleId: "bmw-m5-2025", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 26.0, heightInches:  9.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-hr",  vehicleId: "bmw-m5-2025", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 26.0, heightInches:  9.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-ml",  vehicleId: "bmw-m5-2025", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 11.0, heightInches:  6.5, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-mr",  vehicleId: "bmw-m5-2025", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 11.0, heightInches:  6.5, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-dfl", vehicleId: "bmw-m5-2025", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 40.0, heightInches: 48.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-dfr", vehicleId: "bmw-m5-2025", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 40.0, heightInches: 48.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-drl", vehicleId: "bmw-m5-2025", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 48.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-drr", vehicleId: "bmw-m5-2025", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 48.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-frl", vehicleId: "bmw-m5-2025", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 21.0, heightInches: 23.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
	{ id: "bm5-ppf-frr", vehicleId: "bmw-m5-2025", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 21.0, heightInches: 23.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-14"), updatedAt: new Date("2024-12-14") },
];

const TM3_2024_PPF: Pattern[] = [
	{ id: "tm3-ppf-hd",  vehicleId: "tesla-model3-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 61.0, heightInches: 50.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-ffl", vehicleId: "tesla-model3-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 28.0, heightInches: 22.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-ffr", vehicleId: "tesla-model3-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 28.0, heightInches: 22.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-bf",  vehicleId: "tesla-model3-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 68.0, heightInches: 12.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-hl",  vehicleId: "tesla-model3-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 24.0, heightInches:  8.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-hr",  vehicleId: "tesla-model3-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 24.0, heightInches:  8.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-ml",  vehicleId: "tesla-model3-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-mr",  vehicleId: "tesla-model3-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-dfl", vehicleId: "tesla-model3-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 46.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-dfr", vehicleId: "tesla-model3-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 46.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-drl", vehicleId: "tesla-model3-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 34.0, heightInches: 46.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-drr", vehicleId: "tesla-model3-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 34.0, heightInches: 46.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-frl", vehicleId: "tesla-model3-2024", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 20.0, heightInches: 22.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
	{ id: "tm3-ppf-frr", vehicleId: "tesla-model3-2024", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 20.0, heightInches: 22.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-08"), updatedAt: new Date("2024-11-08") },
];

const TESLA_MS_2024_PPF: Pattern[] = [
	{ id: "tms-ppf-hd",  vehicleId: "tesla-models-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 68.0, heightInches: 54.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-ffl", vehicleId: "tesla-models-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 32.0, heightInches: 24.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-ffr", vehicleId: "tesla-models-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 32.0, heightInches: 24.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-bf",  vehicleId: "tesla-models-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 74.0, heightInches: 13.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-hl",  vehicleId: "tesla-models-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 28.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-hr",  vehicleId: "tesla-models-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 28.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-ml",  vehicleId: "tesla-models-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 11.0, heightInches:  6.5, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-mr",  vehicleId: "tesla-models-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 11.0, heightInches:  6.5, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-dfl", vehicleId: "tesla-models-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 50.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-dfr", vehicleId: "tesla-models-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 50.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-drl", vehicleId: "tesla-models-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 50.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-drr", vehicleId: "tesla-models-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 50.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-frl", vehicleId: "tesla-models-2024", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 22.0, heightInches: 24.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
	{ id: "tms-ppf-frr", vehicleId: "tesla-models-2024", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 22.0, heightInches: 24.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-15"), updatedAt: new Date("2024-10-15") },
];

const TESLA_MX_2024_PPF: Pattern[] = [
	{ id: "tmx-ppf-hd",  vehicleId: "tesla-modelx-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 70.0, heightInches: 58.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-ffl", vehicleId: "tesla-modelx-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 34.0, heightInches: 26.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-ffr", vehicleId: "tesla-modelx-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 34.0, heightInches: 26.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-bf",  vehicleId: "tesla-modelx-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 78.0, heightInches: 14.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-br",  vehicleId: "tesla-modelx-2024", category: "ppf", zone: "bumper-rear",        name: "Rear Bumper",        coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 76.0, heightInches: 13.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-hl",  vehicleId: "tesla-modelx-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 28.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-hr",  vehicleId: "tesla-modelx-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 28.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-ml",  vehicleId: "tesla-modelx-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 12.0, heightInches:  7.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-mr",  vehicleId: "tesla-modelx-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 12.0, heightInches:  7.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-dfl", vehicleId: "tesla-modelx-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 44.0, heightInches: 54.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-dfr", vehicleId: "tesla-modelx-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 44.0, heightInches: 54.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-drl", vehicleId: "tesla-modelx-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 54.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-drr", vehicleId: "tesla-modelx-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 54.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-frl", vehicleId: "tesla-modelx-2024", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 24.0, heightInches: 26.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
	{ id: "tmx-ppf-frr", vehicleId: "tesla-modelx-2024", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 24.0, heightInches: 26.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-08"), updatedAt: new Date("2024-10-08") },
];

const PORSCHE_911_2024_PPF: Pattern[] = [
	{ id: "p11-ppf-hd",  vehicleId: "porsche-911-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 56.0, heightInches: 44.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-ffl", vehicleId: "porsche-911-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 26.0, heightInches: 20.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-ffr", vehicleId: "porsche-911-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 26.0, heightInches: 20.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-bf",  vehicleId: "porsche-911-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 66.0, heightInches: 12.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-hl",  vehicleId: "porsche-911-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 22.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-hr",  vehicleId: "porsche-911-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 22.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-ml",  vehicleId: "porsche-911-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches:  9.0, heightInches:  6.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-mr",  vehicleId: "porsche-911-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches:  9.0, heightInches:  6.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-dfl", vehicleId: "porsche-911-2024", category: "ppf", zone: "door-front-left",    name: "Door Left",          coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 44.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-dfr", vehicleId: "porsche-911-2024", category: "ppf", zone: "door-front-right",   name: "Door Right",         coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 44.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-rkl", vehicleId: "porsche-911-2024", category: "ppf", zone: "rocker-left",        name: "Rocker Left",        coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 66.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
	{ id: "p11-ppf-rkr", vehicleId: "porsche-911-2024", category: "ppf", zone: "rocker-right",       name: "Rocker Right",       coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 66.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-31"), updatedAt: new Date("2024-10-31") },
];

const PORSCHE_CAYENNE_2024_PPF: Pattern[] = [
	{ id: "pca-ppf-hd",  vehicleId: "porsche-cayenne-24", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 68.0, heightInches: 54.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-ffl", vehicleId: "porsche-cayenne-24", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 32.0, heightInches: 25.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-ffr", vehicleId: "porsche-cayenne-24", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 32.0, heightInches: 25.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-bf",  vehicleId: "porsche-cayenne-24", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 76.0, heightInches: 15.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-br",  vehicleId: "porsche-cayenne-24", category: "ppf", zone: "bumper-rear",        name: "Rear Bumper",        coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 74.0, heightInches: 14.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-hl",  vehicleId: "porsche-cayenne-24", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 28.0, heightInches:  9.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-hr",  vehicleId: "porsche-cayenne-24", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 28.0, heightInches:  9.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-ml",  vehicleId: "porsche-cayenne-24", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 12.0, heightInches:  7.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-mr",  vehicleId: "porsche-cayenne-24", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 12.0, heightInches:  7.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-dfl", vehicleId: "porsche-cayenne-24", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 52.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-dfr", vehicleId: "porsche-cayenne-24", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 52.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-drl", vehicleId: "porsche-cayenne-24", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 52.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-drr", vehicleId: "porsche-cayenne-24", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 52.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-frl", vehicleId: "porsche-cayenne-24", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 22.0, heightInches: 24.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
	{ id: "pca-ppf-frr", vehicleId: "porsche-cayenne-24", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 22.0, heightInches: 24.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-15"), updatedAt: new Date("2024-09-15") },
];

const FORD_F150_2024_PPF: Pattern[] = [
	{ id: "ff1-ppf-hd",  vehicleId: "ford-f150-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M5,4 L95,4 L95,96 L5,96 Z",                                 widthInches: 74.0, heightInches: 60.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-ffl", vehicleId: "ford-f150-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 38.0, heightInches: 28.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-ffr", vehicleId: "ford-f150-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 38.0, heightInches: 28.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-bf",  vehicleId: "ford-f150-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 80.0, heightInches: 18.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-br",  vehicleId: "ford-f150-2024", category: "ppf", zone: "bumper-rear",        name: "Rear Bumper",        coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 78.0, heightInches: 16.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-hl",  vehicleId: "ford-f150-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 28.0, heightInches: 10.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-hr",  vehicleId: "ford-f150-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 28.0, heightInches: 10.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-ml",  vehicleId: "ford-f150-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 14.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-mr",  vehicleId: "ford-f150-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 14.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-dfl", vehicleId: "ford-f150-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 54.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-dfr", vehicleId: "ford-f150-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 54.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-drl", vehicleId: "ford-f150-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 54.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
	{ id: "ff1-ppf-drr", vehicleId: "ford-f150-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 54.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-14"), updatedAt: new Date("2024-10-14") },
];

const FORD_MUSTANG_2024_PPF: Pattern[] = [
	{ id: "fmu-ppf-hd",  vehicleId: "ford-mustang-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 64.0, heightInches: 50.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-ffl", vehicleId: "ford-mustang-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 30.0, heightInches: 23.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-ffr", vehicleId: "ford-mustang-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 30.0, heightInches: 23.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-bf",  vehicleId: "ford-mustang-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 72.0, heightInches: 14.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-hl",  vehicleId: "ford-mustang-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 25.0, heightInches:  9.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-hr",  vehicleId: "ford-mustang-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 25.0, heightInches:  9.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-ml",  vehicleId: "ford-mustang-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-mr",  vehicleId: "ford-mustang-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-dfl", vehicleId: "ford-mustang-2024", category: "ppf", zone: "door-front-left",    name: "Door Left",          coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 45.0, heightInches: 46.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-dfr", vehicleId: "ford-mustang-2024", category: "ppf", zone: "door-front-right",   name: "Door Right",         coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 45.0, heightInches: 46.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-rkl", vehicleId: "ford-mustang-2024", category: "ppf", zone: "rocker-left",        name: "Rocker Left",        coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 72.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
	{ id: "fmu-ppf-rkr", vehicleId: "ford-mustang-2024", category: "ppf", zone: "rocker-right",       name: "Rocker Right",       coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 72.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-01"), updatedAt: new Date("2024-10-01") },
];

const MERC_C300_2024_PPF: Pattern[] = [
	{ id: "mc3-ppf-hd",  vehicleId: "mercedes-c300-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 62.0, heightInches: 50.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-ffl", vehicleId: "mercedes-c300-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 29.0, heightInches: 23.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-ffr", vehicleId: "mercedes-c300-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 29.0, heightInches: 23.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-bf",  vehicleId: "mercedes-c300-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 70.0, heightInches: 13.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-hl",  vehicleId: "mercedes-c300-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 26.0, heightInches:  9.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-hr",  vehicleId: "mercedes-c300-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 26.0, heightInches:  9.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-ml",  vehicleId: "mercedes-c300-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.5, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-mr",  vehicleId: "mercedes-c300-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.5, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-dfl", vehicleId: "mercedes-c300-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 46.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-dfr", vehicleId: "mercedes-c300-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 46.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-drl", vehicleId: "mercedes-c300-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 32.0, heightInches: 46.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-drr", vehicleId: "mercedes-c300-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 32.0, heightInches: 46.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-frl", vehicleId: "mercedes-c300-2024", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 20.0, heightInches: 21.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
	{ id: "mc3-ppf-frr", vehicleId: "mercedes-c300-2024", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 20.0, heightInches: 21.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-30"), updatedAt: new Date("2024-09-30") },
];

const MERC_G63_2024_PPF: Pattern[] = [
	{ id: "mg6-ppf-hd",  vehicleId: "mercedes-g63-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M5,4 L95,4 L95,96 L5,96 Z",                                 widthInches: 70.0, heightInches: 56.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-ffl", vehicleId: "mercedes-g63-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 36.0, heightInches: 28.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-ffr", vehicleId: "mercedes-g63-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 36.0, heightInches: 28.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-bf",  vehicleId: "mercedes-g63-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 78.0, heightInches: 18.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-br",  vehicleId: "mercedes-g63-2024", category: "ppf", zone: "bumper-rear",        name: "Rear Bumper",        coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 76.0, heightInches: 16.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-hl",  vehicleId: "mercedes-g63-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 28.0, heightInches: 10.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-hr",  vehicleId: "mercedes-g63-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 28.0, heightInches: 10.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-ml",  vehicleId: "mercedes-g63-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 13.0, heightInches:  8.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-mr",  vehicleId: "mercedes-g63-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 13.0, heightInches:  8.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-dfl", vehicleId: "mercedes-g63-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 54.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-dfr", vehicleId: "mercedes-g63-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 54.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-drl", vehicleId: "mercedes-g63-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 54.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-drr", vehicleId: "mercedes-g63-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 54.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-frl", vehicleId: "mercedes-g63-2024", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 24.0, heightInches: 26.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
	{ id: "mg6-ppf-frr", vehicleId: "mercedes-g63-2024", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 24.0, heightInches: 26.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-02"), updatedAt: new Date("2024-12-02") },
];

const AUDI_RS6_2024_PPF: Pattern[] = [
	{ id: "ar6-ppf-hd",  vehicleId: "audi-rs6-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 66.0, heightInches: 54.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-ffl", vehicleId: "audi-rs6-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 31.0, heightInches: 24.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-ffr", vehicleId: "audi-rs6-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 31.0, heightInches: 24.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-bf",  vehicleId: "audi-rs6-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 74.0, heightInches: 14.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-br",  vehicleId: "audi-rs6-2024", category: "ppf", zone: "bumper-rear",        name: "Rear Bumper",        coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 72.0, heightInches: 13.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-hl",  vehicleId: "audi-rs6-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 27.0, heightInches:  9.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-hr",  vehicleId: "audi-rs6-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 27.0, heightInches:  9.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-ml",  vehicleId: "audi-rs6-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 11.0, heightInches:  6.5, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-mr",  vehicleId: "audi-rs6-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 11.0, heightInches:  6.5, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-dfl", vehicleId: "audi-rs6-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 40.0, heightInches: 48.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-dfr", vehicleId: "audi-rs6-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 40.0, heightInches: 48.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-drl", vehicleId: "audi-rs6-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 48.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-drr", vehicleId: "audi-rs6-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 36.0, heightInches: 48.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-frl", vehicleId: "audi-rs6-2024", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 22.0, heightInches: 23.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
	{ id: "ar6-ppf-frr", vehicleId: "audi-rs6-2024", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 22.0, heightInches: 23.0, revision: "2024-11", isPublished: true, createdAt: new Date("2024-11-01"), updatedAt: new Date("2024-11-01") },
];

const TOYOTA_SUPRA_2024_PPF: Pattern[] = [
	{ id: "tsu-ppf-hd",  vehicleId: "toyota-supra-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 58.0, heightInches: 46.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-ffl", vehicleId: "toyota-supra-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 26.0, heightInches: 20.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-ffr", vehicleId: "toyota-supra-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 26.0, heightInches: 20.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-bf",  vehicleId: "toyota-supra-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 66.0, heightInches: 12.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-hl",  vehicleId: "toyota-supra-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 22.0, heightInches:  8.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-hr",  vehicleId: "toyota-supra-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 22.0, heightInches:  8.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-ml",  vehicleId: "toyota-supra-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches:  9.0, heightInches:  6.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-mr",  vehicleId: "toyota-supra-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches:  9.0, heightInches:  6.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-dfl", vehicleId: "toyota-supra-2024", category: "ppf", zone: "door-front-left",    name: "Door Left",          coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 40.0, heightInches: 42.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-dfr", vehicleId: "toyota-supra-2024", category: "ppf", zone: "door-front-right",   name: "Door Right",         coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 40.0, heightInches: 42.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-rkl", vehicleId: "toyota-supra-2024", category: "ppf", zone: "rocker-left",        name: "Rocker Left",        coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 66.0, heightInches:  7.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "tsu-ppf-rkr", vehicleId: "toyota-supra-2024", category: "ppf", zone: "rocker-right",       name: "Rocker Right",       coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 66.0, heightInches:  7.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
];

const TOYOTA_GR86_2024_PPF: Pattern[] = [
	{ id: "t86-ppf-hd",  vehicleId: "toyota-gr86-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 56.0, heightInches: 44.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-ffl", vehicleId: "toyota-gr86-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 25.0, heightInches: 20.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-ffr", vehicleId: "toyota-gr86-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 25.0, heightInches: 20.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-bf",  vehicleId: "toyota-gr86-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 64.0, heightInches: 12.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-hl",  vehicleId: "toyota-gr86-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 21.0, heightInches:  8.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-hr",  vehicleId: "toyota-gr86-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 21.0, heightInches:  8.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-ml",  vehicleId: "toyota-gr86-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches:  9.0, heightInches:  5.5, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-mr",  vehicleId: "toyota-gr86-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches:  9.0, heightInches:  5.5, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-dfl", vehicleId: "toyota-gr86-2024", category: "ppf", zone: "door-front-left",    name: "Door Left",          coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 42.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-dfr", vehicleId: "toyota-gr86-2024", category: "ppf", zone: "door-front-right",   name: "Door Right",         coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 42.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-rkl", vehicleId: "toyota-gr86-2024", category: "ppf", zone: "rocker-left",        name: "Rocker Left",        coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 64.0, heightInches:  7.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
	{ id: "t86-ppf-rkr", vehicleId: "toyota-gr86-2024", category: "ppf", zone: "rocker-right",       name: "Rocker Right",       coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 64.0, heightInches:  7.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-22"), updatedAt: new Date("2024-09-22") },
];

const DODGE_HELLCAT_2024_PPF: Pattern[] = [
	{ id: "dhl-ppf-hd",  vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 68.0, heightInches: 52.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-ffl", vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 34.0, heightInches: 26.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-ffr", vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 34.0, heightInches: 26.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-bf",  vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 76.0, heightInches: 15.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-hl",  vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 26.0, heightInches:  9.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-hr",  vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 26.0, heightInches:  9.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-ml",  vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 11.0, heightInches:  7.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-mr",  vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 11.0, heightInches:  7.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-dfl", vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "door-front-left",    name: "Door Left",          coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 50.0, heightInches: 48.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-dfr", vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "door-front-right",   name: "Door Right",         coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 50.0, heightInches: 48.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-rkl", vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "rocker-left",        name: "Rocker Left",        coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 76.0, heightInches:  9.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
	{ id: "dhl-ppf-rkr", vehicleId: "dodge-hellcat-2024", category: "ppf", zone: "rocker-right",       name: "Rocker Right",       coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 76.0, heightInches:  9.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-10"), updatedAt: new Date("2024-09-10") },
];

const HONDA_CIVIC_2024_PPF: Pattern[] = [
	{ id: "hcr-ppf-hd",  vehicleId: "honda-civic-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 58.0, heightInches: 46.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-ffl", vehicleId: "honda-civic-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 26.0, heightInches: 21.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-ffr", vehicleId: "honda-civic-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 26.0, heightInches: 21.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-bf",  vehicleId: "honda-civic-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 68.0, heightInches: 13.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-br",  vehicleId: "honda-civic-2024", category: "ppf", zone: "bumper-rear",        name: "Rear Bumper",        coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 66.0, heightInches: 12.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-hl",  vehicleId: "honda-civic-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 22.0, heightInches:  8.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-hr",  vehicleId: "honda-civic-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 22.0, heightInches:  8.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-ml",  vehicleId: "honda-civic-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches:  9.0, heightInches:  6.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-mr",  vehicleId: "honda-civic-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches:  9.0, heightInches:  6.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-dfl", vehicleId: "honda-civic-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 44.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-dfr", vehicleId: "honda-civic-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 44.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-drl", vehicleId: "honda-civic-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 30.0, heightInches: 44.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
	{ id: "hcr-ppf-drr", vehicleId: "honda-civic-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 30.0, heightInches: 44.0, revision: "2024-09", isPublished: true, createdAt: new Date("2024-09-05"), updatedAt: new Date("2024-09-05") },
];

const LAMBO_URUS_2024_PPF: Pattern[] = [
	{ id: "lur-ppf-hd",  vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 72.0, heightInches: 58.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-ffl", vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 36.0, heightInches: 27.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-ffr", vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 36.0, heightInches: 27.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-bf",  vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 80.0, heightInches: 16.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-br",  vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "bumper-rear",        name: "Rear Bumper",        coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 78.0, heightInches: 15.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-hl",  vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 28.0, heightInches:  9.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-hr",  vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 28.0, heightInches:  9.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-ml",  vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 13.0, heightInches:  7.5, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-mr",  vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 13.0, heightInches:  7.5, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-dfl", vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "door-front-left",    name: "Front Door Left",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 44.0, heightInches: 52.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-dfr", vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "door-front-right",   name: "Front Door Right",   coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 44.0, heightInches: 52.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-drl", vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "door-rear-left",     name: "Rear Door Left",     coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 52.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-drr", vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "door-rear-right",    name: "Rear Door Right",    coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 38.0, heightInches: 52.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-frl", vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "fender-rear-left",   name: "Rear Fender Left",   coverage: "full", svgPath: "M5,8 Q10,2 90,4 L95,82 Q60,96 5,88 Z",                     widthInches: 24.0, heightInches: 25.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
	{ id: "lur-ppf-frr", vehicleId: "lamborghini-urus-2024", category: "ppf", zone: "fender-rear-right",  name: "Rear Fender Right",  coverage: "full", svgPath: "M5,4 L90,2 Q95,8 95,82 Q40,96 5,88 Z",                     widthInches: 24.0, heightInches: 25.0, revision: "2024-12", isPublished: true, createdAt: new Date("2024-12-10"), updatedAt: new Date("2024-12-10") },
];

const CORVETTE_Z06_2024_PPF: Pattern[] = [
	{ id: "cz6-ppf-hd",  vehicleId: "corvette-z06-2024", category: "ppf", zone: "hood",               name: "Hood",               coverage: "full", svgPath: "M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z",                     widthInches: 62.0, heightInches: 48.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-ffl", vehicleId: "corvette-z06-2024", category: "ppf", zone: "fender-front-left",  name: "Front Fender Left",  coverage: "full", svgPath: "M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z",             widthInches: 26.0, heightInches: 20.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-ffr", vehicleId: "corvette-z06-2024", category: "ppf", zone: "fender-front-right", name: "Front Fender Right", coverage: "full", svgPath: "M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z",             widthInches: 26.0, heightInches: 20.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-bf",  vehicleId: "corvette-z06-2024", category: "ppf", zone: "bumper-front",       name: "Front Bumper",       coverage: "full", svgPath: "M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z",   widthInches: 72.0, heightInches: 13.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-hl",  vehicleId: "corvette-z06-2024", category: "ppf", zone: "headlight-left",     name: "Headlight Left",     coverage: "full", svgPath: "M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z",   widthInches: 22.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-hr",  vehicleId: "corvette-z06-2024", category: "ppf", zone: "headlight-right",    name: "Headlight Right",    coverage: "full", svgPath: "M4,18 Q12,4 92,5 Q96,18 96,82 Q92,96 12,95 Q4,82 4,18 Z", widthInches: 22.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-ml",  vehicleId: "corvette-z06-2024", category: "ppf", zone: "mirror-left",        name: "Mirror Left",        coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-mr",  vehicleId: "corvette-z06-2024", category: "ppf", zone: "mirror-right",       name: "Mirror Right",       coverage: "full", svgPath: "M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z",       widthInches: 10.0, heightInches:  6.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-dfl", vehicleId: "corvette-z06-2024", category: "ppf", zone: "door-front-left",    name: "Door Left",          coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 44.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-dfr", vehicleId: "corvette-z06-2024", category: "ppf", zone: "door-front-right",   name: "Door Right",         coverage: "full", svgPath: "M4,4 L96,4 L96,96 L4,96 Z",                                 widthInches: 42.0, heightInches: 44.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-rkl", vehicleId: "corvette-z06-2024", category: "ppf", zone: "rocker-left",        name: "Rocker Left",        coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 72.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
	{ id: "cz6-ppf-rkr", vehicleId: "corvette-z06-2024", category: "ppf", zone: "rocker-right",       name: "Rocker Right",       coverage: "full", svgPath: "M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z",       widthInches: 72.0, heightInches:  8.0, revision: "2024-10", isPublished: true, createdAt: new Date("2024-10-05"), updatedAt: new Date("2024-10-05") },
];

// ─── Seed map (used as fallback and for seeding Firestore) ───
const SEED_PATTERNS: Record<string, Pattern[]> = {
	"tesla-model3-2024":     [...TM3_2024_TINT,             ...TM3_2024_PPF],
	"bmw-m4-2024":           [...BMW_M4_2024_TINT,          ...BMW_M4_2024_PPF],
	"bmw-m3-2024":           [...BMW_M3_2024_TINT,          ...BMW_M3_2024_PPF],
	"bmw-x5-2024":           [...BMW_X5_2024_TINT,          ...BMW_X5_2024_PPF],
	"bmw-m5-2025":           [...BMW_M5_2025_TINT,          ...BMW_M5_2025_PPF],
	"tesla-models-2024":     [...TESLA_MS_2024_TINT,        ...TESLA_MS_2024_PPF],
	"tesla-modelx-2024":     [...TESLA_MX_2024_TINT,        ...TESLA_MX_2024_PPF],
	"porsche-911-2024":      [...PORSCHE_911_2024_TINT,     ...PORSCHE_911_2024_PPF],
	"porsche-cayenne-24":    [...PORSCHE_CAYENNE_2024_TINT, ...PORSCHE_CAYENNE_2024_PPF],
	"ford-f150-2024":        [...FORD_F150_2024_TINT,       ...FORD_F150_2024_PPF],
	"ford-mustang-2024":     [...FORD_MUSTANG_2024_TINT,    ...FORD_MUSTANG_2024_PPF],
	"mercedes-c300-2024":    [...MERC_C300_2024_TINT,       ...MERC_C300_2024_PPF],
	"mercedes-g63-2024":     [...MERC_G63_2024_TINT,        ...MERC_G63_2024_PPF],
	"audi-rs6-2024":         [...AUDI_RS6_2024_TINT,        ...AUDI_RS6_2024_PPF],
	"toyota-supra-2024":     [...TOYOTA_SUPRA_2024_TINT,    ...TOYOTA_SUPRA_2024_PPF],
	"toyota-gr86-2024":      [...TOYOTA_GR86_2024_TINT,     ...TOYOTA_GR86_2024_PPF],
	"dodge-hellcat-2024":    [...DODGE_HELLCAT_2024_TINT,   ...DODGE_HELLCAT_2024_PPF],
	"honda-civic-2024":      [...HONDA_CIVIC_2024_TINT,     ...HONDA_CIVIC_2024_PPF],
	"lamborghini-urus-2024": [...LAMBO_URUS_2024_TINT,      ...LAMBO_URUS_2024_PPF],
	"corvette-z06-2024":     [...CORVETTE_Z06_2024_TINT,    ...CORVETTE_Z06_2024_PPF],
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
