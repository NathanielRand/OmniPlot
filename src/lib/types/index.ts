// ─────────────────────────────────────────────
// OmniPlot — GLOBAL TYPE DEFINITIONS
// ─────────────────────────────────────────────

// ─── User & Auth ─────────────────────────────
export type UserTier = "free" | "lite" | "pro" | "admin";

export interface UserProfile {
	uid: string;
	email: string;
	billingEmail: string | null;
	displayName: string;
	photoURL: string | null;
	phone: string | null;
	tier: UserTier;
	createdAt: Date;
	updatedAt: Date;

	// Usage tracking
	usage: {
		cutCount: number;
		lastCutAt: Date | null;
		monthlyCount: number;
		monthResetAt: Date;
	};

	// Subscription
	subscription: {
		stripeCustomerId:     string | null;
		stripePriceId:        string | null;
		stripeSubscriptionId: string | null;
		status: "active" | "canceled" | "past_due" | "trialing" | "paused" | null;
		// True when billing is on hold via self-service `pause_collection` —
		// distinct from `status`, which Stripe leaves as "active" throughout.
		pausedCollection: boolean;
		currentPeriodEnd: Date | null;
		trialEnd:         Date | null;
		cancelAtPeriodEnd: boolean;
	};

	// Preferences
	preferences: {
		theme: "dark" | "light" | "system";
		defaultPlotter: string | null;
		defaultMaterial: string | null;
		units: "inches" | "mm";
		autoNest: boolean;
	};

	// Session tracking — used for concurrent-session enforcement
	activeSessionId: string | null;

	// Shop membership
	shopId: string | null;
	shopRole: ShopRole | null;
}

// ─── Shop / Org hierarchy ─────────────────────
export type ShopPlan = "starter" | "team" | "studio";
export type ShopRole = "owner" | "manager" | "tech";
export type InviteStatus = "pending" | "accepted" | "revoked";

