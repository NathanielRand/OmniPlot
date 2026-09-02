// ─────────────────────────────────────────────
// OmniPlot — APP CONFIGURATION
// ─────────────────────────────────────────────
import type { PricingPlan, MaterialSheet, TintFilm, PlotterConfig, ShopPlan } from "$lib/types";

// ─── Cut Agent version ────────────────────────
// Single source of truth. Bump here when a new agent binary is deployed.
// Any running agent that reports a different version triggers the update badge + block.
export const CURRENT_AGENT_VERSION = "1.2.0";

// ─── Plotter preset type ──────────────────────
// Extends PlotterConfig with hardware metadata used for detection and compatibility.
// Fields with confirmed real-world specs are marked; adjust if your specific unit differs.
export interface PlotterPreset extends Partial<PlotterConfig> {
	name: string;
	/** Hardware max cutting width in mm (NOT media load width — the actual cut zone). */
	maxMediaWidthMm: number;
	/** USB Vendor IDs for auto-detection via Web Serial / Cut Agent enumeration. */
	usbVids?: number[];
	/** Shown in UI when protocol or connectivity requires special user setup. */
	compatNote?: string;
}

// ─── App constants ────────────────────────────
export const APP_NAME = "OmniPlot";
export const APP_TAGLINE =
	"Professional PPF & window tint cutting software. No install required.";
export const APP_URL = import.meta.env.VITE_APP_URL ?? "https://omniplot.app";
export const SUPPORT_EMAIL = "support@omniplot.app";

// ─── Tier limits ──────────────────────────────
export const TIER_LIMITS = {
	free: { cutsPerMonth: 1, cutsPerDay: null, seats: 1 },
	lite: { cutsPerMonth: null, cutsPerDay: 1, seats: 1 },
	pro:  { cutsPerMonth: null, cutsPerDay: null, seats: 1 },
} as const;

// ─── Shop plan limits ─────────────────────────
export const SHOP_PLAN_LIMITS: Record<ShopPlan, {
	seats: number;
	cutsPerDay: null;
	cutsPerMonth: null;
	customPatterns: boolean;
	aiAssist: boolean;
	prioritySupport: boolean;
}> = {
	starter: { seats: 3,  cutsPerDay: null, cutsPerMonth: null, customPatterns: false, aiAssist: false, prioritySupport: false },
	team:    { seats: 10, cutsPerDay: null, cutsPerMonth: null, customPatterns: true,  aiAssist: false, prioritySupport: true  },
	studio:  { seats: 25, cutsPerDay: null, cutsPerMonth: null, customPatterns: true,  aiAssist: true,  prioritySupport: true  },
};

// ─── Shop pricing plans ───────────────────────
export interface ShopPricingPlan {
	id: ShopPlan;
	name: string;
	price: number;
	yearlyPrice: number;
	seats: number;
	description: string;
	features: string[];
	stripePriceId: string;
	stripeYearlyPriceId: string;
	popular?: boolean;
}

export const SHOP_PRICING_PLANS: ShopPricingPlan[] = [
	{
		id: "starter",
		name: "Starter",
		price: 149,
		yearlyPrice: 124,
		seats: 3,
		description: "One subscription for a small crew.",
		features: [
			"3 tech logins",
			"Unlimited cuts for all seats",
			"Full pattern library",
			"HPGL / SVG / DXF export",
			"Auto-nesting optimizer",
			"Shared job history",
		],
		stripePriceId: import.meta.env.VITE_STRIPE_SHOP_STARTER_MONTHLY ?? "",
		stripeYearlyPriceId: import.meta.env.VITE_STRIPE_SHOP_STARTER_YEARLY ?? "",
	},
	{
		id: "team",
		name: "Team",
		price: 299,
		yearlyPrice: 249,
		seats: 10,
		description: "For growing shops with multiple bays.",
		features: [
			"10 tech logins",
			"Unlimited cuts for all seats",
			"Everything in Starter",
			"Custom pattern uploads",
			"Priority support",
			"PDF export",
		],
		stripePriceId: import.meta.env.VITE_STRIPE_SHOP_TEAM_MONTHLY ?? "",
		stripeYearlyPriceId: import.meta.env.VITE_STRIPE_SHOP_TEAM_YEARLY ?? "",
		popular: true,
	},
	{
		id: "studio",
		name: "Studio",
		price: 499,
		yearlyPrice: 416,
		seats: 25,
		description: "High-volume shops and franchises.",
		features: [
			"25 tech logins",
			"Unlimited cuts for all seats",
			"Everything in Team",
			"AI pattern fit assist",
			"Dedicated account manager",
			"Volume discounts on patterns",
		],
		stripePriceId: import.meta.env.VITE_STRIPE_SHOP_STUDIO_MONTHLY ?? "",
		stripeYearlyPriceId: import.meta.env.VITE_STRIPE_SHOP_STUDIO_YEARLY ?? "",
	},
];

