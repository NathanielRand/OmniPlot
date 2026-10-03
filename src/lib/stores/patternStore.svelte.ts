// ─────────────────────────────────────────────
// OmniPlot — PATTERN & VEHICLE STORE (Svelte 5 Runes)
// Shared source of truth for admin and library pages.
// ─────────────────────────────────────────────

import { uid } from "$lib/utils";
import type { MyVote } from "$lib/utils/demand";
import type { VoteTarget } from "$lib/firebase/firestore";
import { rectSegs, serializePath } from "$lib/utils/pathGeometry";
import type {
	Pattern,
	PatternCategory,
	PatternCoverage,
	PatternZone,
	ProjectType,
	VehicleEntry,
	VehicleMedia,
	PatternRequest,
	DemandRecord,
	PatternStatus,
	RequestStatus,
} from "$lib/types";
import {
	subscribeVehicles,
	subscribePatterns,
	subscribeRequests,
	subscribeMyVotes,
	sendVote,
	setDemandStatus,
	subscribeVehicleMedia,
	setVehicleDoc,
	updateVehicleDoc,
	deleteVehicleDoc,
	setPatternDoc,
	updatePatternDoc,
	deletePatternDoc,
	batchSeedData,
} from "$lib/firebase/firestore";
import { toastStore, userStore } from "./stores.svelte";
import { patternOptionsStore } from "./patternOptionsStore.svelte";
import {
	BODY_STYLES, CUSTOM_ZONES_LIST, PPF_ZONES_LIST, TINT_ZONES_LIST, RESIDENTIAL_ZONES_LIST, COMMERCIAL_ZONES_LIST,
	PATTERN_CATEGORIES, TINT_ZONE_GROUP, PPF_ZONE_GROUP, MIRROR_PAIRS,
	categoryMetaOf, mirrorPairs, withAdminZones, withCategoryOverride, type PatternCategoryMeta,
} from "$lib/patternOptions";