// Top of the hierarchy — the paying entity. Billing fields live here as of
// Phase 4; Shop keeps its own copies too (checkout/webhook/ledger no longer
// write them, but nothing reads-deletes the fields — additive migration,
// same as every prior phase).
export interface Organization {
	id: string;
	name: string;
	ownerId: string;
	plan: ShopPlan;
	seats: number; // org-wide pool, shared across every shop under it
	stripeCustomerId: string | null;
	stripePriceId: string | null;
	subscriptionStatus: "active" | "canceled" | "past_due" | "trialing" | null;
	currentPeriodEnd: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

// orgs/{orgId}/members/{uid} — the resolved permission record. Precomputed
// (not derived at request time) because Firestore rules can't walk an
// org→group→role chain per request.
//
// `role`/`shopIds` are the EFFECTIVE grant — max(directRole, every group
// this member belongs to) — and are what permission checks should read.
// `directRole`/`directShopIds` are the grant that comes from shop
// membership alone, independent of any group; recompute uses them as a
// floor so leaving/losing a group can never erode a shop-membership grant.
export interface OrgMember {
	uid: string;
	orgId: string;
	role: ShopRole;
	shopIds: string[] | null; // null = org-wide
	// Null when this member's only grant comes from group membership.
	directRole: ShopRole | null;
	directShopIds: string[] | null;
	displayName: string;
	email: string;
	joinedAt: Date;
}

// orgs/{orgId}/groups/{groupId} — an org-level group whose role grant is
// scoped to one or more shops, or org-wide. Named "Group" (not "Team") to
// avoid colliding with the "Team" ShopPlan tier already user-visible in
// the pricing modal and plan badges.
export interface Group {
	id: string;
	orgId: string;
	name: string;
	role: ShopRole;
	shopIds: string[] | null; // null = org-wide
	createdAt: Date;
	updatedAt: Date;
}

// orgs/{orgId}/groups/{groupId}/groupMembers/{uid}
export interface GroupMember {
	uid: string;
	orgId: string;
	groupId: string;
	joinedAt: Date;
}

export interface Shop {
	id: string;
	// Null until the Phase 1 backfill runs.
	orgId: string | null;
	name: string;
	plan: ShopPlan;
	seats: number; // max active members
	ownerId: string;
	// Stripe billing lives on the shop, not individual users
	stripeCustomerId: string | null;
	stripePriceId: string | null;
	subscriptionStatus: "active" | "canceled" | "past_due" | "trialing" | null;
	currentPeriodEnd: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface ShopMember {
	uid: string;
	shopId: string;
	role: ShopRole;
	displayName: string;
	email: string;
	joinedAt: Date;
}

export interface ShopInvite {
	id: string; // doc ID is the token
	shopId: string;
	shopName: string;
	role: ShopRole;
	email: string | null; // null = open link (anyone with the token can join)
	createdBy: string; // uid of inviter
	status: InviteStatus;
	createdAt: Date;
	expiresAt: Date;
}

// ─── Vehicle & Patterns ───────────────────────
export interface Vehicle {
	id: string;
	make: string;
	model: string;
	year: number;
	variant?: string;
	bodyStyle:
		| "sedan"
		| "coupe"
		| "suv"
		| "truck"
		| "convertible"
		| "wagon"
		| "hatchback";
	patternCount: number;
	thumbnailUrl?: string;
	createdAt: Date;
	updatedAt: Date;
	isPublished: boolean;
	tags: string[];
}

export type PatternCategory = "ppf" | "window-tint";

export type PatternZone =
	// ── PPF zones ─────────────────────────────
	| "hood"
	| "hood-edge-left"
	| "hood-edge-right"
	| "fender-front-left"
	| "fender-front-right"
	| "fender-rear-left"
	| "fender-rear-right"
	| "bumper-front"
	| "bumper-rear"
	| "door-front-left"
	| "door-front-right"
	| "door-rear-left"
	| "door-rear-right"
	| "rocker-left"
	| "rocker-right"
	| "mirror-left"
	| "mirror-right"
	| "roof"
	| "trunk"
	| "a-pillar-left"
	| "a-pillar-right"
	| "headlight-left"
	| "headlight-right"
	| "foglight-left"
	| "foglight-right"
	// ── Window tint zones ──────────────────────
	| "windshield"
	| "windshield-strip"
	| "rear-windshield"
	| "sunroof"
	| "moonroof"
	| "window-front-left"
	| "window-front-right"
	| "window-rear-left"
	| "window-rear-right"
	| "quarter-window-left"
	| "quarter-window-right"
	| "vent-window-left"
	| "vent-window-right"
	| "custom";

export type PatternCoverage = "full" | "partial" | "edge-only";

export interface Pattern {
	id: string;
	vehicleId: string;
	category: PatternCategory;
	zone: PatternZone;
	name: string;
	coverage: PatternCoverage;
	svgPath: string; // The actual SVG path data
	svgUrl?: string; // URL to full SVG file in Cloud Storage
	widthInches: number;
	heightInches: number;
	revision: string; // e.g. "2024-11"
	notes?: string;
	isPublished: boolean;
	createdAt: Date;
	updatedAt: Date;
}

// ─── Tint Film ────────────────────────────────
export interface TintFilm {
	id: string;
	name: string;
	manufacturer: string;
	sku: string;
	widthInches: number;
	heightInches: number;
	vlt: number; // Visible Light Transmission %, e.g. 35 = 35% VLT
	series: string; // e.g. "Ceramic", "Carbon", "Dyed"
	irRejection?: number; // % infrared rejection
}

// ─── Canvas / Editor ─────────────────────────
export interface CanvasItem {
	id: string;
	patternId: string;
	pattern: Pattern;
	// Position on the material sheet (in inches)
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	flippedH: boolean;
	flippedV: boolean;
	scale: number;
	layer: number;
	locked: boolean;
	color: string; // Display color for this item
	label?: string;
	outOfBounds?: boolean; // True when item doesn't fit within the material sheet
}

export interface MaterialSheet {
	id: string;
	name: string;
	widthInches: number;
	heightInches: number;
	manufacturer: string;
	sku: string;
}

export type CanvasTool = "select" | "pan" | "zoom-in" | "zoom-out";

export interface CanvasState {
	items: CanvasItem[];
	sheet: MaterialSheet;
	selectedIds: string[];
	zoom: number; // percent, e.g. 100
	panX: number;
	panY: number;
	tool: CanvasTool;
	showGrid: boolean;
	showRulers: boolean;
	snapToGrid: boolean;
	gridSizeInches: number;
}

// ─── Cut Jobs ─────────────────────────────────
export type JobStatus = "draft" | "ready" | "cutting" | "complete" | "error";
export type ExportFormat = "hpgl" | "svg" | "dxf" | "pdf";

export interface CutJob {
	id: string;
	userId: string;
	vehicleId: string;
	vehicle?: Vehicle;
	name: string;
	status: JobStatus;
	canvasState: CanvasState;
	plotterConfig: PlotterConfig;
	materialSheet: MaterialSheet;
	exportFormat: ExportFormat;

