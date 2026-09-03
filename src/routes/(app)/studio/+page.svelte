<script lang="ts">
	import { onMount } from "svelte";
	import {
		canvasStore,
		plotterStore,
		toastStore,
		uiStore,
		userStore,
		shopStore,
		agentStore,
		confirmStore,
	} from "$lib/stores";
	import { bestNest, smartNest, findNextPosition, samplePolygonArea, getSvgPathBBox, type PlacementResult } from "$lib/utils/nesting";
	import {
		downloadHpgl,
		downloadSvg,
		downloadDxf,
		calcEfficiency,
		estimateCutTime,
		generateHpgl,
		generateHpglSegments,
	} from "$lib/utils/hpgl";
	import { sendToPlotter, sendToPlotterSegmented, sendSettings, connectSerialPort, reconnectSerialPort, disconnectSerialPort, isSerialConnected, queryPlotter, releaseAgentPort, type SerialPortInfo, type CutProgress } from "$lib/utils/plotter-connection";
	import { logPlotterError, incrementCutUsage } from "$lib/firebase/firestore";
	import { cutJobStore } from "$lib/stores";
	import type { PlotterDiagnostic } from "$lib/utils/plotter-errors";
	import PlotterDiagPanel from "$lib/components/ui/PlotterDiagPanel.svelte";
	import {
		canCut,
		formatDimensions,
		getItemColor,
		uid,
		formatCutTime,
		formatEfficiency,
	} from "$lib/utils";
	import { DEFAULT_MATERIALS, PLOTTER_PRESETS, CURRENT_AGENT_VERSION, type PlotterPreset } from "$lib/config";
	import {
		detectUsbPlotters,
		detectAgentPorts,
		scanNetworkViaAgent,
		matchPortToPreset,
		getCompatibilityStatus,
		compatLabel,
		type DetectedPlotter,
		type NetworkDevice,
	} from "$lib/utils/plotter-detect";
	import Button from "$lib/components/ui/Button.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import GuidedTour from "$lib/components/ui/GuidedTour.svelte";
	import EarlyAccessModal from "$lib/components/ui/EarlyAccessModal.svelte";
	import type { TourStep } from "$lib/components/ui/GuidedTour.svelte";
	import { getVehicleName } from "$lib/stores/patternStore.svelte";
	import type { CanvasItem, PlotterConfig } from "$lib/types";

	// ─── Guided tour ─────────────────────────────
	const TOUR_STEPS: TourStep[] = [
		{
			target: null,
			title: "Welcome to OmniPlot Studio",
			body: "This quick tour covers the cutting workflow end-to-end. You can skip anytime — and replay it from your account menu.",
			position: "center",
		},
		{
			target: '[data-tour="sidebar-library"]',
			title: "Pattern Library",
			body: "Start here: browse PPF and window tint patterns by vehicle. Click a pattern to add it directly to your cut sheet.",
			position: "right",
		},
		{
			target: '[data-tour="canvas"]',
			title: "Material Roll Canvas",
			body: "This canvas represents your physical material roll. Patterns are placed here. Zoom in/out to inspect and scroll to explore the full length.",
			position: "top",
		},
		{
			target: '[data-tour="toolbar-nest"]',
			title: "AI Nest",
			body: "AI Nest is on by default — patterns auto-arrange to minimize material waste whenever you add them. Click the star toggle to switch to manual placement mode. The refresh icon runs a deeper re-optimization pass on demand.",
			position: "bottom",
		},
		{
			target: '[data-tour="panel-tabs"]',
			title: "Properties Panel",
			body: "Properties: tweak cut force, speed, and roll width. Patterns: see every piece on sheet. Plotter: configure your cutter device and connection.",
			position: "left",
		},
		{
			target: '[data-tour="statusbar"]',
			title: "Status Bar",
			body: "Live metrics: material efficiency percentage, number of cut paths, estimated cut time, roll dimensions, and cursor position.",
			position: "top",
		},
		{
			target: '[data-tour="cut-btn"]',
			title: "Export & Cut",
			body: "Export as PLT, SVG, or DXF — or send the job directly to your plotter over USB, network, or the local Cut Agent.",
			position: "bottom",
		},
	];

	// ─── Derived metrics ──────────────────────────
	const outOfBoundsCount = $derived(
		canvasStore.items.filter((i) => i.outOfBounds).length,
	);
	const cutCount = $derived(
		canvasStore.items.filter((i) => !i.outOfBounds).length,
	);
	// Material utilization = actual polygon area / (roll_width × roll_length_used).
	// Uses the shoelace formula on sampled SVG path points (cached after first call),
	// not bounding-box area, so arch/dome shapes don't overstate efficiency.
	const efficiency = $derived.by(() => {
		const inBounds = canvasStore.items.filter((i) => !i.outOfBounds);
		if (!inBounds.length) return 0;
		const usedLength = Math.max(...inBounds.map((i) => i.x + i.width), 0);
		if (usedLength === 0) return 0;
		const patternArea = inBounds.reduce(
			(s, i) => s + samplePolygonArea(i.pattern.svgPath, i.width, i.height),
			0,
		);
		return Math.min(1, patternArea / (canvasStore.sheet.widthInches * usedLength));
	});
	const cutTimeSecs = $derived(
		estimateCutTime(canvasStore.items, plotterStore.config.cuttingSpeed),
	);

	// ─── Roll canvas dimensions (in the sheet's own, unrotated frame) ──
	// Internally the sheet is still laid out with length along X and roll
	// width along Y — that matches how items are positioned/nested. It gets
	// visually rotated 90° at render time (see .roll-frame / .material-sheet
	// below) so the roll's width reads as screen-horizontal, without having
	// to touch any item coordinate or shape math.
	const displaySheetLength = $derived.by(() => {
		const inBounds = canvasStore.items.filter((i) => !i.outOfBounds);
		if (!inBounds.length) return 20;
		return Math.max(...inBounds.map((i) => i.x + i.width));
	});
	// Canvas cross-dimension always mirrors the selected roll's physical
	// width — it's a visual stand-in for the roll, so it must track the roll
	// size directly rather than being clamped/cropped to content extent.
	const displaySheetWidth = $derived.by(() => {
		const rollWidth = canvasStore.sheet.widthInches;
		const oobStrip = outOfBoundsCount > 0 ? 20 : 0;
		return rollWidth + oobStrip;
	});

	// ─── Ruler ticks across the roll's width ──────
	// Major ticks are labeled; minor ticks are small unlabeled notches at the
	// "next stage down" spacing, so the ruler still shows finer resolution
	// after zooming out to a coarser major step.
	const RULER_STEPS = [5, 10, 20, 30] as const;
	const RULER_MINOR_STEP: Record<number, number> = { 5: 1, 10: 5, 20: 10, 30: 10 };
	const rulerMajorTicks = $derived.by(() => {
		const step = canvasStore.state.rulerStepInches || 5;
		const ticks: number[] = [];
		for (let t = 0; t <= displaySheetWidth + 0.001; t += step) ticks.push(Math.round(t * 100) / 100);
		return ticks;
	});
	const rulerMinorTicks = $derived.by(() => {
		const step = canvasStore.state.rulerStepInches || 5;
		const minorStep = RULER_MINOR_STEP[step] ?? 1;
		const majorSet = new Set(rulerMajorTicks);
		const ticks: number[] = [];
		for (let t = 0; t <= displaySheetWidth + 0.001; t += minorStep) {
			const r = Math.round(t * 100) / 100;
			if (!majorSet.has(r)) ticks.push(r);
		}
		return ticks;
	});

	// ─── Merged roll label (name, length, width, used) ────
	// Material names in config bake the width/length into the string itself
	// (e.g. "Tint Roll 20\" × 100ft"), which duplicated the width/used figures
	// shown separately elsewhere on the canvas. Strip that suffix here so the
	// one on-canvas label can show real, current values instead of a mix of
	// baked-in text and live numbers that can drift apart (e.g. after a custom
	// roll length is set below).
	const materialBaseName = $derived.by(() => {
		const stripped = canvasStore.sheet.name
			.replace(/\s*\d+(?:\.\d+)?"\s*(?:[×x]\s*\d+(?:\.\d+)?\s*f?t?\.?)?\s*$/i, "")
			.trim();
		return stripped || canvasStore.sheet.name;
	});
	const rollLengthFt = $derived(canvasStore.sheet.heightInches / 12);
	// Actual used length, independent of displaySheetLength's cosmetic 20"
	// fallback (which only exists to keep the empty canvas a visible size) —
	// with no in-bounds patterns, nothing has actually been used yet.
	const usedLengthFt = $derived.by(() => {
		const inBounds = canvasStore.items.filter((i) => !i.outOfBounds);
		if (!inBounds.length) return 0;
		return Math.max(...inBounds.map((i) => i.x + i.width)) / 12;
	});

	// ─── Transposed sheet for nesting ─────────────
	// Swap width/height so nesting treats roll_length as X (large, unconstrained)
	// and roll_width as Y (the true cutting constraint).
	function transposedSheet(sheet = canvasStore.sheet) {
		return {
			...sheet,
			widthInches: sheet.heightInches,
			heightInches: sheet.widthInches,
		};
	}

	// ─── Auto-fit zoom on roll-width change (user-toggleable) ─────
	// On by default. Fits by WIDTH only — not min(width, height) like the
	// "Fit to view" toolbar action — so the roll's fixed left gutter
	// (canvas-content's 48px padding) is mirrored exactly on the right,
	// keeping the whole roll width in view regardless of its length.
	let autoFitZoomOnRollChange = $state(
		typeof localStorage !== "undefined"
			? localStorage.getItem("op-auto-fit-zoom") !== "false"
			: true,
	);
	$effect(() => {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem("op-auto-fit-zoom", String(autoFitZoomOnRollChange));
		}
	});

	function fitWidthToView() {
		if (!canvasEl) return;
		const viewW = canvasEl.clientWidth;
		const PAD = 96; // 48px canvas-content padding × 2 — the left gutter, mirrored on the right
		const rollPxW = displaySheetWidth * 48;
		if (viewW > PAD && rollPxW > 0) {
			canvasStore.setZoom(Math.max(3, Math.min(100, ((viewW - PAD) / rollPxW) * 100)));
		}
		canvasEl.scrollLeft = 0;
		canvasEl.scrollTop = 0;
	}

	// ─── Re-nest items on new sheet ───────────────
	function renestOnSheet(sheet: typeof canvasStore.sheet) {
		canvasStore.setSheet(sheet);
		if (canvasStore.items.length > 0) {
			const nested = bestNest(canvasStore.items, transposedSheet(sheet), true, canvasStore.state.bufferInches);
			canvasStore.setItems(nested);
			const oob = nested.filter((i) => i.outOfBounds).length;
			if (oob > 0) {
				toastStore.warning(
					`${sheet.widthInches}" roll`,
					`${oob} pieces exceed roll width — won't cut`,
				);
			} else if (canvasStore.items.length > 0) {
				toastStore.success(
					`${sheet.widthInches}" roll`,
					"All pieces re-nested",
				);
			}
		}
		if (autoFitZoomOnRollChange) {
			fitWidthToView();
		} else if (canvasEl) {
			canvasEl.scrollLeft = 0;
			canvasEl.scrollTop = 0;
		}
	}

	// ─── Active panel tab ─────────────────────────
	let panelTab = $state<"properties" | "patterns" | "plotter">("patterns");
	// Which pattern card's accordion is open in the Patterns tab (move/rotate/flip controls).
	let expandedItemId = $state<string | null>(null);
	// Axis currently being scrub-dragged (for the position field's drag cursor/highlight state).
	let scrubbingAxis = $state<"x" | "y" | null>(null);

	// ─── Position field: click-drag "scrub" like Figma/design-tool number fields ──
	// Dragging the X/Y tag left/right adjusts that axis live, in real time, without
	// needing to click into the input, select the text, and retype a number.
	function scrubPosition(e: PointerEvent, item: CanvasItem, axis: "x" | "y") {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		const handle = e.currentTarget as HTMLElement;
		const startClientX = e.clientX;
		const startVal = axis === "x" ? item.x : item.y;
		let dragged = false;
		scrubbingAxis = axis;
		handle.setPointerCapture(e.pointerId);

		function onMove(ev: PointerEvent) {
			const dx = ev.clientX - startClientX;
			if (Math.abs(dx) > 2) dragged = true;
			const sensitivity = ev.shiftKey ? 0.02 : 0.15; // shift = fine adjustment
			const raw = +(startVal + dx * sensitivity).toFixed(2);
			// x = length axis (effectively unbounded); y = roll-width axis, must
			// stay inside [0, rollWidth - item.height] — otherwise the item can
			// be scrubbed straight through the cut-zone edge and renders fully
			// opaque outside it, with no out-of-bounds indicator, since this
			// path never re-derives item.outOfBounds.
			const max = axis === "x" ? Infinity : Math.max(0, canvasStore.sheet.widthInches - item.height);
			const next = Math.min(Math.max(0, raw), max);
			canvasStore.updateItem(item.id, axis === "x" ? { x: next } : { y: next, outOfBounds: false });
		}
		function onUp(ev: PointerEvent) {
			handle.releasePointerCapture(e.pointerId);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			scrubbingAxis = null;
			// A drag-free click on the tag focuses the adjacent input for direct typing.
			if (!dragged) {
				const input = handle.parentElement?.querySelector("input");
				input?.focus();
				input?.select();
			}
		}
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	// Arrow-key nudge on the position inputs: ↑/↓ step by 0.1", shift+↑/↓ steps by 1".
	function nudgePosition(e: KeyboardEvent, item: CanvasItem, axis: "x" | "y") {
		if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
		e.preventDefault();
		const step = e.shiftKey ? 1 : 0.1;
		const dir = e.key === "ArrowUp" ? 1 : -1;
		const current = axis === "x" ? item.x : item.y;
		const raw = +(current + dir * step).toFixed(2);
		const max = axis === "x" ? Infinity : Math.max(0, canvasStore.sheet.widthInches - item.height);
		const next = Math.min(Math.max(0, raw), max);
		canvasStore.updateItem(item.id, axis === "x" ? { x: next } : { y: next, outOfBounds: false });
	}

	// ─── Settings panel collapse (expanded = 1/3 screen width) ──
	let panelCollapsed = $state(
		typeof localStorage !== "undefined"
			? localStorage.getItem("op-panel-collapsed") === "true"
			: false,
	);
	$effect(() => {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem("op-panel-collapsed", String(panelCollapsed));
		}
	});

	// Jump to the Plotter tab, expanding the settings panel if it's collapsed —
	// used by the toolbar plotter badge's Connect/View button.
	function openPlotterTab() {
		panelTab = "plotter";
		panelCollapsed = false;
	}

	// ─── Canvas interaction ───────────────────────
	let canvasEl = $state<HTMLDivElement | null>(null);
	let cursorX = $state(0);
	let cursorY = $state(0);

	function onCanvasMouseMove(e: MouseEvent) {
		if (!canvasEl) return;
		const rect = canvasEl.getBoundingClientRect();
		const scale = canvasStore.zoom / 100;
		cursorX = Math.max(0, (e.clientX - rect.left + canvasEl.scrollLeft - 48) / scale / 48);
		cursorY = Math.max(0, (e.clientY - rect.top + canvasEl.scrollTop - 48) / scale / 48);
	}

	function onCanvasClick(e: MouseEvent) {
		if ((e.target as HTMLElement).closest(".cut-item")) return;
		canvasStore.deselect();
	}

	// ─── Delete key removes the selected pattern(s) ───
	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key !== "Delete" && e.key !== "Backspace") return;
		const target = e.target as HTMLElement | null;
		if (target?.closest("input, textarea, select, [contenteditable]")) return;
		if (canvasStore.selected.length === 0) return;
		e.preventDefault();
		canvasStore.removeSelected();
	}

	// ─── Clear all patterns from the canvas ───────
	async function handleClearCanvas() {
		const count = canvasStore.items.length;
		if (count === 0) return;
		const ok = await confirmStore.ask({
			title: "Clear all patterns from the canvas?",
			message: "This can be undone with Undo.",
			details: [{ label: "Patterns on sheet", value: String(count) }],
			confirmLabel: "Clear canvas",
			variant: "danger",
		});
		if (!ok) return;
		canvasStore.clear();
	}

	// ─── Actions ──────────────────────────────────
	function handleAutoNest() {
		const nested = bestNest(canvasStore.items, transposedSheet(), true, canvasStore.state.bufferInches);
		console.log("NEST v13", nested.map((i) => [i.id, i.x.toFixed(2), i.y.toFixed(2), i.width.toFixed(1), i.height.toFixed(1), i.rotation]));
		canvasStore.setItems(nested);
		smartNestGain = null;
		const oob = nested.filter((i) => i.outOfBounds).length;
		const fit = nested.length - oob;
		const eff = formatEfficiency(calcEfficiency(nested, canvasStore.sheet));
		if (oob > 0) {
			toastStore.warning(
				"Auto-nested",
				`${fit} pieces fit · ${eff} efficiency · ${oob} won't cut (exceed sheet)`,
			);
		} else {
			toastStore.success(
				"Auto-nested",
				`${fit} pieces · ${eff} efficiency`,
			);
		}
		fitToView();
	}

	let smartNesting = $state(false);
	let smartNestGain = $state<number | null>(null);

	// ─── AI Nest mode (default ON) ────────────────
	// When enabled: patterns auto-nest using the fast skyline algorithm whenever
	// items are added or the sheet changes. Users can toggle this off to drag
	// patterns to custom positions without the layout being overridden.
	let aiNestEnabled = $state(
		typeof localStorage !== "undefined"
			? localStorage.getItem("op-ai-nest") !== "false"
			: true,
	);
	$effect(() => {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem("op-ai-nest", aiNestEnabled ? "true" : "false");
		}
	});

	// ─── Auto Re-optimize (default ON) ────────────
	// When enabled: the deep AI nest (handleSmartNest — same one the
	// "Re-optimize" button runs) reruns automatically whenever a pattern is
	// added to or removed from the sheet. Toggle off to only re-optimize on
	// demand via the button, e.g. while iterating on a specific layout where
	// the deep search repeatedly repositioning everything gets in the way.
	let autoReoptimize = $state(
		typeof localStorage !== "undefined"
			? localStorage.getItem("op-auto-reoptimize") !== "false"
			: true,
	);
	$effect(() => {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem("op-auto-reoptimize", autoReoptimize ? "true" : "false");
		}
	});
	// -1 = not yet baselined (page load / restore) — don't fire on that first read.
	let autoReoptimizeLastCount = -1;
	$effect(() => {
		const count = canvasStore.items.length;
		if (autoReoptimizeLastCount === -1) {
			autoReoptimizeLastCount = count;
			return;
		}
		if (count === autoReoptimizeLastCount) return;
		autoReoptimizeLastCount = count;
		if (autoReoptimize && !smartNesting) handleSmartNest({ silent: true });
	});

	let cutting          = $state(false);
	let serialPortInfo   = $state<SerialPortInfo | null>(null);

	// ─── Cut progress + abort + resume checkpoint ─
	// Progress is shown in the toolbar during a segmented send.
	// cutAbortController lets the user cancel mid-job.
	let cutProgress        = $state<CutProgress | null>(null);
	let cutAbortController = $state<AbortController | null>(null);

	interface ResumeCheckpoint {
		remainingItemIds: string[];
		completedCount: number;
		totalCount: number;
		presetName: string;
	}
	let resumeCheckpoint = $state<ResumeCheckpoint | null>(null);

	// ─── Plotter diagnostic panel ─────────────────
	let diagData     = $state<PlotterDiagnostic | null>(null);
	let diagReported = $state(false);

	// ─── Live settings debounce ───────────────────
	let _settingsTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleSettingsSend() {
		if (plotterStore.config.connection === "download") return;
		if (_settingsTimer) clearTimeout(_settingsTimer);
		_settingsTimer = setTimeout(async () => {
			_settingsTimer = null;
			const result = await sendSettings(plotterStore.config);
			if (!result.ok) {
				// Silent fail — settings updates are best-effort background ops
				console.debug("[settings send]", result.diagnostic.code, result.diagnostic.raw);
			}
		}, 400);
	}

	// ─── Plotter discovery ───────────────────────
	// Replaces the manual preset dropdown + connection cards.
	// runDiscovery() probes all sources (Cut Agent + Web Serial) on mount and
	// every 8s; auto-selects and auto-connects when a single device is found.
	interface DiscoveredDevice {
		id: string;
		source: "agent" | "usb";
		portPath?: string;
		preset: PlotterPreset;
		confidence: "exact-vid" | "manufacturer-name" | "generic";
		vendorId?: number;
		productId?: number;
		manufacturer?: string;
		product?: string;
		status: "detected" | "connected" | "offline";
		lastSeenMs: number;
	}

	let discoveredDevices  = $state<DiscoveredDevice[]>([]);
	let discoveryPhase     = $state<"idle" | "scanning" | "done">("idle");
	let selectedDeviceId   = $state<string | null>(null);
	let autoConnectedAgent = $state(false);  // prevents re-auto-connecting on every poll
	let testingConn        = $state(false);
	let bgRefreshing       = $state(false);  // silent background poll in progress

	const liveDevices    = $derived(discoveredDevices.filter(d => d.status !== "offline"));
	const selectedDevice = $derived(discoveredDevices.find(d => d.id === selectedDeviceId) ?? null);

	// ─── Connection UI state ───────────────────────
	let agentProbeStatus = $state<"probing" | "online" | "offline">("probing");
	let connecting       = $state(false);
	let autoReconnecting = false; // guards the background USB auto-reconnect in runDiscovery against overlapping 8s poll ticks
	let showConfig       = $state(false);

	// ─── Roll alignment calibration ───────────────
	type CalPhase = 'idle' | 'probe-wait' | 'probe-busy' | 'probe-done' | 'probe-error';
	// 'oa-unsupported' = plotter didn't respond to OA (firmware doesn't implement it)
	// 'port-busy'      = agent left the serial port locked after a previous query timeout
	// 'port-missing'   = the configured COM/tty path no longer exists (unplugged, renumbered)
	// 'generic'        = any other error
	type CalErrorKind = 'oa-unsupported' | 'port-busy' | 'port-missing' | 'generic';
	let calPhase     = $state<CalPhase>('idle');
	let calCapture   = $state<{ offsetIn: number; raw: string } | null>(null);
	let calError     = $state<string | null>(null);
	let calErrorKind = $state<CalErrorKind>('generic');
	let calCustomX   = $state(0);

	const plotterMaxIn  = $derived(plotterStore.config.maxMediaWidthMm / 25.4);
	const rollWidthIn   = $derived(plotterStore.config.mediaWidthMm   / 25.4);
	const originXIn     = $derived(plotterStore.config.originX);
	const mountPreset   = $derived.by(() => {
		const diff = plotterMaxIn - rollWidthIn;
		if (Math.abs(originXIn) < 0.05) return 'flush-left' as const;
		if (diff > 0.1 && Math.abs(originXIn - diff) < 0.1) return 'flush-right' as const;
		return 'custom' as const;
	});

	// Diagram geometry — precomputed so template needs no {@const}
	const CAL_DIAG_BED  = 172;
	const calDiagSafe   = $derived(Math.max(plotterMaxIn, rollWidthIn, 1));
	const calDiagRoll   = $derived(Math.round((rollWidthIn / calDiagSafe) * CAL_DIAG_BED));
	const calDiagOff    = $derived(Math.round((Math.min(originXIn, calDiagSafe - rollWidthIn) / calDiagSafe) * CAL_DIAG_BED));

	function setMountMode(mode: 'flush-left' | 'flush-right' | 'custom') {
		if (mode === 'flush-left')  { plotterStore.update({ originX: 0 }); calPhase = 'idle'; }
		if (mode === 'flush-right') { plotterStore.update({ originX: Math.max(0, plotterMaxIn - rollWidthIn) }); calPhase = 'idle'; }
		if (mode === 'custom')      { calCustomX = originXIn; }
	}

	function applyCustomX() {
		const v = Math.max(0, Math.min(calCustomX, plotterMaxIn));
		plotterStore.update({ originX: v });
	}

	async function runProbe() {
		calPhase     = 'probe-busy';
		calError     = null;
		calErrorKind = 'generic';
		const res = await queryPlotter('OA;', plotterStore.config, 3000);

		if (!res.ok) {
			const msg = (res.error ?? '').toLowerCase();
			if (
				(msg.includes('not found') || msg.includes('no such file')) &&
				(msg.includes('port') || msg.includes('tty') || msg.includes('com'))
			) {
				// The configured serial path doesn't exist on this machine — releasing
				// a handle the agent doesn't hold won't fix this, unlike port-busy below.
				calErrorKind = 'port-missing';
				calError = res.error ?? 'Serial port not found';
			} else if (msg.includes('busy') || msg.includes('in use') || msg.includes('cannot open')) {
				// Agent left the port open from the previous query timeout.
				calErrorKind = 'port-busy';
				calError = res.error ?? 'Serial port busy';
			} else {
				calErrorKind = 'generic';
				calError = res.error ?? 'Agent error';
			}
			calPhase = 'probe-error';
			return;
		}

		if (!res.response) {
			// Plotter returned nothing — it doesn't implement OA.
			calErrorKind = 'oa-unsupported';
			calError = null;
			calPhase = 'probe-error';
			return;
		}

		// Parse HPGL OA response: "{x},{y};" or "{x},{y}\r\n"
		const clean = res.response.replace(/[;\r\n\s]/g, '');
		const parts = clean.split(',').map(Number);
		if (parts.length < 1 || isNaN(parts[0])) {
			calErrorKind = 'generic';
			calError = `Unexpected response: "${res.response}"`;
			calPhase = 'probe-error';
			return;
		}
		const offsetIn = parts[0] / 1016; // HPGL_UNITS_PER_INCH
		calCapture = { offsetIn, raw: res.response };
		plotterStore.update({ originX: offsetIn });
		calPhase = 'probe-done';
	}

	function buildCalCut(): string {
		const U  = 1016;
		const x0 = Math.round(0.25 * U);
		const y0 = Math.round(0.25 * U);
		const x1 = Math.round(1.25 * U);
		const y1 = Math.round(1.25 * U);
		const cx = Math.round(0.75 * U);
		const cy = Math.round(0.75 * U);
		const r  = Math.round(0.30 * U);
		return [
			'IN;SP1;PA;',
			`PU${x0},${y0};PD${x0},${y1};PD${x1},${y1};PD${x1},${y0};PD${x0},${y0};`,
			`PU${cx},${cy};CI${r};`,
			'PU0,0;SP0;IN;',
		].join('\n');
	}

	async function sendCalCut() {
		const hpgl = buildCalCut();
		await sendToPlotter(hpgl, plotterStore.config);
	}

	const isConnected = $derived(
		(plotterStore.config.connection === "usb-serial" && !!serialPortInfo) ||
		plotterStore.config.connection === "cut-agent"
	);

	const compat = $derived(
		getCompatibilityStatus(
			plotterStore.config.maxMediaWidthMm,
			canvasStore.sheet.widthInches,
		),
	);

	// Max cutting width of the selected plotter in inches
	const plotterMaxWidthIn = $derived(plotterStore.config.maxMediaWidthMm / 25.4);

	// ─── Plotter tab status badge ─────────────────
	// missing = no cutter connected or detected; warn = detected but not
	// connected / near width limit / agent needs update; error = material
	// exceeds plotter's max width; ok = connected and compatible.
	const plotterStatusInfo = $derived.by(() => {
		if (compat === "overflow") return { label: "Error — material too wide", tone: "error" };
		if (!isConnected) {
			return liveDevices.length > 0
				? { label: "Out of sync — detected, not connected", tone: "warn" }
				: { label: "Missing — no cutter detected", tone: "missing" };
		}
		if (compat === "tight" || agentStore.needsUpdate) {
			return { label: "Warning — check connection", tone: "warn" };
		}
		return { label: "Connected", tone: "ok" };
	});

	// ─── Toolbar plotter status badge ─────────────
	// Quick-glance card in the main toolbar: name, connection medallion, and
	// live status. Reacts to every signal that can change it — connect/
	// disconnect (isConnected/serialPortInfo), the agent going offline
	// (agentStore.status), a job starting/finishing (cutting/cutProgress),
	// and material/plotter width compatibility (compat).
	type ToolbarConnType = "usb-serial" | "cut-agent" | "network" | "download";
	interface ToolbarPlotterBadge {
		state: "cutting" | "connected" | "detected" | "scanning" | "none";
		name: string | null;
		connType: ToolbarConnType | null;
		detail: string;
		tone: "ok" | "warn" | "error" | "missing" | "cutting";
	}
	const toolbarPlotterBadge = $derived.by((): ToolbarPlotterBadge => {
		if (isConnected) {
			if (cutting) {
				return {
					state: "cutting",
					name: plotterStore.config.name,
					connType: plotterStore.config.connection as ToolbarConnType,
					detail: cutProgress ? `Cutting · ${cutProgress.sent}/${cutProgress.total}` : "Cutting…",
					tone: "cutting",
				};
			}
			if (compat === "overflow") {
				return {
					state: "connected",
					name: plotterStore.config.name,
					connType: plotterStore.config.connection as ToolbarConnType,
					detail: "Material too wide for this plotter",
					tone: "error",
				};
			}
			if (compat === "tight" || agentStore.needsUpdate) {
				return {
					state: "connected",
					name: plotterStore.config.name,
					connType: plotterStore.config.connection as ToolbarConnType,
					detail: agentStore.needsUpdate ? "Agent update required" : "Near max cutting width",
					tone: "warn",
				};
			}
			return {
				state: "connected",
				name: plotterStore.config.name,
				connType: plotterStore.config.connection as ToolbarConnType,
				detail: "Connected · ready to cut",
				tone: "ok",
			};
		}
		if (liveDevices.length > 0) {
			const d = liveDevices.find((x) => x.id === selectedDeviceId) ?? liveDevices[0];
			return {
				state: "detected",
				name: d.preset.name,
				connType: d.source === "agent" ? "cut-agent" : "usb-serial",
				detail: liveDevices.length > 1 ? `${liveDevices.length} cutters found — not connected` : "Detected · not connected",
				tone: "warn",
			};
		}
		if (discoveryPhase === "scanning") {
			return { state: "scanning", name: null, connType: null, detail: "Scanning for cutters…", tone: "missing" };
		}
		return { state: "none", name: null, connType: null, detail: "No plotter detected", tone: "missing" };
	});

	// ─── Metered feature gates ────────────────────
	// Re-derives whenever user or shop subscription changes (real-time listener).
	const cutCheck = $derived(
		userStore.user
			? canCut(userStore.user, shopStore.shop)
			: { allowed: true }, // don't block while auth is loading
	);
	// True for free-tier users with no active shop subscription — gates non-cut features.
	const isFree = $derived(
		!!userStore.user &&
		userStore.user.tier === "free" &&
		shopStore.shop?.subscriptionStatus !== "active" &&
		shopStore.shop?.subscriptionStatus !== "trialing",
	);
	// Cut-btn counter: unlimited for pro/admin or an active/trialing shop seat
	// (free/lite are rate-limited to 1 cut per period, not a pool, so their
	// "remaining" is just whether cutCheck currently allows one).
	const cutsRemainingDisplay = $derived.by(() => {
		if (!userStore.user) return "∞";
		const unlimited =
			userStore.user.tier === "pro" ||
			userStore.user.tier === "admin" ||
			shopStore.shop?.subscriptionStatus === "active" ||
			shopStore.shop?.subscriptionStatus === "trialing";
		if (unlimited) return "∞";
		return cutCheck.allowed ? "1" : "0";
	});
	// Pre-compute export lock states for use in template
	const pltLocked = $derived(!cutCheck.allowed);
	const dxfLocked = $derived(isFree);

	// ─── Agent update helpers ────────────────────
	let stoppingOldAgent = $state(false);

	async function stopOldAgent() {
		stoppingOldAgent = true;
		const base = (plotterStore.config.agentUrl ?? "http://localhost:7878").replace(/\/$/, "");
		try {
			await fetch(`${base}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(3000) });
		} catch { /* expected — agent closes connection on shutdown */ }
		await new Promise(r => setTimeout(r, 800));
		agentStore.reset();
		stoppingOldAgent = false;
		runDiscovery();
	}

	// ─── Plotter discovery ───────────────────────
	// Polls all sources (Cut Agent USB ports + Web Serial granted ports),
	// merges results, auto-connects agent devices, and updates live status.
	// silent=true: background poll — skips the "Scanning…" phase change so the
	// UI doesn't flicker every 8s. Data is still updated atomically at the end.
	async function runDiscovery(silent = false) {
		if (silent) {
			bgRefreshing = true;
		} else {
			discoveryPhase = "scanning";
		}
		const now = Date.now();
		const next: DiscoveredDevice[] = [];

		// 1. Probe agent + enumerate its USB ports
		const base = (plotterStore.config.agentUrl ?? "http://localhost:7878").replace(/\/$/, "");
		try {
			const r = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(2500) });
			if (r.ok) {
				agentProbeStatus = "online";
				const body: { version?: string } = await r.json().catch(() => ({}));
				agentStore.setOnline(body.version ?? "");
			} else {
				agentProbeStatus = "offline";
				agentStore.setOffline();
			}
		} catch {
			agentProbeStatus = "offline";
			agentStore.setOffline();
		}

		if (agentProbeStatus === "online") {
			type AgentPort = { name: string; isUSB: boolean; vendorId?: string; productId?: string; manufacturer?: string; product?: string; };
			const ports: AgentPort[] = await fetch(`${base}/api/ports`, { signal: AbortSignal.timeout(3000) })
				.then(r => r.ok ? r.json() : []).catch(() => []);
			for (const p of (ports as AgentPort[]).filter(pp => pp.isUSB)) {
				const vid = p.vendorId ? parseInt(p.vendorId, 16) : undefined;
				const pid = p.productId ? parseInt(p.productId, 16) : undefined;
				const matched = matchPortToPreset(vid, pid);
				const id = `agent:${p.name}`;
				const isActive = plotterStore.config.connection === "cut-agent";
				next.push({
					id,
					source: "agent",
					portPath: p.name,
					preset: matched?.preset ?? PLOTTER_PRESETS[0],
					confidence: matched?.confidence ?? "generic",
					vendorId: vid,
					productId: pid,
					manufacturer: p.manufacturer,
					product: p.product,
					status: isActive ? "connected" : "detected",
					lastSeenMs: now,
				});
			}
		}

		// 2. Web Serial previously-granted ports (Chrome/Edge only)
		if (typeof navigator !== "undefined" && "serial" in navigator) {
			const ports: any[] = await (navigator as any).serial.getPorts().catch(() => []);
			for (const port of ports) {
				const info: { usbVendorId?: number; usbProductId?: number } = port.getInfo?.() ?? {};
				const vid = info.usbVendorId;
				const pid = info.usbProductId;
				const matched = matchPortToPreset(vid, pid);
				const id = `usb:${vid?.toString(16).padStart(4, "0") ?? "??"}:${pid?.toString(16).padStart(4, "0") ?? "??"}`;
				const isActive = plotterStore.config.connection === "usb-serial" && !!serialPortInfo;
				next.push({
					id,
					source: "usb",
					preset: matched?.preset ?? PLOTTER_PRESETS[0],
					confidence: matched?.confidence ?? "generic",
					vendorId: vid,
					productId: pid,
					status: isActive ? "connected" : "detected",
					lastSeenMs: now,
				});
			}
		}

		// 3. Merge — preserve connected devices that vanished (mark offline + disconnect)
		const merged: DiscoveredDevice[] = [...next];
		for (const prev of discoveredDevices) {
			if (!next.find(d => d.id === prev.id) && prev.status === "connected") {
				merged.push({ ...prev, status: "offline" });
				if (prev.source === "usb") { disconnectSerialPort(); serialPortInfo = null; }
				if (prev.source === "agent") { plotterStore.switchConnection("download", { save: false }); autoConnectedAgent = false; }
			}
		}

		discoveredDevices = merged;
		if (!silent) discoveryPhase = "done";
		bgRefreshing = false;

		// 4. Auto-select + auto-connect
		const online = merged.filter(d => d.status !== "offline");
		const onlineAgents = online.filter(d => d.source === "agent");
		if (online.length >= 1) {
			// Pick selection: prefer existing selection, then single device, then prefer agent over USB
			const target = (selectedDeviceId ? online.find(d => d.id === selectedDeviceId) : null)
				?? (online.length === 1 ? online[0] : null)
				?? (onlineAgents.length === 1 ? onlineAgents[0] : null);
			if (target) {
				if (selectedDeviceId !== target.id) {
					selectedDeviceId = target.id;
					plotterStore.applyPreset(target.preset);
					if (target.portPath) plotterStore.update({ serialPort: target.portPath });
				}
				// Auto-connect a single agent device (no browser dialog needed; skip if outdated).
				// Check onlineAgents.length === 1 (not online.length) so USB Direct cards alongside
				// the agent don't suppress auto-connect.
				if (onlineAgents.length === 1 && target.source === "agent" && !autoConnectedAgent && !isConnected && !agentStore.needsUpdate) {
					plotterStore.switchConnection("cut-agent");
					sendSettings(plotterStore.config).catch(() => {});
					autoConnectedAgent = true;
					discoveredDevices = discoveredDevices.map(d =>
						d.id === target.id ? { ...d, status: "connected" } : d
					);
				}
				// Silently reconnect a USB device the user has connected to before (VID/PID
				// matches the last-saved usb-serial config) without requiring a click —
				// covers the case where it's plugged back in mid-session, not just on mount.
				if (
					target.source === "usb" && target.status === "detected" && !serialPortInfo &&
					!autoReconnecting &&
					plotterStore.config.vendorId !== undefined &&
					target.vendorId === plotterStore.config.vendorId &&
					target.productId === plotterStore.config.productId
				) {
					autoReconnecting = true;
					reconnectSerialPort(target.preset.baudRate ?? plotterStore.config.baudRate ?? 9600, {
						vendorId: target.vendorId, productId: target.productId,
					}).then((info) => {
						if (!info) return;
						serialPortInfo = info;
						plotterStore.applyPreset(target.preset);
						plotterStore.switchConnection("usb-serial");
						discoveredDevices = discoveredDevices.map(d =>
							d.id === target.id ? { ...d, status: "connected" } : d
						);
						toastStore.success(`Reconnected · ${target.preset.name}`, "USB Direct (auto-detected)");
					}).finally(() => {
						autoReconnecting = false;
					});
				}
			}
		}
	}

	async function handleConnectDevice(device: DiscoveredDevice) {
		if (connecting) return;
		connecting = true;
		try {
			if (device.source === "agent") {
				plotterStore.applyPreset(device.preset);
				if (device.portPath) plotterStore.update({ serialPort: device.portPath });
				plotterStore.switchConnection("cut-agent");
				sendSettings(plotterStore.config).catch(() => {});
				autoConnectedAgent = true;
				discoveredDevices = discoveredDevices.map(d =>
					d.id === device.id ? { ...d, status: "connected" } : d
				);
				selectedDeviceId = device.id;
				toastStore.success(`Connected · ${device.preset.name}`, `Cut Agent · ${device.portPath ?? "auto"}`);
			} else {
				if (!("serial" in navigator)) {
					toastStore.warning("Not supported", "USB Direct requires Chrome or Edge.");
					return;
				}
				if (isFree) { toastStore.info("Lite plan required", "USB Direct is available on Lite and above."); uiStore.openPricing(); return; }
				try {
					serialPortInfo = await connectSerialPort(device.preset.baudRate ?? plotterStore.config.baudRate ?? 9600);
					plotterStore.applyPreset(device.preset);
					plotterStore.switchConnection("usb-serial");
					plotterStore.update({ vendorId: serialPortInfo.vendorId, productId: serialPortInfo.productId });
					plotterStore.persistConnSettings();
					selectedDeviceId = device.id;
					discoveredDevices = discoveredDevices.map(d =>
						d.id === device.id ? { ...d, status: "connected" } : d
					);
					sendSettings(plotterStore.config).catch(() => {});
					toastStore.success(`Connected · ${device.preset.name}`, serialPortInfo.label);
				} catch (err: any) {
					if (err?.name !== "NotAllowedError") toastStore.error("Connection failed", err?.message ?? "Could not open serial port.");
					serialPortInfo = null;
				}
			}
		} finally {
			connecting = false;
		}
	}

	function handleSelectDevice(device: DiscoveredDevice) {
		if (device.status === "offline") return;
		selectedDeviceId = device.id;
		plotterStore.applyPreset(device.preset);
		if (device.portPath) plotterStore.update({ serialPort: device.portPath });
	}

	async function handleTestConnection(device: DiscoveredDevice) {
		if (testingConn) return;
		testingConn = true;
		try {
			const result = await sendToPlotter("PU;", plotterStore.config);
			if (result.ok) {
				toastStore.success("Plotter responding", `${device.preset.name} acknowledged the test command.`);
			} else {
				toastStore.warning("Test failed", result.diagnostic.title);
			}
		} finally {
			testingConn = false;
		}
	}

	async function handleGrantUsbPort() {
		if (!("serial" in navigator)) return;
		if (isFree) { uiStore.openPricing(); return; }
		try {
			const portInfo = await connectSerialPort(plotterStore.config.baudRate ?? 9600);
			serialPortInfo = portInfo;
			const matched = matchPortToPreset(portInfo.vendorId, portInfo.productId);
			if (matched) plotterStore.applyPreset(matched.preset);
			plotterStore.switchConnection("usb-serial");
			plotterStore.update({ vendorId: portInfo.vendorId, productId: portInfo.productId });
			plotterStore.persistConnSettings();
			await runDiscovery();
			toastStore.success("USB port authorized", portInfo.label);
		} catch (err: any) {
			if (err?.name !== "NotAllowedError") toastStore.error("Connection failed", err?.message ?? "Could not open port.");
		}
	}

	// `silent`: used by the auto re-optimize effect below — skips the
	// upgrade nag and "no patterns" toast, which would otherwise fire on
	// every single add/remove for a free-tier user or an empty canvas.
	function handleSmartNest(opts: { silent?: boolean } = {}) {
		const { silent = false } = opts;
		if (isFree) {
			if (!silent) {
				toastStore.info("Lite plan required", "AI deep optimization is available on Lite and above.");
				uiStore.openPricing();
			}
			return;
		}
		if (!canvasStore.items.length) {
			if (!silent) toastStore.warning("No patterns", "Add patterns to the sheet first.");
			return;
		}
		smartNesting = true;
		// Yield once so Svelte can paint the loading state before we block the thread.
		setTimeout(() => {
			try {
				// Deproxy: convert Svelte 5 reactive proxies to plain objects so the
				// nesting engine can spread/mutate them freely without triggering
				// reactive tracking or creating proxy-of-proxy structures.
				const plainItems = canvasStore.items.map((item) => ({
					...item,
					pattern: { ...item.pattern },
				}));
				const sheet = { ...canvasStore.sheet };

				const result = smartNest(plainItems, transposedSheet(sheet), true, canvasStore.state.bufferInches);

				// smartNest's random-restart search is still bbox/skyline based.
				// Compare against the true-shape NFP layout too — the deep
				// search shouldn't be allowed to regress to a worse grid packing.
				const nfpAlt = bestNest(plainItems, transposedSheet(sheet), true, canvasStore.state.bufferInches);
				const oobLen = (arr: typeof result.items) => {
					const oob = arr.filter((i) => i.outOfBounds).length;
					const fit = arr.filter((i) => !i.outOfBounds);
					const len = fit.length ? Math.max(...fit.map((i) => i.x + i.width)) : 0;
					return { oob, len };
				};
				const a = oobLen(result.items);
				const b = oobLen(nfpAlt);
				const finalItems = (b.oob < a.oob || (b.oob === a.oob && b.len <= a.len)) ? nfpAlt : result.items;
				console.log("NEST v15 handleSmartNest " + JSON.stringify({
					smartNestLen: a.len.toFixed(2), smartNestOob: a.oob,
					nfpAltLen: b.len.toFixed(2), nfpAltOob: b.oob,
					chose: finalItems === nfpAlt ? "nfpAlt" : "smartNest.result",
					patterns: plainItems.map((i) => `${i.id}:pattern=${i.pattern.name}:nomW=${i.pattern.widthInches},nomH=${i.pattern.heightInches}`),
				}, null, 2));

				canvasStore.setItems(finalItems);
				smartNestGain = result.improvementPct;

				const oob = finalItems.filter((i) => i.outOfBounds).length;
				const fit = finalItems.length - oob;
				const eff = formatEfficiency(calcEfficiency(finalItems, canvasStore.sheet));
				const gainStr = result.improvementPct >= 0.5
					? ` · ↑${result.improvementPct.toFixed(0)}% vs baseline`
					: "";
				if (oob > 0) {
					toastStore.warning(
						"AI Nest complete",
						`${fit} pieces fit · ${eff} efficiency${gainStr} · ${oob} won't cut`,
					);
				} else {
					toastStore.success(
						"AI Nest complete",
						`${fit} pieces · ${eff} efficiency${gainStr}`,
					);
				}
				fitToView();
			} catch (e) {
				console.error("[AI Nest]", e);
				toastStore.error(
					"Smart Nest failed",
					e instanceof Error ? e.message : "Could not optimize layout.",
				);
			} finally {
				smartNesting = false;
			}
		}, 16);
	}

	async function handleResumeCut() {
		if (!resumeCheckpoint) return;
		const checkpoint = resumeCheckpoint;

		const remainingItems = canvasStore.items.filter(
			(i) => checkpoint.remainingItemIds.includes(i.id),
		);
		if (!remainingItems.length) {
			resumeCheckpoint = null;
			localStorage.removeItem("omniplot-resume-checkpoint");
			return;
		}

		const abortCtrl = new AbortController();
		cutAbortController = abortCtrl;
		cutting = true;
		cutProgress = null;
		let lastCompletedIdx = -1;

		try {
			const partialState = { ...canvasStore.state, items: remainingItems };
			const result = await sendToPlotterSegmented(
				partialState,
				plotterStore.config,
				(progress) => {
					cutProgress = progress;
					lastCompletedIdx = progress.lastCompletedIndex;
				},
				abortCtrl.signal,
			);

			cutProgress = null;

			if (result.aborted) {
				const done = lastCompletedIdx + 1;
				toastStore.warning("Cut cancelled", `${done} of ${remainingItems.length} patterns sent.`);
				if (done > 0 && done < remainingItems.length) {
					const sortedRemaining = [...remainingItems].sort((a, b) => a.layer - b.layer || a.y - b.y);
					const newCheckpoint: ResumeCheckpoint = {
						remainingItemIds: sortedRemaining.slice(done).map((i) => i.id),
						completedCount: checkpoint.completedCount + done,
						totalCount: checkpoint.totalCount,
						presetName: plotterStore.config.name,
					};
					localStorage.setItem("omniplot-resume-checkpoint", JSON.stringify(newCheckpoint));
					resumeCheckpoint = newCheckpoint;
				}
			} else if (result.ok) {
				localStorage.removeItem("omniplot-resume-checkpoint");
				resumeCheckpoint = null;
				toastStore.success(
					"Resume complete",
					`${remainingItems.length} remaining pattern${remainingItems.length !== 1 ? "s" : ""} sent.`,
				);
			} else {
				if (lastCompletedIdx >= 0) {
					const sortedRemaining = [...remainingItems].sort((a, b) => a.layer - b.layer || a.y - b.y);
					const newCheckpoint: ResumeCheckpoint = {
						remainingItemIds: sortedRemaining.slice(lastCompletedIdx + 1).map((i) => i.id),
						completedCount: checkpoint.completedCount + lastCompletedIdx + 1,
						totalCount: checkpoint.totalCount,
						presetName: plotterStore.config.name,
					};
					localStorage.setItem("omniplot-resume-checkpoint", JSON.stringify(newCheckpoint));
					resumeCheckpoint = newCheckpoint;
				}
				diagData = result.diagnostic;
				diagReported = result.diagnostic.escalate;
			}
		} finally {
			cutting = false;
			cutProgress = null;
			cutAbortController = null;
		}
	}

	async function handleCut() {
		const user = userStore.user;
		if (user) {
			const check = canCut(user, shopStore.shop);
			if (!check.allowed) {
				toastStore.warning("Cut limit reached", check.reason);
				uiStore.openPricing();
				return;
			}
		}
		if (!canvasStore.items.length) {
			toastStore.warning("No patterns", "Add patterns to the sheet before cutting.");
			return;
		}

		const inBounds = canvasStore.items.filter((i) => !i.outOfBounds);
		if (!inBounds.length) {
			toastStore.warning("Nothing in bounds", "All patterns are outside the roll — adjust sheet width.");
			return;
		}

		const usedLength = Math.max(...inBounds.map((i) => i.x + i.width));
		const patternArea = inBounds.reduce(
			(s, i) => s + samplePolygonArea(i.pattern.svgPath, i.width, i.height),
			0,
		);
		const sheetArea = canvasStore.sheet.widthInches * usedLength;
		const eff       = sheetArea > 0 ? Math.min(1, patternArea / sheetArea) : 0;
		const jobName   = `Job ${new Date().toLocaleDateString()}`;
		const fileSlug  = `omniplot-${new Date().toISOString().slice(0, 10)}`;

		// ── Download mode: synchronous, no loading state needed ──────────
		if (plotterStore.config.connection === "download") {
			downloadHpgl(canvasStore.state, plotterStore.config, fileSlug);
			const connLabel = `PLT file downloaded (${inBounds.length} paths)`;
			toastStore.success("Cut job ready", connLabel);
			persistJob({ user, inBounds, eff, usedLength, patternArea, sheetArea, jobName });
			return;
		}

		// ── Live connection: async segmented send ────────────────────────
		// USB uses per-pattern segmented send so progress is tracked and the job
		// can be resumed from a known pattern index if the connection drops.
		// Network and Cut Agent use monolithic send (the agent/server handles serial).
		const abortCtrl = new AbortController();
		cutAbortController = abortCtrl;
		cutting = true;
		cutProgress = null;

		// Sorted in-bounds items match the order generateHpglSegments will use
		const sortedInBounds = [...inBounds].sort((a, b) => a.layer - b.layer || a.y - b.y);
		let lastCompletedIdx = -1;

		try {
			const result = await sendToPlotterSegmented(
				canvasStore.state,
				plotterStore.config,
				(progress) => {
					cutProgress = progress;
					lastCompletedIdx = progress.lastCompletedIndex;
				},
				abortCtrl.signal,
			);

			cutProgress = null;

			if (result.aborted) {
				// User cancelled — save a resume checkpoint if any patterns sent
				const doneSoFar = lastCompletedIdx + 1;
				toastStore.warning("Cut cancelled", `${doneSoFar} of ${inBounds.length} pattern${inBounds.length !== 1 ? "s" : ""} sent.`);
				if (doneSoFar > 0 && doneSoFar < sortedInBounds.length) {
					const checkpoint: ResumeCheckpoint = {
						remainingItemIds: sortedInBounds.slice(doneSoFar).map((i) => i.id),
						completedCount: doneSoFar,
						totalCount: sortedInBounds.length,
						presetName: plotterStore.config.name,
					};
					localStorage.setItem("omniplot-resume-checkpoint", JSON.stringify(checkpoint));
					resumeCheckpoint = checkpoint;
				}
			} else if (result.ok) {
				localStorage.removeItem("omniplot-resume-checkpoint");
				resumeCheckpoint = null;
				toastStore.success("Sent to plotter", `${inBounds.length} pattern${inBounds.length !== 1 ? "s" : ""} sent successfully.`);
				persistJob({ user, inBounds, eff, usedLength, patternArea, sheetArea, jobName });
			} else {
				const completedSoFar = lastCompletedIdx + 1;
				if (lastCompletedIdx >= 0 && lastCompletedIdx < sortedInBounds.length - 1) {
					const checkpoint: ResumeCheckpoint = {
						remainingItemIds: sortedInBounds.slice(completedSoFar).map((i) => i.id),
						completedCount: completedSoFar,
						totalCount: sortedInBounds.length,
						presetName: plotterStore.config.name,
					};
					localStorage.setItem("omniplot-resume-checkpoint", JSON.stringify(checkpoint));
					resumeCheckpoint = checkpoint;
				}
				if (completedSoFar > 0) {
					persistJob({
						user,
						inBounds: sortedInBounds,
						eff,
						usedLength,
						patternArea,
						sheetArea,
						jobName,
						status: "error",
						patternsCompleted: completedSoFar,
					});
				}
				diagData     = result.diagnostic;
				diagReported = result.diagnostic.escalate;
				if (userStore.user) {
					logPlotterError({
						userId:        userStore.user.uid,
						userEmail:     userStore.user.email ?? null,
						displayName:   userStore.user.displayName ?? null,
						plotterPreset: plotterStore.config.name,
						connection:    plotterStore.config.connection,
						protocol:      plotterStore.config.protocol,
						errorCode:     result.diagnostic.code,
						errorTitle:    result.diagnostic.title,
						errorRaw:      `${result.diagnostic.raw ?? ""} [interrupted after ${completedSoFar}/${sortedInBounds.length} patterns]`,
						agentVersion:  null,
						userAgent:     navigator.userAgent,
						autoReported:  result.diagnostic.escalate,
					}).catch(() => {});
				}
			}
		} finally {
			cutting = false;
			cutProgress = null;
			cutAbortController = null;
		}
	}

	async function diagRetry() {
		diagData = null;
		await handleCut();
	}

	async function diagReport() {
		if (!diagData || !userStore.user) return;
		await logPlotterError({
			userId:       userStore.user.uid,
			userEmail:    userStore.user.email ?? null,
			displayName:  userStore.user.displayName ?? null,
			plotterPreset: plotterStore.config.name,
			connection:   plotterStore.config.connection,
			protocol:     plotterStore.config.protocol,
			errorCode:    diagData.code,
			errorTitle:   diagData.title,
			errorRaw:     diagData.raw ?? "",
			agentVersion: agentStore.version,
			userAgent:    navigator.userAgent,
			autoReported: false,
		}).catch(() => {});
		diagReported = true;
	}

	function persistJob(opts: {
		user: typeof userStore.user;
		inBounds: typeof canvasStore.items;
		eff: number;
		usedLength: number;
		patternArea: number;
		sheetArea: number;
		jobName: string;
		status?: "complete" | "error";
		patternsCompleted?: number; // for interrupted jobs; defaults to inBounds.length
	}) {
		if (!opts.user) return;
		const status = opts.status ?? "complete";
		const patternsCompleted = opts.patternsCompleted ?? opts.inBounds.length;
		const job = {
			id: uid("job_"),
			userId: opts.user.uid,
			vehicleId: canvasStore.items[0]?.pattern.vehicleId ?? "",
			name: opts.jobName,
			status,
			canvasState: canvasStore.state,
			plotterConfig: plotterStore.config,
			materialSheet: canvasStore.sheet,
			exportFormat: "hpgl" as const,
			metrics: {
				materialEfficiency: opts.eff,
				totalPathLengthMm: 0,
				estimatedCutSeconds: estimateCutTime(opts.inBounds, plotterStore.config.cuttingSpeed),
				itemCount: opts.inBounds.length,
				patternsCompleted,
				sheetArea: opts.sheetArea,
				usedArea: opts.patternArea,
			},
			createdAt: new Date(),
			updatedAt: new Date(),
			completedAt: status === "complete" ? new Date() : null,
			exportUrl: null,
		};
		cutJobStore.addJob(job);
		// Only count usage increments for completed jobs
		if (status === "complete") {
			incrementCutUsage(opts.user.uid, opts.user.usage.monthResetAt).catch(() => {});
		}
	}

	// ─── Export confirmation ───────────────────────
	// Format the user picked from the dropdown, pending confirmation of how
	// many patterns will actually be included (out-of-bounds pieces are
	// silently skipped by the generators, so the count needs to reflect that).
	let pendingExportFormat = $state<"hpgl" | "svg" | "dxf" | null>(null);

	function requestExport(format: "hpgl" | "svg" | "dxf") {
		showExport = false;
		if (!canvasStore.items.length) {
			toastStore.warning("Nothing to export", "Add patterns first.");
			return;
		}
		if (format === "dxf" && isFree) {
			toastStore.info("Lite plan required", "DXF export is available on Lite and above.");
			uiStore.openPricing();
			return;
		}
		if (format === "hpgl" && !cutCheck.allowed) {
			toastStore.warning("Cut limit reached", cutCheck.reason ?? "Upgrade to continue.");
			uiStore.openPricing();
			return;
		}
		pendingExportFormat = format;
	}

	function confirmExport() {
		if (pendingExportFormat) handleExport(pendingExportFormat);
		pendingExportFormat = null;
	}

	// Preconditions (has items, plan gates) are already checked by requestExport
	// before pendingExportFormat is set, so this just performs the download.
	function handleExport(format: "hpgl" | "svg" | "dxf") {
		const exportSlug = `omniplot-${new Date().toISOString().slice(0, 10)}`;
		if (format === "hpgl") {
			downloadHpgl(canvasStore.state, plotterStore.config, exportSlug);
			if (userStore.user) {
				incrementCutUsage(userStore.user.uid, userStore.user.usage.monthResetAt).catch(() => {});
			}
		} else if (format === "dxf") {
			downloadDxf(canvasStore.state, exportSlug);
		} else {
			downloadSvg(canvasStore.state, exportSlug);
		}
		uiStore.closeExport();
		toastStore.success("Exported", `Downloaded as .${format}`);
	}

	// ─── Demo: add a sample item ──────────────────
	function addSampleItem() {
		const colors = ["#00E5FF", "#A78BFA", "#00D68F", "#FFB547"];
		const idx = canvasStore.items.length;
		const w = 18 - (idx % 4) * 2;
		const h = 12 - (idx % 4);
		const demoPath = "M10,90 Q15,20 50,5 Q85,20 90,90";
		const pos = findNextPosition(canvasStore.items, transposedSheet(), w, h, demoPath);
		const item: CanvasItem = {
			id: uid("item_"),
			patternId: `demo_${idx}`,
			pattern: {
				id: `demo_${idx}`,
				vehicleId: "bmw-m4-2024",
				category: "ppf",
				zone: "hood",
				name: ["Hood Main", "Fender L", "Bumper Front", "Rocker L"][
					idx % 4
				],
				coverage: "full",
				svgPath: "M10,90 Q15,20 50,5 Q85,20 90,90",
				widthInches: w,
				heightInches: h,
				revision: "2024-11",
				isPublished: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			x: pos.x,
			y: pos.y,
			width: pos.width,
			height: pos.height,
			rotation: pos.rotation,
			outOfBounds: pos.outOfBounds,
			flippedH: false,
			flippedV: false,
			scale: 1,
			layer: idx,
			locked: false,
			color: colors[idx % colors.length],
			label: ["Hood Main", "Fender L", "Bumper Front", "Rocker L"][
				idx % 4
			],
		};
		if (aiNestEnabled) {
			const nested = bestNest([...canvasStore.items, item], transposedSheet(), true, canvasStore.state.bufferInches);
			canvasStore.setItems(nested);
			canvasStore.select(item.id);
		} else {
			canvasStore.setItems([...canvasStore.items, item]);
			canvasStore.select(item.id);
		}
		toastStore.info("Pattern added", item.label);
		requestAnimationFrame(fitToView);
	}

	// ─── Vehicle grouping ─────────────────────────
	// Groups all canvas items by their vehicleId so the legend and Patterns tab
	// can show which patterns belong to which car.
	const vehicleGroups = $derived.by(() => {
		const map = new Map<string, { vehicleId: string; vehicleName: string; items: CanvasItem[] }>();
		for (const item of canvasStore.items) {
			const vid = item.pattern.vehicleId || "unknown";
			if (!map.has(vid)) {
				map.set(vid, { vehicleId: vid, vehicleName: getVehicleName(vid), items: [] });
			}
			map.get(vid)!.items.push(item);
		}
		return [...map.values()];
	});
	const hasMultipleVehicles = $derived(vehicleGroups.length > 1);
	const itemIndexMap = $derived.by(() => {
		const m = new Map<string, number>();
		canvasStore.items.forEach((it, i) => m.set(it.id, i + 1));
		return m;
	});


	// ─── Zoom shortcuts ───────────────────────────
	let showExport = $state(false);

	// ─── SVG viewBox for a pattern at its current rotation ───────────────────
	// Computes the minimal viewBox in SVG coordinate space that fully contains
	// the rotated path, so the pattern fills its canvas div with no phantom
	// whitespace from the 0-100 authoring coordinate system.
	function itemViewBox(svgPath: string, rotation: number): string {
		const bb = getSvgPathBBox(svgPath);
		const cx = bb.x + bb.w / 2;
		const cy = bb.y + bb.h / 2;
		const hw = bb.w / 2;
		const hh = bb.h / 2;
		const rad = (rotation * Math.PI) / 180;
		const cos = Math.abs(Math.cos(rad));
		const sin = Math.abs(Math.sin(rad));
		const rHW = hw * cos + hh * sin;
		const rHH = hw * sin + hh * cos;
		const PAD = 0.5; // sub-unit float safety margin
		return `${cx - rHW - PAD} ${cy - rHH - PAD} ${(rHW + PAD) * 2} ${(rHH + PAD) * 2}`;
	}

	// ─── Fit to view ─────────────────────────────
	// Calculates zoom so all placed content fits the canvas viewport.
	// canvas-content has 48px padding on each side → 96px total in each axis.
	function fitToView() {
		if (!canvasEl) return;
		const viewW = canvasEl.clientWidth;
		const viewH = canvasEl.clientHeight;
		const PAD = 96; // 48px canvas-content padding × 2
		const rollPxW = displaySheetWidth * 48;
		const rollPxH = displaySheetLength * 48;
		if (viewH > PAD && viewW > PAD && rollPxH > 0 && rollPxW > 0) {
			const zoomH = ((viewH - PAD) / rollPxH) * 100;
			const zoomW = ((viewW - PAD) / rollPxW) * 100;
			canvasStore.setZoom(Math.max(3, Math.min(100, Math.min(zoomH, zoomW))));
		}
		canvasEl.scrollLeft = 0;
		canvasEl.scrollTop = 0;
	}

	// ─── Canvas persistence ───────────────────────
	let _mounted = false;
	function handleDisconnect() {
		// Always release the Web Serial port if one is open, regardless of which
		// connection type is currently active (USB reconnect on mount may have left
		// a port open even after the UI switched to cut-agent).
		if (serialPortInfo) {
			disconnectSerialPort();
			serialPortInfo = null;
		}
		plotterStore.switchConnection("download", { save: false });
		// Mark as already-auto-connected so the 8s silent poll does NOT immediately
		// re-connect the agent after a manual disconnect. The user just chose to
		// disconnect — both method cards should stay in "Detected" state so they can
		// pick a new method. autoConnectedAgent resets to false on next onMount.
		// (The only correct place to reset it to false is line 543: when the agent
		// device physically vanishes from a scan, allowing reconnect when it returns.)
		autoConnectedAgent = true;
		showConfig = false;
		discoveredDevices = discoveredDevices.map(d =>
			d.status === "connected" ? { ...d, status: "detected" } : d
		);
		toastStore.info("Disconnected", "Connection closed.");
	}

	function maybeShowTour() {
		if (typeof localStorage !== "undefined" && !localStorage.getItem("op-tour-seen")) {
			setTimeout(() => uiStore.openTour(), 800);
		}
	}

	// Once the mandatory early access disclosure closes (acknowledged), fall
	// through to the guided tour check so the two never overlap.
	let _prevEarlyAccessOpen = false;
	$effect(() => {
		const open = uiStore.earlyAccessModalOpen;
		if (_prevEarlyAccessOpen && !open) maybeShowTour();
		_prevEarlyAccessOpen = open;
	});

	onMount(() => {
		canvasStore.restoreFromStorage();
		_mounted = true;
		requestAnimationFrame(fitToView);
		// Restore any interrupted job resume checkpoint
		if (typeof localStorage !== "undefined") {
			const raw = localStorage.getItem("omniplot-resume-checkpoint");
			if (raw) {
				try { resumeCheckpoint = JSON.parse(raw); } catch { localStorage.removeItem("omniplot-resume-checkpoint"); }
			}
		}
		// Early access disclosure gates everything else — show it first, and only
		// queue the guided tour once it has been acknowledged (or was already).
		if (typeof localStorage !== "undefined" && !localStorage.getItem("op-early-access-ack")) {
			uiStore.openEarlyAccessModal();
		} else {
			maybeShowTour();
		}

		// Initial plotter discovery
		runDiscovery();

		// If the user had a USB-serial connection before navigation, try to restore it
		// silently using the already-authorized port (no browser dialog required).
		if (plotterStore.config.connection === "usb-serial") {
			const savedVid = plotterStore.config.vendorId;
			const savedPid = plotterStore.config.productId;
			reconnectSerialPort(plotterStore.config.baudRate ?? 9600, { vendorId: savedVid, productId: savedPid }).then((info) => {
				if (info) {
					serialPortInfo = info;
					if (info.vendorId !== undefined) plotterStore.update({ vendorId: info.vendorId, productId: info.productId });
					const matched = matchPortToPreset(info.vendorId, info.productId);
					toastStore.success(`Reconnected · ${matched?.preset.name ?? info.label}`, "USB Direct");
					discoveredDevices = discoveredDevices.map(d =>
						d.source === "usb" ? { ...d, status: "connected" } : d,
					);
				} else {
					// Port no longer available — fall back to download so cut button doesn't lie
					plotterStore.switchConnection("download", { save: false });
				}
			});
		}

		// Web Serial connect/disconnect events — re-scan immediately on cable change
		const cleanup: Array<() => void> = [];
		if (typeof navigator !== "undefined" && "serial" in navigator) {
			const serial = (navigator as any).serial;
			const onSerialConnect    = () => runDiscovery();
			const onSerialDisconnect = () => runDiscovery();
			serial.addEventListener("connect",    onSerialConnect);
			serial.addEventListener("disconnect", onSerialDisconnect);
			cleanup.push(() => {
				serial.removeEventListener("connect",    onSerialConnect);
				serial.removeEventListener("disconnect", onSerialDisconnect);
			});
		}

		// Poll every 8s while an agent is connected (catch disconnects quickly);
		// back off to 60s while offline — most users never run the local Cut
		// Agent app, so there's no reason to hammer it (and log a CORS-blocked
		// request to the console) every 8s indefinitely.
		let pollTimer: ReturnType<typeof setTimeout>;
		const schedulePoll = () => {
			pollTimer = setTimeout(async () => {
				await runDiscovery(true);
				schedulePoll();
			}, agentProbeStatus === "online" ? 8_000 : 60_000);
		};
		schedulePoll();
		cleanup.push(() => clearTimeout(pollTimer));

		return () => cleanup.forEach(fn => fn());
	});

	$effect(() => {
		// Explicitly track both so the effect re-runs on any change.
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		canvasStore.items; canvasStore.sheet;
		// Skip first run — onMount hasn't restored yet, and saving here would
		// overwrite any items that were added from the library before navigating here.
		if (_mounted) canvasStore.saveToStorage();
	});
</script>

<svelte:head>
	<title>Studio — OmniPlot</title>
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet connTypeIcon(c: "usb-serial" | "cut-agent" | "network" | "download")}
	{#if c === "usb-serial"}
		<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h9M4 15h9"/><path d="M13 6h4l3 3v6l-3 3h-4"/><circle cx="7" cy="9" r="0.5" fill="currentColor"/><circle cx="7" cy="15" r="0.5" fill="currentColor"/><path d="M9 6V4M9 20v-2"/></svg>
	{:else if c === "cut-agent"}
		<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><circle cx="7" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="7" cy="16.5" r="1" fill="currentColor" stroke="none"/><path d="M12 7.5h6M12 16.5h6"/></svg>
	{:else if c === "network"}
		<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16.5a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>
	{:else}
		<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>
	{/if}
{/snippet}

{#snippet patternCard(item: CanvasItem)}
	<div class="pattern-card-wrap">
		<div
			class="pattern-card"
			class:active={canvasStore.selected.includes(item.id)}
			class:expanded={expandedItemId === item.id}
			role="button"
			tabindex="0"
			aria-pressed={canvasStore.selected.includes(item.id)}
			aria-expanded={expandedItemId === item.id}
			onclick={() => {
				canvasStore.select(item.id);
				expandedItemId = expandedItemId === item.id ? null : item.id;
			}}
			onkeydown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					canvasStore.select(item.id);
					expandedItemId = expandedItemId === item.id ? null : item.id;
				}
			}}
		>
			<div class="pattern-card__thumb" style="border-color: {item.color}20">
				<svg width="44" height="30" viewBox="0 0 100 90" aria-hidden="true">
					<path d={item.pattern.svgPath} fill="none" stroke={item.color} stroke-width="2" />
				</svg>
			</div>
			<div class="pattern-card__info">
				<div class="pattern-card__name">{item.label ?? item.pattern.name} ({itemIndexMap.get(item.id)})</div>
				<div class="pattern-card__meta">{item.width.toFixed(1)}" × {item.height.toFixed(1)}"</div>
			</div>
			<svg
				class="pattern-card__chevron"
				class:pattern-card__chevron--open={expandedItemId === item.id}
				width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
			>
				<polyline points="6 9 12 15 18 9" />
			</svg>
			<button
				class="pattern-card__del"
				onclick={(e) => {
					e.stopPropagation();
					canvasStore.select(item.id);
					canvasStore.removeSelected();
					if (expandedItemId === item.id) expandedItemId = null;
				}}
				aria-label="Remove {item.label}"
			>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"
					><path d="M18 6L6 18M6 6l12 12" /></svg>
			</button>
		</div>

		{#if expandedItemId === item.id}
			<div class="pattern-card__panel">
				<!-- Position: drag the X/Y tag to scrub the value live (like a design-tool
				     number field), click it to jump into the input and type, or use
				     ↑/↓ (+ shift for coarse steps) once focused. -->
				<div class="pattern-card__group">
					<div class="pattern-card__group-label">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></svg>
						Position
					</div>
					<div class="pattern-card__field-row">
						<div class="pattern-card__field">
							<span
								class="pattern-card__field-tag"
								class:scrubbing={scrubbingAxis === "x"}
								role="slider"
								tabindex="0"
								aria-label="X position — drag to adjust, click to type"
								aria-valuenow={item.x}
								onpointerdown={(e) => scrubPosition(e, item, "x")}
							>X</span>
							<input
								type="number"
								class="pattern-card__field-input"
								value={item.x.toFixed(2)}
								step="0.1"
								aria-label="X position"
								onclick={(e) => e.stopPropagation()}
								onkeydown={(e) => nudgePosition(e, item, "x")}
								onchange={(e) =>
									canvasStore.updateItem(item.id, {
										x: parseFloat((e.target as HTMLInputElement).value),
									})}
							/>
							<span class="pattern-card__field-unit">in</span>
						</div>
						<div class="pattern-card__field">
							<span
								class="pattern-card__field-tag"
								class:scrubbing={scrubbingAxis === "y"}
								role="slider"
								tabindex="0"
								aria-label="Y position — drag to adjust, click to type"
								aria-valuenow={item.y}
								onpointerdown={(e) => scrubPosition(e, item, "y")}
							>Y</span>
							<input
								type="number"
								class="pattern-card__field-input"
								value={item.y.toFixed(2)}
								step="0.1"
								aria-label="Y position"
								onclick={(e) => e.stopPropagation()}
								onkeydown={(e) => nudgePosition(e, item, "y")}
								onchange={(e) =>
									canvasStore.updateItem(item.id, {
										y: parseFloat((e.target as HTMLInputElement).value),
									})}
							/>
							<span class="pattern-card__field-unit">in</span>
						</div>
					</div>
				</div>

				<!-- Size: read-only, so it's visually distinct from the editable
				     position fields above (chips, not inputs — nothing to click into). -->
				<div class="pattern-card__group">
					<div class="pattern-card__group-label">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
						Size
					</div>
					<div class="pattern-card__size-row">
						<span class="pattern-card__size-chip">{item.width.toFixed(2)}" <em>W</em></span>
						<span class="pattern-card__size-chip">{item.height.toFixed(2)}" <em>H</em></span>
					</div>
				</div>

				<div class="pattern-card__group">
					<div class="pattern-card__group-label">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 11-3.5-7.1" /><polyline points="21 3 21 9 15 9" /></svg>
						Transform
					</div>
					<div class="pattern-card__row">
						<span class="pattern-card__rot-value">{item.rotation}°</span>
						<button
							class="pattern-card__ctrl-btn"
							onclick={(e) => { e.stopPropagation(); canvasStore.updateItem(item.id, { rotation: (item.rotation + 270) % 360 }); }}
							aria-label="Rotate -90°"
							title="Rotate -90°"
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-1" /></svg>
						</button>
						<button
							class="pattern-card__ctrl-btn"
							onclick={(e) => { e.stopPropagation(); canvasStore.updateItem(item.id, { rotation: (item.rotation + 90) % 360 }); }}
							aria-label="Rotate +90°"
							title="Rotate +90°"
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h1" /></svg>
						</button>
						<button
							class="pattern-card__ctrl-btn pattern-card__ctrl-btn--wide"
							class:active={item.flippedH}
							onclick={(e) => { e.stopPropagation(); canvasStore.updateItem(item.id, { flippedH: !item.flippedH }); }}
						>Flip H</button>
						<button
							class="pattern-card__ctrl-btn pattern-card__ctrl-btn--wide"
							class:active={item.flippedV}
							onclick={(e) => { e.stopPropagation(); canvasStore.updateItem(item.id, { flippedV: !item.flippedV }); }}
						>Flip V</button>
					</div>
					<div class="pattern-card__row">
						<button
							class="pattern-card__ctrl-btn pattern-card__ctrl-btn--wide"
							class:active={item.locked}
							onclick={(e) => { e.stopPropagation(); canvasStore.updateItem(item.id, { locked: !item.locked }); }}
						>{item.locked ? "Locked" : "Lock position"}</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<div class="studio">
	<!-- Header wrapper: keeps the toolbar + optional banners as ONE grid item,
	     so .studio__body always lands in the grid's 1fr row regardless of how
	     many of the conditional banners below are actually rendered (grid
	     auto-placement fills explicit row tracks in DOM order, so with fewer
	     items than declared rows, body would otherwise slide into an earlier
	     "auto" track and leave the real 1fr track empty — a big dead zone). -->
	<div class="studio__header">
	<!-- ─── Canvas Toolbar ─── -->
	<div class="studio__toolbar">
		<!-- Tool group -->
		<div class="tool-group">
			{#each ["select", "pan"] as const as toolName}
				<button
					class="tool-btn"
					class:active={canvasStore.tool === toolName}
					onclick={() => canvasStore.setTool(toolName)}
					title={toolName}
					aria-pressed={canvasStore.tool === toolName}
				>
					{#if toolName === "select"}
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><path d="M5 3l14 9-7 1-4 7z" /></svg
						>
					{:else}
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><path d="M5 9l7-7 7 7M5 15l7 7 7-7" /></svg
						>
					{/if}
				</button>
			{/each}
		</div>

		<div class="toolbar-sep" aria-hidden="true"></div>

		<!-- Edit actions -->
		<div class="tool-group" data-tour="toolbar-nest">
			<!-- AI Nest mode toggle — ON by default; turning off enables manual placement -->
			<button
				class="tool-btn tool-btn--ai-mode"
				class:active={aiNestEnabled}
				title={aiNestEnabled ? "AI Nest ON — patterns auto-arrange on add (click to disable for manual placement)" : "AI Nest OFF — manual placement mode (click to re-enable)"}
				onclick={() => { aiNestEnabled = !aiNestEnabled; }}
				aria-pressed={aiNestEnabled}
				aria-label="Toggle AI Nest mode"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
				</svg>
				<span class="ai-mode-label">{aiNestEnabled ? "AI Nest" : "Manual"}</span>
			</button>
			<!-- Deep optimize button — reruns full smartNest on demand (Lite+) -->
			<button
				class="tool-btn tool-btn--ai-optimize"
				class:loading={smartNesting}
				title={isFree ? "AI deep optimization — Lite plan required" : "Re-optimize — run deep AI nesting across all patterns now"}
				onclick={() => handleSmartNest()}
				disabled={smartNesting}
				aria-label="Run deep AI nest optimization"
			>
				{#if smartNesting}
					<span class="ai-spinner" aria-hidden="true"></span>
				{:else}
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
						<path d="M3 3v5h5" />
						<path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
						<path d="M16 16h5v5" />
					</svg>
				{/if}
			</button>
			<!-- Auto re-optimize toggle — ON by default; runs the same deep AI
			     nest as the button above automatically on add/remove -->
			<button
				class="tool-btn tool-btn--auto-reoptimize"
				class:active={autoReoptimize}
				title={autoReoptimize
					? "Auto Re-optimize ON — deep AI nest reruns automatically when a pattern is added or removed (click to switch to manual)"
					: "Auto Re-optimize OFF — click Re-optimize to run it manually (click to re-enable auto)"}
				onclick={() => { autoReoptimize = !autoReoptimize; }}
				aria-pressed={autoReoptimize}
				aria-label="Toggle automatic re-optimize on add/remove"
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill={autoReoptimize ? "currentColor" : "none"}
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M13 2 3 14h7l-1 8 11-14h-7l1-6z" />
				</svg>
				<span class="ai-mode-label">{autoReoptimize ? "Auto" : "Manual"}</span>
			</button>
			<button
				class="tool-btn"
				title="Undo"
				onclick={canvasStore.undo}
				disabled={!canvasStore.canUndo}
				aria-label="Undo"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><path d="M9 14L4 9l5-5" /><path
						d="M4 9h10.5a5.5 5.5 0 010 11H11"
					/></svg
				>
			</button>
			<button
				class="tool-btn"
				title="Redo"
				onclick={canvasStore.redo}
				disabled={!canvasStore.canRedo}
				aria-label="Redo"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><path d="M15 14l5-5-5-5" /><path
						d="M20 9H9.5a5.5 5.5 0 000 11H13"
					/></svg
				>
			</button>
		</div>

		<div class="toolbar-sep" aria-hidden="true"></div>

		<!-- Zoom -->
		<div class="zoom-control" role="group" aria-label="Zoom">
			<button
				class="tool-btn"
				onclick={() => canvasStore.setZoom(canvasStore.zoom - 5)}
				aria-label="Zoom out"
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					aria-hidden="true"><path d="M5 12h14" /></svg
				>
			</button>
			<div class="zoom-display" aria-label="Current zoom">
				{Math.round(canvasStore.zoom)}%
			</div>
			<button
				class="tool-btn"
				onclick={() => canvasStore.setZoom(canvasStore.zoom + 5)}
				aria-label="Zoom in"
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg
				>
			</button>
		</div>

		<!-- Fit to view -->
		<button
			class="tool-btn"
			title="Fit roll to view (F)"
			onclick={fitToView}
			aria-label="Fit roll to view"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><polyline points="15 3 21 3 21 9" /><polyline
					points="9 21 3 21 3 15"
				/><line x1="21" y1="3" x2="14" y2="10" /><line
					x1="3"
					y1="21"
					x2="10"
					y2="14"
				/></svg
			>
		</button>

		<!-- View toggles -->
		<button
			class="tool-btn"
			class:active={canvasStore.state.showGrid}
			onclick={canvasStore.toggleGrid}
			title="Toggle grid"
			aria-pressed={canvasStore.state.showGrid}
			aria-label="Toggle grid"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				stroke-linecap="round"
				aria-hidden="true"
				><path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" /></svg
			>
		</button>

		<!-- Add demo item -->
		<button
			class="tool-btn"
			title="Add sample pattern"
			onclick={addSampleItem}
			aria-label="Add sample pattern"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg
			>
		</button>

		<!-- Clear canvas -->
		<button
			class="tool-btn tool-btn--danger"
			title="Clear all patterns from canvas"
			onclick={handleClearCanvas}
			disabled={canvasStore.items.length === 0}
			aria-label="Clear canvas"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><polyline points="3 6 5 6 21 6" /><path
					d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
				/></svg
			>
		</button>

		<!-- Spacer -->
		<div style="flex:1" aria-hidden="true"></div>

		<!-- Plotter status badge: quick-glance name, connection type, and live status -->
		<div
			class="plotter-badge plotter-badge--{toolbarPlotterBadge.tone}"
			title="{toolbarPlotterBadge.name ?? 'No plotter'} · {toolbarPlotterBadge.detail}"
			role="status"
			aria-live="polite"
		>
			<span class="plotter-badge__dot" aria-hidden="true"></span>
			{#if toolbarPlotterBadge.connType}
				<span class="plotter-badge__medallion plotter-badge__medallion--{toolbarPlotterBadge.connType}">
					{@render connTypeIcon(toolbarPlotterBadge.connType)}
				</span>
			{/if}
			<span class="plotter-badge__text">
				<span class="plotter-badge__name">{toolbarPlotterBadge.name ?? "No plotter"}</span>
				<span class="plotter-badge__detail">{toolbarPlotterBadge.detail}</span>
			</span>
			<button
				class="plotter-badge__action"
				onclick={openPlotterTab}
				title={toolbarPlotterBadge.state === "connected" || toolbarPlotterBadge.state === "cutting" ? "View plotter settings" : "Connect a plotter"}
			>
				{toolbarPlotterBadge.state === "connected" || toolbarPlotterBadge.state === "cutting" ? "View" : "Connect"}
			</button>
		</div>

		<!-- Spacer -->
		<div style="flex:1" aria-hidden="true"></div>

		<!-- Cut progress indicator — shown during segmented USB send -->
		{#if cutProgress}
			<div class="cut-progress" role="status" aria-live="polite" aria-label="Cut progress">
				<div class="cut-progress__track">
					<div class="cut-progress__fill" style="width: {(cutProgress.sent / cutProgress.total) * 100}%"></div>
				</div>
				<span class="cut-progress__label">{cutProgress.sent}/{cutProgress.total}</span>
			</div>
		{/if}

		<!-- Community template upload -->
		<a class="community-btn" href="/library/upload" data-tour="community-upload" title="Upload a cut pattern to the community library" aria-label="Upload a cut pattern to the community library">
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
		</a>

		<!-- Export button -->
		<button class="export-btn" onclick={() => (showExport = !showExport)} title="Export" aria-label="Export">
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><path
					d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
				/></svg
			>
		</button>

		<!-- Manual mode reminder — shown whenever a live connection is active -->
		{#if plotterStore.config.connection !== "download"}
			<span class="offline-tip" title="Most cutters must be in Manual or Offline mode on their front panel before they will accept serial commands.">
				<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
				Set cutter to <strong>Manual / Offline</strong> mode first
			</span>
		{/if}

		<!-- Abort button — replaces cut button while a job is in progress -->
		{#if cutting}
			<button
				class="abort-btn"
				onclick={() => cutAbortController?.abort()}
				title="Stop the current cut job. The plotter finishes its current move, then stops."
				aria-label="Abort cut job"
			>
				<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
				Abort
			</button>
		{/if}

		<!-- Cut button -->
		<button
			class="cut-btn"
			class:cut-btn--locked={!cutCheck.allowed}
			class:cut-btn--hidden={cutting}
			data-tour="cut-btn"
			onclick={handleCut}
			disabled={cutting || !cutCheck.allowed}
			title={!cutCheck.allowed ? (cutCheck.reason ?? "Cut limit reached — upgrade to continue") : undefined}
			aria-disabled={!cutCheck.allowed}
		>
			{#if cutting}
				<span class="ai-spinner" aria-hidden="true"></span>
				<span class="ai-label">Sending…</span>
			{:else if !cutCheck.allowed}
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
				Upgrade to Cut
			{:else}
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><circle cx="6" cy="6" r="3" /><circle
						cx="6"
						cy="18"
						r="3"
					/><path
						d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"
					/></svg
				>
				Cut
				<span class="cut-btn__count">{cutsRemainingDisplay}</span>
			{/if}
		</button>
	</div>

	<!-- Export dropdown -->
	{#if showExport}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="export-dropdown-backdrop"
			onclick={() => (showExport = false)}
		></div>
		<div class="export-dropdown animate-slide-down">
			<button class="export-option" class:export-option--locked={pltLocked} onclick={() => requestExport("hpgl")}>
				<div class="export-option__icon">PLT</div>
				<div class="export-option__body">
					<div class="export-option__title">
						PLT file
						{#if pltLocked}<span class="export-lock-badge">Limit reached</span>{/if}
					</div>
					<div class="export-option__desc">Universal plotter format. Works with any cutter.</div>
				</div>
			</button>
			<button class="export-option" onclick={() => requestExport("svg")}>
				<div class="export-option__icon">SVG</div>
				<div class="export-option__body">
					<div class="export-option__title">SVG file</div>
					<div class="export-option__desc">For FlexiSIGN, Inkscape, Illustrator.</div>
				</div>
			</button>
			<button class="export-option" class:export-option--locked={dxfLocked} onclick={() => requestExport("dxf")}>
				<div class="export-option__icon">DXF</div>
				<div class="export-option__body">
					<div class="export-option__title">
						DXF file
						{#if dxfLocked}<span class="export-lock-badge">Lite+</span>{/if}
					</div>
					<div class="export-option__desc">For AutoCAD-compatible tools and CNC software.</div>
				</div>
			</button>
		</div>
	{/if}

	<!-- ─── Export confirmation dialog ─── -->
	{#if pendingExportFormat}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="export-confirm-backdrop" onclick={() => (pendingExportFormat = null)}></div>
		<div class="export-confirm animate-slide-down" role="alertdialog" aria-modal="true" aria-labelledby="export-confirm-title">
			<p id="export-confirm-title" class="export-confirm__title">
				Export {cutCount} {cutCount === 1 ? "pattern" : "patterns"} as .{pendingExportFormat}?
			</p>
			{#if outOfBoundsCount > 0}
				<p class="export-confirm__note">
					{outOfBoundsCount} {outOfBoundsCount === 1 ? "piece" : "pieces"} outside the material zone won't be included.
				</p>
			{/if}
			<div class="export-confirm__actions">
				<button class="export-confirm__btn export-confirm__btn--ghost" onclick={() => (pendingExportFormat = null)}>Cancel</button>
				<button class="export-confirm__btn export-confirm__btn--primary" onclick={confirmExport}>Export</button>
			</div>
		</div>
	{/if}

	<!-- ─── Vehicle legend ─── -->
	{#if hasMultipleVehicles}
		<div class="vehicle-legend" role="region" aria-label="Subject breakdown">
			{#each vehicleGroups as group (group.vehicleId)}
				<div class="vl-group">
					<span class="vl-car">{group.vehicleName}</span>
					<div class="vl-chips">
						{#each group.items as item (item.id)}
							<button
								class="vl-chip"
								class:vl-chip--sel={canvasStore.selected.includes(item.id)}
								style="--chip: {item.color}"
								onclick={() => canvasStore.select(item.id)}
								title="{item.label ?? item.pattern.name} · {item.width.toFixed(1)}&quot; × {item.height.toFixed(1)}&quot;"
							>
								<span class="vl-dot" aria-hidden="true"></span>
								{item.label ?? item.pattern.zone}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- ─── Resume banner ─── -->
	{#if resumeCheckpoint && !cutting}
		<div class="resume-banner" role="alert">
			<div class="resume-banner__info">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
				<span>
					Job interrupted — <strong>{resumeCheckpoint.totalCount - resumeCheckpoint.completedCount}</strong> of <strong>{resumeCheckpoint.totalCount}</strong> patterns remaining
					{#if resumeCheckpoint.presetName}
						<span class="resume-banner__preset">· {resumeCheckpoint.presetName}</span>
					{/if}
				</span>
			</div>
			<div class="resume-banner__actions">
				<button class="resume-banner__btn resume-banner__btn--primary" onclick={handleResumeCut} disabled={cutting}>
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
					Resume Cut
				</button>
				<button
					class="resume-banner__btn resume-banner__btn--ghost"
					onclick={() => { resumeCheckpoint = null; localStorage.removeItem("omniplot-resume-checkpoint"); }}
				>Dismiss</button>
			</div>
		</div>
	{/if}
	</div>

	<!-- ─── Main area ─── -->
	<div class="studio__body" class:studio__body--collapsed={panelCollapsed}>
		<!-- Canvas -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
		<div
			class="canvas-area"
			class:show-grid={canvasStore.state.showGrid}
			bind:this={canvasEl}
			onmousemove={onCanvasMouseMove}
			onclick={onCanvasClick}
			role="application"
			aria-label="Cut layout canvas"
			data-tour="canvas"
		>
			{#if canvasStore.state.showGrid}
				<div class="canvas-grid" aria-hidden="true"></div>
				<div class="canvas-grid-major" aria-hidden="true"></div>
			{/if}

			<div
				class="canvas-content"
			>
				<!-- Roll header: material label + ruler, spans the roll's full width.
				     The ruler marks the roll's WIDTH axis (screen-horizontal — same
				     axis item.y positions travel along), not how much length has
				     been used. -->
				<div
					class="roll-header"
					style="width: {displaySheetWidth * 48 * canvasStore.zoom / 100}px;"
				>
					<div class="roll-header__top">
						<div class="sheet-label">
							{materialBaseName} ({rollLengthFt}ft) {canvasStore.sheet.widthInches}" Wide - {usedLengthFt.toFixed(1)}/{rollLengthFt} USED
						</div>
						<div class="ruler__unit-toggle" role="group" aria-label="Ruler spacing">
							{#each RULER_STEPS as step}
								<button
									type="button"
									class="ruler__unit-btn"
									class:active={canvasStore.state.rulerStepInches === step}
									onclick={() => canvasStore.setRulerStep(step)}
								>{step}"</button>
							{/each}
						</div>
					</div>
					<div class="ruler">
						{#each rulerMinorTicks as t (t)}
							<div class="ruler__tick ruler__tick--minor" style="left: {t * 48 * canvasStore.zoom / 100}px">
								<span class="ruler__mark ruler__mark--minor"></span>
							</div>
						{/each}
						{#each rulerMajorTicks as t (t)}
							<div class="ruler__tick" style="left: {t * 48 * canvasStore.zoom / 100}px">
								<span class="ruler__mark"></span>
								<span class="ruler__num">{t}"</span>
							</div>
						{/each}
					</div>
				</div>

				<!-- Roll frame: the visual footprint after the 90° rotation below —
				     width = roll width (screen-horizontal), height = length used (screen-vertical) -->
				<div
					class="roll-frame"
					style="
            width: {displaySheetWidth * 48 * canvasStore.zoom / 100}px;
            height: {displaySheetLength * 48 * canvasStore.zoom / 100}px;
          "
				>
					<!-- Ghost roll-direction guide: length runs top-to-bottom on screen
					     (see the rotation note above the .material-sheet block below), so
					     this is just context for which way the physical roll feeds/unrolls
					     while cutting — purely decorative, not part of the sheet itself. -->
					<div class="print-direction" aria-hidden="true">
						<span class="print-direction__text">Prints this way</span>
						<svg class="print-direction__arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>
					</div>

					<!-- Material sheet: laid out in its own natural frame (length along X,
					     roll width along Y — matching how items are positioned/nested),
					     then rotated 90° into the roll-frame above so the roll's width
					     reads as screen-horizontal without touching any item math. -->
					<div
						class="material-sheet"
						style="
            width: {displaySheetLength * 48 * canvasStore.zoom / 100}px;
            height: {displaySheetWidth * 48 * canvasStore.zoom / 100}px;
          "
					>
					<!-- Roll-width boundary line: only needed when the out-of-bounds strip pushes the canvas wider than the roll -->
					{#if canvasStore.sheet.widthInches < displaySheetWidth}
						<div
							class="roll-boundary"
							style="top: {(displaySheetWidth - canvasStore.sheet.widthInches) * 48 * canvasStore.zoom / 100}px"
							aria-hidden="true"
						></div>
					{/if}

					<!-- Plotter limit line: shown when material is wider than plotter's max cutting width -->
					{#if compat !== "ok" && plotterMaxWidthIn < canvasStore.sheet.widthInches}
						<div
							class="plotter-limit-line"
							class:plotter-limit-line--overflow={compat === "overflow"}
							class:plotter-limit-line--tight={compat === "tight"}
							style="top: {(displaySheetWidth - plotterMaxWidthIn) * 48 * canvasStore.zoom / 100}px"
							aria-label="Plotter cutting limit: {plotterStore.config.name} max {plotterMaxWidthIn.toFixed(1)}&quot;"
						>
							<span class="plotter-limit-label">
								{plotterStore.config.name} limit · {plotterMaxWidthIn.toFixed(1)}"
							</span>
						</div>
					{/if}

					<!-- Cut items -->
					{#each canvasStore.items as item (item.id)}
						{@const _bb = getSvgPathBBox(item.pattern.svgPath)}
						{@const _textBase = item.label ?? item.pattern.zone ?? ''}
						{@const _textStr = _textBase ? `${_textBase} (${itemIndexMap.get(item.id) ?? ''})` : `(${itemIndexMap.get(item.id) ?? ''})`}
						{@const _vname = hasMultipleVehicles ? getVehicleName(item.pattern.vehicleId).split(' ').slice(1).join(' ') : ''}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							class="cut-item"
							class:selected={canvasStore.selected.includes(item.id)}
							class:cut-item--oob={item.outOfBounds}
							style="
                left: {item.x * 48 * canvasStore.zoom / 100}px;
                top: {(displaySheetWidth - item.y - item.height) * 48 * canvasStore.zoom / 100}px;
                width: {item.width * 48 * canvasStore.zoom / 100}px;
                height: {item.height * 48 * canvasStore.zoom / 100}px;
              "
							role="button"
							tabindex="0"
							aria-label={item.label ?? item.pattern.name}
							aria-pressed={canvasStore.selected.includes(
								item.id,
							)}
							onclick={(e) => {
								e.stopPropagation();
								canvasStore.select(item.id, e.shiftKey);
							}}
							onkeydown={(e) =>
								e.key === "Enter" &&
								canvasStore.select(item.id)}
						>
							<svg
								width="100%"
								height="100%"
								viewBox={itemViewBox(item.pattern.svgPath, item.rotation)}
								preserveAspectRatio="none"
								aria-hidden="true"
							>
								<g transform="rotate({item.rotation} {_bb.x + _bb.w / 2} {_bb.y + _bb.h / 2})">
									<g transform={item.flippedH ? `matrix(-1 0 0 1 ${2 * (_bb.x + _bb.w / 2)} 0)` : undefined}>
										<path
											d={item.pattern.svgPath}
											fill="{item.color}20"
											stroke={item.color}
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round"
											vector-effect="non-scaling-stroke"
											class:marching-ants={canvasStore.selected.includes(
												item.id,
											)}
										/>
									</g>
								</g>
							</svg>
							<!-- Label rendered as plain HTML, outside the rotated/skewed SVG
							     (the SVG uses preserveAspectRatio="none" to fill the item's
							     true-shape bbox, which non-uniformly stretches anything drawn
							     inside it — a counter-rotation there would shear, not just
							     un-rotate). Overlaying the label in ordinary page coordinates
							     keeps it upright and readable at any rotation/flip. -->
							<div class="cut-item__label" aria-hidden="true" style="color: {item.color}">
								<span>{_textStr}</span>
								{#if hasMultipleVehicles}
									<span class="cut-item__label-sub">{_vname}</span>
								{/if}
							</div>
							{#if canvasStore.selected.includes(item.id)}
								<div
									class="cut-item__ring"
									aria-hidden="true"
									style="border-color: {item.color}"
								></div>
								<!-- handles -->
								{#each ["tl", "tr", "bl", "br"] as corner}
									<div
										class="cut-item__handle cut-item__handle--{corner}"
										aria-hidden="true"
										style="background: {item.color}"
									></div>
								{/each}
								<button
									class="cut-item__del"
									onclick={(e) => {
										e.stopPropagation();
										canvasStore.select(item.id);
										canvasStore.removeSelected();
									}}
									title="Delete (Del)"
									aria-label="Delete {item.label ?? item.pattern.name}"
								>
									<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
								</button>
							{/if}
							{#if item.outOfBounds}
								<div class="cut-item__oob-badge" aria-label="Won't cut — outside material zone">
									<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
									Won't cut
								</div>
							{/if}
						</div>
					{/each}
					</div>

					{#if canvasStore.items.length === 0}
						<!-- Kept outside the rotated .material-sheet so this reads normally, not sideways -->
						<div class="canvas-empty">
							<div class="canvas-empty__icon" aria-hidden="true">
								<svg
									width="32"
									height="32"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path
										d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"
									/></svg
								>
							</div>
							<p class="canvas-empty__title">
								No patterns on sheet
							</p>
							<p class="canvas-empty__sub">
								Browse the <a href="/library">pattern library</a
								> or click + above to add a sample.
							</p>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Right panel -->
		<aside class="studio__panel" class:studio__panel--collapsed={panelCollapsed}>
			<button
				class="panel-collapse-btn"
				onclick={() => (panelCollapsed = !panelCollapsed)}
				title={panelCollapsed ? "Expand settings panel" : "Collapse settings panel"}
				aria-label={panelCollapsed ? "Expand settings panel" : "Collapse settings panel"}
				aria-expanded={!panelCollapsed}
			>
				<svg class="panel-collapse-btn__gear" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<circle cx="12" cy="12" r="3" />
					<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
				</svg>
				<svg class="panel-collapse-btn__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform: rotate({panelCollapsed ? 180 : 0}deg); transition: transform 0.18s;">
					<polyline points="9 18 15 12 9 6" />
				</svg>
			</button>

			{#if !panelCollapsed}
			<div class="panel-content">
			<div class="panel-tabs" role="tablist" data-tour="panel-tabs">
				{#each ["patterns", "plotter", "properties"] as const as tab}
					<button
						class="panel-tab"
						class:active={panelTab === tab}
						onclick={() => (panelTab = tab)}
						role="tab"
						aria-selected={panelTab === tab}
						aria-controls="panel-{tab}"
					>
						{tab.charAt(0).toUpperCase() + tab.slice(1)}
						{#if tab === "patterns" && canvasStore.items.length > 0}
							<span class="panel-tab__badge" title="{canvasStore.items.length} patterns on sheet">{canvasStore.items.length}</span>
						{:else if tab === "properties" && canvasStore.items.length > 0}
							<span class="panel-tab__badge panel-tab__badge--eff" title="Nesting efficiency">{Math.round(efficiency * 100)}%</span>
						{:else if tab === "plotter"}
							<span
								class="panel-tab__dot panel-tab__dot--{plotterStatusInfo.tone}"
								title={plotterStatusInfo.label}
								aria-label="Plotter status: {plotterStatusInfo.label}"
							></span>
						{/if}
					</button>
				{/each}
			</div>

			<div class="panel-body" id="panel-{panelTab}" role="tabpanel">
				<!-- Properties tab (material / roll settings — per-pattern move,
				     rotate, and flip controls live on each card's accordion
				     in the Patterns tab now) -->
				{#if panelTab === "properties"}
					<div class="prop-section">
						<div class="prop-label">Material</div>
						<select
							class="prop-select"
							aria-label="Material sheet"
							onchange={(e) => {
								const mat = DEFAULT_MATERIALS.find(
									(m) =>
										m.id ===
										(e.target as HTMLSelectElement).value,
								);
								if (mat) renestOnSheet(mat);
							}}
						>
							{#each DEFAULT_MATERIALS as mat}
								<option
									value={mat.id}
									selected={canvasStore.sheet.id === mat.id}
									>{mat.name}</option
								>
							{/each}
						</select>
					</div>

					<div class="prop-section">
						<div class="prop-label">Roll Width</div>
						<div class="roll-width-pills">
							{#each [20, 24, 36, 40, 48, 60] as w}
								<button
									class="roll-pill"
									class:active={canvasStore.sheet.widthInches === w}
									onclick={() => {
										const mat =
											DEFAULT_MATERIALS.find(
												(m) => m.widthInches === w,
											) ?? {
												...canvasStore.sheet,
												id: `roll-${w}`,
												name: `Roll ${w}" × 100ft`,
												widthInches: w,
												heightInches: 1200,
											};
										renestOnSheet(mat);
									}}
								>{w}"</button
								>
							{/each}
						<label class="auto-fit-toggle">
							<input type="checkbox" bind:checked={autoFitZoomOnRollChange} />
							Auto-fit zoom on roll change
						</label>
						</div>
					</div>

					<div class="prop-section">
						<div class="prop-label">Roll Length</div>
						<div class="roll-length-row">
							<input
								type="number"
								class="prop-input"
								min="1"
								step="1"
								value={rollLengthFt}
								aria-label="Roll length in feet"
								onchange={(e) => {
									const ft = parseFloat((e.target as HTMLInputElement).value);
									if (!Number.isFinite(ft) || ft <= 0) return;
									renestOnSheet({ ...canvasStore.sheet, heightInches: ft * 12 });
								}}
							/>
							<span class="roll-length-unit">ft</span>
						</div>
					</div>

					<div class="prop-section">
						<div class="prop-label">Nesting efficiency</div>
						<div class="eff-bar-wrap">
							<div
								class="eff-bar-track"
								role="progressbar"
								aria-valuenow={Math.round(efficiency * 100)}
								aria-valuemin={0}
								aria-valuemax={100}
							>
								<div
									class="eff-bar-fill"
									style="width: {efficiency *
										100}%; background: {efficiency > 0.7
										? 'var(--color-success)'
										: efficiency > 0.5
											? 'var(--color-warning)'
											: 'var(--color-danger)'};"
								></div>
							</div>
							<div class="eff-bar-labels">
								<span>{formatEfficiency(efficiency)} used</span>
								<span style="color: var(--color-warning)"
									>{formatEfficiency(1 - efficiency)} waste</span
								>
							</div>
						</div>
					</div>

					<!-- Patterns tab -->
				{:else if panelTab === "patterns"}
					<div class="buffer-control">
						<label for="buffer-input" class="buffer-control__label">
							Cut buffer
							<span
								class="info-tip"
								data-tip="Minimum gap kept between pieces (and from the roll edge) when nesting. Negative values intentionally allow pieces to overlap -- only set this below zero on purpose."
							>?</span>
						</label>
						<div class="buffer-control__row">
							<input
								id="buffer-input"
								type="number"
								step="0.01"
								min="-5"
								max="12"
								value={canvasStore.state.bufferInches}
								onchange={(e) => {
									const v = parseFloat((e.target as HTMLInputElement).value);
									if (!Number.isNaN(v)) {
										canvasStore.setBufferInches(v);
										if (canvasStore.items.length) handleAutoNest();
									}
								}}
							/>
							<span class="buffer-control__unit">in</span>
							{#if canvasStore.state.bufferInches < 0}
								<span class="buffer-control__warn" title="Pieces are allowed to intentionally overlap">Overlap allowed</span>
							{/if}
						</div>
					</div>
					<div class="prop-label" style="padding: 0 0 10px;">
						Placed patterns
						{#if canvasStore.items.length}
							<span class="patterns-count">{canvasStore.items.length}</span>
						{/if}
					</div>
					{#if canvasStore.items.length}
						{#if hasMultipleVehicles}
							<!-- Grouped by vehicle -->
							{#each vehicleGroups as group (group.vehicleId)}
								<div class="vehicle-section">
									<div class="vehicle-section__header">
										<span class="vehicle-section__name">{group.vehicleName}</span>
										<span class="vehicle-section__count">{group.items.length}</span>
									</div>
									{#each group.items as item (item.id)}
										{@render patternCard(item)}
									{/each}
								</div>
							{/each}
						{:else}
							<!-- Flat list (single vehicle) -->
							{#each canvasStore.items as item (item.id)}
								{@render patternCard(item)}
							{/each}
						{/if}
					{:else}
						<div class="panel-placeholder">
							<p>
								No patterns placed. Browse the library to add
								some.
							</p>
						</div>
					{/if}
					<Button
						variant="secondary"
						size="sm"
						href="/library"
						class="mt-3">Browse Library →</Button
					>

					<!-- Community upload CTA -->
					<a href="/library/upload" class="community-panel-cta">
						<div class="community-panel-cta__icon" aria-hidden="true">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
						</div>
						<div class="community-panel-cta__body">
							<span class="community-panel-cta__title">Upload Your Pattern</span>
							<span class="community-panel-cta__sub">Contribute a verified cut pattern to the community library</span>
						</div>
						<svg class="community-panel-cta__arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
					</a>

					<!-- Plotter tab -->
				{:else}

					<!-- ── Plotter Discovery ─────────────────── -->
					<div class="discovery-panel">
						<!-- header: scan status + rescan button -->
						<div class="discovery-header">
							<div class="discovery-header__left">
								{#if discoveryPhase === "scanning"}
									<span class="ai-spinner" style="width:10px;height:10px;flex-shrink:0" aria-hidden="true"></span>
									<span class="discovery-title">Scanning…</span>
								{:else if liveDevices.length === 0}
									<span class="discovery-title">No cutters detected</span>
								{:else if liveDevices.length === 1}
									<span class="discovery-title">
										{liveDevices[0].status === "connected" ? "Cutter connected" : "Cutter detected"}
									</span>
								{:else}
									<span class="discovery-title">{liveDevices.length} cutters found — select one</span>
								{/if}
							</div>
							<button
								class="discovery-rescan-btn"
								class:discovery-rescan-btn--spinning={bgRefreshing}
								onclick={() => runDiscovery()}
								disabled={discoveryPhase === "scanning"}
								title="Rescan for cutters"
								aria-label="Rescan"
							>
								<svg
									class="rescan-icon"
									class:rescan-icon--spin={bgRefreshing || discoveryPhase === "scanning"}
									width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"
								>
									<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
									<path d="M3 3v5h5"/>
									<path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
									<path d="M16 16h5v5"/>
								</svg>
							</button>
						</div>

						{#if discoveredDevices.length > 0}
							{#if agentStore.needsUpdate}
								<div class="discovery-update-warn">
									<div class="discovery-update-warn__header">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
										<strong>Agent update required</strong> — running v{agentStore.version}, need v{CURRENT_AGENT_VERSION}
									</div>
									<div class="discovery-update-warn__steps">
										<div class="discovery-update-warn__step">
											<span class="discovery-update-warn__num">1</span>
											<span>Stop the running agent</span>
											<button
												class="discovery-update-warn__action"
												onclick={stopOldAgent}
												disabled={stoppingOldAgent}
											>{stoppingOldAgent ? "Stopping…" : "Stop agent"}</button>
										</div>
										<div class="discovery-update-warn__step">
											<span class="discovery-update-warn__num">2</span>
											<span>Delete the old <code>omniplot-agent-*</code> file from your computer</span>
										</div>
										<div class="discovery-update-warn__step">
											<span class="discovery-update-warn__num">3</span>
											<span>Download and run v{CURRENT_AGENT_VERSION}</span>
											<a href="/studio/agent" class="discovery-update-warn__action">Get v{CURRENT_AGENT_VERSION} →</a>
										</div>
									</div>
								</div>
							{/if}
							<div class="device-list">
								{#each discoveredDevices as device (device.id)}
									<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
									<div
										class="device-card"
										class:device-card--connected={device.status === "connected"}
										class:device-card--offline={device.status === "offline"}
										class:device-card--selectable={liveDevices.length > 1 && device.status !== "offline"}
										class:device-card--selected={selectedDeviceId === device.id && liveDevices.length > 1}
										role={liveDevices.length > 1 && device.status !== "offline" ? "button" : undefined}
										tabindex={liveDevices.length > 1 && device.status !== "offline" ? 0 : undefined}
										onclick={liveDevices.length > 1 && device.status !== "offline" ? () => handleSelectDevice(device) : undefined}
										onkeydown={liveDevices.length > 1 && device.status !== "offline" ? (e) => { if (e.key === "Enter" || e.key === " ") handleSelectDevice(device); } : undefined}
									>
										<!-- Identity row -->
										<div class="device-card__top">
											<div class="device-dot device-dot--{device.status}"></div>
											<div class="device-identity">
												<span class="device-name">{device.preset.name}</span>
												<span class="device-via">
													{device.source === "agent"
														? `Cut Agent${agentStore.version ? ` · v${agentStore.version}` : ""}`
														: "USB Direct"}
												</span>
											</div>
											<span class="device-status-badge device-status-badge--{device.status}">
												{device.status === "connected" ? "Connected" : device.status === "offline" ? "Offline" : "Detected"}
											</span>
										</div>

										<!-- Spec chips -->
										<div class="device-specs">
											{#if device.portPath}
												<span class="device-spec-chip">{device.portPath}</span>
											{/if}
											{#if device.vendorId !== undefined}
												<span class="device-spec-chip device-spec-chip--mono">
													VID {device.vendorId.toString(16).toUpperCase().padStart(4, "0")}{device.productId !== undefined ? `:${device.productId.toString(16).toUpperCase().padStart(4, "0")}` : ""}
												</span>
											{/if}
											<span class="device-spec-chip">{(device.preset.maxMediaWidthMm / 25.4).toFixed(0)}" max</span>
											<span class="device-spec-chip">{device.preset.protocol?.toUpperCase() ?? "HPGL"}</span>
											<span class="device-spec-chip">{device.preset.baudRate ?? 9600} baud</span>
										</div>

										{#if device.manufacturer || device.product}
											<div class="device-hw-line">
												{[device.manufacturer, device.product].filter(Boolean).join(" ")}
											</div>
										{/if}

										<!-- Compat warning inline -->
										{#if compat === "overflow" && device.status !== "offline"}
											<p class="compat-warn" style="margin:6px 0 0">
												Material ({canvasStore.sheet.widthInches}") wider than this plotter's max ({(device.preset.maxMediaWidthMm / 25.4).toFixed(1)}").
											</p>
										{:else if compat === "tight" && device.status !== "offline"}
											<p class="compat-tight" style="margin:6px 0 0">Near max width — verify roll alignment.</p>
										{/if}
										{#if plotterStore.config.compatNote && device.status !== "offline"}
											<p class="compat-warn compat-warn--protocol" style="margin:4px 0 0">⚠ {plotterStore.config.compatNote}</p>
										{/if}

										<!-- Actions: show only for single device OR selected device in multi-device mode -->
										{#if liveDevices.length === 1 || selectedDeviceId === device.id}
											<div class="device-card__actions">
												{#if device.status === "connected"}
													<button
														class="device-action-test"
														onclick={(e) => { e.stopPropagation(); handleTestConnection(device); }}
														disabled={testingConn}
													>
														{testingConn ? "Testing…" : "Test"}
													</button>
													<button
														class="device-action-disconnect"
														onclick={(e) => { e.stopPropagation(); handleDisconnect(); }}
													>
														Disconnect
													</button>
												{:else if device.status === "detected"}
													{#if device.source === "agent" && agentStore.needsUpdate}
														<a href="/studio/agent" class="device-action-update">Update agent →</a>
													{:else}
														<button
															class="device-action-connect"
															onclick={(e) => { e.stopPropagation(); handleConnectDevice(device); }}
															disabled={connecting}
														>
															{#if connecting}
																<span class="ai-spinner" style="width:10px;height:10px" aria-hidden="true"></span>
																Connecting…
															{:else if device.source === "usb"}
																Select USB Port…
															{:else}
																Connect
															{/if}
														</button>
													{/if}
												{:else}
													<span class="device-offline-msg">Reconnect cable and rescan</span>
												{/if}
											</div>
										{/if}
									</div>
								{/each}
							</div>

						{:else if discoveryPhase === "done"}
							<!-- No devices found -->
							<div class="discovery-empty">
								<div class="discovery-check-row">
									<span class="discovery-check-dot discovery-check-dot--{agentProbeStatus}"></span>
									<span class="discovery-check-label">
										Cut Agent {agentProbeStatus === "online" ? "online" : agentProbeStatus === "probing" ? "checking…" : "not running"}
									</span>
									{#if agentProbeStatus === "offline"}
										<a href="/studio/agent" class="discovery-check-action">Install ↗</a>
									{/if}
								</div>
								{#if typeof navigator !== "undefined" && "serial" in navigator}
									<div class="discovery-check-row">
										<span class="discovery-check-dot discovery-check-dot--none"></span>
										<span class="discovery-check-label">No USB ports authorized</span>
										<button class="discovery-check-action" onclick={handleGrantUsbPort}>Authorize →</button>
									</div>
								{:else}
									<div class="discovery-check-row">
										<span class="discovery-check-dot discovery-check-dot--none"></span>
										<span class="discovery-check-label">USB Direct requires Chrome or Edge</span>
									</div>
								{/if}
								<p class="discovery-empty__tip">
									Power on your cutter, then
									<button class="discovery-link-btn" onclick={() => runDiscovery()}>scan again</button>.
								</p>
							</div>
						{/if}

						<!-- Advanced settings (Agent URL + baud rate) — collapsed by default -->
						<details class="discovery-advanced">
							<summary class="discovery-advanced__summary">Advanced settings</summary>
							<div class="discovery-advanced__body">
								<label class="discovery-adv-label">
									Agent URL
									<input
										class="prop-input prop-input--full"
										type="text"
										placeholder="http://localhost:7878"
										value={plotterStore.config.agentUrl ?? "http://localhost:7878"}
										oninput={(e) => { plotterStore.update({ agentUrl: (e.target as HTMLInputElement).value }); agentStore.reset(); runDiscovery(); }}
									/>
								</label>
								<label class="discovery-adv-label" style="margin-top:8px">
									Baud Rate
									<select class="prop-select" aria-label="Baud rate" onchange={(e) => plotterStore.update({ baudRate: parseInt((e.target as HTMLSelectElement).value) })}>
										{#each [9600, 19200, 38400, 57600, 115200] as rate}
											<option value={rate} selected={plotterStore.config.baudRate === rate}>{rate}</option>
										{/each}
									</select>
								</label>
							</div>
						</details>
					</div>

					<div class="plotter-divider"></div>

					<!-- ── Configuration: hidden until connected, reveal on demand ── -->
					{#if !isConnected}
						<button
							class="config-reveal-btn"
							onclick={() => showConfig = !showConfig}
							aria-expanded={showConfig}
						>
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
								{#if showConfig}<path d="M18 15l-6-6-6 6"/>{:else}<path d="M6 9l6 6 6-6"/>{/if}
							</svg>
							{showConfig ? "Hide configuration" : "Show plotter configuration"}
						</button>
					{/if}

					{#if isConnected || showConfig}
						{#if !isConnected}
							<div class="config-preview-notice">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
								Not connected — preview only
							</div>
						{/if}

						<!-- ── Cut Settings ───────────────────────── -->
						<div class="prop-section" style="margin-top: 12px;">
							<div class="prop-label-row">
								<span class="prop-label">Cut Settings</span>
								{#if isConnected}
									<span class="info-tip" data-tip="Blade force and speed sync to your plotter in real-time. The front-panel display may not update — this is a hardware limitation. Commands are applied internally.">
										<span class="live-badge">Live</span>
									</span>
								{/if}
							</div>
							{#each [["Blade force", "bladeForce", 10, 400, "g", "Pressure applied by the blade in grams. Higher = deeper cuts. Start low and test on scrap material first."], ["Speed mm/s", "cuttingSpeed", 10, 1200, "mm/s", "Cutting head speed. Slower = cleaner curves on tight corners. Syncs to plotter in real-time."], ["Passes", "passes", 1, 4, "×", "Number of times each path is traced. Use 2+ for thick materials. Applied at cut time — not a live command."], ["Overcut mm", "overcut", 0, 2, "mm", "Extra distance past path endpoints to prevent uncut corners. 0.3–0.5mm for most materials. Applied at cut time."]] as const as [label, key, min, max, unit, tip]}
								<div class="prop-slider-row">
									<span class="prop-slider-name">
										{label}
										{#if key === "passes" || key === "overcut"}
											<span class="cut-time-badge">Cut-time</span>
										{/if}
									</span>
									<input
										type="range"
										class="prop-slider"
										{min}
										{max}
										step={key === "overcut" ? 0.1 : 1}
										value={plotterStore.config[key]}
										aria-label={label}
										oninput={(e) => {
											plotterStore.update({ [key]: parseFloat((e.target as HTMLInputElement).value) });
											if (key === "bladeForce" || key === "cuttingSpeed") scheduleSettingsSend();
										}}
									/>
									<span class="prop-slider-val">{key === "overcut" ? plotterStore.config[key].toFixed(1) : plotterStore.config[key]}{unit}</span>
									<span class="info-tip" data-tip={tip}>
										<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
									</span>
								</div>
							{/each}
						</div>

						<!-- ── Roll Alignment ───────────────────────── -->
						<div class="prop-section">
							<div class="prop-label-row">
								<span class="prop-label">Roll Alignment</span>
								<span class="info-tip" data-tip="Tells OmniPlot where your roll sits on the plotter bed. Critical when roll width is less than plotter max width — without this, cuts will be offset by the difference.">
									<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
								</span>
							</div>

							<!-- Visual diagram: plotter bed + roll position -->
							<div class="cal-diagram-wrap" aria-hidden="true">
								<svg class="cal-diagram" width="192" height="44" overflow="visible">
									<rect x="10" y="10" width={CAL_DIAG_BED} height="14" rx="3" fill="var(--bg-surface-3)" stroke="var(--border-subtle)" stroke-width="1"/>
									<rect x={10 + calDiagOff} y="10" width={calDiagRoll} height="14" rx="2" fill="#00e5ff" fill-opacity="0.18" stroke="#00e5ff" stroke-opacity="0.55" stroke-width="1.5"/>
									<text x="10"              y="7" font-size="6.5" fill="var(--text-tertiary)" font-family="monospace" text-anchor="start">0"</text>
									<text x={10 + CAL_DIAG_BED} y="7" font-size="6.5" fill="var(--text-tertiary)" font-family="monospace" text-anchor="end">{plotterMaxIn.toFixed(0)}"</text>
									<text x={10 + calDiagOff + calDiagRoll / 2} y="20" font-size="6" fill="#00e5ff" font-family="monospace" text-anchor="middle" fill-opacity="0.9">{rollWidthIn.toFixed(0)}" roll</text>
									{#if originXIn > 0.05 && calDiagOff > 6}
										<line x1="10" y1="30" x2={10 + calDiagOff} y2="30" stroke="var(--text-tertiary)" stroke-width="1" stroke-dasharray="2 1.5"/>
										<text x={10 + calDiagOff / 2} y="40" font-size="6" fill="var(--text-tertiary)" font-family="monospace" text-anchor="middle">+{originXIn.toFixed(2)}"</text>
									{/if}
								</svg>
							</div>

							<!-- Mode 1: Quick mount preset -->
							<div class="cal-mount-row">
								<button
									class="cal-mount-btn"
									class:cal-mount-btn--active={mountPreset === 'flush-left'}
									onclick={() => setMountMode('flush-left')}
								>Flush Left<span class="cal-mount-dim">0"</span></button>
								<button
									class="cal-mount-btn"
									class:cal-mount-btn--active={mountPreset === 'flush-right'}
									onclick={() => setMountMode('flush-right')}
									disabled={plotterMaxIn <= rollWidthIn}
								>Flush Right<span class="cal-mount-dim">{Math.max(0, plotterMaxIn - rollWidthIn).toFixed(1)}"</span></button>
								<button
									class="cal-mount-btn"
									class:cal-mount-btn--active={mountPreset === 'custom'}
									onclick={() => setMountMode('custom')}
								>Custom</button>
							</div>

							{#if mountPreset === 'custom'}
								<div class="cal-custom-row">
									<span class="prop-slider-name">X offset</span>
									<input
										type="number"
										class="cal-custom-input"
										min="0"
										max={plotterMaxIn}
										step="0.1"
										bind:value={calCustomX}
										aria-label="Custom X offset in inches"
									/>
									<span class="cal-custom-unit">"</span>
									<button class="cal-apply-btn" onclick={applyCustomX}>Apply</button>
								</div>
							{/if}

							<!-- Mode 2: Auto-probe (cut-agent only) -->
							{#if plotterStore.config.connection === 'cut-agent'}
								<div class="cal-probe-section">
									<div class="cal-probe-header">
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
										<span>Auto-probe</span>
									</div>

									{#if calPhase === 'idle' || calPhase === 'probe-done'}
										<p class="cal-probe-hint">Jog the plotter carriage to the left edge of your roll, then click Capture — the agent reads the carriage position directly.</p>
										<button class="cal-probe-btn" onclick={() => calPhase = 'probe-wait'}>
											Start Probe
										</button>
									{/if}

									{#if calPhase === 'probe-wait'}
										<p class="cal-probe-hint cal-probe-hint--active">Using your plotter's keypad, jog the carriage to the <strong>left edge</strong> of your roll. Click Capture when positioned.</p>
										<div class="cal-probe-actions">
											<button class="cal-probe-btn cal-probe-btn--capture" onclick={runProbe}>
												<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>
												Capture Position
											</button>
											<button class="cal-probe-btn cal-probe-btn--cancel" onclick={() => calPhase = 'idle'}>Cancel</button>
										</div>
									{/if}

									{#if calPhase === 'probe-busy'}
										<p class="cal-probe-hint">Reading carriage position…</p>
										<div class="cal-probe-spinner" aria-hidden="true"></div>
									{/if}

									{#if calPhase === 'probe-done' && calCapture}
										<div class="cal-probe-result">
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
											Offset captured: <strong>{calCapture.offsetIn.toFixed(3)}"</strong> applied
										</div>
									{/if}

									{#if calPhase === 'probe-error'}
										{#if calErrorKind === 'oa-unsupported'}
											<div class="cal-probe-error">
												<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
												No response — plotter may not support OA query
											</div>
											<p class="cal-probe-hint" style="margin-top:6px">Most budget cutters don't implement the OA position command. Use <strong>manual offset entry</strong> above instead.</p>
											<button class="cal-probe-btn" onclick={() => { calPhase = 'idle'; calError = null; }}>Dismiss</button>
										{:else if calErrorKind === 'port-busy'}
											<div class="cal-probe-error">
												<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
												{calError}
											</div>
											<p class="cal-probe-hint" style="margin-top:6px">The port is held open from the previous query. Click Release to close it in the agent, then retry.</p>
											<button class="cal-probe-btn" onclick={async () => {
												await releaseAgentPort(plotterStore.config);
												calPhase = 'probe-wait';
												calError = null;
											}}>Release &amp; Retry</button>
										{:else if calErrorKind === 'port-missing'}
											<div class="cal-probe-error">
												<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
												{calError}
											</div>
											<p class="cal-probe-hint" style="margin-top:6px">The configured port no longer exists on this machine — unplug and replug the USB cable, then use Auto-detect on the Plotters page to find its new path.</p>
											<button class="cal-probe-btn" onclick={() => { calPhase = 'idle'; calError = null; }}>Dismiss</button>
										{:else}
											<div class="cal-probe-error">
												<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
												{calError}
											</div>
											<button class="cal-probe-btn" onclick={() => { calPhase = 'probe-wait'; calError = null; }}>Retry</button>
										{/if}
									{/if}
								</div>
							{/if}

							<!-- Test cut: sends bracket marks at roll edges -->
							{#if isConnected}
								<button class="cal-test-cut-btn" onclick={sendCalCut} title="Cuts bracket marks at the configured roll edges on scrap material to verify alignment">
									<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
									Send test cut
								</button>
							{/if}

							<!-- Y offset (minor, kept as compact slider) -->
							<div class="cal-y-row">
								<span class="prop-slider-name">Y offset</span>
								<input
									type="range"
									class="prop-slider"
									min="0" max="24" step="0.1"
									value={plotterStore.config.originY}
									aria-label="Y offset in inches"
									oninput={(e) => plotterStore.update({ originY: parseFloat((e.target as HTMLInputElement).value) })}
								/>
								<span class="prop-slider-val">{plotterStore.config.originY.toFixed(1)}"</span>
							</div>
						</div>

						<div class="plotter-divider"></div>
					{/if}

					<!-- ── Output Format ───────────────────────── -->
					<div class="prop-section">
						<div class="prop-label-row">
							<span class="prop-label">Output Format</span>
							<span class="info-tip" data-tip="HPGL protocol variant. Standard HPGL and Roland use different speed units internally. Select the format matching your plotter for correctly scaled cut speeds.">
								<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
							</span>
						</div>
						<select
							class="prop-select"
							aria-label="Output format"
							onchange={(e) => {
								plotterStore.update({ protocol: (e.target as HTMLSelectElement).value as PlotterConfig["protocol"] });
							}}
						>
							{#each [["hpgl", "HPGL — Standard (VEVOR, USCutter, GCC, Mimaki)"], ["roland", "HPGL — Roland CAMM-1 series"], ["hpgl2", "HPGL/2 — Graphtec / Summa"]] as [val, label]}
								<option value={val} selected={plotterStore.config.protocol === val}>{label}</option>
							{/each}
						</select>
					</div>

				{/if}
			</div>
			</div>
			{/if}
		</aside>
	</div>

	<!-- ─── Status bar ─── -->
	<!-- left offset tracks the app sidebar's current width (200px open / 52px collapsed) so this stays flush with the main content area, not just the canvas column -->
	<div
		class="studio__statusbar"
		style="left: {uiStore.sidebarOpen ? 200 : 52}px"
		role="status"
		aria-label="Job metrics"
		data-tour="statusbar"
	>
		<div class="status-metric">
			<span class="status-metric__label">Material Usage</span>
			<span class="status-metric__value-row">
				<span
					class="status-metric__value"
					class:good={efficiency > 0.65}
					class:warn={efficiency <= 0.65 && efficiency > 0}
				>{formatEfficiency(efficiency)}</span>
				{#if smartNestGain !== null && smartNestGain >= 0.5}
					<span class="ai-badge" title="AI-optimized layout — ↑{smartNestGain.toFixed(0)}% vs baseline">AI ↑{smartNestGain.toFixed(0)}%</span>
				{/if}
			</span>
		</div>
		{#each [["Cut Paths", `${cutCount}`, ""], ["Est. Cut Time", formatCutTime(cutTimeSecs), ""], ["Roll", `${canvasStore.sheet.widthInches}" × ${displaySheetLength.toFixed(0)}"`, ""], ["Excluded", `${outOfBoundsCount}`, outOfBoundsCount > 0 ? "warn" : ""], ["Cursor", `${cursorX.toFixed(1)}" , ${cursorY.toFixed(1)}"`, ""]] as [label, value, cls]}
			<div class="status-metric">
				<span class="status-metric__label">{label}</span>
				<span
					class="status-metric__value"
					class:warn={cls === "warn"}>{value}</span
				>
			</div>
		{/each}
	</div>
</div>

<EarlyAccessModal />

<GuidedTour
	steps={TOUR_STEPS}
	open={uiStore.tourOpen}
	onclose={uiStore.closeTour}
/>

<PlotterDiagPanel
	diagnostic={diagData}
	reported={diagReported}
	onClose={() => { diagData = null; diagReported = false; }}
	onRetry={diagRetry}
	onReport={diagReport}
/>

<style>
	.studio {
		--statusbar-h: 44px;
		display: grid;
		/* Status bar is fixed to the viewport (see .studio__statusbar) and no
		   longer takes a row here — its height (--statusbar-h) is reserved via
		   padding-bottom on the canvas/panel scroll areas instead, so it never
		   overlaps their content. */
		grid-template-rows: auto 1fr;
		/* Anchored directly to the viewport (minus the 52px app topbar) rather
		   than height:100% up through the app-shell/app-main ancestor chain —
		   on tall/vertical monitors that percentage chain was falling short of
		   the true viewport, leaving dead space between this grid's 1fr row
		   and the .studio__statusbar footer, which IS viewport-fixed. Anchoring
		   both to the same reference (the viewport) guarantees they meet. */
		height: calc(100vh - 52px);
		height: calc(100dvh - 52px);
		overflow: hidden;
		position: relative;
	}

	/* ─── Vehicle legend ────── */
	.vehicle-legend {
		display: flex;
		align-items: flex-start;
		gap: 0;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-subtle);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.vehicle-legend::-webkit-scrollbar { display: none; }

	.vl-group {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 14px;
		flex-shrink: 0;
		border-right: 1px solid var(--border-subtle);
	}
	.vl-group:last-child { border-right: none; }

	.vl-car {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-secondary);
		white-space: nowrap;
		letter-spacing: 0.01em;
	}

	.vl-chips {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.vl-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 7px 2px 5px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--chip) 40%, transparent);
		background: color-mix(in srgb, var(--chip) 10%, transparent);
		color: var(--chip);
		font-size: 0.6875rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.1s;
		font-family: var(--font-body);
	}
	.vl-chip:hover {
		background: color-mix(in srgb, var(--chip) 20%, transparent);
	}
	.vl-chip--sel {
		background: color-mix(in srgb, var(--chip) 22%, transparent);
		border-color: var(--chip);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--chip) 50%, transparent);
	}

	.vl-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--chip);
		flex-shrink: 0;
	}

	/* ─── Toolbar ────── */
	.studio__toolbar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-subtle);
		/* Never drop to a second row (that's what was pushing "Send to Plotter"
		   down) — scroll horizontally instead if everything doesn't fit. */
		flex-wrap: nowrap;
		overflow-x: auto;
		overflow-y: hidden;
		position: relative;
		z-index: 10;
	}

	.tool-group {
		display: flex;
		gap: 1px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 2px;
	}

	.tool-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 5px;
		border: none;
		background: transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		transition:
			background 0.12s,
			color 0.12s;
		flex-shrink: 0;
	}

	.tool-btn:hover:not(:disabled) {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}
	.tool-btn.active {
		background: var(--color-brand-dim);
		color: #fff;
	}
	.tool-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.tool-btn--danger:hover:not(:disabled) {
		background: var(--color-danger);
		color: #fff;
	}

	/* AI Nest mode toggle — star icon, active = ON state with brand fill */
	.tool-btn--ai-mode {
		width: auto;
		padding: 0 10px;
		gap: 5px;
		color: var(--text-muted);
		border: 1px solid transparent;
		transition: color 0.15s, background 0.15s, border-color 0.15s;
	}
	.tool-btn--ai-mode.active {
		color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.08);
		border-color: rgba(0, 112, 255, 0.2);
	}
	.tool-btn--ai-mode.active svg {
		fill: var(--color-brand-dim);
		stroke: var(--color-brand-dim);
	}
	.tool-btn--ai-mode:hover:not(:disabled) {
		background: rgba(0, 112, 255, 0.1);
		color: var(--color-brand-dim);
	}
	.ai-mode-label {
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-body);
		letter-spacing: 0.01em;
	}
	/* Deep re-optimize button — small refresh icon, visible but understated */
	.tool-btn--ai-optimize {
		color: var(--text-muted);
	}
	.tool-btn--ai-optimize:hover:not(:disabled) {
		color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.08);
	}
	.tool-btn--ai-optimize.loading {
		opacity: 1;
		cursor: wait;
	}
	/* Auto re-optimize toggle — same visual language as AI Nest mode above */
	.tool-btn--auto-reoptimize {
		width: auto;
		padding: 0 10px;
		gap: 5px;
		color: var(--text-muted);
		border: 1px solid transparent;
		transition: color 0.15s, background 0.15s, border-color 0.15s;
	}
	.tool-btn--auto-reoptimize.active {
		color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.08);
		border-color: rgba(0, 112, 255, 0.2);
	}
	.tool-btn--auto-reoptimize.active svg {
		fill: var(--color-brand-dim);
		stroke: var(--color-brand-dim);
	}
	.tool-btn--auto-reoptimize:hover:not(:disabled) {
		background: rgba(0, 112, 255, 0.1);
		color: var(--color-brand-dim);
	}
	/* Legacy class kept for other spinner uses */
	.tool-btn--ai {
		color: var(--color-brand-dim);
		position: relative;
	}
	.tool-btn--ai-labeled {
		width: auto;
		padding: 0 10px;
		gap: 5px;
	}
	.ai-label {
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-body);
		letter-spacing: 0.01em;
	}
	.tool-btn--ai:hover:not(:disabled) {
		background: rgba(0, 112, 255, 0.1);
		color: var(--color-brand-dim);
	}
	.tool-btn--ai.loading {
		opacity: 1;
		cursor: wait;
	}

	.ai-spinner {
		display: block;
		width: 12px;
		height: 12px;
		border: 2px solid rgba(0, 112, 255, 0.25);
		border-top-color: var(--color-brand-dim);
		border-radius: 50%;
		animation: ai-spin 0.7s linear infinite;
	}
	@keyframes ai-spin { to { transform: rotate(360deg); } }

	.toolbar-sep {
		width: 1px;
		height: 24px;
		background: var(--border-default);
		margin: 0 2px;
		flex-shrink: 0;
	}

	.zoom-control {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.zoom-display {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		padding: 4px 8px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		min-width: 46px;
		text-align: center;
		color: var(--text-primary);
	}

	/* ── Community upload button (toolbar) ── */
	.community-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		height: 34px;
		padding: 0 12px;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-brand) 45%, transparent);
		background: color-mix(in srgb, var(--color-brand) 10%, transparent);
		color: var(--color-brand);
		text-decoration: none;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.12s, border-color 0.12s, color 0.12s;
		flex-shrink: 0;
	}
	.community-btn:hover {
		background: color-mix(in srgb, var(--color-brand) 18%, transparent);
		border-color: var(--color-brand);
	}

	/* ── Community upload CTA (patterns panel) ── */
	.community-panel-cta {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 12px;
		padding: 12px 14px;
		background: color-mix(in srgb, var(--color-brand) 8%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, var(--color-brand) 30%, transparent);
		border-radius: var(--radius-lg);
		text-decoration: none;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
	}
	.community-panel-cta:hover {
		background: color-mix(in srgb, var(--color-brand) 14%, var(--bg-surface-2));
		border-color: color-mix(in srgb, var(--color-brand) 55%, transparent);
	}
	.community-panel-cta__icon {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-brand) 14%, var(--bg-surface-3));
		border: 1px solid color-mix(in srgb, var(--color-brand) 30%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-brand);
		flex-shrink: 0;
	}
	.community-panel-cta__body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.community-panel-cta__title {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.community-panel-cta__sub {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}
	.community-panel-cta__arrow {
		color: var(--color-brand);
		flex-shrink: 0;
		opacity: 0.7;
	}

	.export-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		height: 34px;
		padding: 0 12px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		cursor: pointer;
		transition: background 0.12s;
		flex-shrink: 0;
	}

	.export-btn:hover {
		background: var(--bg-surface-3);
	}

	.abort-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 14px;
		height: 34px;
		font-size: 0.8125rem;
		font-weight: 600;
		font-family: var(--font-body);
		background: rgba(255, 77, 109, 0.12);
		border: 1px solid rgba(255, 77, 109, 0.4);
		border-radius: var(--radius-md);
		color: var(--color-danger);
		cursor: pointer;
		transition: all 0.12s;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.abort-btn:hover {
		background: rgba(255, 77, 109, 0.2);
		border-color: rgba(255, 77, 109, 0.6);
	}
	.abort-btn:active {
		background: rgba(255, 77, 109, 0.28);
	}

	.cut-btn--hidden {
		display: none;
	}

	/* ─── Toolbar plotter status badge ────── */
	.plotter-badge {
		display: flex;
		align-items: center;
		gap: 7px;
		height: 34px;
		padding: 0 7px 0 11px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		max-width: 280px;
		flex-shrink: 1;
		min-width: 0;
	}

	.plotter-badge__dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.plotter-badge--ok .plotter-badge__dot {
		background: var(--color-success);
	}
	.plotter-badge--warn .plotter-badge__dot {
		background: var(--color-warning);
	}
	.plotter-badge--error .plotter-badge__dot {
		background: var(--color-danger);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-danger) 25%, transparent);
	}
	.plotter-badge--missing .plotter-badge__dot {
		background: var(--text-tertiary);
	}
	.plotter-badge--cutting .plotter-badge__dot {
		background: var(--color-brand);
		animation: plotter-badge-pulse 1.1s ease-in-out infinite;
	}
	@keyframes plotter-badge-pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.4; transform: scale(0.7); }
	}

	/* Small version of the connection-type medallions from the connected-plotters page */
	.plotter-badge__medallion {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 5px;
		flex-shrink: 0;
	}
	.plotter-badge__medallion--usb-serial {
		background: rgba(96, 165, 250, 0.14);
		color: #60a5fa;
	}
	.plotter-badge__medallion--cut-agent {
		background: rgba(52, 211, 153, 0.14);
		color: #34d399;
	}
	.plotter-badge__medallion--network {
		background: rgba(251, 191, 36, 0.14);
		color: #fbbf24;
	}
	.plotter-badge__medallion--download {
		background: rgba(148, 163, 184, 0.14);
		color: #94a3b8;
	}

	.plotter-badge__text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.25;
	}
	.plotter-badge__name {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
	}
	.plotter-badge__detail {
		font-size: 0.625rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
	}
	.plotter-badge--cutting .plotter-badge__detail {
		color: var(--color-brand);
		font-weight: 600;
	}
	.plotter-badge--error .plotter-badge__detail {
		color: var(--color-danger);
	}

	.plotter-badge__action {
		flex-shrink: 0;
		margin-left: 2px;
		padding: 4px 9px;
		font-size: 0.6875rem;
		font-weight: 600;
		font-family: var(--font-body);
		border-radius: 999px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface-3);
		color: var(--text-secondary);
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.plotter-badge__action:hover {
		background: var(--color-brand);
		color: var(--bg-surface);
		border-color: var(--color-brand);
	}

	.offline-tip {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.7rem;
		color: var(--color-warning, #e6a817);
		background: color-mix(in srgb, var(--color-warning, #e6a817) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-warning, #e6a817) 25%, transparent);
		border-radius: var(--radius-md);
		padding: 5px 9px;
		cursor: help;
		line-height: 1.3;
	}

	.cut-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		padding: 0 16px;
		font-size: 0.8125rem;
		font-weight: 600;
		font-family: var(--font-body);
		background: var(--color-brand);
		border: none;
		border-radius: var(--radius-md);
		color: #000;
		cursor: pointer;
		transition:
			opacity 0.15s,
			transform 0.1s;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.cut-btn:hover {
		opacity: 0.9;
	}
	.cut-btn:active {
		transform: scale(0.98);
	}
	.cut-btn--locked,
	.cut-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		background: var(--bg-surface-2);
		color: var(--text-secondary);
	}
	.cut-btn--locked:hover { opacity: 0.55; }

	.cut-btn__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.18);
		font-size: 0.6875rem;
		font-weight: 700;
		font-family: var(--font-mono);
	}

	/* Export confirmation dialog */
	.export-confirm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 39;
		background: rgba(0, 0, 0, 0.4);
	}
	.export-confirm {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 40;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 20px;
		width: 320px;
		max-width: calc(100vw - 32px);
		box-shadow: var(--shadow-lg);
	}
	.export-confirm__title {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 4px;
	}
	.export-confirm__note {
		font-size: 0.75rem;
		color: var(--color-warning);
		margin: 0;
	}
	.export-confirm__actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 18px;
	}
	.export-confirm__btn {
		padding: 7px 14px;
		font-size: 0.8125rem;
		font-weight: 600;
		font-family: var(--font-body);
		border-radius: var(--radius-md);
		cursor: pointer;
		border: 1px solid transparent;
	}
	.export-confirm__btn--ghost {
		background: none;
		border-color: var(--border-default);
		color: var(--text-secondary);
	}
	.export-confirm__btn--ghost:hover {
		background: var(--interactive-hover);
	}
	.export-confirm__btn--primary {
		background: var(--color-brand);
		color: #000;
	}
	.export-confirm__btn--primary:hover {
		opacity: 0.9;
	}

	/* Export dropdown */
	.export-dropdown-backdrop {
		position: fixed;
		inset: 0;
		z-index: 19;
	}

	.export-dropdown {
		position: absolute;
		top: 54px;
		right: 110px;
		z-index: 20;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 6px;
		min-width: 260px;
		box-shadow: var(--shadow-lg);
	}

	.export-option {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px;
		border-radius: var(--radius-md);
		background: none;
		border: none;
		cursor: pointer;
		width: 100%;
		text-align: left;
		transition: background 0.12s;
	}

	.export-option:hover {
		background: var(--interactive-hover);
	}
	.export-option--locked {
		opacity: 0.6;
	}
	.export-option__body {
		flex: 1;
		min-width: 0;
	}
	.export-lock-badge {
		display: inline-block;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		background: var(--color-warning, #F7B731);
		color: #000;
		padding: 1px 5px;
		border-radius: 3px;
		margin-left: 6px;
		vertical-align: middle;
	}

	.export-option__icon {
		width: 36px;
		height: 36px;
		background: var(--bg-surface-2);
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--color-brand);
		flex-shrink: 0;
	}

	.export-option__title {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-primary);
	}
	.export-option__desc {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-top: 1px;
	}

	/* ─── Cut progress ─── */
	.cut-progress {
		display: flex;
		align-items: center;
		gap: 7px;
		flex-shrink: 0;
	}
	.cut-progress__track {
		width: 80px;
		height: 4px;
		background: var(--bg-surface-3);
		border-radius: 99px;
		overflow: hidden;
	}
	.cut-progress__fill {
		height: 100%;
		background: var(--color-brand);
		border-radius: 99px;
		transition: width 0.2s;
	}
	.cut-progress__label {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	/* ─── Resume banner ─── */
	.resume-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 16px;
		background: color-mix(in srgb, var(--color-warning, #f7b731) 12%, var(--bg-surface));
		border-bottom: 1px solid color-mix(in srgb, var(--color-warning, #f7b731) 35%, transparent);
		font-size: 0.8125rem;
		flex-wrap: wrap;
	}
	.resume-banner__info {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--color-warning, #f7b731);
		flex: 1;
		min-width: 0;
	}
	.resume-banner__info span {
		color: var(--text-primary);
	}
	.resume-banner__preset {
		color: var(--text-secondary);
	}
	.resume-banner__actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.resume-banner__btn {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 12px;
		font-size: 0.8rem;
		font-weight: 600;
		font-family: var(--font-body);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: opacity 0.12s;
	}
	.resume-banner__btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.resume-banner__btn--primary {
		background: var(--color-brand);
		border: none;
		color: #000;
	}
	.resume-banner__btn--primary:hover:not(:disabled) { opacity: 0.9; }
	.resume-banner__btn--ghost {
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
	}
	.resume-banner__btn--ghost:hover:not(:disabled) {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}

	/* ─── Inline prop row button ─── */
	.prop-btn-inline {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.1s, color 0.1s;
		flex-shrink: 0;
	}
	.prop-btn-inline:hover:not(:disabled) {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}
	.prop-btn-inline:disabled { opacity: 0.4; cursor: not-allowed; }

	/* ─── Body ────── */
	.studio__body {
		display: grid;
		grid-template-columns: 1fr min(33.333vw, 480px);
		overflow: hidden;
		transition: grid-template-columns 0.2s ease;
	}
	.studio__body--collapsed {
		/* Not literal 0 — reserves just enough track width that the collapse
		   button (which straddles this column's left edge) stays inside
		   .studio__body's own box instead of getting clipped by its
		   overflow: hidden on the right. */
		grid-template-columns: 1fr 24px;
	}

	/* ─── Canvas ────── */
	.canvas-area {
		position: relative;
		overflow: auto;
		background: var(--canvas-bg);
		cursor: crosshair;
		/* Reserve space for the viewport-fixed status bar so it never covers
		   the bottom of the canvas content. */
		padding-bottom: var(--statusbar-h);
	}

	/* Minor grid lines live directly on canvas-area so they scroll naturally */
	.canvas-area.show-grid {
		background-image:
			linear-gradient(var(--canvas-grid) 1px, transparent 1px),
			linear-gradient(90deg, var(--canvas-grid) 1px, transparent 1px);
		background-size: 24px 24px;
	}

	.canvas-grid {
		display: none; /* replaced by canvas-area.show-grid background */
	}

	.canvas-grid-major {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(var(--canvas-grid-major) 1px, transparent 1px),
			linear-gradient(
				90deg,
				var(--canvas-grid-major) 1px,
				transparent 1px
			);
		background-size: 120px 120px;
		pointer-events: none;
		z-index: 0;
	}

	.canvas-content {
		position: relative;
		display: inline-block;
		padding: 48px;
	}

	/* Visual footprint after the 90° rotation: width = roll width, height = length used */
	.roll-frame {
		position: relative;
		flex-shrink: 0;
	}

	/* Laid out in its own natural frame (length along X, roll width along Y —
	   matching the item x/y coordinate space), then rotated 90° clockwise into
	   .roll-frame above so the roll's width reads as screen-horizontal. The
	   rotate+translateY(-100%) pair (around a top-left origin) is what makes
	   the rotated box land back inside .roll-frame's bounds instead of
	   swinging off to the side. */
	.material-sheet {
		position: absolute;
		top: 0;
		left: 0;
		background: rgba(255, 255, 255, 0.03);
		border: 1px dashed var(--canvas-zone-border);
		border-radius: 2px;
		transform-origin: top left;
		transform: rotate(90deg) translateY(-100%);
	}

	/* Single merged label above the canvas — name, roll length, width, and the
	   live used-length, all in one place instead of split above/below the roll. */
	.roll-header {
		display: flex;
		flex-direction: column;
		margin-bottom: 6px;
	}

	.roll-header__top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 4px;
	}

	.sheet-label {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
	}

	.ruler {
		position: relative;
		height: 20px;
		border-bottom: 1px solid var(--border-default);
	}
	.ruler__tick {
		position: absolute;
		bottom: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		transform: translateX(-50%);
	}
	.ruler__mark {
		width: 1px;
		height: 6px;
		background: var(--border-default);
		margin-bottom: 2px;
	}
	.ruler__tick--minor {
		z-index: 0;
	}
	.ruler__mark--minor {
		height: 3px;
		margin-bottom: 0;
		background: var(--border-subtle);
	}
	.ruler__num {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		color: var(--text-tertiary, var(--text-secondary));
		white-space: nowrap;
	}
	.ruler__unit-toggle {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}
	.ruler__unit-btn {
		padding: 1px 6px;
		font-size: 0.62rem;
		font-family: var(--font-mono);
		background: var(--bg-surface-2, var(--bg-elevated));
		border: 1px solid var(--border-subtle);
		border-radius: 4px;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.ruler__unit-btn.active {
		background: var(--color-accent, var(--text-primary));
		color: var(--bg-base, #fff);
		border-color: transparent;
	}

	/* Ghost roll-direction guide — vertical "Prints this way" + arrow sitting
	   just left of the roll, centered top-to-bottom, faint/non-interactive. */
	.print-direction {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -34px;
		width: 22px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		opacity: 0.85;
		/* --text-brand is the theme-mapped accent (blue in light mode, cyan in
		   dark mode — see app.css) rather than a hardcoded brand hex, so this
		   stays legible and on-brand in both themes automatically. */
		color: var(--text-brand);
		pointer-events: none;
	}
	.print-direction__text {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		font-family: var(--font-mono);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.print-direction__arrow {
		flex-shrink: 0;
	}

	/* Cut items */
	.cut-item {
		position: absolute;
		cursor: pointer;
		transition: filter 0.12s;
	}

	.cut-item:hover {
		filter: brightness(1.15);
	}
	.cut-item.selected {
		z-index: 5;
	}

	/* Out-of-bounds items — won't be cut */
	.cut-item--oob {
		opacity: 0.45;
	}
	.cut-item--oob::after {
		content: "";
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			-45deg,
			rgba(255, 60, 60, 0.12) 0px,
			rgba(255, 60, 60, 0.12) 4px,
			transparent 4px,
			transparent 10px
		);
		pointer-events: none;
		border-radius: 2px;
	}

	.cut-item__oob-badge {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 2px 6px;
		background: rgba(220, 40, 40, 0.85);
		color: #fff;
		font-family: var(--font-mono);
		font-size: 0.5rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		border-radius: 3px;
		white-space: nowrap;
		pointer-events: none;
		text-transform: uppercase;
	}

	.cut-item__label {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;
		gap: 2px;
		pointer-events: none;
		font-family: monospace;
		text-align: center;
		line-height: 1.2;
		padding: 4px;
		overflow: hidden;
	}
	.cut-item__label span {
		opacity: 0.6;
		font-size: 10px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-height: 100%;
		/* Rotated 90° from plain horizontal — items on this canvas are
		   typically taller than wide, so text running along the long axis
		   reads better than text squeezed across the short one. Uses
		   writing-mode (not a transform for the rotation itself, so
		   ellipsis/overflow still work) — vertical-rl alone renders bottom-
		   to-top, so the extra 180° flip makes it read top-to-bottom. */
		writing-mode: vertical-rl;
		transform: rotate(180deg);
	}
	.cut-item__label-sub {
		opacity: 0.38 !important;
		font-size: 8px !important;
	}
	/* Pattern labels use item.color inline (the same bright per-pattern
	   accent as the shape's outline) — reads fine on the near-black dark
	   canvas, but those same light/saturated hues have too little contrast
	   against the light-mode canvas fill. Force a dark, legible color in
	   light mode; !important is needed to win over the inline style. */
	:global([data-theme="light"]) .cut-item__label {
		color: var(--text-primary) !important;
	}

	.cut-item__ring {
		position: absolute;
		inset: -2px;
		border: 1.5px solid;
		border-radius: 2px;
		pointer-events: none;
	}

	.cut-item__handle {
		position: absolute;
		width: 6px;
		height: 6px;
		border-radius: 1px;
		border: 1px solid rgba(0, 0, 0, 0.3);
		pointer-events: none;
	}

	.cut-item__handle--tl {
		top: -3px;
		left: -3px;
		cursor: nw-resize;
	}
	.cut-item__handle--tr {
		top: -3px;
		right: -3px;
		cursor: ne-resize;
	}
	.cut-item__handle--bl {
		bottom: -3px;
		left: -3px;
		cursor: sw-resize;
	}
	.cut-item__handle--br {
		bottom: -3px;
		right: -3px;
		cursor: se-resize;
	}

	.cut-item__del {
		position: absolute;
		top: -8px;
		right: -8px;
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-danger);
		color: #fff;
		border: 1.5px solid var(--bg-surface);
		border-radius: 50%;
		cursor: pointer;
		z-index: 6;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
		transition: transform 0.1s;
	}
	.cut-item__del:hover {
		transform: scale(1.15);
	}

	/* Canvas empty state */
	.canvas-empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		pointer-events: none;
	}

	.canvas-empty__icon {
		color: var(--text-tertiary);
		opacity: 0.4;
	}
	.canvas-empty__title {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.canvas-empty__sub {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		text-align: center;
		pointer-events: all;
	}

	.canvas-empty__sub a {
		color: var(--text-brand);
		text-decoration: underline;
	}

	/* ─── Right panel ────── */
	/* overflow is intentionally NOT set here — .panel-collapse-btn is a direct
	   child of this element, positioned to straddle its left edge, and an
	   overflow:hidden here would clip it (it did — that's why the button used
	   to get cut off on whichever side stuck outside the panel's box). Actual
	   content clipping/scrolling happens one level in, on .panel-content. */
	.studio__panel {
		position: relative;
		background: var(--bg-surface);
		border-left: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.studio__panel--collapsed {
		border-left: none;
	}

	.panel-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	/* Collapse toggle — sits centered on the panel's left border, well clear
	   of the tab row and panel content on every side. */
	.panel-collapse-btn {
		position: absolute;
		top: 50%;
		left: -24px;
		transform: translateY(-50%);
		z-index: 20;
		width: 44px;
		height: 80px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 10px 6px;
		box-sizing: border-box;
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
		transition:
			background 0.12s,
			color 0.12s,
			border-color 0.12s;
	}
	.panel-collapse-btn:hover {
		background: var(--color-brand);
		color: var(--bg-surface);
		border-color: var(--color-brand);
	}
	.panel-collapse-btn__gear {
		opacity: 0.7;
		flex-shrink: 0;
	}
	.panel-collapse-btn:hover .panel-collapse-btn__gear {
		opacity: 1;
	}
	.panel-collapse-btn__chevron {
		flex-shrink: 0;
	}

	.panel-tabs {
		display: flex;
		border-bottom: 1px solid var(--border-subtle);
		padding: 0 6px;
		gap: 2px;
	}

	.panel-tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		padding: 13px 4px;
		font-size: 0.8719rem;
		font-weight: 600;
		font-family: var(--font-body);
		color: var(--text-tertiary);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition:
			color 0.12s,
			border-color 0.12s;
	}

	.panel-tab__badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 21px;
		height: 21px;
		padding: 0 6px;
		border-radius: 10px;
		font-size: 0.7556rem;
		font-weight: 700;
		font-family: var(--font-mono);
		background: var(--bg-surface-3);
		color: var(--text-secondary);
		line-height: 1;
	}
	.panel-tab.active .panel-tab__badge {
		background: var(--color-brand);
		color: var(--bg-surface);
	}
	.panel-tab__badge--eff {
		background: color-mix(in srgb, var(--color-success) 22%, white);
		color: color-mix(in srgb, var(--color-success) 55%, black);
	}
	.panel-tab.active .panel-tab__badge--eff {
		background: color-mix(in srgb, var(--color-success) 30%, white);
		color: color-mix(in srgb, var(--color-success) 55%, black);
	}

	.panel-tab__dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.panel-tab__dot--ok {
		background: var(--color-success);
	}
	.panel-tab__dot--warn {
		background: var(--color-warning);
	}
	.panel-tab__dot--error {
		background: var(--color-danger);
	}
	.panel-tab__dot--missing {
		background: var(--text-tertiary);
	}

	.panel-tab:hover {
		color: var(--text-primary);
	}
	.panel-tab.active {
		color: var(--color-brand);
		border-bottom-color: var(--color-brand);
	}

	.panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 22px 20px calc(22px + var(--statusbar-h)) 20px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.panel-placeholder {
		padding: 32px 0;
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.93rem;
	}

	/* Properties */
	.prop-section {
		margin-bottom: 28px;
	}

	.prop-label {
		font-family: var(--font-mono);
		font-size: 0.9974rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 12px;
	}

	.prop-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
	}

	.prop-name {
		font-size: 1.1509rem;
		color: var(--text-secondary);
		min-width: 18px;
	}

	.prop-input {
		flex: 1;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 9px 11px;
		font-family: var(--font-mono);
		font-size: 1.1509rem;
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
	}

	.prop-input:focus {
		border-color: var(--color-brand-dim);
	}

	.prop-select {
		width: 100%;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 10px 12px;
		font-family: var(--font-mono);
		font-size: 1.1509rem;
		color: var(--text-primary);
		outline: none;
		cursor: pointer;
	}

	.prop-input--full {
		flex: none;
		width: 100%;
		box-sizing: border-box;
	}

	.prop-btn {
		width: 100%;
		padding: 12px 16px;
		background: var(--color-brand);
		color: #000;
		border: none;
		border-radius: var(--radius-md);
		font-size: 1.1509rem;
		font-weight: 600;
		cursor: pointer;
		text-align: center;
		font-family: var(--font-body);
	}
	.prop-btn:hover { opacity: 0.88; }
	.prop-btn--ghost {
		background: transparent;
		color: var(--text-secondary);
		border: 1px solid var(--border-default);
		margin-top: 6px;
	}

	.prop-note {
		font-size: 1.0742rem;
		color: var(--text-tertiary);
		margin-top: 6px;
		line-height: 1.5;
	}
	.prop-note--usb-hint {
		color: var(--color-warning, #F7B731);
	}
	.prop-note--disclaimer {
		margin-top: 10px;
		padding: 10px 12px;
		background: var(--bg-surface-2);
		border-left: 2px solid var(--border-default);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		color: var(--text-secondary);
	}

	/* Live / cut-time indicator badges on slider labels */
	.live-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.9207rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px 7px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--color-success, #00D68F) 15%, transparent);
		color: var(--color-success, #00D68F);
		border: 1px solid color-mix(in srgb, var(--color-success, #00D68F) 30%, transparent);
	}
	.cut-time-badge {
		display: inline-flex;
		font-size: 0.8839rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--bg-surface-3);
		color: var(--text-tertiary);
		vertical-align: middle;
		margin-left: 4px;
	}

	.conn-status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 1.1509rem;
		color: var(--text-primary);
		margin-bottom: 6px;
	}
	.conn-status--ok { color: var(--color-success, #00D68F); }
	.conn-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}

	.prop-slider-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
	}
	.prop-slider-name {
		font-size: 1.1509rem;
		color: var(--text-secondary);
		min-width: 84px;
	}

	.prop-slider {
		flex: 1;
		-webkit-appearance: none;
		appearance: none;
		height: 4px;
		background: var(--bg-surface-3);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.prop-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 15px;
		height: 15px;
		border-radius: 50%;
		background: var(--color-brand-dim);
		cursor: pointer;
		border: 1px solid rgba(0, 0, 0, 0.2);
	}

	.prop-slider-val {
		font-family: var(--font-mono);
		font-size: 0.844rem;
		color: var(--text-tertiary);
		min-width: 28px;
		text-align: right;
	}

	/* Nesting bar */
	.eff-bar-wrap {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.eff-bar-track {
		height: 4px;
		background: var(--bg-surface-3);
		border-radius: 2px;
		overflow: hidden;
	}

	.eff-bar-fill {
		height: 100%;
		border-radius: 2px;
		transition: width 0.4s var(--ease-smooth);
	}

	.eff-bar-labels {
		display: flex;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 0.7672rem;
		color: var(--text-tertiary);
	}

	/* Pattern cards */
	.pattern-card-wrap {
		margin-bottom: 8px;
	}
	.pattern-card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			border-color 0.12s,
			background 0.12s;
	}

	.pattern-card:hover {
		border-color: var(--border-default);
		background: var(--bg-surface-3);
	}
	.pattern-card.active {
		border-color: var(--color-brand-dim);
	}
	.pattern-card.expanded {
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		border-bottom-color: transparent;
	}

	.pattern-card__chevron {
		flex-shrink: 0;
		color: var(--text-tertiary);
		transition: transform 0.15s, color 0.12s;
	}
	.pattern-card__chevron--open {
		transform: rotate(180deg);
		color: var(--text-secondary);
	}

	/* Accordion: per-pattern move / rotate / flip controls */
	.pattern-card__panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 14px 12px 16px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-top: 1px dashed var(--border-default);
		border-radius: 0 0 var(--radius-md) var(--radius-md);
	}
	.pattern-card__row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	/* Labeled sub-groups (Position / Size / Transform) inside the accordion */
	.pattern-card__group {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.pattern-card__group-label {
		display: flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.pattern-card__group-label svg {
		flex-shrink: 0;
		opacity: 0.8;
	}

	/* Position fields — scrubbable tag + typeable input, Figma-style */
	.pattern-card__field-row {
		display: flex;
		gap: 8px;
	}
	.pattern-card__field {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: stretch;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: border-color 0.12s;
	}
	.pattern-card__field:focus-within {
		border-color: var(--color-brand-dim);
	}
	.pattern-card__field-tag {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 26px;
		padding: 0 8px;
		background: var(--bg-surface-3);
		color: var(--text-secondary);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 700;
		cursor: ew-resize;
		user-select: none;
		touch-action: none;
		transition: background 0.12s, color 0.12s;
	}
	.pattern-card__field-tag:hover {
		background: var(--color-brand-muted);
		color: var(--color-brand-dim);
	}
	.pattern-card__field-tag.scrubbing {
		background: var(--color-brand-dim);
		color: var(--bg-surface);
	}
	.pattern-card__field-input {
		flex: 1;
		min-width: 0;
		width: 100%;
		background: none;
		border: none;
		outline: none;
		padding: 8px 4px 8px 8px;
		font-family: var(--font-mono);
		font-size: 0.9375rem;
		color: var(--text-primary);
		-moz-appearance: textfield;
		appearance: textfield;
	}
	.pattern-card__field-input::-webkit-outer-spin-button,
	.pattern-card__field-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	.pattern-card__field-unit {
		display: flex;
		align-items: center;
		padding-right: 9px;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	/* Size chips — read-only, deliberately styled unlike the editable fields above */
	.pattern-card__size-row {
		display: flex;
		gap: 8px;
	}
	.pattern-card__size-chip {
		flex: 1;
		text-align: center;
		padding: 7px 8px;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
	.pattern-card__size-chip em {
		font-style: normal;
		color: var(--text-tertiary);
		font-size: 0.75rem;
		margin-left: 3px;
	}

	.pattern-card__rot-value {
		font-family: var(--font-mono);
		font-size: 0.9rem;
		color: var(--text-secondary);
		min-width: 34px;
	}
	.pattern-card__ctrl-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.8125rem;
		font-weight: 600;
		font-family: var(--font-body);
		transition: background 0.12s, border-color 0.12s, color 0.12s;
	}
	.pattern-card__ctrl-btn--wide {
		flex: 1;
	}
	.pattern-card__ctrl-btn:hover {
		border-color: var(--color-brand-dim);
		color: var(--text-primary);
	}
	.pattern-card__ctrl-btn.active {
		background: color-mix(in srgb, var(--color-brand-dim) 16%, var(--bg-surface-2));
		border-color: var(--color-brand-dim);
		color: var(--color-brand-dim);
	}

	.pattern-card__thumb {
		width: 44px;
		height: 30px;
		background: var(--bg-surface-3);
		border-radius: var(--radius-sm);
		border: 1px solid;
		flex-shrink: 0;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.pattern-card__info {
		flex: 1;
		min-width: 0;
	}
	.pattern-card__name {
		font-size: 0.9207rem;
		font-weight: 500;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pattern-card__meta {
		font-family: var(--font-mono);
		font-size: 0.7672rem;
		color: var(--text-tertiary);
	}

	.pattern-card__del {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-sm);
		border: none;
		background: none;
		color: var(--text-tertiary);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 0.12s,
			background 0.12s,
			color 0.12s;
		flex-shrink: 0;
	}

	.pattern-card:hover .pattern-card__del {
		opacity: 1;
	}
	.pattern-card__del:hover {
		background: rgba(255, 77, 109, 0.1);
		color: var(--color-danger);
	}

	/* ─── Vehicle section (Patterns tab, multi-vehicle) ────── */
	.vehicle-section {
		margin-bottom: 10px;
	}

	.vehicle-section__header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 0 4px;
		margin-bottom: 4px;
		border-bottom: 1px solid var(--border-subtle);
	}

	.vehicle-section__name {
		font-size: 0.844rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-tertiary, var(--text-muted));
		flex: 1;
	}

	.vehicle-section__count {
		font-size: 0.844rem;
		font-family: var(--font-mono, monospace);
		color: var(--text-tertiary, var(--text-muted));
		background: var(--bg-surface-2, var(--bg-elevated));
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		padding: 0 5px;
		line-height: 1.6;
	}

	.buffer-control {
		margin-bottom: 14px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--border-subtle);
	}
	.buffer-control__label {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.02em;
		margin-bottom: 6px;
	}
	.buffer-control__row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.buffer-control__row input {
		width: 80px;
		padding: 5px 8px;
		font-size: 0.86rem;
		font-family: var(--font-mono, monospace);
		background: var(--bg-surface-2, var(--bg-elevated));
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		color: var(--text-primary);
	}
	.buffer-control__unit {
		font-size: 0.8rem;
		color: var(--text-tertiary, var(--text-secondary));
	}
	.buffer-control__warn {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-warning);
		margin-left: 4px;
	}

	.patterns-count {
		display: inline-flex;
		align-items: center;
		padding: 0 5px;
		font-size: 0.844rem;
		font-family: var(--font-mono, monospace);
		font-weight: 600;
		background: var(--bg-surface-2, var(--bg-elevated));
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		color: var(--text-secondary);
		line-height: 1.6;
		margin-left: 5px;
	}

	/* ─── Status bar ────── */
	/* Fixed to the actual browser viewport bottom (not the .studio grid flow)
	   so it stays put regardless of canvas/panel scroll or content height.
	   `left` is set inline to track the app sidebar's current width. */
	.studio__statusbar {
		position: fixed;
		bottom: 0;
		right: 0;
		height: var(--statusbar-h);
		z-index: 30;
		display: flex;
		align-items: stretch;
		background: var(--bg-surface);
		border-top: 1px solid var(--border-subtle);
		overflow-x: auto;
	}

	.status-metric {
		display: flex;
		flex-direction: column;
		padding: 6px 16px;
		border-right: 1px solid var(--border-subtle);
		min-width: 100px;
	}

	.status-metric__label {
		font-family: var(--font-mono);
		font-size: 0.6905rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 1px;
	}

	.status-metric__value {
		font-family: var(--font-mono);
		font-size: 0.9974rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.status-metric__value.good {
		color: var(--color-success);
	}
	.status-metric__value.warn {
		color: var(--color-warning);
	}

	.status-metric__value-row {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	/* Shown when smartNestGain is set — shows efficiency gain vs baseline */
	.ai-badge {
		font-family: var(--font-mono);
		font-size: 0.7672rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		padding: 1px 5px;
		border-radius: 3px;
		background: rgba(0, 112, 255, 0.12);
		color: var(--color-brand-dim);
		border: 1px solid rgba(0, 112, 255, 0.25);
		white-space: nowrap;
		cursor: default;
	}

	/* ─── Responsive ────── */

	@media (max-width: 1024px) {
		.studio__body {
			grid-template-columns: 1fr 300px;
		}
	}

	@media (max-width: 768px) {
		.studio__body {
			grid-template-columns: 1fr;
		}
		.studio__panel {
			display: none;
		}
		.cut-btn span {
			display: none;
		}
		/* App sidebar is hidden entirely below this breakpoint (see AppShell) */
		.studio__statusbar {
			left: 0 !important;
		}
	}

	/* Roll-width boundary — dashed line between cut zone and staging area */
	.roll-boundary {
		position: absolute;
		left: 0;
		right: 0;
		height: 0;
		border-top: 1.5px dashed rgba(255, 80, 80, 0.45);
		pointer-events: none;
		z-index: 2;
	}

	/* Roll width quick-select pills */
	.roll-width-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.auto-fit-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		font-size: 0.9207rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.auto-fit-toggle input {
		cursor: pointer;
	}

	.roll-length-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.roll-length-row .prop-input {
		flex: 0 0 80px;
	}
	.roll-length-unit {
		font-size: 0.9207rem;
		color: var(--text-tertiary);
		font-family: var(--font-mono);
	}

	.roll-pill {
		padding: 4px 10px;
		border-radius: 99px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		font-family: var(--font-mono);
		font-size: 0.7672rem;
		cursor: pointer;
		transition:
			background 0.12s,
			color 0.12s,
			border-color 0.12s;
	}

	.roll-pill:hover {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}

	.roll-pill.active {
		background: var(--color-brand-dim);
		border-color: var(--color-brand-dim);
		color: #000;
	}

	:global(.mt-3) {
		margin-top: 12px;
	}

	/* ─── Plotter limit line ────── */
	.plotter-limit-line {
		position: absolute;
		left: 0;
		right: 0;
		height: 0;
		pointer-events: none;
		z-index: 3;
	}
	.plotter-limit-line--overflow {
		border-top: 2px solid rgba(255, 60, 60, 0.7);
	}
	.plotter-limit-line--tight {
		border-top: 2px dashed rgba(255, 181, 71, 0.7);
	}
	.plotter-limit-label {
		position: absolute;
		top: 3px;
		right: 6px;
		font-family: var(--font-mono);
		font-size: 0.6138rem;
		letter-spacing: 0.06em;
		font-weight: 600;
		text-transform: uppercase;
		padding: 1px 5px;
		border-radius: 3px;
		white-space: nowrap;
		/* Counter-rotate: .material-sheet (this label's ancestor) is rotated
		   90° to make the roll width read as screen-horizontal, so this needs
		   the inverse rotation to stay upright and legible. */
		transform-origin: top right;
		transform: rotate(-90deg) translateY(-100%);
	}
	.plotter-limit-line--overflow .plotter-limit-label {
		background: rgba(255, 60, 60, 0.15);
		color: rgba(255, 100, 100, 0.9);
	}
	.plotter-limit-line--tight .plotter-limit-label {
		background: rgba(255, 181, 71, 0.12);
		color: rgba(255, 181, 71, 0.9);
	}

	/* ─── Detection section ────── */
	.detect-section {
		margin-bottom: 12px;
	}
	.detect-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 7px 12px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.9821rem;
		font-weight: 600;
		font-family: var(--font-body);
		color: var(--text-primary);
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
		justify-content: center;
	}
	.detect-btn:hover:not(:disabled) {
		background: var(--bg-surface-3);
		border-color: var(--color-brand-dim);
		color: var(--color-brand);
	}
	.detect-btn:disabled { opacity: 0.6; cursor: wait; }

	.detect-result {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
		padding: 8px 10px;
		background: rgba(0, 229, 255, 0.05);
		border: 1px solid rgba(0, 229, 255, 0.2);
		border-radius: var(--radius-md);
	}
	.detect-result__dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-success);
		flex-shrink: 0;
		animation: pulse-dot 2s ease-in-out infinite;
	}
	.detect-result__info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.detect-result__name {
		font-size: 0.9207rem;
		font-weight: 600;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.detect-result__detail {
		font-size: 0.7672rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.detect-badge {
		font-family: var(--font-mono);
		font-size: 0.6138rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 2px 6px;
		border-radius: 3px;
		text-transform: uppercase;
		flex-shrink: 0;
	}
	.detect-badge--exact { background: rgba(0, 214, 143, 0.12); color: var(--color-success); border: 1px solid rgba(0, 214, 143, 0.3); }
	.detect-badge--mfr   { background: rgba(0, 112, 255, 0.1); color: var(--color-brand-dim); border: 1px solid rgba(0, 112, 255, 0.25); }
	.detect-badge--generic { background: var(--bg-surface-3); color: var(--text-tertiary); border: 1px solid var(--border-default); }

	/* ─── Compatibility badge ────── */
	.prop-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	.prop-label-row .prop-label { margin-bottom: 0; }

	.compat-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-family: var(--font-mono);
		font-size: 0.6138rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		padding: 2px 6px;
		border-radius: 3px;
	}
	.compat-badge--ok       { background: rgba(0, 214, 143, 0.1); color: var(--color-success); border: 1px solid rgba(0, 214, 143, 0.25); }
	.compat-badge--tight    { background: rgba(255, 181, 71, 0.1); color: var(--color-warning, #ffb547); border: 1px solid rgba(255, 181, 71, 0.3); }
	.compat-badge--overflow { background: rgba(255, 77, 109, 0.1); color: var(--color-danger); border: 1px solid rgba(255, 77, 109, 0.3); }

	/* Plotter spec row */
	.plotter-spec-row {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: 6px;
	}
	.plotter-spec {
		font-family: var(--font-mono);
		font-size: 0.6905rem;
		color: var(--text-tertiary);
	}

	/* Compatibility warnings */
	.compat-warn {
		font-size: 0.8839rem;
		color: var(--color-danger);
		background: rgba(255, 77, 109, 0.06);
		border: 1px solid rgba(255, 77, 109, 0.2);
		border-radius: var(--radius-sm);
		padding: 6px 8px;
		margin-top: 6px;
		line-height: 1.45;
	}
	.compat-warn--protocol {
		color: var(--color-warning, #ffb547);
		background: rgba(255, 181, 71, 0.06);
		border-color: rgba(255, 181, 71, 0.25);
	}
	.compat-tight {
		font-size: 0.8839rem;
		color: var(--color-warning, #ffb547);
		background: rgba(255, 181, 71, 0.06);
		border: 1px solid rgba(255, 181, 71, 0.2);
		border-radius: var(--radius-sm);
		padding: 6px 8px;
		margin-top: 6px;
		line-height: 1.45;
	}

	/* prop-input-row for IP:Port inline layout */
	.prop-input-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.prop-input--grow { flex: 1; }
	.prop-input--port { width: 64px; }
	.prop-input-sep {
		font-size: 1.0742rem;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	/* Network scan */
	.scan-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
	}
	.network-results {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 8px;
	}
	.network-device {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 0.844rem;
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
		width: 100%;
		transition: background 0.1s, border-color 0.1s;
	}
	.network-device:hover {
		background: var(--bg-surface-3);
		border-color: var(--color-brand-dim);
	}
	.network-device__ip   { flex: 1; font-weight: 600; }
	.network-device__port { color: var(--text-tertiary); }
	.network-device__ms   { font-size: 0.6905rem; color: var(--text-tertiary); margin-left: auto; }

	/* ─── Connection method cards ────── */
	.conn-method-cards {
		display: flex;
		gap: 6px;
		margin-bottom: 10px;
	}

	.conn-method-card {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: background 0.12s, border-color 0.12s;
		min-width: 0;
	}
	.conn-method-card:hover:not(:disabled) {
		background: var(--bg-surface-3);
	}
	.conn-method-card.selected {
		border-color: var(--color-brand-dim);
		background: color-mix(in srgb, var(--color-brand-dim) 8%, var(--bg-surface-2));
	}
	.conn-method-card:disabled {
		cursor: default;
	}

	.conn-method-card__dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--border-default);
		flex-shrink: 0;
		transition: background 0.2s;
	}
	.conn-method-card__dot.online {
		background: var(--color-success, #00D68F);
		animation: pulse-dot 2s ease-in-out infinite;
	}
	.conn-method-card__dot.probing {
		background: var(--text-tertiary);
		animation: pulse-dot 1.2s ease-in-out infinite;
	}

	.conn-method-card__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.conn-method-card__name {
		font-size: 0.9207rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.conn-method-card__status {
		font-family: var(--font-mono);
		font-size: 0.6905rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.conn-method-settings {
		padding-top: 10px;
		border-top: 1px solid var(--border-subtle);
		margin-bottom: 10px;
	}

	/* ─── Active plotter bar ────── */
	.plotter-active-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		margin-top: 10px;
		background: color-mix(in srgb, var(--color-success, #00D68F) 7%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, var(--color-success, #00D68F) 22%, transparent);
		border-radius: var(--radius-md);
	}
	.plotter-active-bar__dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-success, #00D68F);
		flex-shrink: 0;
		animation: pulse-dot 2s ease-in-out infinite;
	}
	.plotter-active-bar__info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.plotter-active-bar__label {
		font-size: 0.9207rem;
		font-weight: 600;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.plotter-active-bar__sub {
		font-family: var(--font-mono);
		font-size: 0.6905rem;
		color: var(--text-tertiary);
	}

	.plotter-disconnect-btn {
		padding: 4px 10px;
		font-size: 0.8593rem;
		font-weight: 600;
		font-family: var(--font-body);
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-danger, #FF4D6D) 50%, transparent);
		border-radius: var(--radius-sm);
		color: var(--color-danger, #FF4D6D);
		cursor: pointer;
		transition: background 0.1s;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.plotter-disconnect-btn:hover {
		background: color-mix(in srgb, var(--color-danger, #FF4D6D) 10%, transparent);
	}

	/* ─── Connect button ────── */
	.plotter-connect-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		padding: 9px 12px;
		margin-top: 10px;
		font-size: 0.9821rem;
		font-weight: 600;
		font-family: var(--font-body);
		background: var(--color-brand);
		border: none;
		border-radius: var(--radius-md);
		color: #000;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.plotter-connect-btn:hover:not(:disabled) { opacity: 0.88; }
	.plotter-connect-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: var(--bg-surface-2);
		color: var(--text-secondary);
	}
	.plotter-connect-btn.connecting {
		opacity: 0.7;
		cursor: wait;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.plotter-divider {
		height: 1px;
		background: var(--border-subtle);
		margin: 14px -14px;
	}

	/* ─── Roll Alignment / Calibration Wizard ─── */
	.cal-diagram-wrap { margin: 8px 0 6px; overflow: visible; }
	.cal-diagram { display: block; overflow: visible; }

	.cal-mount-row {
		display: flex; gap: 4px; margin: 6px 0 4px;
	}
	.cal-mount-btn {
		flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px;
		padding: 5px 4px; background: var(--bg-surface-2); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md); font-size: 0.844rem; font-weight: 500;
		color: var(--text-secondary); cursor: pointer; transition: all 0.12s; font-family: var(--font-body);
	}
	.cal-mount-btn:hover:not(:disabled) { border-color: var(--border-default); color: var(--text-primary); }
	.cal-mount-btn--active { border-color: #00e5ff60; background: color-mix(in srgb, #00e5ff 10%, var(--bg-surface-2)); color: #00e5ff; }
	.cal-mount-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.cal-mount-dim { font-size: 0.6905rem; font-family: var(--font-mono); opacity: 0.7; }

	.cal-custom-row {
		display: flex; align-items: center; gap: 6px; margin: 4px 0;
	}
	.cal-custom-input {
		width: 60px; padding: 3px 6px; background: var(--bg-surface-2);
		border: 1px solid var(--border-default); border-radius: var(--radius-md);
		font-family: var(--font-mono); font-size: 0.9974rem; color: var(--text-primary);
		text-align: right;
	}
	.cal-custom-unit { font-family: var(--font-mono); font-size: 0.9207rem; color: var(--text-tertiary); }
	.cal-apply-btn {
		padding: 3px 10px; background: var(--bg-surface-3); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); font-size: 0.9207rem; color: var(--text-secondary); cursor: pointer;
		font-family: var(--font-body); transition: all 0.12s;
	}
	.cal-apply-btn:hover { background: var(--interactive-hover); color: var(--text-primary); }

	.cal-probe-section {
		margin: 8px 0 4px; padding: 10px 10px 8px;
		background: var(--bg-surface-2); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg); display: flex; flex-direction: column; gap: 6px;
	}
	.cal-probe-header {
		display: flex; align-items: center; gap: 5px;
		font-size: 0.844rem; font-weight: 600; color: var(--text-tertiary);
		text-transform: uppercase; letter-spacing: 0.07em;
	}
	.cal-probe-hint {
		font-size: 0.9207rem; color: var(--text-tertiary); line-height: 1.5; margin: 0;
	}
	.cal-probe-hint--active { color: var(--text-secondary); }
	.cal-probe-hint strong { color: var(--text-primary); }

	.cal-probe-actions { display: flex; gap: 6px; }
	.cal-probe-btn {
		display: flex; align-items: center; gap: 5px; padding: 5px 10px;
		background: var(--bg-surface-3); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); font-size: 0.9207rem; font-weight: 500;
		color: var(--text-secondary); cursor: pointer; font-family: var(--font-body); transition: all 0.12s;
	}
	.cal-probe-btn:hover { border-color: var(--border-default); color: var(--text-primary); }
	.cal-probe-btn--capture {
		border-color: #00e5ff50; color: #00e5ff; background: color-mix(in srgb, #00e5ff 8%, var(--bg-surface-3));
	}
	.cal-probe-btn--capture:hover { background: color-mix(in srgb, #00e5ff 15%, var(--bg-surface-3)); }
	.cal-probe-btn--cancel { font-size: 0.844rem; }

	.cal-probe-spinner {
		width: 16px; height: 16px; border: 2px solid var(--border-subtle);
		border-top-color: #00e5ff; border-radius: 50%; animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.cal-probe-result {
		display: flex; align-items: center; gap: 5px;
		font-size: 0.9207rem; color: var(--text-secondary);
	}
	.cal-probe-result strong { color: #2ecc71; }

	.cal-probe-error {
		display: flex; align-items: flex-start; gap: 5px;
		font-size: 0.9207rem; color: rgba(255,100,100,0.9); line-height: 1.4;
	}

	.cal-test-cut-btn {
		display: flex; align-items: center; gap: 5px; margin: 6px 0 2px;
		padding: 5px 10px; background: transparent; border: 1px dashed var(--border-default);
		border-radius: var(--radius-md); font-size: 0.9207rem; color: var(--text-tertiary);
		cursor: pointer; font-family: var(--font-body); transition: all 0.12s; width: 100%;
	}
	.cal-test-cut-btn:hover { border-color: var(--border-default); color: var(--text-secondary); background: var(--interactive-hover); }

	.cal-y-row {
		display: grid; grid-template-columns: auto 1fr auto; align-items: center;
		gap: 8px; margin-top: 6px;
	}

	.config-reveal-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		width: 100%;
		padding: 7px;
		background: transparent;
		border: 1px dashed var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.9207rem;
		font-weight: 500;
		font-family: var(--font-body);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
	}
	.config-reveal-btn:hover {
		border-color: var(--text-tertiary);
		color: var(--text-secondary);
		background: var(--interactive-hover);
	}

	.config-preview-notice {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 10px;
		margin-top: 10px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		font-size: 0.8839rem;
		color: var(--text-tertiary);
		margin-bottom: 2px;
	}

	.info-tip {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: help;
		color: var(--text-tertiary);
		flex-shrink: 0;
		vertical-align: middle;
	}
	.info-tip:hover { color: var(--text-secondary); }
	.info-tip svg { display: block; }
	.info-tip::before {
		content: attr(data-tip);
		position: absolute;
		bottom: calc(100% + 6px);
		right: 0;
		width: 210px;
		padding: 7px 10px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(0,0,0,0.28);
		font-size: 0.8532rem;
		font-family: var(--font-body);
		font-weight: 400;
		color: var(--text-secondary);
		line-height: 1.45;
		white-space: normal;
		text-transform: none;
		letter-spacing: 0;
		pointer-events: none;
		z-index: 300;
		opacity: 0;
		transition: opacity 0.1s;
	}
	.info-tip:hover::before { opacity: 1; }

	/* ── Plotter Discovery Panel ──────────────── */

	@keyframes discovery-card-in {
		from { opacity: 0; transform: translateY(-4px); }
		to   { opacity: 1; transform: translateY(0); }
	}

	@keyframes rescan-spin {
		to { transform: rotate(360deg); }
	}

	.discovery-panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.discovery-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.discovery-header__left {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.discovery-title {
		font-size: 0.9575rem;
		font-weight: 600;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: opacity 0.2s ease;
	}

	.discovery-rescan-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 9px;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		font-size: 0.8839rem;
		font-weight: 500;
		font-family: var(--font-body);
		color: var(--text-tertiary);
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
	}
	.discovery-rescan-btn:hover:not(:disabled) {
		border-color: var(--text-tertiary);
		color: var(--text-secondary);
		background: var(--interactive-hover);
	}
	.discovery-rescan-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	/* Subtle highlight pulse while a background refresh is in flight */
	.discovery-rescan-btn--spinning {
		border-color: var(--color-accent, #7c3aed);
		color: var(--color-accent, #7c3aed);
	}

	.rescan-icon {
		display: block;
		flex-shrink: 0;
		transform-origin: center;
	}
	.rescan-icon--spin {
		animation: rescan-spin 0.9s linear infinite;
	}

	/* ── Device list ─────────────────────────── */

	.device-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.device-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		transition: border-color 0.35s ease, background 0.35s ease, opacity 0.35s ease;
		animation: discovery-card-in 0.25s ease both;
	}
	.device-card--connected {
		border-color: var(--color-success, #22c55e);
		background: color-mix(in srgb, var(--color-success, #22c55e) 6%, var(--bg-surface-2));
	}
	.device-card--offline {
		opacity: 0.55;
		border-color: var(--border-subtle);
	}
	.device-card--selectable {
		cursor: pointer;
	}
	.device-card--selectable:hover {
		border-color: var(--border-default);
		background: var(--interactive-hover);
	}
	.device-card--selected {
		border-color: var(--color-accent, #7c3aed);
		background: color-mix(in srgb, var(--color-accent, #7c3aed) 6%, var(--bg-surface-2));
	}

	.device-card__top {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* ── Status dot ──────────────────────────── */

	.device-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		transition: background 0.4s ease, box-shadow 0.4s ease;
	}
	.device-dot--detected {
		background: var(--color-warning, #f59e0b);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-warning, #f59e0b) 22%, transparent);
	}
	.device-dot--connected {
		background: var(--color-success, #22c55e);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-success, #22c55e) 22%, transparent);
		animation: dot-pulse 2s ease-in-out infinite;
	}
	.device-dot--offline {
		background: var(--text-disabled, #6b7280);
		box-shadow: none;
	}

	@keyframes dot-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.55; }
	}

	/* ── Device identity ─────────────────────── */

	.device-identity {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}

	.device-name {
		font-size: 0.9821rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.device-via {
		font-size: 0.847rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	/* ── Status badge ────────────────────────── */

	.device-status-badge {
		flex-shrink: 0;
		padding: 2px 7px;
		border-radius: 999px;
		font-size: 0.8225rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		transition: background 0.4s ease, color 0.4s ease;
	}
	.device-status-badge--connected {
		background: color-mix(in srgb, var(--color-success, #22c55e) 18%, transparent);
		color: var(--color-success, #22c55e);
	}
	.device-status-badge--detected {
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 18%, transparent);
		color: var(--color-warning, #f59e0b);
	}
	.device-status-badge--offline {
		background: var(--bg-surface-3, rgba(255,255,255,0.05));
		color: var(--text-disabled, #6b7280);
	}

	/* ── Spec chips ──────────────────────────── */

	.device-specs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.device-spec-chip {
		padding: 2px 7px;
		background: var(--bg-surface-3, rgba(255,255,255,0.06));
		border: 1px solid var(--border-subtle);
		border-radius: 4px;
		font-size: 0.8348rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.device-spec-chip--mono {
		font-family: var(--font-mono, monospace);
		font-size: 0.8102rem;
		color: var(--text-tertiary);
	}

	/* ── Hardware identity line ──────────────── */

	.device-hw-line {
		font-size: 0.847rem;
		color: var(--text-tertiary);
		font-style: italic;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Action buttons ──────────────────────── */

	.device-card__actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.device-action-connect,
	.device-action-disconnect,
	.device-action-test {
		padding: 5px 12px;
		border-radius: var(--radius-sm);
		font-size: 0.8961rem;
		font-weight: 500;
		font-family: var(--font-body);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background 0.12s, border-color 0.12s, color 0.12s;
	}
	.device-action-connect {
		background: var(--color-accent, #7c3aed);
		color: #fff;
		border-color: var(--color-accent, #7c3aed);
	}
	.device-action-connect:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent, #7c3aed) 85%, #000);
	}
	.device-action-connect:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.device-action-disconnect {
		background: transparent;
		color: var(--color-danger, #ef4444);
		border-color: var(--color-danger, #ef4444);
	}
	.device-action-disconnect:hover {
		background: color-mix(in srgb, var(--color-danger, #ef4444) 12%, transparent);
	}
	.device-action-test {
		background: transparent;
		color: var(--text-secondary);
		border-color: var(--border-default);
	}
	.device-action-test:hover:not(:disabled) {
		border-color: var(--text-tertiary);
		color: var(--text-primary);
		background: var(--interactive-hover);
	}
	.device-action-test:disabled {
		opacity: 0.45;
		cursor: default;
	}

	/* ── Update required button / banner ────────── */

	.device-action-update {
		padding: 5px 12px;
		border-radius: var(--radius-sm);
		font-size: 0.8961rem;
		font-weight: 600;
		font-family: var(--font-body);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		background: rgba(245, 158, 11, 0.12);
		color: #f59e0b;
		border: 1px solid rgba(245, 158, 11, 0.45);
		transition: background 0.12s;
	}
	.device-action-update:hover {
		background: rgba(245, 158, 11, 0.2);
	}
	.discovery-update-warn {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px;
		margin: 0 0 8px;
		background: rgba(245, 158, 11, 0.08);
		border: 1px solid rgba(245, 158, 11, 0.35);
		border-radius: var(--radius-md);
		font-size: 0.9207rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}
	.discovery-update-warn__header {
		display: flex;
		align-items: center;
		gap: 7px;
		color: var(--text-primary);
		font-weight: 500;
	}
	.discovery-update-warn__header svg { color: #f59e0b; flex-shrink: 0; }
	.discovery-update-warn__header strong { color: #f59e0b; }
	.discovery-update-warn__steps {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding-left: 4px;
	}
	.discovery-update-warn__step {
		display: flex;
		align-items: center;
		gap: 7px;
		color: var(--text-secondary);
	}
	.discovery-update-warn__step code {
		font-family: var(--font-mono);
		font-size: 0.8em;
		background: var(--bg-surface-3);
		padding: 1px 4px;
		border-radius: 3px;
		color: var(--text-primary);
	}
	.discovery-update-warn__num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: rgba(245, 158, 11, 0.25);
		color: #f59e0b;
		font-size: 0.7366rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.discovery-update-warn__action {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		font-size: 0.844rem;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid rgba(245, 158, 11, 0.5);
		background: rgba(245, 158, 11, 0.1);
		color: #f59e0b;
		text-decoration: none;
		white-space: nowrap;
		margin-left: auto;
		transition: background 0.12s;
	}
	.discovery-update-warn__action:hover { background: rgba(245, 158, 11, 0.2); }
	.discovery-update-warn__action:disabled { opacity: 0.5; cursor: not-allowed; }

	/* ── Offline message ─────────────────────── */

	.device-offline-msg {
		font-size: 0.847rem;
		color: var(--text-disabled, #6b7280);
		font-style: italic;
	}

	/* ── Empty state ─────────────────────────── */

	.discovery-empty {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 0 4px;
	}

	.discovery-check-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.discovery-check-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.discovery-check-dot--online {
		background: var(--color-success, #22c55e);
	}
	.discovery-check-dot--offline {
		background: var(--color-danger, #ef4444);
	}
	.discovery-check-dot--probing {
		background: var(--color-warning, #f59e0b);
		animation: dot-pulse 1.2s ease-in-out infinite;
	}
	.discovery-check-dot--none {
		background: var(--text-disabled, #6b7280);
	}

	.discovery-check-label {
		flex: 1;
		font-size: 0.8961rem;
		color: var(--text-secondary);
	}

	.discovery-check-action {
		padding: 2px 8px;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		font-size: 0.847rem;
		font-weight: 500;
		font-family: var(--font-body);
		color: var(--text-tertiary);
		cursor: pointer;
		text-decoration: none;
		white-space: nowrap;
		transition: border-color 0.12s, color 0.12s;
	}
	.discovery-check-action:hover {
		border-color: var(--text-tertiary);
		color: var(--text-secondary);
	}

	.discovery-empty__tip {
		margin: 4px 0 0;
		font-size: 0.847rem;
		color: var(--text-tertiary);
		line-height: 1.5;
	}

	.discovery-link-btn {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: inherit;
		color: var(--color-accent, #7c3aed);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.discovery-link-btn:hover {
		color: color-mix(in srgb, var(--color-accent, #7c3aed) 80%, #fff);
	}

	/* ── Advanced settings ───────────────────── */

	.discovery-advanced {
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.discovery-advanced__summary {
		padding: 7px 11px;
		font-size: 0.8839rem;
		font-weight: 500;
		color: var(--text-tertiary);
		cursor: pointer;
		user-select: none;
		list-style: none;
		display: flex;
		align-items: center;
		gap: 5px;
		background: var(--bg-surface-2);
		transition: color 0.1s, background 0.1s;
	}
	.discovery-advanced__summary:hover {
		color: var(--text-secondary);
		background: var(--interactive-hover);
	}
	.discovery-advanced__summary::marker,
	.discovery-advanced__summary::-webkit-details-marker {
		display: none;
	}

	.discovery-advanced__body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px 12px;
		background: var(--bg-surface-2);
		border-top: 1px solid var(--border-subtle);
	}

	.discovery-adv-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.8839rem;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.discovery-adv-label input,
	.discovery-adv-label select {
		padding: 5px 8px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		font-size: 0.8961rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
	}
	.discovery-adv-label input:focus,
	.discovery-adv-label select:focus {
		border-color: var(--color-accent, #7c3aed);
	}
</style>
