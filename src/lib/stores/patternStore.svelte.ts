// ─────────────────────────────────────────────
// OmniPlot — PATTERN & VEHICLE STORE (Svelte 5 Runes)
// Shared source of truth for admin and library pages.
// ─────────────────────────────────────────────

import { uid } from "$lib/utils";
import { rectSegs, serializePath } from "$lib/utils/pathGeometry";
import type {
	Pattern,
	PatternCategory,
	PatternCoverage,
	PatternZone,
	ProjectType,
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
import { toastStore, userStore } from "./stores.svelte";

export type { PatternStatus, RequestStatus, VehicleEntry, PatternRequest };

// ─── Seed: Vehicles ───────────────────────────

const INITIAL_VEHICLES: VehicleEntry[] = [
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

// PRECISION: each reference template's outline is an EXACT rectangle at its
// own W × H (square corners), generated from its dimensions — never a shared
// shape stretched to fit (that turned corners into ovals and broke the
// rule that W × H always matches the outline's proportions).
function exactRect(w: number, h: number): string {
	return serializePath(rectSegs(0, 0, w, h));
}

const COMMUNITY_RESIDENTIAL: Pattern[] = [
	{
		id: "comm-res-picture", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-picture-window", name: "Picture Window — Nominal 4050",
		coverage: "full", svgPath: exactRect(47.5, 59.5), widthInches: 47.5, heightInches: 59.5, revision: REV_COMMUNITY,
		notes: "Nominal 4'0\"x5'0\" fixed picture window (WWHH convention shared across Andersen 400/Pella Impervia/Milgard Tuscany catalogs). Cut size shown ~0.5\" under nominal per side to match sash glass opening." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-living-room", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-living-room-window", name: "Living Room Window — Nominal 3050",
		coverage: "full", svgPath: exactRect(35.5, 59.5), widthInches: 35.5, heightInches: 59.5, revision: REV_COMMUNITY,
		notes: "Nominal 3'0\"x5'0\" double-hung window, the most common living-room callout across major manufacturer catalogs." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-bedroom", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-bedroom-window", name: "Bedroom Window (Egress) — Nominal 2846",
		coverage: "full", svgPath: exactRect(31.5, 53.5), widthInches: 31.5, heightInches: 53.5, revision: REV_COMMUNITY,
		notes: "Nominal 2'8\"x4'6\" double-hung — common bedroom egress size. Meets IRC R310 egress minimums (net clear opening ≥5.7 sq ft, min. clear height 24\", min. clear width 20\", max. sill height 44\" AFF). Confirm actual egress compliance on-site; film should never obstruct the operable sash." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-bathroom", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-bathroom-window", name: "Bathroom Window — Nominal 2020",
		coverage: "full", svgPath: exactRect(23.5, 23.5), widthInches: 23.5, heightInches: 23.5, revision: REV_COMMUNITY,
		notes: "Nominal 2'0\"x2'0\" awning/single-hung — common small bathroom size, frequently paired with frosted/privacy glass. If job calls for privacy film over frosted glass, confirm which side is film-friendly with the customer first." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-kitchen", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-kitchen-window", name: "Kitchen Window — Nominal 3646",
		coverage: "full", svgPath: exactRect(35.5, 53.5), widthInches: 35.5, heightInches: 53.5, revision: REV_COMMUNITY,
		notes: "Nominal 3'6\"x4'6\" double-hung — common over-sink kitchen window callout." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-basement", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-basement-window", name: "Basement Window (Egress) — Nominal 3220 Hopper",
		coverage: "full", svgPath: exactRect(31.5, 19.5), widthInches: 31.5, heightInches: 19.5, revision: REV_COMMUNITY,
		notes: "Nominal 3'2\"x2'0\" hopper/slider — minimum practical basement egress size under IRC R310 (net clear opening ≥5.0 sq ft at grade level, min. clear height 24\", min. clear width 20\", max. sill height 44\" AFF). Many basement windows exceed this minimum — always field-verify." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-sliding-door", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-sliding-glass-door", name: "Sliding Glass Door — Standard 6ft (per panel)",
		coverage: "full", svgPath: exactRect(34.5, 76.0), widthInches: 34.5, heightInches: 76.0, revision: REV_COMMUNITY,
		notes: "6' (72\"x80\") two-panel slider is the most common patio door width (Andersen/Pella/Milgard lines also publish 5' and 8'). Dimensions shown are per glass panel on a 2-panel unit — verify panel count and per-panel glass size on-site; 3- and 4-panel configurations divide differently." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-front-door", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-front-door-glass", name: "Front Door Glass Insert — Standard 3068 Door",
		coverage: "partial", svgPath: exactRect(22.0, 64.0), widthInches: 22.0, heightInches: 64.0, revision: REV_COMMUNITY,
		notes: "Glass-insert opening within a standard 3'0\"x6'8\" prehung entry door (Therma-Tru/Masonite catalogs). Decorative glass insert sizes vary widely by door line — this is a common full-lite dimension, not a universal one." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-sidelight", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-front-door-sidelight", name: "Entry Door Sidelight — Standard 14\"",
		coverage: "full", svgPath: exactRect(13.0, 76.0), widthInches: 13.0, heightInches: 76.0, revision: REV_COMMUNITY,
		notes: "14\"-wide sidelight, the most common of Therma-Tru's published 10\"/12\"/14\" sidelight width options, at standard 80\" door height less frame." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-garage", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-garage-window", name: "Garage Door Window Insert (per section)",
		coverage: "full", svgPath: exactRect(37.0, 6.0), widthInches: 37.0, heightInches: 6.0, revision: REV_COMMUNITY,
		notes: "Per-lite dimension for a common decorative garage-door window insert row (Clopay/Amarr catalogs) — most residential garage doors carry 3–4 lites per row across the top section. Insert sizes vary significantly by door model; treat as a starting estimate only." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-sunroom", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-sunroom-window", name: "Sunroom Window — Nominal 3060",
		coverage: "full", svgPath: exactRect(35.5, 71.5), widthInches: 35.5, heightInches: 71.5, revision: REV_COMMUNITY,
		notes: "Nominal 3'0\"x6'0\" — common sunroom/patio-enclosure sash size. Sunroom systems vary more by manufacturer than standard house windows; treat as a rough starting point." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-res-skylight", vehicleId: "community-residential-standard", projectType: "residential",
		category: "window-tint", zone: "res-skylight", name: "Skylight — VELUX Curb-Mount 2222",
		coverage: "full", svgPath: exactRect(22.5, 22.5), widthInches: 22.5, heightInches: 22.5, revision: REV_COMMUNITY,
		notes: "22.5\"x22.5\" fixed curb-mount skylight (VELUX FCM/FS series nomenclature — the sizing convention most other skylight brands also build to). Other common VELUX curb sizes: 3030 (30\"x30\"), 4646 (46\"x46\"). Confirm model number before cutting; skylight glazing sizes are not standardized as tightly as house windows." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
];

const COMMUNITY_COMMERCIAL: Pattern[] = [
	{
		id: "comm-com-storefront", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-storefront-window", name: "Storefront Glazing Lite — Standard 4ft Bay",
		coverage: "full", svgPath: exactRect(47.0, 83.0), widthInches: 47.0, heightInches: 83.0, revision: REV_COMMUNITY,
		notes: "4'0\" module width is the most common storefront framing bay spacing (Kawneer 451T/EFCO/Tubelite aluminum storefront systems); infill height reflects a typical ~7' glazed lite below an 8'–10' floor-to-floor. Actual module width and lite height vary by building — always confirm against the storefront shop drawings or field measurement." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-entry-door", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-entry-door-glass", name: "Commercial Entry Door Glass — Standard 3ft ADA Door",
		coverage: "full", svgPath: exactRect(33.0, 82.0), widthInches: 33.0, heightInches: 82.0, revision: REV_COMMUNITY,
		notes: "Full-glass leaf on a standard 3'0\"x7'0\" commercial aluminum entry door. Minimum clear width of 32\" is required by ADA Standards §404.2.3 / ICC A117.1 — do not narrow the operable clearance with frame-mounted film." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-display", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-display-window", name: "Retail Display Window — Standard 5x8ft Bay",
		coverage: "full", svgPath: exactRect(59.0, 95.0), widthInches: 59.0, heightInches: 95.0, revision: REV_COMMUNITY,
		notes: "5'x8' is a common large-format retail display bay size seen in strip-mall and main-street storefront construction. Display windows are one of the least standardized commercial glazing types — this is a rough starting estimate, always field-measure." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-lobby", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-lobby-window", name: "Lobby Sidelight Glazing — Standard 24in",
		coverage: "full", svgPath: exactRect(23.0, 83.0), widthInches: 23.0, heightInches: 83.0, revision: REV_COMMUNITY,
		notes: "24\"-wide sidelight is a common lobby entry glazing width alongside a standard 3' commercial door, matching typical storefront mullion spacing." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-office", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-office-window", name: "Interior Office Borrowed-Light — Standard 3x4ft",
		coverage: "full", svgPath: exactRect(35.0, 47.0), widthInches: 35.0, heightInches: 47.0, revision: REV_COMMUNITY,
		notes: "3'x4' interior glazed \"borrowed light\" panel — a common single-lite size for interior office partition glazing. If the panel is wired or tempered safety glass (common per NFPA 80/UL requirements near rated openings), confirm film compatibility with the glass manufacturer first." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-conference", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-conference-room-window", name: "Conference Room Glazing — Standard 5x4ft",
		coverage: "full", svgPath: exactRect(59.0, 47.0), widthInches: 59.0, heightInches: 47.0, revision: REV_COMMUNITY,
		notes: "5'x4' interior glazing wall — common conference-room sightline panel size, often specified with switchable privacy or frosted film." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-curtain-wall", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-curtain-wall", name: "Curtain Wall Module — Standard 5x8ft",
		coverage: "full", svgPath: exactRect(59.0, 95.0), widthInches: 59.0, heightInches: 95.0, revision: REV_COMMUNITY,
		notes: "5'x8' unitized curtain wall module is a common mullion spacing on mid-rise commercial systems (e.g. Kawneer 1600 System class framing). Curtain wall grids are highly project-specific — confirm exact module dimensions from the building's glazing shop drawings before cutting." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-transom", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-transom-window", name: "Transom Window — Standard 3ft Door Width",
		coverage: "full", svgPath: exactRect(35.0, 17.0), widthInches: 35.0, heightInches: 17.0, revision: REV_COMMUNITY,
		notes: "18\" transom height over a standard 3'0\" commercial door is a common storefront proportion, but transom height varies by building elevation design far more than door width does." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
	{
		id: "comm-com-skylight", vehicleId: "community-commercial-standard", projectType: "commercial",
		category: "window-tint", zone: "com-skylight", name: "Commercial Skylight — Standard 4x4ft Curb Module",
		coverage: "full", svgPath: exactRect(47.0, 47.0), widthInches: 47.0, heightInches: 47.0, revision: REV_COMMUNITY,
		notes: "4'x4' is a standard commercial curb-mount skylight module (VELUX Commercial / Wasco lines build to this convention). Larger ganged/ridge skylight systems divide into multiple such modules — count panels on-site before cutting a full job set." + NOTE_COMMUNITY_SUFFIX,
		isPublished: true, createdAt: D_COMMUNITY, updatedAt: D_COMMUNITY,
	},
];

// ─── Seed map (ONLY for the admin "seed catalog" action — never shown as a fallback) ───
const SEED_PATTERNS: Record<string, Pattern[]> = {
	"community-residential-standard":   COMMUNITY_RESIDENTIAL,
	"community-commercial-standard":    COMMUNITY_COMMERCIAL,
};

// ─── Store Factory ────────────────────────────

function createPatternStore() {
	// PRECISION: the catalog shown to users is ONLY what is in Firestore.
	// Nothing hard-coded is ever displayed or cuttable — until the catalog
	// loads the UI shows a loading state, and a load failure shows an error.
	let vehicles  = $state<VehicleEntry[]>([]);
	let patterns  = $state<Record<string, Pattern[]>>({});
	let requests  = $state<PatternRequest[]>(INITIAL_REQUESTS);
	let loading   = $state(true);
	let firestoreReady = false;
	// True while Firestore has no catalog yet (empty or failed to load).
	// Admin catalog edits are blocked in that state until the catalog is
	// seeded, so the first write can't leave a partial catalog.
	let usingSeed = $state(true);
	let catalogError = $state(false);

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
				vehicles = entries;
				usingSeed = entries.length === 0;
				catalogError = false;
				vReady = true;
				checkReady();
			},
			() => { usingSeed = true; catalogError = true; vReady = true; checkReady(); },
		);

		const unsubP = subscribePatterns(
			(flat) => {
				patterns = mapPatterns(flat);
				pReady = true;
				checkReady();
			},
			() => { catalogError = true; pReady = true; checkReady(); },
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

	// Create-only: writes seed docs that don't exist yet and leaves existing
	// ones untouched, so it never reverts admin edits. A seed doc an admin
	// deleted counts as missing and would come back — the admin UI says so.
	async function seedFirestore(): Promise<{ created: number; skipped: number } | null> {
		try {
			const result = await batchSeedData(INITIAL_VEHICLES, SEED_PATTERNS, INITIAL_REQUESTS);
			toastStore.success("Catalog seeded", `${result.created} docs created, ${result.skipped} already existed and were left alone.`);
			return result;
		} catch (e) {
			toastStore.error("Seed failed", String(e));
			return null;
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
		// Its patterns go too — otherwise their docs stay in Firestore pointing
		// at a subject that no longer exists.
		for (const p of patterns[id] ?? []) syncPatternDelete(p.id);
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

	/** Vehicle requests carry make/model/year; property and custom requests
	 *  carry a title (in `model`) and no year. */
	function addRequest(r: { projectType?: ProjectType; make: string; model: string; year: number; notes: string }): PatternRequest {
		const projectType = r.projectType ?? "vehicle";
		const req: PatternRequest = {
			id: uid("req_"),
			vehicle: projectType === "vehicle" ? `${r.year} ${r.make} ${r.model}` : r.model,
			projectType,
			make: r.make,
			model: r.model,
			year: projectType === "vehicle" ? r.year : 0,
			notes: r.notes,
			votes: 1,
			status: "queued",
			requestedAt: new Date().toISOString().split("T")[0],
			requestedBy: userStore.user?.uid,
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
		get usingSeed() { return usingSeed; },
		get catalogError() { return catalogError; },
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

/** Zones valid for a subject: residential/commercial/custom subjects have
 *  their own lists regardless of category; vehicles go by category. */
export function zonesFor(category: PatternCategory, projectType?: ProjectType): Array<{ value: PatternZone; label: string }> {
	switch (projectType ?? "vehicle") {
		case "residential": return RESIDENTIAL_ZONES_LIST;
		case "commercial":  return COMMERCIAL_ZONES_LIST;
		case "custom":      return CUSTOM_ZONES_LIST;
		default:            return zonesForCategory(category);
	}
}

/** Human label for any zone. Looks in the subject's own list first, then
 *  every list, so a residential zone never shows as its raw id. */
export function zoneLabel(zone: PatternZone, category: PatternCategory, projectType?: ProjectType, customLabel?: string): string {
	if (zone === "custom") return customLabel?.trim() || "Custom";
	const lists = [zonesFor(category, projectType), PPF_ZONES_LIST, TINT_ZONES_LIST, RESIDENTIAL_ZONES_LIST, COMMERCIAL_ZONES_LIST, CUSTOM_ZONES_LIST];
	for (const list of lists) {
		const hit = list.find((z) => z.value === zone);
		if (hit) return hit.label;
	}
	return String(zone).replace(/^(res|com)-/, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}
