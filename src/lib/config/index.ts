// ─────────────────────────────────────────────
// OmniPlot — APP CONFIGURATION
// ─────────────────────────────────────────────
import type { PricingPlan, MaterialSheet, TintFilm, PlotterConfig, ShopPlan } from "$lib/types";

// ─── App constants ────────────────────────────
export const APP_NAME = "OmniPlot";
export const APP_TAGLINE =
	"Professional PPF & window tint cutting software. No install required.";
export const APP_URL = "https://omniplot.app";
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
export const PLOTTER_PRESETS: Partial<PlotterConfig>[] = [
	{
		name: "Generic HPGL Cutter",
		manufacturer: "Generic",
		model: "HPGL",
		protocol: "hpgl",
		bladeForce: 65,
		cuttingSpeed: 400,
		passes: 1,
	},
	{
		name: "Roland GX-500",
		manufacturer: "Roland",
		model: "GX-500",
		protocol: "hpgl",
		bladeForce: 80,
		cuttingSpeed: 500,
		passes: 1,
	},
	{
		name: "Roland GS-24",
		manufacturer: "Roland",
		model: "GS-24",
		protocol: "hpgl",
		bladeForce: 75,
		cuttingSpeed: 450,
		passes: 1,
	},
	{
		name: "Graphtec CE7000-130",
		manufacturer: "Graphtec",
		model: "CE7000-130",
		protocol: "hpgl",
		bladeForce: 70,
		cuttingSpeed: 600,
		passes: 1,
	},
	{
		name: "Graphtec FC9000-160",
		manufacturer: "Graphtec",
		model: "FC9000-160",
		protocol: "hpgl2",
		bladeForce: 90,
		cuttingSpeed: 900,
		passes: 1,
	},
	{
		name: "Mimaki CJV300",
		manufacturer: "Mimaki",
		model: "CJV300",
		protocol: "hpgl",
		bladeForce: 70,
		cuttingSpeed: 500,
		passes: 1,
	},
	{
		name: "USCutter MH Series",
		manufacturer: "USCutter",
		model: "MH Series",
		protocol: "hpgl",
		bladeForce: 60,
		cuttingSpeed: 300,
		passes: 1,
	},
	{
		name: "VEVOR Vinyl Cutter",
		manufacturer: "VEVOR",
		model: "Vinyl Cutter",
		protocol: "hpgl",
		bladeForce: 60,
		cuttingSpeed: 350,
		passes: 1,
	},
	{
		name: "Summa S2 D160",
		manufacturer: "Summa",
		model: "S2 D160",
		protocol: "hpgl2",
		bladeForce: 85,
		cuttingSpeed: 700,
		passes: 1,
	},
	{
		name: "Silhouette Cameo 4 Pro",
		manufacturer: "Silhouette",
		model: "Cameo 4 Pro",
		protocol: "gpgl",
		bladeForce: 30,
		cuttingSpeed: 200,
		passes: 1,
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
	{ label: "Studio", href: "/studio", icon: "scissors" },
	{ label: "Library", href: "/library", icon: "library" },
	{ label: "Jobs", href: "/jobs", icon: "briefcase" },
	{ label: "Settings", href: "/settings", icon: "settings" },
] as const;

export const MARKETING_NAV = [
	{ label: "Features", href: "/#features" },
	{ label: "Pricing", href: "/pricing" },
	{ label: "FAQ", href: "/faq" },
	{ label: "Changelog", href: "/changelog" },
] as const;

export const ADMIN_NAV = [
	{ label: "Overview", href: "/admin", icon: "layout-dashboard" },
	{ label: "Users", href: "/admin/users", icon: "users" },
	{ label: "Patterns", href: "/admin/patterns", icon: "vector-bezier" },
	{ label: "Analytics", href: "/admin/analytics", icon: "chart-bar" },
	{ label: "Settings", href: "/admin/settings", icon: "settings" },
] as const;

// ─── FAQ content ──────────────────────────────
export const FAQ_ITEMS = [
	{
		category: "Getting Started",
		items: [
			{
				q: "Do I need to install anything?",
				a: "No. OmniPlot is fully web-based and runs in any modern browser on any device — desktop, tablet, or your shop iPad. No drivers, no software installs.",
			},
			{
				q: "Which plotters does OmniPlot work with?",
				a: "Any plotter that accepts HPGL commands — which is virtually all of them. Roland, Graphtec, Mimaki, USCutter, Summa, VEVOR, and hundreds of others. You export a standard .plt file and send it via your existing plotter software, or connect directly via Web Serial (Chrome/Edge) or our lightweight Cut Agent.",
			},
			{
				q: "How do I send a cut file to my plotter?",
				a: "Three ways: (1) Download the .plt file and open it in your plotter's existing software. (2) Use Web Serial in Chrome/Edge to connect directly — no install. (3) Run our tiny Cut Agent (a small background app for Windows/Mac/Linux) for automated sending.",
			},
			{
				q: "Can I use OmniPlot on my shop tablet or phone?",
				a: "Yes. The studio is fully responsive and works on tablets and phones. For cutting, you'll need a device connected to (or on the same network as) your plotter, but you can design on any device and send from another.",
			},
		],
	},
	{
		category: "Patterns & Library",
		items: [
			{
				q: "How many vehicle patterns do you have?",
				a: "We're actively growing the library. Launch includes patterns for the most popular 200+ vehicles. We add new vehicles weekly and take requests — most requested models are turned around within 72 hours.",
			},
			{
				q: "What if my vehicle isn't in the library?",
				a: "Request it via the Library page and we'll add it. Pro tier users can also upload their own custom SVG patterns directly.",
			},
			{
				q: "Are patterns available for window tint as well as PPF?",
				a: "Yes. OmniPlot supports both PPF and window tint workflows. Switch between modes in the Pattern Library. Window tint patterns cover windshield, rear window, all side windows, sunroof/moonroof, and quarter/vent windows — with accurate shapes for every vehicle in the library. Tint film materials (LLumar, 3M, XPEL, SunTek, FormulaOne, and more) are available alongside PPF rolls in the material selector.",
			},
			{
				q: "How accurate are the patterns?",
				a: "All patterns are digitized from OEM vehicle measurements and installer-verified. They include recommended offsets and wrap-edge allowances. Each pattern is versioned so you always know what revision you're working with.",
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
				q: "Can I cancel anytime?",
				a: "Yes. Cancel in Settings → Billing with one click. Your plan stays active until the end of the current billing period, then reverts to Free.",
			},
			{
				q: "Is there a free trial?",
				a: "Yes — the Free plan is your trial. Use the full pattern library, export files, and cut once per 30 days with no credit card required. Upgrade to Lite or Pro when you're ready to cut more.",
			},
			{
				q: "Do you offer annual billing?",
				a: "Yes. Annual billing saves ~20% (Lite: $24/mo billed annually; Pro: $66/mo). Switch anytime in Settings → Billing.",
			},
		],
	},
	{
		category: "Technical",
		items: [
			{
				q: "What export formats are supported?",
				a: "HPGL (.plt) — works with all cutters. SVG — for Inkscape, FlexiSIGN, Illustrator. DXF — for AutoCAD-compatible tools. PDF (Pro) — for archival.",
			},
			{
				q: "Does OmniPlot work offline?",
				a: "Not currently — an internet connection is required for the pattern library and account features. Local/offline mode is on our roadmap.",
			},
			{
				q: "How is my data stored?",
				a: "Jobs and settings are stored securely in Firebase (Google Cloud). Pattern SVGs are served from Cloud Storage. We never share your data with third parties.",
			},
			{
				q: "What browsers are supported?",
				a: "Chrome and Edge are recommended (required for Web Serial plotter control). Firefox and Safari work for design and file export, but direct plotter connection via Web Serial is Chrome/Edge only.",
			},
		],
	},
] as const;

// ─── Changelog ────────────────────────────────
export const CHANGELOG = [
	{
		version: "1.0.0",
		date: "2025-01-15",
		label: "Launch",
		changes: [
			{
				type: "feature",
				text: "Web-based PPF cutting studio — no install required",
			},
			{
				type: "feature",
				text: "Pattern library with 200+ vehicle templates",
			},
			{ type: "feature", text: "HPGL / SVG / DXF export" },
			{
				type: "feature",
				text: "Auto-nesting optimizer for material efficiency",
			},
			{
				type: "feature",
				text: "Web Serial API direct plotter connection (Chrome/Edge)",
			},
			{ type: "feature", text: "Dark and light mode" },
			{ type: "feature", text: "Mobile-responsive studio and library" },
			{ type: "feature", text: "Free, Lite, and Pro subscription tiers" },
		],
	},
] as const;
