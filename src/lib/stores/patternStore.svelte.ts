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
	// ── Community reference templates (admin-curated, non-vehicle) ──
	// Not a physical property — a standing library of common building-glazing
	// sizes so shops without exact field measurements have a documented
	// starting point. See COMMUNITY_RESIDENTIAL / COMMUNITY_COMMERCIAL below
	// for per-pattern citations.
	{ id: "community-residential-standard", projectType: "residential", propertyLabel: "Standard Residential Window & Door Sizes", tags: ["community", "reference", "residential"], popular: true, status: "published", updatedAt: "2026-09-04" },
	{ id: "community-commercial-standard", projectType: "commercial", propertyLabel: "Standard Commercial Storefront & Glazing Sizes", tags: ["community", "reference", "commercial"], popular: true, status: "published", updatedAt: "2026-09-04" },
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

// ─── Seed: Community reference patterns (residential / commercial) ───────────
// Admin-curated, non-vehicle-specific templates for the most common window,
// door, and glazing sizes a residential or commercial film install job will
// encounter. These are NOT measurements of a specific property — they are
// documented industry-standard/nominal sizes meant as a cutting-list starting
// point when a shop hasn't (or can't) field-measure yet.
//
// Sourcing notes:
// - Residential nominal window sizing (the WWHH callout, e.g. "3050" = 3'0"x5'0")
//   is a shared industry convention published across manufacturer catalogs
//   (Andersen 400 Series, Pella Impervia/250 Series, Milgard Tuscany/Style Line).
//   Actual glass/sash opening runs ~0.5" smaller than the nominal rough-opening
//   size on each dimension — reflected below as the cut dimension.
// - Egress minimums (bedroom + basement) cite IRC (International Residential
//   Code) Section R310: net clear opening ≥ 5.7 sq ft (5.0 sq ft at grade
//   level), min. clear height 24", min. clear width 20", max. sill height 44"
//   above finished floor.
// - Patio/sliding door widths (5', 6', 8') are the standard nominal widths
//   published by Andersen, Pella, and Milgard patio door lines.
// - ADA commercial door clearance (32" min. clear width) cites ADA Standards
//   §404.2.3 / ICC A117.1.
// - Skylight curb sizes (2222, 3030, 4646, etc.) cite VELUX's standard
//   curb-mount nomenclature (FCM/FS series), the de facto sizing convention
//   most other skylight manufacturers also build to.
// - Storefront/curtain-wall module widths (4'–5' bays) and transom heights
//   cite common Kawneer/EFCO/Tubelite aluminum storefront framing systems.
//
// ALL sizes below are reference-only. Always verify against the manufacturer
// spec sheet or a field measurement before cutting — flag if unverified.

const D_COMMUNITY = new Date("2026-09-04");
const REV_COMMUNITY = "2026-09";
const NOTE_COMMUNITY_SUFFIX =
	" COMMUNITY REFERENCE TEMPLATE — standard/nominal industry size, not a field measurement. Verify against manufacturer spec sheet or on-site measurement before cutting.";

// Simple rounded-rectangle path shared by every reference template — these are
// dimension placeholders, not traced shapes, so an exact-shape SVG isn't needed.
const SVG_RECT = "M4,4 L96,4 Q98,4 98,6 L98,94 Q98,96 96,96 L4,96 Q2,96 2,94 L2,6 Q2,4 4,4 Z";