// ─── Pricing plans ────────────────────────────
export const PRICING_PLANS: PricingPlan[] = [
	{
		id: "free",
		name: "Free",
		price: 0,
		yearlyPrice: 0,
		description: "Sample the full pattern library risk-free.",
		features: [
			"1 cut per 30 days",
			"Full pattern library access",
			"HPGL / SVG / DXF export",
			"Any plotter, any device",
			"Auto-nesting preview",
		],
		limits: {
			cutsPerDay: null,
			cutsPerMonth: 1,
			seats: 1,
			customPatterns: false,
			aiAssist: false,
			prioritySupport: false,
			exportFormats: ["hpgl", "svg"],
		},
		stripePriceId: "",
		stripeYearlyPriceId: "",
	},
	{
		id: "lite",
		name: "Lite",
		price: 29,
		yearlyPrice: 24,
		description: "For installers doing a few jobs a day.",
		features: [
			"1 cut per day",
			"Everything in Free",
			"Auto-nesting optimizer",
			"Cut history & job log (90 days)",
			"Web Serial plotter control",
			"1 seat",
		],
		limits: {
			cutsPerDay: 1,
			cutsPerMonth: null,
			seats: 1,
			customPatterns: false,
			aiAssist: false,
			prioritySupport: false,
			exportFormats: ["hpgl", "svg", "dxf"],
		},
		stripePriceId: import.meta.env.VITE_STRIPE_LITE_MONTHLY,
		stripeYearlyPriceId: import.meta.env.VITE_STRIPE_LITE_YEARLY,
		popular: true,
		badge: "Most popular",
	},
	{
		id: "pro",
		name: "Pro",
		price: 79,
		yearlyPrice: 66,
		description: "For busy shops and professional installers.",
		features: [
			"Unlimited cuts",
			"Everything in Lite",
			"AI pattern fit assist",
			"Custom pattern uploads",
			"Full job history",
			"Priority support",
		],
		limits: {
			cutsPerDay: null,
			cutsPerMonth: null,
			seats: 1,
			customPatterns: true,
			aiAssist: true,
			prioritySupport: true,
			exportFormats: ["hpgl", "svg", "dxf", "pdf"],
		},
		stripePriceId: import.meta.env.VITE_STRIPE_PRO_MONTHLY,
		stripeYearlyPriceId: import.meta.env.VITE_STRIPE_PRO_YEARLY,
	},
];

// ─── Default materials ────────────────────────
// Roll height = 1200" (100 feet). Displayed area auto-fits to placed items.
export const DEFAULT_MATERIALS: MaterialSheet[] = [
	// ── PPF rolls (60" wide) ──────────────────────
	{
		id: "stek-dynoshield-60",
		name: "STEK DYNOShield 60\"",
		widthInches: 60,
		heightInches: 1200,
		manufacturer: "STEK",
		sku: "DSH-60",
	},
	{
		id: "xpel-ultimate-60",
		name: "XPEL Ultimate Plus 60\"",
		widthInches: 60,
		heightInches: 1200,
		manufacturer: "XPEL",
		sku: "ULT+-60",
	},
	{
		id: "llumar-platinum-60",
		name: "LLumar Platinum PPF 60\"",
		widthInches: 60,
		heightInches: 1200,
		manufacturer: "LLumar",
		sku: "PT-60",
	},
	{
		id: "3m-scotchgard-60",
		name: "3M Scotchgard Pro 60\"",
		widthInches: 60,
		heightInches: 1200,
		manufacturer: "3M",
		sku: "SGP-60",
	},
	{
		id: "suntek-ultra-60",
		name: "SunTek Ultra PPF 60\"",
		widthInches: 60,
		heightInches: 1200,
		manufacturer: "SunTek",
		sku: "UPF-60",
	},
	{
		id: "kavaca-ceramic-60",
		name: "KAVACA Ceramic-Coated 60\"",
		widthInches: 60,
		heightInches: 1200,
		manufacturer: "KAVACA",
		sku: "CC-60",
	},
	// ── Window tint rolls ─────────────────────────
	{
		id: "tint-20",
		name: "Tint Roll 20\" × 100ft",
		widthInches: 20,
		heightInches: 1200,
		manufacturer: "Generic",
		sku: "TINT-20",
	},
	{
		id: "tint-24",
		name: "Tint Roll 24\" × 100ft",
		widthInches: 24,
		heightInches: 1200,
		manufacturer: "Generic",
		sku: "TINT-24",
	},
	{
		id: "tint-36",
		name: "Tint Roll 36\" × 100ft",
		widthInches: 36,
		heightInches: 1200,
		manufacturer: "Generic",
		sku: "TINT-36",
	},
	{
		id: "tint-40",
		name: "Tint Roll 40\" × 100ft",
		widthInches: 40,
		heightInches: 1200,
		manufacturer: "Generic",
		sku: "TINT-40",
	},
	{
		id: "tint-60",
		name: "Tint Roll 60\" × 100ft",
		widthInches: 60,
		heightInches: 1200,
		manufacturer: "Generic",
		sku: "TINT-60",
	},
	{
		id: "custom",
		name: "Custom / Other",
		widthInches: 60,
		heightInches: 1200,
		manufacturer: "Custom",
		sku: "",
	},
];

