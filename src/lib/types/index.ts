// ─────────────────────────────────────────────
// OmniPlot — GLOBAL TYPE DEFINITIONS
// ─────────────────────────────────────────────

// ─── User & Auth ─────────────────────────────
export type UserTier = "free" | "lite" | "pro" | "admin";

export interface UserProfile {
	uid: string;
	email: string;
	displayName: string;
	photoURL: string | null;
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
		stripeCustomerId: string | null;
		stripePriceId: string | null;
		status: "active" | "canceled" | "past_due" | "trialing" | null;
		currentPeriodEnd: Date | null;
		trialEnd: Date | null;
	};

	// Preferences
	preferences: {
		theme: "dark" | "light" | "system";
		defaultPlotter: string | null;
		defaultMaterial: string | null;
		units: "inches" | "mm";
		autoNest: boolean;
	};
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

export type PatternZone =
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
	| "custom";

export type PatternCoverage = "full" | "partial" | "edge-only";

export interface Pattern {
	id: string;
	vehicleId: string;
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
export type PlotterProtocol = "hpgl" | "hpgl2" | "gpgl";
export type PlotterConnection =
	| "usb-serial"
	| "network"
	| "download"
	| "cut-agent";

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

	// Sheet setup
	mediaWidthMm: number;
	originX: number;
	originY: number;
	flipH: boolean;
	flipV: boolean;

	// Network/serial config
	ipAddress?: string;
	port?: number;
	baudRate?: number;
	serialPort?: string;
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