const COMMUNITY_RESIDENTIAL: Pattern[] = [
	{
		id: "comm-res-picture", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-picture-window", name: "Picture Window — Nominal 4050",
		coverage: "full", svgPath: SVG_RECT, widthInches: 47.5, heightInches: 59.5, revision: REV_COMMUNITY,
		notes: "Nominal 4'0\"x5'0\" fixed picture window (WWHH convention shared across Andersen 400/Pella Impervia/Milgard Tuscany catalogs). Cut size shown ~0.5\" under nominal per side to match sash glass opening." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-living-room", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-living-room-window", name: "Living Room Window — Nominal 3050",
		coverage: "full", svgPath: SVG_RECT, widthInches: 35.5, heightInches: 59.5, revision: REV_COMMUNITY,
		notes: "Nominal 3'0\"x5'0\" double-hung window, the most common living-room callout across major manufacturer catalogs." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-bedroom", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-bedroom-window", name: "Bedroom Window (Egress) — Nominal 2846",
		coverage: "full", svgPath: SVG_RECT, widthInches: 31.5, heightInches: 53.5, revision: REV_COMMUNITY,
		notes: "Nominal 2'8\"x4'6\" double-hung — common bedroom egress size. Meets IRC R310 egress minimums (net clear opening ≥5.7 sq ft, min. clear height 24\", min. clear width 20\", max. sill height 44\" AFF). Confirm actual egress compliance on-site; film should never obstruct the operable sash." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-bathroom", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-bathroom-window", name: "Bathroom Window — Nominal 2020",
		coverage: "full", svgPath: SVG_RECT, widthInches: 23.5, heightInches: 23.5, revision: REV_COMMUNITY,
		notes: "Nominal 2'0\"x2'0\" awning/single-hung — common small bathroom size, frequently paired with frosted/privacy glass. If job calls for privacy film over frosted glass, confirm which side is film-friendly with the customer first." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-kitchen", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-kitchen-window", name: "Kitchen Window — Nominal 3646",
		coverage: "full", svgPath: SVG_RECT, widthInches: 35.5, heightInches: 53.5, revision: REV_COMMUNITY,
		notes: "Nominal 3'6\"x4'6\" double-hung — common over-sink kitchen window callout." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-basement", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-basement-window", name: "Basement Window (Egress) — Nominal 3220 Hopper",
		coverage: "full", svgPath: SVG_RECT, widthInches: 31.5, heightInches: 19.5, revision: REV_COMMUNITY,
		notes: "Nominal 3'2\"x2'0\" hopper/slider — minimum practical basement egress size under IRC R310 (net clear opening ≥5.0 sq ft at grade level, min. clear height 24\", min. clear width 20\", max. sill height 44\" AFF). Many basement windows exceed this minimum — always field-verify." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-sliding-door", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-sliding-glass-door", name: "Sliding Glass Door — Standard 6ft (per panel)",
		coverage: "full", svgPath: SVG_RECT, widthInches: 34.5, heightInches: 76.0, revision: REV_COMMUNITY,
		notes: "6' (72\"x80\") two-panel slider is the most common patio door width (Andersen/Pella/Milgard lines also publish 5' and 8'). Dimensions shown are per glass panel on a 2-panel unit — verify panel count and per-panel glass size on-site; 3- and 4-panel configurations divide differently." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-front-door", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-front-door-glass", name: "Front Door Glass Insert — Standard 3068 Door",
		coverage: "partial", svgPath: SVG_RECT, widthInches: 22.0, heightInches: 64.0, revision: REV_COMMUNITY,
		notes: "Glass-insert opening within a standard 3'0\"x6'8\" prehung entry door (Therma-Tru/Masonite catalogs). Decorative glass insert sizes vary widely by door line — this is a common full-lite dimension, not a universal one." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-sidelight", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-front-door-sidelight", name: "Entry Door Sidelight — Standard 14\"",
		coverage: "full", svgPath: SVG_RECT, widthInches: 13.0, heightInches: 76.0, revision: REV_COMMUNITY,
		notes: "14\"-wide sidelight, the most common of Therma-Tru's published 10\"/12\"/14\" sidelight width options, at standard 80\" door height less frame." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-garage", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-garage-window", name: "Garage Door Window Insert (per section)",
		coverage: "full", svgPath: SVG_RECT, widthInches: 37.0, heightInches: 6.0, revision: REV_COMMUNITY,
		notes: "Per-lite dimension for a common decorative garage-door window insert row (Clopay/Amarr catalogs) — most residential garage doors carry 3–4 lites per row across the top section. Insert sizes vary significantly by door model; treat as a starting estimate only." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-sunroom", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-sunroom-window", name: "Sunroom Window — Nominal 3060",
		coverage: "full", svgPath: SVG_RECT, widthInches: 35.5, heightInches: 71.5, revision: REV_COMMUNITY,
		notes: "Nominal 3'0\"x6'0\" — common sunroom/patio-enclosure sash size. Sunroom systems vary more by manufacturer than standard house windows; treat as a rough starting point." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-skylight", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-skylight", name: "Skylight — VELUX Curb-Mount 2222",
		coverage: "full", svgPath: SVG_RECT, widthInches: 22.5, heightInches: 22.5, revision: REV_COMMUNITY,
		notes: "22.5\"x22.5\" fixed curb-mount skylight (VELUX FCM/FS series nomenclature — the sizing convention most other skylight brands also build to). Other common VELUX curb sizes: 3030 (30\"x30\"), 4646 (46\"x46\"). Confirm model number before cutting; skylight glazing sizes are not standardized as tightly as house windows." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
];

const COMMUNITY_COMMERCIAL: Pattern[] = [
	{
		id: "comm-com-storefront", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-storefront-window", name: "Storefront Glazing Lite — Standard 4ft Bay",
		coverage: "full", svgPath: SVG_RECT, widthInches: 47.0, heightInches: 83.0, revision: REV_COMMUNITY,
		notes: "4'0\" module width is the most common storefront framing bay spacing (Kawneer 451T/EFCO/Tubelite aluminum storefront systems); infill height reflects a typical ~7' glazed lite below an 8'–10' floor-to-floor. Actual module width and lite height vary by building — always confirm against the storefront shop drawings or field measurement." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-entry-door", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-entry-door-glass", name: "Commercial Entry Door Glass — Standard 3ft ADA Door",
		coverage: "full", svgPath: SVG_RECT, widthInches: 33.0, heightInches: 82.0, revision: REV_COMMUNITY,
		notes: "Full-glass leaf on a standard 3'0\"x7'0\" commercial aluminum entry door. Minimum clear width of 32\" is required by ADA Standards §404.2.3 / ICC A117.1 — do not narrow the operable clearance with frame-mounted film." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-display", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-display-window", name: "Retail Display Window — Standard 5x8ft Bay",
		coverage: "full", svgPath: SVG_RECT, widthInches: 59.0, heightInches: 95.0, revision: REV_COMMUNITY,
		notes: "5'x8' is a common large-format retail display bay size seen in strip-mall and main-street storefront construction. Display windows are one of the least standardized commercial glazing types — this is a rough starting estimate, always field-measure." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-lobby", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-lobby-window", name: "Lobby Sidelight Glazing — Standard 24in",
		coverage: "full", svgPath: SVG_RECT, widthInches: 23.0, heightInches: 83.0, revision: REV_COMMUNITY,
		notes: "24\"-wide sidelight is a common lobby entry glazing width alongside a standard 3' commercial door, matching typical storefront mullion spacing." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-office", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-office-window", name: "Interior Office Borrowed-Light — Standard 3x4ft",
		coverage: "full", svgPath: SVG_RECT, widthInches: 35.0, heightInches: 47.0, revision: REV_COMMUNITY,
		notes: "3'x4' interior glazed \"borrowed light\" panel — a common single-lite size for interior office partition glazing. If the panel is wired or tempered safety glass (common per NFPA 80/UL requirements near rated openings), confirm film compatibility with the glass manufacturer first." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-conference", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-conference-room-window", name: "Conference Room Glazing — Standard 5x4ft",
		coverage: "full", svgPath: SVG_RECT, widthInches: 59.0, heightInches: 47.0, revision: REV_COMMUNITY,
		notes: "5'x4' interior glazing wall — common conference-room sightline panel size, often specified with switchable privacy or frosted film." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-curtain-wall", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-curtain-wall", name: "Curtain Wall Module — Standard 5x8ft",
		coverage: "full", svgPath: SVG_RECT, widthInches: 59.0, heightInches: 95.0, revision: REV_COMMUNITY,
		notes: "5'x8' unitized curtain wall module is a common mullion spacing on mid-rise commercial systems (e.g. Kawneer 1600 System class framing). Curtain wall grids are highly project-specific — confirm exact module dimensions from the building's glazing shop drawings before cutting." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-transom", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-transom-window", name: "Transom Window — Standard 3ft Door Width",
		coverage: "full", svgPath: SVG_RECT, widthInches: 35.0, heightInches: 17.0, revision: REV_COMMUNITY,
		notes: "18\" transom height over a standard 3'0\" commercial door is a common storefront proportion, but transom height varies by building elevation design far more than door width does." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-skylight", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-skylight", name: "Commercial Skylight — Standard 4x4ft Curb Module",
		coverage: "full", svgPath: SVG_RECT, widthInches: 47.0, heightInches: 47.0, revision: REV_COMMUNITY,
		notes: "4'x4' is a standard commercial curb-mount skylight module (VELUX Commercial / Wasco lines build to this convention). Larger ganged/ridge skylight systems divide into multiple such modules — count panels on-site before cutting a full job set." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
];

// ─── Seed map (used as fallback and for seeding Firestore) ───
const SEED_PATTERNS: Record<string, Pattern[]> = {
	"chevy-silverado1500-2014":         CHEVY_SILVERADO1500_2014_VISOR,
	"chevy-silverado1500-2015":         CHEVY_SILVERADO1500_2015_VISOR,
	"chevy-silverado1500-2016-crew":    [...CHEVY_SILVERADO1500_2016_CREW_TINT, ...CHEVY_SILVERADO1500_2016_VISOR],
	"chevy-silverado1500-2017":         CHEVY_SILVERADO1500_2017_VISOR,
	"chevy-silverado1500-2018":         CHEVY_SILVERADO1500_2018_VISOR,
	"chevy-silverado1500-2019-limited": CHEVY_SILVERADO1500_2019_LIMITED_VISOR,
	"community-residential-standard":   COMMUNITY_RESIDENTIAL,
	"community-commercial-standard":    COMMUNITY_COMMERCIAL,
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
	function getPatterns(vehicleId: string, category?: PatternCategory, publishedOnly = false): Pattern[] {
		const all = patterns[vehicleId] ?? [];
		const byCategory = category ? all.filter((p) => p.category === category) : all;
		return publishedOnly ? byCategory.filter((p) => p.isPublished) : byCategory;
	}

	function hasPatterns(vehicleId: string, category?: PatternCategory, publishedOnly = false): boolean {
		return getPatterns(vehicleId, category, publishedOnly).length > 0;
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
	if ((v.projectType ?? "vehicle") !== "vehicle") {
		return v.propertyLabel || v.model || v.address || vehicleId;
	}
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

export const RESIDENTIAL_ZONES_LIST: Array<{ value: PatternZone; label: string }> = [
	{ value: "res-picture-window",     label: "Picture Window" },
	{ value: "res-living-room-window", label: "Living Room Window" },
	{ value: "res-bedroom-window",     label: "Bedroom Window" },
	{ value: "res-kitchen-window",     label: "Kitchen Window" },
	{ value: "res-bathroom-window",    label: "Bathroom Window" },
	{ value: "res-sunroom-window",     label: "Sunroom Window" },
	{ value: "res-basement-window",    label: "Basement Window" },
	{ value: "res-garage-window",      label: "Garage Window" },
	{ value: "res-skylight",           label: "Skylight" },
	{ value: "res-sliding-glass-door", label: "Sliding Glass Door" },
	{ value: "res-front-door-glass",   label: "Front Door Glass" },
	{ value: "res-front-door-sidelight", label: "Front Door Sidelight" },
	{ value: "custom",                 label: "Custom" },
];

export const COMMERCIAL_ZONES_LIST: Array<{ value: PatternZone; label: string }> = [
	{ value: "com-storefront-window",       label: "Storefront Window" },
	{ value: "com-display-window",          label: "Display Window" },
	{ value: "com-entry-door-glass",        label: "Entry Door Glass" },
	{ value: "com-lobby-window",            label: "Lobby Window" },
	{ value: "com-office-window",           label: "Office Window" },
	{ value: "com-conference-room-window",  label: "Conference Room Window" },
	{ value: "com-curtain-wall",            label: "Curtain Wall Panel" },
	{ value: "com-transom-window",          label: "Transom Window" },
	{ value: "com-skylight",                label: "Skylight" },
	{ value: "custom",                      label: "Custom" },
];

// Categories with no dedicated zone taxonomy yet (vinyl, HTV, gasket, stencil,
// signage) — every piece is "custom" until zone-specific values are added.
export const CUSTOM_ZONES_LIST: Array<{ value: PatternZone; label: string }> = [
	{ value: "custom", label: "Custom" },
];

// ─── Category metadata (labels + icon + zone list) for CRUD UI ───
// Icons are single-path 0-24 viewBox glyphs, drawn with stroke=currentColor at
// call sites so they inherit each card's accent color.
export interface PatternCategoryMeta {
	value: PatternCategory;
	label: string;
	shortLabel: string;
	description: string;
	icon: string; // svg path `d`
	accent: string; // CSS color used for icon/active-state tint
}

export const PATTERN_CATEGORIES: PatternCategoryMeta[] = [
	{
		value: "ppf", label: "Paint Protection Film", shortLabel: "PPF",
		description: "Clear film panels for paint",
		icon: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z",
		accent: "#00e5ff",
	},
	{
		value: "window-tint", label: "Window Tint", shortLabel: "Tint",
		description: "Precut glass films",
		icon: "M3 4h18v16H3z M3 12h18 M9 4v16 M15 4v16",
		accent: "#0070ff",
	},
	{
		value: "vinyl", label: "Vinyl Wrap", shortLabel: "Vinyl",
		description: "Full/partial body wraps",
		icon: "M12 2a10 10 0 100 20 10 10 0 000-20z M12 9a3 3 0 100 6 3 3 0 000-6z",
		accent: "#a855f7",
	},
	{
		value: "htv", label: "Heat Transfer Vinyl", shortLabel: "HTV",
		description: "Apparel & garment cuts",
		icon: "M12 2c-1.2 3.6-5 5-5 9a5 5 0 0010 0c0-1.8-.8-2.8-1.7-3.7.1 1.8-.8 2.7-1.8 1.9.9-1.8-.1-4.7-1.5-7.2z",
		accent: "#f97316",
	},
	{
		value: "gasket", label: "Gasket", shortLabel: "Gasket",
		description: "Seals & rings",
		icon: "M12 2a10 10 0 100 20 10 10 0 000-20z M12 8a4 4 0 100 8 4 4 0 000-8z",
		accent: "#94a3b8",
	},
	{
		value: "stencil", label: "Stencil", shortLabel: "Stencil",
		description: "Paint & spray masks",
		icon: "M9 3h6v4H9z M7 7h10l1 14H6z M9 12h6 M9 16h6",
		accent: "#22c55e",
	},
	{
		value: "signage", label: "Signage", shortLabel: "Signage",
		description: "Storefront & display signs",
		icon: "M4 4h16v12H4z M9 20h6 M12 16v4 M8 9h4 M8 12h8",
		accent: "#eab308",
	},
];

export function categoryMeta(category: PatternCategory): PatternCategoryMeta {
	return PATTERN_CATEGORIES.find((c) => c.value === category) ?? PATTERN_CATEGORIES[0];
}

export function categoryLabel(category: PatternCategory): string {
	return categoryMeta(category).label;
}

export function categoryShortLabel(category: PatternCategory): string {
	return categoryMeta(category).shortLabel;
}

export function zonesForCategory(category: PatternCategory): Array<{ value: PatternZone; label: string }> {
	switch (category) {
		case "ppf": return PPF_ZONES_LIST;
		case "window-tint": return TINT_ZONES_LIST;
		default: return CUSTOM_ZONES_LIST;
	}
}