// ─── Known plotter presets ────────────────────
// Specs sourced from official manufacturer documentation and driver packages.
// maxMediaWidthMm = confirmed cutting zone width (not media load width).
// usbVids = USB Vendor IDs from USB-IF registry for auto-identification.
export const PLOTTER_PRESETS: PlotterPreset[] = [
	{
		// Fallback for any HPGL-compatible cutter. Conservative defaults.
		name: "Generic HPGL Cutter",
		manufacturer: "Generic",
		model: "HPGL",
		protocol: "hpgl",
		bladeForce: 65,
		cuttingSpeed: 400,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 1524, // 60" — set to your plotter's actual max
	},
	{
		// Roland CAMM-1 GS-24: desktop 24" professional vinyl cutter.
		// Max cutting width 609.6mm (24.0"). Max force ~250g. Max speed 500 mm/s.
		// Baud: 9600 default (selectable to 38400 in Roland driver settings).
		// Roland uses a non-standard HPGL extension: VS in mm/s (not cm/s).
		name: "Roland CAMM-1 GS-24",
		manufacturer: "Roland",
		model: "GS-24",
		protocol: "roland",
		bladeForce: 80,
		cuttingSpeed: 450,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 609,
		usbVids: [0x09CA], // Roland DG Corp USB VID
	},
	{
		// Roland CAMM-1 GR4-640: wide-format professional series, 64" media.
		// Max cutting width 1625mm (64.0"). Max force ~600g. Max speed 500 mm/s.
		name: "Roland CAMM-1 GR4-640",
		manufacturer: "Roland",
		model: "GR4-640",
		protocol: "roland",
		bladeForce: 90,
		cuttingSpeed: 500,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 1625,
		usbVids: [0x09CA],
	},
	{
		// Graphtec CE7000-130: professional 51" vinyl cutter.
		// Max cutting width 1293mm (50.9"). Max force 300g. Max speed 600 mm/s.
		// Uses standard HPGL (not HPGL/2). Baud 9600 by default.
		name: "Graphtec CE7000-130",
		manufacturer: "Graphtec",
		model: "CE7000-130",
		protocol: "hpgl",
		bladeForce: 70,
		cuttingSpeed: 600,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 1293,
		usbVids: [0x0B4B], // Graphtec Corp USB VID
	},
	{
		// Graphtec FC9000-160: high-end 63" flatbed/roll cutter.
		// Max cutting width 1580mm (62.2"). Max force 600g. Max speed 1000 mm/s.
		// Requires HPGL/2 (FC command for force, VS in cm/s).
		name: "Graphtec FC9000-160",
		manufacturer: "Graphtec",
		model: "FC9000-160",
		protocol: "hpgl2",
		bladeForce: 90,
		cuttingSpeed: 900,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 1580,
		usbVids: [0x0B4B],
	},
	{
		// Mimaki CJV300-130: print-and-cut system, 54" media.
		// Max cutting width 1387mm (54.6"). Force 0.6 N max. Speed 500 mm/s.
		// Used in shops that print+cut PPF/tint on the same unit.
		name: "Mimaki CJV300-130",
		manufacturer: "Mimaki",
		model: "CJV300-130",
		protocol: "hpgl",
		bladeForce: 70,
		cuttingSpeed: 500,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 1387,
	},
	{
		// USCutter MH-871: 34" entry-level vinyl cutter. Common in budget shops.
		// Max cutting width 870mm (34.25"). Force ~350g. Speed 100–800 mm/s.
		// Uses CH340G USB-serial chip (no unique VID to match on).
		name: "USCutter MH-871",
		manufacturer: "USCutter",
		model: "MH-871",
		protocol: "hpgl",
		bladeForce: 60,
		cuttingSpeed: 300,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 870,
	},
	{
		// VEVOR vinyl cutter (28" mid-range). Common in small shops and hobbyist use.
		// Max cutting width 720mm (28.3"). Uses CP2102 USB-serial, no unique VID.
		name: "VEVOR Vinyl Cutter 28\"",
		manufacturer: "VEVOR",
		model: "Vinyl Cutter 28",
		protocol: "hpgl",
		bladeForce: 60,
		cuttingSpeed: 350,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 720,
	},
	{
		// VEVOR vinyl cutter (53" wide-format). Fits most PPF rolls.
		// Max cutting width 1346mm (53.0"). Force ~500g. Speed up to 500 mm/s.
		// Uses CP2102/CH340 USB-serial chip — no unique USB VID to match on.
		name: "VEVOR Vinyl Cutter 53\"",
		manufacturer: "VEVOR",
		model: "Vinyl Cutter 53",
		protocol: "hpgl",
		bladeForce: 70,
		cuttingSpeed: 500,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 1346,
	},
	{
		// Summa S2 D160: Belgian-made professional 63" plotter.
		// Max cutting width 1580mm (62.2"). Max force 600g. Max speed 700 mm/s.
		// Uses HPGL/2 (DMPL/Summa protocol variant).
		name: "Summa S2 D160",
		manufacturer: "Summa",
		model: "S2 D160",
		protocol: "hpgl2",
		bladeForce: 85,
		cuttingSpeed: 700,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 1580,
	},
	{
		// Silhouette Cameo 4 Pro: 24" consumer/prosumer cutter.
		// WARNING: Uses a proprietary USB HID protocol, NOT standard HPGL.
		// HPGL output will NOT work over native USB. Requires Silhouette Studio
		// or a third-party HPGL→Silhouette bridge (e.g. Inkscape plugin).
		// Network or Cut Agent TCP may work if you route through a bridge.
		name: "Silhouette Cameo 4 Pro",
		manufacturer: "Silhouette",
		model: "Cameo 4 Pro",
		protocol: "gpgl",
		bladeForce: 30,
		cuttingSpeed: 200,
		passes: 1,
		baudRate: 9600,
		maxMediaWidthMm: 609,
		usbVids: [0x0B4D], // Silhouette America USB VID
		compatNote: "Uses proprietary USB protocol — HPGL requires a bridge app or network mode.",
	},
];