	// Metrics
	metrics: {
		materialEfficiency: number; // 0–1
		totalPathLengthMm: number;
		estimatedCutSeconds: number;
		itemCount: number;
		sheetArea: number;
		usedArea: number;
	};

	createdAt: Date;
	updatedAt: Date;
	completedAt: Date | null;
	exportUrl: string | null;
}

// ─── Plotter ──────────────────────────────────
// hpgl   — Standard HPGL: VS in cm/s, FS in grams. Correct for VEVOR, USCutter, GCC, Mimaki, and most budget cutters.
// roland — Roland CAMM-1 HPGL extension: VS in mm/s (non-standard), FS in grams.
// hpgl2  — HPGL/2: VS in cm/s, FC in 0–38 units. Graphtec FC9000, Summa S2.
// gpgl   — Silhouette proprietary: no serial force command.
export type PlotterProtocol = "hpgl" | "roland" | "hpgl2" | "gpgl";
export type PlotterConnection =
	| "usb-serial"
	| "network"
	| "download"
	| "cut-agent";

export type PlotterStatus = "idle" | "cutting" | "paused" | "error" | "offline";

/** A registered, user-owned cutting device persisted in Firestore. */
export interface PlotterDevice {
	id: string;
	userId: string;
	name: string;             // user-assigned label, e.g. "Bay 1 Roland"
	presetName: string;       // PLOTTER_PRESETS[].name
	manufacturer: string;
	model: string;
	protocol: PlotterProtocol;
	connection: PlotterConnection;
	maxMediaWidthMm: number;
	ipAddress?: string;
	port?: number;
	baudRate?: number;
	serialPort?: string;
	agentUrl?: string;
	compatNote?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface PlotterConfig {
	id: string;
	name: string;
	manufacturer: string;
	model: string;
	protocol: PlotterProtocol;
	connection: PlotterConnection;

	// Cut settings
	bladeForce: number; // grams
	cuttingSpeed: number; // mm/s
	passes: number;
	overcut: number; // mm
	offsetBlade: number; // mm

	// Sheet / hardware constraints
	mediaWidthMm: number;       // configured working width
	maxMediaWidthMm: number;    // hardware max cutting width (from preset)
	originX: number;
	originY: number;
	flipH: boolean;
	flipV: boolean;

	// Network/serial config
	ipAddress?: string;
	port?: number;
	baudRate?: number;
	serialPort?: string;
	agentUrl?: string;  // Cut-Agent URL, default "http://localhost:7878"

	// Compatibility note shown in UI (e.g. for Silhouette proprietary protocol)
	compatNote?: string;
}

// ─── Admin ────────────────────────────────────
export interface AdminStats {
	totalUsers: number;
	activeToday: number;
	activeMTD: number;
	tierBreakdown: Record<UserTier, number>;
	totalCuts: number;
	cutsToday: number;
	cutsThisMonth: number;
	revenue: {
		mrr: number;
		arr: number;
		lifetimeValue: number;
	};
	topVehicles: Array<{ vehicleId: string; name: string; count: number }>;
	recentJobs: CutJob[];
}

export interface AdminUser extends UserProfile {
	// Additional admin-visible fields
	ipAddress?: string;
	lastSeen?: Date;
	flagged?: boolean;
	notes?: string;
}

// ─── Pattern Library Admin ────────────────────
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

// ─── Insights / Blog ─────────────────────────
export type InsightCategory = 'ppf' | 'window-tint' | 'guides' | 'vehicles';
export type InsightStatus   = 'draft' | 'published';

export interface InsightPost {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	content: string;          // HTML
	category: InsightCategory;
	tags: string[];
	status: InsightStatus;
	coverImageUrl: string | null;
	author: string;
	readTimeMinutes: number;
	viewCount: number;
	metaTitle: string | null;
	metaDescription: string | null;
	publishedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

// ─── User Patterns (private + community upload) ──
export type UserPatternStatus = "private" | "pending" | "approved" | "rejected";

export interface UserPattern {
	id: string;
	ownerId: string;           // uid of creator
	createdAt: Date;
	updatedAt: Date;
	submitToCommunity: boolean; // user wants this reviewed for public library
	isPublished: boolean;       // admin approved — visible in public library
	status: UserPatternStatus;
	adminNotes?: string;
	// Vehicle (embedded — may not exist in public catalog)
	vehicleId?: string;        // set if linking to existing public vehicle
	make: string;
	models: string[];
	years: string[];   // e.g. ["2018", "2020-2024"]
	bodyStyle: "sedan" | "coupe" | "suv" | "truck" | "convertible" | "wagon" | "hatchback";
	// Pattern geometry
	category: PatternCategory;
	zones: PatternZone[];
	name: string;
	coverage: PatternCoverage;
	widthInches: number;
	heightInches: number;
	svgPath: string;
	notes?: string;
}

// ─── Pattern Adjustment Requests ─────────────
// Submitted by a user when they want to change an approved (locked) community pattern.
export interface PatternAdjustmentRequest {
	id: string;
	patternId: string;    // userPattern doc id
	requestedBy: string;  // uid
	notes: string;        // what the user wants changed
	status: "pending" | "approved" | "rejected";
	adminResponse?: string;
	createdAt: Date;
}

// ─── Plotter Error Reports ────────────────────
export interface PlotterErrorReport {
	id: string;
	userId: string;
	userEmail: string | null;
	displayName: string | null;
	plotterPreset: string;
	connection: string;
	protocol: string;
	errorCode: string;
	errorTitle: string;
	errorRaw: string;
	agentVersion: string | null;
	userAgent: string;
	/** true = escalate flag was set; auto-logged without user action */
	autoReported: boolean;
	resolvedAt: Date | null;
	createdAt: Date;
}

// ─── UI State ─────────────────────────────────
export interface Toast {
	id: string;
	type: "success" | "error" | "warning" | "info";
	title: string;
	message?: string;
	duration?: number;
	action?: { label: string; fn: () => void };
}

export interface Modal {
	id: string;
	component: any;
	props?: Record<string, unknown>;
}

// ─── API Responses ────────────────────────────
export interface ApiResponse<T = unknown> {
	data: T | null;
	error: string | null;
	status: number;
}

// ─── Pricing ──────────────────────────────────
export interface PricingPlan {
	id: UserTier;
	name: string;
	price: number; // Monthly USD
	yearlyPrice: number;
	description: string;
	features: string[];
	limits: {
		cutsPerDay: number | null; // null = unlimited
		cutsPerMonth: number | null;
		seats: number;
		customPatterns: boolean;
		aiAssist: boolean;
		prioritySupport: boolean;
		exportFormats: ExportFormat[];
	};
	stripePriceId: string;
	stripeYearlyPriceId: string;
	popular?: boolean;
	badge?: string;
}