// Built-in option lists moved to $lib/patternOptions (shared with the server);
// re-exported so existing imports keep working.
export {
	BODY_STYLES, CUSTOM_ZONES_LIST, PPF_ZONES_LIST, TINT_ZONES_LIST, RESIDENTIAL_ZONES_LIST, COMMERCIAL_ZONES_LIST,
	PATTERN_CATEGORIES, TINT_ZONE_GROUP, PPF_ZONE_GROUP, MIRROR_PAIRS,
};
export type { PatternCategoryMeta };

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
	let requests  = $state<DemandRecord[]>([]);
	let myVotes   = $state<Record<string, MyVote>>({});
	let unsubVotes: (() => void) | null = null;
	let loading   = $state(true);
	let media     = $state<Record<string, VehicleMedia>>({});
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

		// Imagery is decoration only — it never gates `loading`, and a failure
		// (rules not deployed yet, offline) just leaves the fallbacks showing.
		const unsubM = subscribeVehicleMedia(
			(list) => { media = Object.fromEntries(list.map((m) => [m.id, m])); },
			() => {},
		);

		return () => { unsubV(); unsubP(); unsubR(); unsubM(); unsubVotes?.(); firestoreReady = false; };
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

	/**
	 * Ask for a pattern, or vote on a coming-soon one — the same thing. The server
	 * folds it into the one record for that make/model and keeps it to one vote
	 * per person, so this is safe to call for something already requested.
	 */
	async function vote(t: VoteTarget, on = true): Promise<boolean> {
		try { await sendVote(t, on); return true; }
		catch (e) { toastStore.error(on ? "Couldn't save your vote" : "Couldn't remove your vote", e instanceof Error ? e.message : "Please try again."); return false; }
	}

	/** Follow the signed-in user's own votes (null on sign-out). */
	function watchVotes(uid: string | null) {
		unsubVotes?.(); unsubVotes = null; myVotes = {};
		if (uid) unsubVotes = subscribeMyVotes(uid, (v) => { myVotes = v; }, () => {});
	}

	async function advanceRequest(id: string) {
		const r = requests.find((x) => x.id === id);
		if (!r) return;
		const to: RequestStatus = r.status === "queued" ? "in-progress" : r.status === "in-progress" ? "done" : r.status;
		if (to === r.status) return;
		try { await setDemandStatus(id, to); }
		catch { toastStore.error("Sync error", "Could not update request"); }
	}

	return {
		get vehicles() { return vehicles; },
		get requests() { return requests; },
		get myVotes() { return myVotes; },
		get media() { return media; },
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
		vote,
		watchVotes,
		advanceRequest,
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


const builtinCategories = () => PATTERN_CATEGORIES.map((c) => withCategoryOverride(c, patternOptionsStore.doc.overrides.categories[c.value]));

/** Categories offered in pickers: built-ins and additions, minus hidden ones. */
export function allCategories(): PatternCategoryMeta[] {
	const { doc } = patternOptionsStore;
	return [
		...builtinCategories().filter((c) => !doc.overrides.categories[c.value]?.hidden),
		...doc.categories.filter((c) => !c.hidden).map(categoryMetaOf),
	];
}

/** Every category that can appear on an existing pattern — hidden ones too,
 *  so browsing and filtering never lose patterns saved under them. */
export function knownCategories(): PatternCategoryMeta[] {
	return [...builtinCategories(), ...patternOptionsStore.doc.categories.map(categoryMetaOf)];
}

export function categoryMeta(category: PatternCategory): PatternCategoryMeta {
	const extra = patternOptionsStore.doc.categories.find((c) => c.id === category);
	if (extra) return categoryMetaOf(extra);
	const all = builtinCategories();
	return all.find((c) => c.value === category) ?? all[0];
}

export function categoryLabel(category: PatternCategory): string {
	return categoryMeta(category).label;
}

export function categoryShortLabel(category: PatternCategory): string {
	return categoryMeta(category).shortLabel;
}

/** Vehicle types offered in pickers: built-ins and additions, minus hidden ones. */
export function allBodyStyles(includeHidden = false): Array<{ value: string; label: string }> {
	const { doc } = patternOptionsStore;
	return [
		...BODY_STYLES
			.filter((b) => includeHidden || !doc.overrides.bodyStyles[b.value]?.hidden)
			.map((b) => ({ value: b.value, label: doc.overrides.bodyStyles[b.value]?.label ?? b.label })),
		...doc.bodyStyles.filter((b) => includeHidden || !b.hidden).map((b) => ({ value: b.id, label: b.label })),
	];
}

export function bodyStyleLabel(style: string): string {
	return allBodyStyles(true).find((b) => b.value === style)?.label
		?? style.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function zonesForCategory(category: PatternCategory, includeHidden = false): Array<{ value: PatternZone; label: string }> {
	const { doc } = patternOptionsStore;
	const builtin = category === "ppf" ? PPF_ZONES_LIST : category === "window-tint" ? TINT_ZONES_LIST : CUSTOM_ZONES_LIST;
	return withAdminZones(builtin, doc.zones.filter((z) => z.category === category), includeHidden, doc.overrides.zones);
}

/** Zones valid for a subject: residential/commercial/custom subjects have
 *  their own lists regardless of category; vehicles go by category.
 *  `includeHidden` adds zones hidden from the pickers — for checking that
 *  a saved zone is still valid, never for offering a choice. */
export function zonesFor(category: PatternCategory, projectType?: ProjectType, includeHidden = false): Array<{ value: PatternZone; label: string }> {
	const t = projectType ?? "vehicle";
	if (t === "vehicle") return zonesForCategory(category, includeHidden);
	const { doc } = patternOptionsStore;
	const builtin = t === "residential" ? RESIDENTIAL_ZONES_LIST : t === "commercial" ? COMMERCIAL_ZONES_LIST : CUSTOM_ZONES_LIST;
	return withAdminZones(builtin, doc.zones.filter((z) => z.projectType === t), includeHidden, doc.overrides.zones);
}

/** The zone that mirrors this one (left ↔ right), built-in or admin-defined. */
export function mirrorOf(zone: PatternZone): PatternZone | undefined {
	return mirrorPairs(patternOptionsStore.doc)[zone];
}

/** Library zone-filter group for an admin-added zone, if it has one. */
export function adminZoneGroup(zone: PatternZone): string | undefined {
	const z = patternOptionsStore.doc.zones.find((x) => x.id === zone);
	return z ? (z.group || z.label) : undefined;
}

/** Human label for any zone. Looks in the subject's own list first, then
 *  every list (hidden admin zones too), so a saved zone never shows as its raw id. */
export function zoneLabel(zone: PatternZone, category: PatternCategory, projectType?: ProjectType, customLabel?: string): string {
	if (zone === "custom") return customLabel?.trim() || "Custom";
	const ov = patternOptionsStore.doc.overrides.zones;
	const lists = [
		zonesFor(category, projectType, true),
		...[PPF_ZONES_LIST, TINT_ZONES_LIST, RESIDENTIAL_ZONES_LIST, COMMERCIAL_ZONES_LIST, CUSTOM_ZONES_LIST].map((l) => withAdminZones(l, [], true, ov)),
	];
	for (const list of lists) {
		const hit = list.find((z) => z.value === zone);
		if (hit) return hit.label;
	}
	const added = patternOptionsStore.doc.zones.find((z) => z.id === zone);
	if (added) return added.label;
	return String(zone).replace(/^(res|com)-/, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}