// ─── Default tint films ───────────────────────
export const DEFAULT_TINT_FILMS: TintFilm[] = [
	{
		id: "llumar-atr-35",
		name: "LLumar ATR Ceramic",
		manufacturer: "LLumar",
		sku: "ATR-35-60",
		widthInches: 60,
		heightInches: 300,
		vlt: 35,
		series: "Ceramic",
		irRejection: 98,
	},
	{
		id: "3m-crystalline-35",
		name: "3M Crystalline 40",
		manufacturer: "3M",
		sku: "CR-40-60",
		widthInches: 60,
		heightInches: 300,
		vlt: 40,
		series: "Ceramic",
		irRejection: 97,
	},
	{
		id: "xpel-xr-plus-35",
		name: "XPEL XR Plus Ceramic",
		manufacturer: "XPEL",
		sku: "XR+-35-60",
		widthInches: 60,
		heightInches: 300,
		vlt: 35,
		series: "Ceramic",
		irRejection: 98,
	},
	{
		id: "formula-one-pinnacle-35",
		name: "FormulaOne Pinnacle",
		manufacturer: "FormulaOne",
		sku: "PIN-35-60",
		widthInches: 60,
		heightInches: 300,
		vlt: 35,
		series: "Ceramic",
		irRejection: 95,
	},
	{
		id: "suntek-cir-35",
		name: "SunTek CIR Ceramic",
		manufacturer: "SunTek",
		sku: "CIR-35-60",
		widthInches: 60,
		heightInches: 300,
		vlt: 35,
		series: "Ceramic",
		irRejection: 96,
	},
	{
		id: "llumar-atr-20",
		name: "LLumar ATR Ceramic 20%",
		manufacturer: "LLumar",
		sku: "ATR-20-60",
		widthInches: 60,
		heightInches: 300,
		vlt: 20,
		series: "Ceramic",
		irRejection: 98,
	},
	{
		id: "3m-fx-premium-15",
		name: "3M FX Premium 15%",
		manufacturer: "3M",
		sku: "FXP-15-60",
		widthInches: 60,
		heightInches: 300,
		vlt: 15,
		series: "Carbon",
		irRejection: 60,
	},
	{
		id: "custom-tint",
		name: "Custom / Other",
		manufacturer: "Custom",
		sku: "",
		widthInches: 60,
		heightInches: 300,
		vlt: 35,
		series: "Custom",
	},
];

// ─── Window tint zone groups (for library sidebar) ──
export const TINT_ZONE_GROUPS = [
	{ label: "All zones",  value: "all" },
	{ label: "Windshield", value: "windshield" },
	{ label: "Side Windows", value: "side" },
	{ label: "Rear Window", value: "rear" },
	{ label: "Sunroof / Moonroof", value: "sunroof" },
	{ label: "Quarter / Vent", value: "quarter" },
] as const;

// ─── Canvas defaults ──────────────────────────
export const DEFAULT_CANVAS_STATE = {
	zoom: 100,
	panX: 0,
	panY: 0,
	tool: "select" as const,
	showGrid: true,
	showRulers: true,
	snapToGrid: false,
	gridSizeInches: 0.5,
};

// ─── HPGL constants ───────────────────────────
export const HPGL_UNITS_PER_INCH = 1016; // HP-GL standard: 1016 plotter units = 1 inch
export const HPGL_UNITS_PER_MM = 40; // 40 plotter units = 1 mm

// ─── Navigation ───────────────────────────────
export const APP_NAV = [
	{ label: "Studio",   href: "/studio",        icon: "scissors" },
	{ label: "Library",  href: "/library",        icon: "library"  },
	{ label: "Jobs",     href: "/jobs",           icon: "briefcase"},
	{ label: "Plotters", href: "/plotter",        icon: "plotter"  },
	{ label: "Agent",    href: "/studio/agent",   icon: "terminal" },
	{ label: "Settings", href: "/settings",       icon: "settings" },
] as const;

export const MARKETING_NAV = [
	{ label: "Features",    href: "/features" },
	{ label: "Solutions",   href: "/solutions/vehicle" },
	{ label: "Pricing",     href: "/pricing" },
	{ label: "Insights",    href: "/insights" },
	{ label: "Agent",       href: "/agent" },
	{ label: "FAQ",         href: "/faq" },
	{ label: "Changelog",   href: "/changelog" },
	{ label: "About",       href: "/about" },
	{ label: "Support",     href: "/support" },
] as const;

export const SOLUTIONS_NAV = [
	{ label: "Vehicle",     href: "/solutions/vehicle" },
	{ label: "Residential", href: "/solutions/residential" },
	{ label: "Commercial",  href: "/solutions/commercial" },
	{ label: "Custom",      href: "/solutions/custom" },
] as const;

// ─── Feature list (shared: homepage + /features) ──
export const FEATURES = [
	{
		icon: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
		title: "Any plotter, any brand",
		desc: "Export to universal HPGL (.plt) format. Roland, Graphtec, Mimaki, USCutter, VEVOR — if it cuts, OmniPlot drives it.",
		detail: "OmniPlot talks directly to your cutter over serial or network, or exports a portable HPGL/SVG/DXF file for any RIP software you already run. No brand lock-in, no proprietary driver installs, no dongles.",
	},
	{
		icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
		title: "Unlimited patterns",
		desc: "Professionally measured templates for every major make and model — PPF zones and window tint zones. New vehicles added weekly on request.",
		detail: "Beyond the vehicle catalog, upload and save your own patterns for residential, commercial, and custom jobs — gaskets, signage, apparel, device skins, and more. Every pattern you save is private to your shop unless you choose to submit it to the public library.",
	},
	{
		icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
		title: "Auto-nesting optimizer",
		desc: "Maximize material efficiency automatically. Our skyline bin-packing algorithm places pieces with minimal waste.",
		detail: "Multiple sort-order trials plus a pairwise swap improvement pass squeeze more parts onto every roll, with real shoelace-formula efficiency reporting — not a rough bounding-box estimate.",
	},
	{
		icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
		title: "No install. Ever.",
		desc: "Runs in any browser on desktop, tablet, or your shop iPad. Zero drivers. Zero software. Just open and cut.",
		detail: "The optional lightweight cutting agent bridges your browser to serial/USB plotters when needed — everything else, from design to nesting to export, runs entirely client-side in the browser you already have open.",
	},
	{
		icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
		title: "Secure & private",
		desc: "Jobs stored securely in Firebase. Patterns served from Google Cloud CDN. We never share your data.",
		detail: "Team and shop accounts get role-based access control, so techs see only what they need while owners keep full visibility across jobs, patterns, and plotter fleet.",
	},
	{
		icon: "M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22",
		title: "Open format compatible",
		desc: "Export to SVG and DXF for use in Inkscape, FlexiSIGN, or AutoCAD. Your data is always yours.",
		detail: "No proprietary file lock-in. Every pattern and cut job can be exported to a standard format, so your library stays portable even if your toolchain changes.",
	},
	{
		icon: "M22 12h-4l-3 9L9 3l-3 9H2",
		title: "Plotter diagnostics",
		desc: "Built-in error classification for serial, network, and agent connections — with step-by-step recovery guidance.",
		detail: "When a cut fails, OmniPlot classifies the failure (connection drop, buffer overrun, out-of-material, and more) and walks the operator through numbered recovery steps, with auto-escalation to OmniPlot support for hard failures.",
	},
] as const;

export const ADMIN_NAV = [
	{ label: "Overview",  href: "/admin",            icon: "layout-dashboard" },
	{ label: "Users",     href: "/admin/users",       icon: "users" },
	{ label: "Patterns",  href: "/admin/patterns",    icon: "vector-bezier" },
	{ label: "Insights",  href: "/admin/insights",    icon: "book-open" },
	{ label: "Plotters",  href: "/admin/plotters",    icon: "printer" },
	{ label: "Analytics", href: "/admin/analytics",   icon: "chart-bar" },
	{ label: "Products",  href: "/admin/products",    icon: "package" },
	{ label: "Coupons",   href: "/admin/coupons",     icon: "tag" },
	{ label: "Reports",   href: "/admin/reports",     icon: "flag" },
	{ label: "Emails",    href: "/admin/emails",      icon: "mail" },
	{ label: "Billing",   href: "/admin/billing",     icon: "receipt" },
	{ label: "Settings",  href: "/admin/settings",    icon: "settings" },
] as const;

// ─── Insight categories ───────────────────────
export const INSIGHT_CATEGORIES = [
	{ value: "ppf",         label: "PPF",           badge: "brand"   },
	{ value: "window-tint", label: "Window Tint",   badge: "lite"    },
	{ value: "guides",      label: "Guides",        badge: "success" },
	{ value: "vehicles",    label: "Vehicles",      badge: "warning" },
] as const;

// ─── FAQ content ──────────────────────────────
export const FAQ_ITEMS = [
	{
		category: "Getting Started",
		items: [
			{
				q: "Do I need to install anything?",
				a: "No. OmniPlot is fully web-based and runs in any modern browser on any device — desktop, tablet, or your shop iPad. No drivers, no software installs, ever.",
			},
			{
				q: "How do I create an account?",
				a: "Three ways: sign in with Google, receive a one-click magic link to your email, or verify via SMS code to your phone number. No password is ever created or stored — all three methods are passwordless.",
			},
			{
				q: "Which plotters does OmniPlot work with?",
				a: "Any plotter that accepts HPGL commands — Roland, Graphtec, Mimaki, USCutter, Summa, VEVOR, and hundreds of others. Export a standard .plt file and send it via your existing plotter software, connect directly via Web Serial (Chrome/Edge), or use our lightweight Cut Agent.",
			},
			{
				q: "How do I send a cut file to my plotter?",
				a: "Three ways: (1) Download the .plt file and open it in your plotter's existing software. (2) Use Web Serial in Chrome/Edge to connect directly — no install. (3) Run our tiny Cut Agent (a small background app for Windows/Mac/Linux) for automated sending.",
			},
			{
				q: "Can I use OmniPlot on my shop tablet or phone?",
				a: "Yes. The studio is fully responsive and works on tablets and phones. For cutting, you'll need a device connected to (or on the same network as) your plotter — but you can design on any device and send from another.",
			},
		],
	},
	{
		category: "Patterns & Library",
		items: [
			{
				q: "How many vehicle patterns do you have?",
				a: "We're actively growing the library. The most popular 200+ vehicles are available at launch. We add new vehicles weekly and prioritize requests — most requested models are turned around within 72 hours.",
			},
			{
				q: "What if my vehicle isn't in the library?",
				a: "Submit a request from the Library page. Pro and Shop plan users can also upload their own custom SVG patterns directly for vehicles or zones we don't yet cover.",
			},
			{
				q: "Are patterns available for window tint as well as PPF?",
				a: "Yes. OmniPlot covers both PPF and window tint in the same studio. Window tint patterns include windshield, rear window, all side windows, sunroof/moonroof, and quarter/vent windows. Tint film materials (LLumar, 3M, XPEL, SunTek, FormulaOne, and more) are available in the material selector alongside PPF rolls.",
			},
			{
				q: "How accurate are the patterns?",
				a: "All patterns are digitized from OEM vehicle measurements and installer-verified. They include recommended offsets and wrap-edge allowances, and each pattern is versioned so you always know exactly what revision you're cutting.",
			},
		],
	},
	{
		category: "Teams & Shops",
		items: [
			{
				q: "What is a Shop plan?",
				a: "Shop plans (Starter, Team, Studio) let multiple technicians share one subscription. Each tech gets their own login. Billing is consolidated under the shop owner's account. Shop plans include unlimited cuts for all seats and start at $149/mo for 3 seats.",
			},
			{
				q: "How do seats work?",
				a: "Each active member in your shop counts as one seat. Starter supports 3, Team supports 10, and Studio supports 25. You can invite or remove members at any time from Settings → Team. Usage resets at the seat level, not the shop level.",
			},
			{
				q: "How do I invite team members?",
				a: "Go to Settings → Team → Invite a team member. Generate a shareable link (valid for 7 days) and send it to your tech. They'll sign up with their own account and be added to your shop automatically. You can assign them a Technician or Manager role.",
			},
			{
				q: "Can managers invite people or only owners?",
				a: "Owners and Managers can both generate invite links and change member roles (except they can't elevate someone to Owner). Only the Owner can change the shop's subscription plan.",
			},
			{
				q: "What happens if someone opens my account on another device?",
				a: "OmniPlot enforces one active session per account. If your account is opened on a second device, the first session is immediately signed out. This applies to individual accounts. Shop members each have their own account, so this limit applies per-person, not per-shop.",
			},
		],
	},
	{
		category: "Pricing & Billing",
		items: [
			{
				q: 'What counts as a "cut"?',
				a: "A cut is counted each time you send a job to your plotter or export a PLT/cut file. Saving a job, editing, previewing, or downloading SVGs for reference does not count.",
			},
			{
				q: "What are the individual plans?",
				a: "Free: 1 cut per 30 days, no credit card required. Lite ($29/mo): 1 cut per day, full export formats. Pro ($79/mo): unlimited cuts, AI pattern assist, custom pattern uploads, priority support. Annual billing saves ~20% on Lite and Pro.",
			},
			{
				q: "Is there a free trial?",
				a: "The Free plan is your trial — use the full pattern library, export files, and cut once per 30 days with no credit card required. Upgrade to Lite or Pro whenever you're ready for more volume.",
			},
			{
				q: "How do I manage or cancel my subscription?",
				a: "Go to Settings → Billing → Manage billing. This opens the Stripe billing portal where you can change your plan, update your payment method, download invoices, or cancel. Cancellations take effect at the end of the current billing period.",
			},
			{
				q: "Do you offer annual billing?",
				a: "Yes. Annual billing saves ~20% on all individual and shop plans. Switch to annual at any time from Settings → Billing.",
			},
			{
				q: "How does billing work for shops?",
				a: "When you create a shop, you're taken to Stripe Checkout to subscribe to the Starter, Team, or Studio plan. The shop owner's payment method is charged. Individual techs in the shop have no billing relationship — their access flows through the shop subscription.",
			},
		],
	},
	{
		category: "Technical",
		items: [
			{
				q: "What export formats are supported?",
				a: "HPGL (.plt) — universal plotter format. SVG — for Inkscape, FlexiSIGN, Illustrator. DXF — for AutoCAD-compatible tools. PDF (Pro and Shop plans) — for archival and sharing.",
			},
			{
				q: "Does OmniPlot work offline?",
				a: "Not currently — an internet connection is required for the pattern library and account sync. Local/offline mode is on the roadmap.",
			},
			{
				q: "How is my data stored?",
				a: "Accounts are managed through Firebase Authentication (Google Cloud). Job history and settings are stored in Firestore. Pattern files are served from Google Cloud Storage. Billing is handled by Stripe. We never sell your data or share it with third parties outside of these infrastructure providers.",
			},
			{
				q: "What browsers are supported?",
				a: "Chrome and Edge are recommended and required for Web Serial plotter control. Firefox and Safari work for design and file export, but direct plotter connection via Web Serial is Chrome/Edge only.",
			},
			{
				q: "Can I use OmniPlot on multiple devices at the same time?",
				a: "Each individual account supports one active session at a time. Opening your account on a second device automatically signs out the first. Shop team members each have their own account, so multiple techs can be active simultaneously — each one counts as a separate seat.",
			},
		],
	},
] as const;

// ─── Changelog ────────────────────────────────
export const CHANGELOG = [
	{
		version: "1.9.0",
		date: "2026-05-28",
		label: "Cut Agent 1.2",
		changes: [
			{
				type: "feature",
				text: "Cancel mid-job — an Abort button now appears while a cut is in progress. Click it and the plotter finishes its current move, stops, and saves a resume point so you can pick up where you left off.",
			},
			{
				type: "feature",
				text: "Cut Agent v1.2.0 — the serial port now stays open between patterns, eliminating a class of mid-job plotter resets. Previously, opening and closing the port between each pattern could trigger a hardware reset on some devices.",
			},
			{
				type: "improvement",
				text: "Patterns are now sent one at a time to the cutter with automatic pacing — the app waits for each piece to finish cutting before sending the next. This fixes the long-standing issue where only the first pattern would cut and the rest were skipped.",
			},
			{
				type: "improvement",
				text: "Auto-probe port error improved — if the serial port is left locked after a failed probe attempt, a \"Release & Retry\" button now releases it from the agent in one click instead of requiring an agent restart.",
			},
			{
				type: "improvement",
				text: "Agent stop button on the Agent page now shows a spinner and disables while the agent is shutting down, preventing double-clicks.",
			},
			{
				type: "fix",
				text: "macOS agent download temporarily shows \"Coming Soon\" while we prepare a signed build. Windows and Linux are fully available.",
			},
		],
	},
	{
		version: "1.8.0",
		date: "2026-05-27",
		label: "Plotter Connection",
		changes: [
			{
				type: "improvement",
				text: "USB connection now restores automatically when navigating between pages — no more having to reconnect every time you leave the Studio.",
			},
			{
				type: "improvement",
				text: "\"Set Active\" on the Plotters page now fully restores the connection type (USB, Agent, Network) in the Studio, not just the plotter settings.",
			},
			{
				type: "improvement",
				text: "Roll width and material used are now shown larger and more clearly on the canvas — both numbers are labeled so it's obvious which is the roll size and which is how much you've used.",
			},
			{
				type: "improvement",
				text: "A reminder now appears above the Cut button whenever a live connection is active: your cutter must be in Manual or Offline mode on its front panel before it will accept jobs.",
			},
			{
				type: "feature",
				text: "Pre-job flush — an abort sequence is sent to the plotter before every new job to clear any leftover state from a previous interrupted cut. Also available as a standalone Flush button on each plotter card.",
			},
			{
				type: "feature",
				text: "Cut job history in the Jobs page and Plotter page updates in real time — completed and failed jobs appear immediately without needing a page refresh.",
			},
		],
	},
	{
		version: "1.7.0",
		date: "2026-05-26",
		label: "Fleet Management",
		changes: [
			{
				type: "feature",
				text: "Plotters page — dedicated fleet command center for registering, monitoring, and managing all your cutting devices. Includes live job queue, 4-stat dashboard, per-device test cut, and connection-specific troubleshooting for failed jobs.",
			},
			{
				type: "feature",
				text: "Live agent log stream — the Plotters page opens an SSE connection to the Cut Agent and surfaces real-time events (cuts sent, errors, port activity) in a scrollable log feed.",
			},
			{
				type: "feature",
				text: "Plotter registration with CRUD — add and remove plotters stored in Firestore; supports Cut Agent, USB Serial, Network TCP, and Download connection types with USB auto-detect and local network scan.",
			},
			{
				type: "improvement",
				text: "Shared Cut Agent state — agent online/offline status is lifted into a global reactive store so the Plotters page, Agent page, and Studio all reflect live connectivity without independent polling.",
			},
			{
				type: "improvement",
				text: "Plotter settings removed from the Settings page and consolidated into the dedicated Plotters route.",
			},
		],
	},
	{
		version: "1.6.0",
		date: "2026-05-25",
		label: "Billing & Admin",
		changes: [
			{
				type: "feature",
				text: "Admin billing costs page — live view of platform-level Stripe charges, payouts, and connected account fees in one place.",
			},
			{
				type: "feature",
				text: "\"Refresh for updates\" banner — when a new deployment is detected the app prompts users to reload instead of silently diverging.",
			},
			{
				type: "improvement",
				text: "Admin billing refactored into a dedicated Products page with cleaner plan management and Stripe metadata sync.",
			},
			{
				type: "improvement",
				text: "Stripe connected account wiring updated — billing products now sync correctly to the platform's connected account.",
			},
			{
				type: "improvement",
				text: "OmniPlot logo and favicon updated to the new SG mark; favicon served from /favicon.svg with SVG type hint.",
			},
			{
				type: "fix",
				text: "Admin dashboard no longer crashes when a subscription tier has zero users — all tier counts are now initialised to 0 before aggregation.",
			},
			{
				type: "fix",
				text: "Firebase Google Sign-In restored on production: corrected missing VITE_FIREBASE_* environment variables and removed the X-Frame-Options: DENY header that was blocking the Firebase auth iframe.",
			},
		],
	},
	{
		version: "1.5.0",
		date: "2026-05-24",
		label: "Cut Agent",
		changes: [
			{
				type: "feature",
				text: "OmniPlot Cut Agent v1.0.1 — lightweight Go daemon (9 MB) that bridges any browser to your USB/serial cutter. Works in Firefox, Safari, and every other browser, no Chrome required.",
			},
			{
				type: "feature",
				text: "No-Fit Polygon (NFP) nesting — true polygon-based collision detection replaces bounding-box estimates, yielding tighter fits and less wasted film.",
			},
			{
				type: "feature",
				text: "Agent download page at /agent with auto platform detection (Windows, macOS Apple Silicon, macOS Intel, Linux) and a full connection-method comparison.",
			},
			{
				type: "feature",
				text: "Network TCP connection — OmniPlot now proxies HPGL to ethernet plotters (HP JetDirect port 9100, Graphtec network models) server-side.",
			},
			{
				type: "improvement",
				text: "Protocol-aware HPGL output: speed command emits VS in mm/s for Roland and cm/s for Graphtec/GPGL; force command uses FC (0–38) for HPGL/2 and FS for generic HPGL.",
			},
			{
				type: "improvement",
				text: "Canvas now renders each pattern at its actual SVG bounding box — 1:1 scale with the roll, computed via getBBox() and cached per path.",
			},
			{
				type: "improvement",
				text: "Inter-pattern spacing reduced from 0.1\" to 0.05\", and right-side roll buffer trimmed to 1\" past the last piece.",
			},
			{
				type: "fix",
				text: "Overcut now walks the actual path geometry instead of jumping to the third vertex, giving accurate overcut distance on all pattern shapes.",
			},
		],
	},
	{
		version: "1.3.0",
		date: "2026-05-23",
		label: "AI Nesting",
		changes: [
			{
				type: "feature",
				text: "AI Nesting — 7-pass skyline optimizer: sort heuristics, random restarts, per-piece rotation, pair-rotation combinations, swap, insertion, and NFP-seeded placement. Waste % displayed live on canvas.",
			},
			{
				type: "feature",
				text: "Support center page with contact form and categorized FAQ routing.",
			},
			{
				type: "feature",
				text: "Error page with contextual messaging and navigation recovery.",
			},
			{
				type: "improvement",
				text: "Admin dashboard, analytics, users, and settings panels fully redesigned for clarity and density.",
			},
			{
				type: "improvement",
				text: "Jobs page redesigned with cleaner status indicators and job detail layout.",
			},
			{
				type: "improvement",
				text: "Sitemap and robots.txt added for SEO.",
			},
		],
	},
	{
		version: "1.2.0",
		date: "2026-05-22",
		label: "Auth & Billing",
		changes: [
			{
				type: "feature",
				text: "Firebase Authentication — email/password sign-up, email verification, and session management.",
			},
			{
				type: "feature",
				text: "Stripe billing — checkout sessions, customer portal, and webhook handling for subscription lifecycle events.",
			},
			{
				type: "feature",
				text: "Team invitations — owners can invite members via shareable join links with role assignment.",
			},
			{
				type: "feature",
				text: "Settings page overhauled: profile editing, team member management, and direct billing portal access.",
			},
			{
				type: "feature",
				text: "About, Privacy, and Terms pages with full content.",
			},
			{
				type: "improvement",
				text: "Pricing page redesigned with plan comparison table and upgrade modal.",
			},
		],
	},
	{
		version: "1.1.0",
		date: "2026-05-21",
		label: "Pattern Library",
		changes: [
			{
				type: "feature",
				text: "Vehicle pattern store with accurate OEM dimensions for all supported makes and models — PPF zones covering hood, fenders, bumpers, doors, rockers, mirrors, A-pillars, and headlights.",
			},
			{
				type: "feature",
				text: "PPF pattern library expanded to full PP4 format coverage.",
			},
			{
				type: "feature",
				text: "Library page redesigned: dimension display, zone filtering, and live search.",
			},
			{
				type: "feature",
				text: "Admin patterns panel with full pattern CRUD, dimension editing, and publish controls.",
			},
			{
				type: "improvement",
				text: "Nesting algorithm rewritten with result caching and swap-improvement passes, reducing layout time on large jobs.",
			},
		],
	},
	{
		version: "1.0.0",
		date: "2026-05-14",
		label: "Launch",
		changes: [
			{
				type: "feature",
				text: "Web-based PPF and window tint cutting studio — no install, no drivers, works in any modern browser.",
			},
			{
				type: "feature",
				text: "HPGL output with configurable speed, force, overcut, and protocol (HPGL / HPGL-2 / GPGL).",
			},
			{
				type: "feature",
				text: "Skyline bin-packing nesting with rotation support.",
			},
			{
				type: "feature",
				text: "Pattern library with vehicle template support and zone selection.",
			},
			{
				type: "feature",
				text: "Jobs history — every cut job saved with full HPGL payload and metadata.",
			},
			{
				type: "feature",
				text: "App shell with collapsible sidebar, light/dark mode, and responsive layout.",
			},
			{
				type: "feature",
				text: "Marketing site: landing page, pricing, FAQ, and changelog.",
			},
			{
				type: "feature",
				text: "Free, Lite, and Pro subscription tiers.",
			},
		],
	},
] as const;
