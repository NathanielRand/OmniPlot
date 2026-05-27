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
	} from "$lib/stores";
	import { autoNest, smartNest, findNextPosition, samplePolygonArea, getSvgPathBBox, type PlacementResult } from "$lib/utils/nesting";
	import {
		downloadHpgl,
		downloadSvg,
		downloadDxf,
		calcEfficiency,
		estimateCutTime,
		generateHpgl,
		generateHpglSegments,
	} from "$lib/utils/hpgl";
	import { sendToPlotter, sendToPlotterSegmented, sendSettings, connectSerialPort, disconnectSerialPort, isSerialConnected, type SerialPortInfo, type CutProgress } from "$lib/utils/plotter-connection";
	import { saveJob, logPlotterError, incrementCutUsage } from "$lib/firebase/firestore";
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
	import { DEFAULT_MATERIALS, PLOTTER_PRESETS } from "$lib/config";
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
			(s, i) =>
				s +
				samplePolygonArea(
					i.pattern.svgPath,
					i.pattern.widthInches,
					i.pattern.heightInches,
				),
			0,
		);
		return Math.min(1, patternArea / (canvasStore.sheet.widthInches * usedLength));
	});
	const cutTimeSecs = $derived(
		estimateCutTime(canvasStore.items, plotterStore.config.cuttingSpeed),
	);

	// ─── Horizontal roll canvas dimensions ─────────
	// Roll width = fixed HEIGHT of canvas (Y axis = cross-cut dimension).
	// Roll length used = dynamic WIDTH of canvas (X axis = direction feed).
	// Canvas crops to actual content extent + buffer — never pads to full roll width.
	const displaySheetW = $derived.by(() => {
		const inBounds = canvasStore.items.filter((i) => !i.outOfBounds);
		if (!inBounds.length) return 12;
		return Math.max(...inBounds.map((i) => i.x + i.width));
	});
	const displaySheetH = $derived.by(() => {
		const rollWidth = canvasStore.sheet.widthInches;
		const oobStrip = outOfBoundsCount > 0 ? 20 : 0;
		const inBounds = canvasStore.items.filter((i) => !i.outOfBounds);
		if (!inBounds.length) return Math.min(rollWidth, 12) + oobStrip;
		const maxY = Math.max(...inBounds.map((i) => i.y + i.height));
		return Math.min(maxY + 4, rollWidth) + oobStrip;
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

	// ─── Re-nest items on new sheet ───────────────
	function renestOnSheet(sheet: typeof canvasStore.sheet) {
		canvasStore.setSheet(sheet);
		if (canvasStore.items.length > 0) {
			const nested = autoNest(canvasStore.items, transposedSheet(sheet));
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
		fitToView();
	}

	// ─── Active panel tab ─────────────────────────
	let panelTab = $state<"properties" | "patterns" | "plotter">("properties");

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

	// ─── Actions ──────────────────────────────────
	function handleAutoNest() {
		const nested = autoNest(canvasStore.items, transposedSheet());
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
	let cutting          = $state(false);
	let serialPortInfo   = $state<SerialPortInfo | null>(null);

	// ─── Cut progress + resume checkpoint ────────
	// Progress is shown in the toolbar during a segmented USB send.
	// Checkpoint lets the user resume if the job was interrupted mid-job.
	let cutProgress = $state<CutProgress | null>(null);

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

	// ─── Plotter detection state ──────────────────
	let detecting       = $state(false);
	let detectedPlotter = $state<DetectedPlotter | null>(null);
	let networkScan     = $state<"idle" | "scanning" | "done">("idle");
	let networkDevices  = $state<NetworkDevice[]>([]);

	const compat = $derived(
		getCompatibilityStatus(
			plotterStore.config.maxMediaWidthMm,
			canvasStore.sheet.widthInches,
		),
	);

	// Max cutting width of the selected plotter in inches
	const plotterMaxWidthIn = $derived(plotterStore.config.maxMediaWidthMm / 25.4);

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
	// Pre-compute export lock states for use in template
	const pltLocked = $derived(!cutCheck.allowed);
	const dxfLocked = $derived(isFree);

	async function handleDetectPlotter() {
		detecting = true;
		detectedPlotter = null;
		try {
			// 1. Try USB Web Serial (previously authorized ports, no dialog)
			const usbResults = await detectUsbPlotters();
			if (usbResults.length > 0) {
				detectedPlotter = usbResults[0];
				plotterStore.applyPreset(detectedPlotter.preset);
				plotterStore.switchConnection("usb-serial");
				toastStore.success(
					`Detected: ${detectedPlotter.preset.name}`,
					detectedPlotter.detail,
				);
				return;
			}

			// 2. Try Cut Agent port enumeration
			const agentUrl = plotterStore.config.agentUrl ?? "http://localhost:7878";
			const agentResults = await detectAgentPorts(agentUrl);
			if (agentResults.length > 0) {
				detectedPlotter = agentResults[0];
				plotterStore.applyPreset(detectedPlotter.preset);
				plotterStore.switchConnection("cut-agent");
				// If the agent returned a port path, pre-select it
				if (agentResults[0].portPath) {
					plotterStore.update({ serialPort: agentResults[0].portPath });
				}
				fetchAgentPorts();
				toastStore.success(
					`Detected: ${detectedPlotter.preset.name}`,
					`via Cut Agent — ${detectedPlotter.detail}`,
				);
				return;
			}

			toastStore.info(
				"No plotter detected",
				"Connect via USB and click 'Select USB Port…', or make sure the Cut Agent is running.",
			);
		} finally {
			detecting = false;
		}
	}

	async function handleNetworkScan() {
		networkScan = "scanning";
		networkDevices = [];
		const agentUrl = plotterStore.config.agentUrl ?? "http://localhost:7878";
		try {
			const found = await scanNetworkViaAgent(agentUrl);
			networkDevices = found;
			networkScan = "done";
			if (found.length === 0) {
				toastStore.info("No network plotters found", "No devices responded on port 9100 or 5000.");
			} else {
				toastStore.success(`Found ${found.length} device${found.length > 1 ? "s" : ""}`, "Select an IP to connect.");
			}
		} catch {
			networkScan = "done";
			toastStore.error("Scan failed", "Make sure the Cut Agent is running.");
		}
	}

	function handleSmartNest() {
		if (isFree) {
			toastStore.info("Lite plan required", "AI deep optimization is available on Lite and above.");
			uiStore.openPricing();
			return;
		}
		if (!canvasStore.items.length) {
			toastStore.warning("No patterns", "Add patterns to the sheet first.");
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

				const result = smartNest(plainItems, transposedSheet(sheet));

				canvasStore.setItems(result.items);
				smartNestGain = result.improvementPct;

				const oob = result.items.filter((i) => i.outOfBounds).length;
				const fit = result.items.length - oob;
				const eff = formatEfficiency(calcEfficiency(result.items, canvasStore.sheet));
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

	async function handleConnectSerial() {
		if (isFree) {
			toastStore.info("Lite plan required", "USB Web Serial is available on Lite and above.");
			uiStore.openPricing();
			return;
		}
		if (!("serial" in navigator)) {
			toastStore.warning("Not supported", "USB direct connect requires Chrome or Edge. Use Download or Cut Agent for other browsers.");
			return;
		}
		try {
			serialPortInfo = await connectSerialPort(plotterStore.config.baudRate ?? 9600);

			// Auto-switch connection type so settings sends and cut sends use the right path
			plotterStore.update({ connection: "usb-serial" });

			// Immediately match VID/PID — no second "Detect" click needed
			const match = matchPortToPreset(serialPortInfo.vendorId, serialPortInfo.productId);
			if (match) {
				detectedPlotter = match;
				if (match.confidence === "exact-vid") {
					plotterStore.applyPreset(match.preset);
					toastStore.success(
						"Plotter identified",
						`${match.preset.name} — settings applied automatically.`,
					);
				} else {
					if (match.detail.toLowerCase().includes("bridge")) {
						toastStore.info(
							"USB device connected",
							"Bridge chip detected — select your plotter model for optimal settings.",
						);
					} else {
						toastStore.success("Port connected", serialPortInfo.label);
					}
				}
			} else {
				toastStore.success("Port connected", serialPortInfo.label);
			}

			// Sync current UI cut settings to plotter immediately after connecting
			sendSettings(plotterStore.config).catch(() => {});
		} catch (err: any) {
			if (err?.name !== "NotAllowedError") {
				toastStore.error("Connection failed", err?.message ?? "Could not open serial port.");
			}
			serialPortInfo = null;
		}
	}

	function handleDisconnectSerial() {
		disconnectSerialPort();
		serialPortInfo = null;
		toastStore.info("Disconnected", "Serial port closed.");
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
			);

			cutProgress = null;

			if (result.ok) {
				localStorage.removeItem("omniplot-resume-checkpoint");
				resumeCheckpoint = null;
				toastStore.success(
					"Resume complete",
					`${remainingItems.length} remaining pattern${remainingItems.length !== 1 ? "s" : ""} sent.`,
				);
			} else {
				// Advance the checkpoint past any newly completed patterns
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
			(s, i) => s + samplePolygonArea(i.pattern.svgPath, i.pattern.widthInches, i.pattern.heightInches),
			0,
		);
		const sheetArea = canvasStore.sheet.widthInches * usedLength;
		const eff       = sheetArea > 0 ? Math.min(1, patternArea / sheetArea) : 0;
		const jobName   = `Job ${new Date().toLocaleDateString()}`;

		// ── Download mode: synchronous, no loading state needed ──────────
		if (plotterStore.config.connection === "download") {
			downloadHpgl(canvasStore.state, plotterStore.config, jobName);
			const connLabel = `PLT file downloaded (${inBounds.length} paths)`;
			toastStore.success("Cut job ready", connLabel);
			persistJob({ user, inBounds, eff, usedLength, patternArea, sheetArea, jobName });
			return;
		}

		// ── Live connection: async segmented send ────────────────────────
		// USB uses per-pattern segmented send so progress is tracked and the job
		// can be resumed from a known pattern index if the connection drops.
		// Network and Cut Agent use monolithic send (the agent/server handles serial).
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
			);

			cutProgress = null;

			if (result.ok) {
				// Clear any stale resume checkpoint — job completed fully
				localStorage.removeItem("omniplot-resume-checkpoint");
				resumeCheckpoint = null;
				toastStore.success("Sent to plotter", `${inBounds.length} pattern${inBounds.length !== 1 ? "s" : ""} sent successfully.`);
				persistJob({ user, inBounds, eff, usedLength, patternArea, sheetArea, jobName });
			} else {
				// Save resume checkpoint if at least one pattern completed
				if (lastCompletedIdx >= 0 && lastCompletedIdx < sortedInBounds.length - 1) {
					const checkpoint: ResumeCheckpoint = {
						remainingItemIds: sortedInBounds.slice(lastCompletedIdx + 1).map((i) => i.id),
						completedCount: lastCompletedIdx + 1,
						totalCount: sortedInBounds.length,
						presetName: plotterStore.config.name,
					};
					localStorage.setItem("omniplot-resume-checkpoint", JSON.stringify(checkpoint));
					resumeCheckpoint = checkpoint;
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
						errorRaw:      `${result.diagnostic.raw ?? ""} [interrupted after ${lastCompletedIdx + 1}/${sortedInBounds.length} patterns]`,
						agentVersion:  null,
						userAgent:     navigator.userAgent,
						autoReported:  result.diagnostic.escalate,
					}).catch(() => {});
				}
			}
		} finally {
			cutting = false;
			cutProgress = null;
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
	}) {
		if (!opts.user) return;
		const job = {
			id: uid("job_"),
			userId: opts.user.uid,
			vehicleId: canvasStore.items[0]?.pattern.vehicleId ?? "",
			name: opts.jobName,
			status: "complete" as const,
			canvasState: canvasStore.state,
			plotterConfig: plotterStore.config,
			materialSheet: canvasStore.sheet,
			exportFormat: "hpgl" as const,
			metrics: {
				materialEfficiency: opts.eff,
				totalPathLengthMm: 0,
				estimatedCutSeconds: estimateCutTime(opts.inBounds, plotterStore.config.cuttingSpeed),
				itemCount: opts.inBounds.length,
				sheetArea: opts.sheetArea,
				usedArea: opts.patternArea,
			},
			createdAt: new Date(),
			updatedAt: new Date(),
			completedAt: new Date(),
			exportUrl: null,
		};
		saveJob(job).catch(() => {});
		// Increment usage so canCut re-derives and the button gates correctly on next render
		incrementCutUsage(opts.user.uid, opts.user.usage.monthResetAt).catch(() => {});
	}

	function handleExport(format: "hpgl" | "svg" | "dxf") {
		if (!canvasStore.items.length) {
			toastStore.warning("Nothing to export", "Add patterns first.");
			return;
		}
		// DXF is a Lite+ feature
		if (format === "dxf" && isFree) {
			toastStore.info("Lite plan required", "DXF export is available on Lite and above.");
			uiStore.openPricing();
			return;
		}
		// PLT download counts as a cut — enforce the same cut-rate limit
		if (format === "hpgl" && !cutCheck.allowed) {
			toastStore.warning("Cut limit reached", cutCheck.reason ?? "Upgrade to continue.");
			uiStore.openPricing();
			return;
		}
		if (format === "hpgl") {
			downloadHpgl(canvasStore.state, plotterStore.config);
			if (userStore.user) {
				incrementCutUsage(userStore.user.uid, userStore.user.usage.monthResetAt).catch(() => {});
			}
		} else if (format === "dxf") {
			downloadDxf(canvasStore.state);
		} else {
			downloadSvg(canvasStore.state);
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
			const nested = autoNest([...canvasStore.items, item], transposedSheet());
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

	// ─── Selected item ────────────────────────────
	const selectedItem = $derived(
		canvasStore.selected.length === 1
			? canvasStore.items.find((i) => i.id === canvasStore.selected[0])
			: null,
	);

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
		const rollPxW = displaySheetW * 48;
		const rollPxH = displaySheetH * 48;
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
	// ─── Cut Agent port list ─────────────────────
	let agentPortsList = $state<Array<{ name: string; manufacturer?: string }>>([]);
	let agentPortsLoading = $state(false);

	async function fetchAgentPorts() {
		agentPortsLoading = true;
		const base = (plotterStore.config.agentUrl ?? "http://localhost:7878").replace(/\/$/, "");
		try {
			const res = await fetch(`${base}/api/ports`, { signal: AbortSignal.timeout(3000) });
			if (res.ok) {
				const ports: Array<{ name: string; isUSB: boolean; manufacturer?: string }> = await res.json();
				agentPortsList = ports.filter((p) => p.isUSB);
				if (!agentPortsList.length) toastStore.info("No USB ports found", "Connect a plotter via USB to the machine running the Cut Agent.");
			} else {
				agentPortsList = [];
			}
		} catch {
			agentPortsList = [];
			toastStore.warning("Agent unreachable", "Make sure the OmniPlot Cut Agent is running.");
		} finally {
			agentPortsLoading = false;
		}
	}

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
		// Auto-trigger tour for first-time visitors
		if (typeof localStorage !== "undefined" && !localStorage.getItem("op-tour-seen")) {
			setTimeout(() => uiStore.openTour(), 800);
		}
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

{#snippet patternCard(item: CanvasItem)}
	<div
		class="pattern-card"
		class:active={canvasStore.selected.includes(item.id)}
		role="button"
		tabindex="0"
		aria-pressed={canvasStore.selected.includes(item.id)}
		onclick={() => canvasStore.select(item.id)}
		onkeydown={(e) => e.key === "Enter" && canvasStore.select(item.id)}
	>
		<div class="pattern-card__thumb" style="border-color: {item.color}20">
			<svg width="44" height="30" viewBox="0 0 100 90" aria-hidden="true">
				<path d={item.pattern.svgPath} fill="none" stroke={item.color} stroke-width="2" />
			</svg>
		</div>
		<div class="pattern-card__info">
			<div class="pattern-card__name">{item.label ?? item.pattern.name}</div>
			<div class="pattern-card__meta">{item.width.toFixed(1)}" × {item.height.toFixed(1)}"</div>
		</div>
		<button
			class="pattern-card__del"
			onclick={(e) => { e.stopPropagation(); canvasStore.select(item.id); canvasStore.removeSelected(); }}
			aria-label="Remove {item.label}"
		>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"
				><path d="M18 6L6 18M6 6l12 12" /></svg>
		</button>
	</div>
{/snippet}

<div class="studio">
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
				onclick={handleSmartNest}
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
				onclick={() => canvasStore.setZoom(canvasStore.zoom - 10)}
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
				{canvasStore.zoom}%
			</div>
			<button
				class="tool-btn"
				onclick={() => canvasStore.setZoom(canvasStore.zoom + 10)}
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

		<!-- Export button -->
		<button class="export-btn" onclick={() => (showExport = !showExport)}>
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
			Export
		</button>

		<!-- Cut button -->
		<button
			class="cut-btn"
			class:cut-btn--locked={!cutCheck.allowed}
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
				Send to Plotter
			{/if}
		</button>
	</div>

	<!-- Export dropdown -->
	{#if showExport}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="export-dropdown-backdrop"
			onclick={() => (showExport = false)}
		></div>
		<div class="export-dropdown animate-slide-down">
			<button class="export-option" class:export-option--locked={pltLocked} onclick={() => handleExport("hpgl")}>
				<div class="export-option__icon">PLT</div>
				<div class="export-option__body">
					<div class="export-option__title">
						PLT file
						{#if pltLocked}<span class="export-lock-badge">Limit reached</span>{/if}
					</div>
					<div class="export-option__desc">Universal plotter format. Works with any cutter.</div>
				</div>
			</button>
			<button class="export-option" onclick={() => handleExport("svg")}>
				<div class="export-option__icon">SVG</div>
				<div class="export-option__body">
					<div class="export-option__title">SVG file</div>
					<div class="export-option__desc">For FlexiSIGN, Inkscape, Illustrator.</div>
				</div>
			</button>
			<button class="export-option" class:export-option--locked={dxfLocked} onclick={() => handleExport("dxf")}>
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

	<!-- ─── Vehicle legend ─── -->
	{#if hasMultipleVehicles}
		<div class="vehicle-legend" role="region" aria-label="Vehicle breakdown">
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

	<!-- ─── Main area ─── -->
	<div class="studio__body">
		<!-- Canvas -->
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
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
				<!-- Material sheet -->
				<div
					class="material-sheet"
					style="
            width: {displaySheetW * 48 * canvasStore.zoom / 100}px;
            height: {displaySheetH * 48 * canvasStore.zoom / 100}px;
          "
				>
					<span class="sheet-label"
						>{canvasStore.sheet.name} · {canvasStore.sheet
							.widthInches}" wide</span
					>
					<span class="sheet-dim"
						>{canvasStore.sheet.widthInches}" roll · {displaySheetW.toFixed(0)}" used</span
					>
					<!-- Roll-width boundary line: shows the edge of the cut zone -->
					{#if canvasStore.sheet.widthInches <= displaySheetH}
						<div
							class="roll-boundary"
							style="top: {canvasStore.sheet.widthInches * 48 * canvasStore.zoom / 100}px"
							aria-hidden="true"
						></div>
					{/if}

					<!-- Plotter limit line: shown when material is wider than plotter's max cutting width -->
					{#if compat !== "ok" && plotterMaxWidthIn < canvasStore.sheet.widthInches}
						<div
							class="plotter-limit-line"
							class:plotter-limit-line--overflow={compat === "overflow"}
							class:plotter-limit-line--tight={compat === "tight"}
							style="top: {plotterMaxWidthIn * 48 * canvasStore.zoom / 100}px"
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
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							class="cut-item"
							class:selected={canvasStore.selected.includes(item.id)}
							class:cut-item--oob={item.outOfBounds}
							style="
                left: {item.x * 48 * canvasStore.zoom / 100}px;
                top: {item.y * 48 * canvasStore.zoom / 100}px;
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
									<path
										d={item.pattern.svgPath}
										fill="{item.color}0D"
										stroke={item.color}
										stroke-width="1.5"
										stroke-linecap="round"
										stroke-linejoin="round"
										vector-effect="non-scaling-stroke"
										class:marching-ants={canvasStore.selected.includes(
											item.id,
										)}
									/>
									<text
										x="50"
										y="55"
										text-anchor="middle"
										fill={item.color}
										opacity="0.5"
										font-size="8"
										font-family="monospace"
										>{item.label ?? item.pattern.zone}</text
									>
								</g>
							</svg>
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
							{/if}
							{#if item.outOfBounds}
								<div class="cut-item__oob-badge" aria-label="Won't cut — outside material zone">
									<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
									Won't cut
								</div>
							{/if}
							<span
								class="cut-item__label"
								style="color: {item.color}"
								>{item.label ?? item.pattern.name}</span
							>
						</div>
					{/each}

					{#if canvasStore.items.length === 0}
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
		<aside class="studio__panel">
			<div class="panel-tabs" role="tablist" data-tour="panel-tabs">
				{#each ["properties", "patterns", "plotter"] as const as tab}
					<button
						class="panel-tab"
						class:active={panelTab === tab}
						onclick={() => (panelTab = tab)}
						role="tab"
						aria-selected={panelTab === tab}
						aria-controls="panel-{tab}"
					>
						{tab.charAt(0).toUpperCase() + tab.slice(1)}
					</button>
				{/each}
			</div>

			<div class="panel-body" id="panel-{panelTab}" role="tabpanel">
				<!-- Properties tab -->
				{#if panelTab === "properties"}
					{#if selectedItem}
						<div class="prop-section">
							<div class="prop-label">
								Selection · {selectedItem.label}
							</div>
							<div class="prop-row">
								<span class="prop-name">X</span>
								<input
									type="number"
									class="prop-input"
									value={selectedItem.x.toFixed(2)}
									step="0.1"
									aria-label="X position"
									onchange={(e) =>
										canvasStore.updateItem(
											selectedItem.id,
											{
												x: parseFloat(
													(
														e.target as HTMLInputElement
													).value,
												),
											},
										)}
								/>
								<span class="prop-name">Y</span>
								<input
									type="number"
									class="prop-input"
									value={selectedItem.y.toFixed(2)}
									step="0.1"
									aria-label="Y position"
									onchange={(e) =>
										canvasStore.updateItem(
											selectedItem.id,
											{
												y: parseFloat(
													(
														e.target as HTMLInputElement
													).value,
												),
											},
										)}
								/>
							</div>
							<div class="prop-row">
								<span class="prop-name">W</span>
								<input
									type="text"
									class="prop-input"
									value="{selectedItem.width.toFixed(2)}"
									readonly
									aria-label="Width"
								/>
								<span class="prop-name">H</span>
								<input
									type="text"
									class="prop-input"
									value="{selectedItem.height.toFixed(2)}"
									readonly
									aria-label="Height"
								/>
							</div>
						</div>
					{:else}
						<div class="panel-placeholder">
							<p>
								Select a pattern on the canvas to edit its
								properties.
							</p>
						</div>
					{/if}

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

					<!-- Plotter tab -->
				{:else}

					<!-- ── Smart Detection ─────────────────────── -->
					<div class="prop-section detect-section">
						<button
							class="detect-btn"
							class:detecting
							onclick={handleDetectPlotter}
							disabled={detecting}
							aria-label="Auto-detect connected plotter"
						>
							{#if detecting}
								<span class="ai-spinner" aria-hidden="true"></span>
								Detecting…
							{:else}
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
								Detect Plotter
							{/if}
						</button>
						{#if detectedPlotter}
							<div class="detect-result">
								<span class="detect-result__dot"></span>
								<div class="detect-result__info">
									<span class="detect-result__name">
										{detectedPlotter.confidence === "generic"
											? "USB Device Detected"
											: detectedPlotter.preset.name}
									</span>
									<span class="detect-result__detail">{detectedPlotter.detail}</span>
								</div>
								<span class="detect-badge detect-badge--{detectedPlotter.confidence === 'exact-vid' ? 'exact' : detectedPlotter.confidence === 'manufacturer-name' ? 'mfr' : 'generic'}">
									{detectedPlotter.confidence === "exact-vid" ? "Exact match" : detectedPlotter.confidence === "manufacturer-name" ? "By name" : "Select model"}
								</span>
							</div>
						{/if}
					</div>

					<!-- ── Device Selection + Compatibility ───── -->
					<div class="prop-section">
						<div class="prop-label-row">
							<span class="prop-label">Plotter Device</span>
							<span
								class="compat-badge compat-badge--{compat}"
								title="{plotterStore.config.name} max: {plotterMaxWidthIn.toFixed(1)}&quot; · Material: {canvasStore.sheet.widthInches}&quot;"
							>
								{#if compat === "ok"}
									<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
								{:else if compat === "tight"}
									<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/></svg>
								{:else}
									<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
								{/if}
								{compatLabel(compat)}
							</span>
						</div>
						<select
							class="prop-select"
							aria-label="Plotter preset"
							onchange={(e) => {
								const preset = PLOTTER_PRESETS.find(
									(p) => p.name === (e.target as HTMLSelectElement).value,
								);
								if (preset) {
									plotterStore.applyPreset(preset);
									if (plotterStore.config.connection === "usb-serial") {
										sendSettings(plotterStore.config).catch(() => {});
									}
									detectedPlotter = null;
								}
							}}
						>
							{#each PLOTTER_PRESETS as preset}
								<option value={preset.name} selected={plotterStore.config.name === preset.name}>
									{preset.name} · {(preset.maxMediaWidthMm / 25.4).toFixed(0)}"
								</option>
							{/each}
						</select>
						{#if detectedPlotter && detectedPlotter.confidence !== "exact-vid" && plotterStore.config.connection === "usb-serial"}
							<p class="prop-note prop-note--usb-hint">
								USB connected — pick your model above to apply optimized cut settings.
							</p>
						{/if}
						<div class="plotter-spec-row">
							<span class="plotter-spec">Max width: <strong>{plotterMaxWidthIn.toFixed(1)}"</strong></span>
							<span class="plotter-spec">Protocol: <strong>{plotterStore.config.protocol.toUpperCase()}</strong></span>
							<span class="plotter-spec">Baud: <strong>{plotterStore.config.baudRate ?? 9600}</strong></span>
						</div>
						{#if compat === "overflow"}
							<p class="compat-warn">
								Material ({canvasStore.sheet.widthInches}") exceeds this plotter's cutting zone ({plotterMaxWidthIn.toFixed(1)}"). Patterns near the edge won't cut correctly.
							</p>
						{:else if compat === "tight"}
							<p class="compat-tight">
								Material is near this plotter's max width. Verify roll alignment before cutting.
							</p>
						{/if}
						{#if plotterStore.config.compatNote}
							<p class="compat-warn compat-warn--protocol">
								⚠ {plotterStore.config.compatNote}
							</p>
						{/if}
					</div>

					<!-- ── Cut Settings ───────────────────────── -->
					<div class="prop-section">
						<div class="prop-label-row">
							<span class="prop-label">Cut Settings</span>
							{#if plotterStore.config.connection === "usb-serial" || plotterStore.config.connection === "cut-agent"}
								<span class="live-badge" title="Blade force and speed sync to plotter in real-time">Live</span>
							{/if}
						</div>
						{#each [["Blade force", "bladeForce", 10, 400, "g"], ["Speed mm/s", "cuttingSpeed", 10, 1200, "mm/s"], ["Passes", "passes", 1, 4, "×"], ["Overcut mm", "overcut", 0, 2, "mm"]] as const as [label, key, min, max, unit]}
							<div class="prop-slider-row">
								<span class="prop-slider-name">
									{label}
									{#if key === "passes" || key === "overcut"}
										<span class="cut-time-badge" title="Applied at cut time — not sent as a live command">Cut-time</span>
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
										plotterStore.update({
											[key]: parseFloat((e.target as HTMLInputElement).value),
										});
										if (key === "bladeForce" || key === "cuttingSpeed") {
											scheduleSettingsSend();
										}
									}}
								/>
								<span class="prop-slider-val">{key === "overcut" ? plotterStore.config[key].toFixed(1) : plotterStore.config[key]}{unit}</span>
							</div>
						{/each}
						<p class="prop-note">
							Force and speed send to the plotter immediately when you move the slider.
							Passes and overcut are woven into the cut paths — they apply when you hit Send to Plotter.
						</p>
						{#if plotterStore.config.connection !== "download"}
							<p class="prop-note prop-note--disclaimer">
								<strong>Display disclaimer:</strong> Many plotters (including most budget cutters like VEVOR) do not update their front-panel display when settings are changed via serial. This is a hardware limitation — the commands are received and applied internally. Assume your force and speed are correctly set and proceed with your cut normally.
							</p>
						{/if}
					</div>

					<!-- ── Origin Offset ───────────────────────── -->
					<div class="prop-section">
						<div class="prop-label">Origin Offset</div>
						{#each [["X offset (in)", "originX", 0, 48, 0.1], ["Y offset (in)", "originY", 0, 24, 0.1]] as const as [label, key, min, max, step]}
							<div class="prop-slider-row">
								<span class="prop-slider-name">{label}</span>
								<input
									type="range"
									class="prop-slider"
									{min}
									{max}
									{step}
									value={plotterStore.config[key]}
									aria-label={label}
									oninput={(e) =>
										plotterStore.update({
											[key]: parseFloat((e.target as HTMLInputElement).value),
										})}
								/>
								<span class="prop-slider-val">{plotterStore.config[key].toFixed(1)}"</span>
							</div>
						{/each}
						<p class="prop-note">Shifts the cut origin in the generated HPGL — applied at cut time, not sent as a standalone command.</p>
					</div>

					<!-- ── Connection ─────────────────────────── -->
					<div class="prop-section">
						<div class="prop-label">Connection</div>
						<select
							class="prop-select"
							aria-label="Connection method"
							onchange={(e) => {
								const newConn = (e.target as HTMLSelectElement).value as PlotterConfig["connection"];
								if (plotterStore.config.connection === "usb-serial" && newConn !== "usb-serial") {
									handleDisconnectSerial();
								}
								plotterStore.switchConnection(newConn);
								if (newConn === "cut-agent") fetchAgentPorts();
							}}
						>
							{#each [["download", "Download PLT file"], ["usb-serial", "USB (Web Serial — Chrome/Edge)"], ["network", "Network (TCP/IP)"], ["cut-agent", "Local Cut Agent"]] as const as [val, label]}
								<option value={val} selected={plotterStore.config.connection === val}>{label}</option>
							{/each}
						</select>
					</div>

					<!-- USB-Serial fields -->
					{#if plotterStore.config.connection === "usb-serial"}
						<div class="prop-section">
							<div class="prop-label">Baud Rate</div>
							<select
								class="prop-select"
								aria-label="Baud rate"
								onchange={(e) => plotterStore.update({ baudRate: parseInt((e.target as HTMLSelectElement).value) })}
							>
								{#each [9600, 19200, 38400, 57600, 115200] as rate}
									<option value={rate} selected={plotterStore.config.baudRate === rate}>{rate}</option>
								{/each}
							</select>
						</div>
						<div class="prop-section">
							{#if serialPortInfo}
								<div class="conn-status conn-status--ok">
									<span class="conn-dot"></span>
									{#if detectedPlotter && detectedPlotter.confidence === "exact-vid"}
										{detectedPlotter.preset.name}
									{:else if detectedPlotter}
										{detectedPlotter.detail}
									{:else}
										{serialPortInfo.label}
									{/if}
								</div>
								<button class="prop-btn prop-btn--ghost" onclick={handleDisconnectSerial}>Disconnect</button>
							{:else}
								<button class="prop-btn" onclick={handleConnectSerial}>Select USB Port…</button>
								<p class="prop-note">Chrome or Edge required for USB direct connect.</p>
							{/if}
						</div>

					<!-- Network fields -->
					{:else if plotterStore.config.connection === "network"}
						<div class="prop-section">
							<div class="prop-label">Plotter IP Address</div>
							<div class="prop-input-row">
								<input
									class="prop-input prop-input--grow"
									type="text"
									placeholder="192.168.1.100"
									value={plotterStore.config.ipAddress ?? "192.168.1.100"}
									oninput={(e) => plotterStore.update({ ipAddress: (e.target as HTMLInputElement).value })}
								/>
								<span class="prop-input-sep">:</span>
								<input
									class="prop-input prop-input--port"
									type="number"
									placeholder="9100"
									min="1"
									max="65535"
									value={plotterStore.config.port ?? 9100}
									oninput={(e) => plotterStore.update({ port: parseInt((e.target as HTMLInputElement).value) || 9100 })}
								/>
							</div>
							<p class="prop-note">Port 9100 = HP JetDirect (most network plotters).</p>
						</div>
						<!-- Network scan via agent -->
						<div class="prop-section">
							<div class="prop-label">Discover on LAN</div>
							<button
								class="prop-btn prop-btn--ghost scan-btn"
								class:scanning={networkScan === "scanning"}
								onclick={handleNetworkScan}
								disabled={networkScan === "scanning"}
							>
								{#if networkScan === "scanning"}
									<span class="ai-spinner" aria-hidden="true"></span>
									Scanning network…
								{:else}
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M1.42 9a16 16 0 0121.16 0M5 12.55a11 11 0 0114.08 0M10.5 16a6 6 0 013 0M12 20h.01"/></svg>
									Scan via Cut Agent
								{/if}
							</button>
							<p class="prop-note">Requires Cut Agent running on this machine. Scans the local LAN for plotters on port 9100.</p>
							{#if networkScan === "done" && networkDevices.length > 0}
								<div class="network-results">
									{#each networkDevices as dev}
										<button
											class="network-device"
											onclick={() => {
												plotterStore.update({ ipAddress: dev.ip, port: dev.port });
												networkScan = "idle";
											}}
										>
											<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
											<span class="network-device__ip">{dev.ip}</span>
											<span class="network-device__port">:{dev.port}</span>
											<span class="network-device__ms">{dev.responseMs}ms</span>
										</button>
									{/each}
								</div>
							{:else if networkScan === "done"}
								<p class="prop-note" style="color: var(--color-warning)">No plotter-compatible devices found on this LAN.</p>
							{/if}
						</div>

					<!-- Cut Agent fields -->
					{:else if plotterStore.config.connection === "cut-agent"}
						<div class="prop-section">
							<div class="prop-label">Agent URL</div>
							<input
								class="prop-input prop-input--full"
								type="text"
								placeholder="http://localhost:7878"
								value={plotterStore.config.agentUrl ?? "http://localhost:7878"}
								oninput={(e) => plotterStore.update({ agentUrl: (e.target as HTMLInputElement).value })}
							/>
							<p class="prop-note">Run the OmniPlot Cut Agent on this machine to send over USB without browser limitations.</p>
						</div>
						<div class="prop-section">
							<div class="prop-label">Baud Rate</div>
							<select
								class="prop-select"
								aria-label="Baud rate"
								onchange={(e) => plotterStore.update({ baudRate: parseInt((e.target as HTMLSelectElement).value) })}
							>
								{#each [9600, 19200, 38400, 57600, 115200] as rate}
									<option value={rate} selected={plotterStore.config.baudRate === rate}>{rate}</option>
								{/each}
							</select>
						</div>
						<div class="prop-section">
							<div class="prop-label-row">
								<span class="prop-label">Serial Port</span>
								<button
									class="prop-btn-inline"
									onclick={fetchAgentPorts}
									disabled={agentPortsLoading}
									aria-label="Refresh port list"
									title="Refresh"
								>
									{#if agentPortsLoading}
										<span class="ai-spinner" style="width:10px;height:10px;" aria-hidden="true"></span>
									{:else}
										<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
									{/if}
								</button>
							</div>
							<select
								class="prop-select"
								aria-label="Serial port"
								onchange={(e) => plotterStore.update({ serialPort: (e.target as HTMLSelectElement).value })}
							>
								<option value="auto" selected={!plotterStore.config.serialPort || plotterStore.config.serialPort === "auto"}>Auto-detect</option>
								{#each agentPortsList as p}
									<option value={p.name} selected={plotterStore.config.serialPort === p.name}>
										{p.name}{p.manufacturer ? ` — ${p.manufacturer}` : ""}
									</option>
								{/each}
							</select>
							{#if !agentPortsList.length && !agentPortsLoading}
								<p class="prop-note">No USB ports found — connect a plotter to this machine and click refresh.</p>
							{/if}
						</div>
					{/if}

					<!-- ── Output Format ───────────────────────── -->
					<div class="prop-section">
						<div class="prop-label">Output Format</div>
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
						<p class="prop-note">Standard HPGL and Roland use different speed units internally — selecting the right format ensures your plotter receives correctly scaled commands.</p>
					</div>

				{/if}
			</div>
		</aside>
	</div>

	<!-- ─── Status bar ─── -->
	<div class="studio__statusbar" role="status" aria-label="Job metrics" data-tour="statusbar">
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
		{#each [["Cut Paths", `${cutCount}`, ""], ["Est. Cut Time", formatCutTime(cutTimeSecs), ""], ["Roll", `${canvasStore.sheet.widthInches}" × ${displaySheetW.toFixed(0)}"`, ""], ["Excluded", `${outOfBoundsCount}`, outOfBoundsCount > 0 ? "warn" : ""], ["Cursor", `${cursorX.toFixed(1)}" , ${cursorY.toFixed(1)}"`, ""]] as [label, value, cls]}
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
		display: grid;
		grid-template-rows: auto auto auto auto 1fr auto;
		height: 100%;
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
		flex-wrap: wrap;
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

	.export-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 5px 12px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		cursor: pointer;
		transition: background 0.12s;
	}

	.export-btn:hover {
		background: var(--bg-surface-3);
	}

	.cut-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 16px;
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
		grid-template-columns: 1fr 340px;
		overflow: hidden;
	}

	/* ─── Canvas ────── */
	.canvas-area {
		position: relative;
		overflow: auto;
		background: var(--canvas-bg);
		cursor: crosshair;
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

	.material-sheet {
		position: relative;
		background: rgba(255, 255, 255, 0.03);
		border: 1px dashed var(--border-default);
		border-radius: 2px;
		flex-shrink: 0;
	}

	.sheet-label {
		position: absolute;
		top: -20px;
		left: 0;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.sheet-dim {
		position: absolute;
		bottom: -18px;
		right: 0;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		color: var(--text-tertiary);
		white-space: nowrap;
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

	.cut-item__label {
		position: absolute;
		bottom: -16px;
		left: 0;
		font-family: var(--font-mono);
		font-size: 0.5rem;
		white-space: nowrap;
		pointer-events: none;
		letter-spacing: 0.04em;
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
	.studio__panel {
		background: var(--bg-surface);
		border-left: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.panel-tabs {
		display: flex;
		border-bottom: 1px solid var(--border-subtle);
	}

	.panel-tab {
		flex: 1;
		padding: 10px 0;
		font-size: 0.75rem;
		font-weight: 500;
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
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.panel-placeholder {
		padding: 24px 0;
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.8125rem;
	}

	/* Properties */
	.prop-section {
		margin-bottom: 18px;
	}

	.prop-label {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 8px;
	}

	.prop-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
	}

	.prop-name {
		font-size: 0.75rem;
		color: var(--text-secondary);
		min-width: 14px;
	}

	.prop-input {
		flex: 1;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 5px 7px;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
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
		padding: 6px 8px;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
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
		padding: 7px 12px;
		background: var(--color-brand);
		color: #000;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.8rem;
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
		margin-top: 4px;
	}

	.prop-note {
		font-size: 0.72rem;
		color: var(--text-tertiary);
		margin-top: 4px;
		line-height: 1.4;
	}
	.prop-note--usb-hint {
		color: var(--color-warning, #F7B731);
	}
	.prop-note--disclaimer {
		margin-top: 6px;
		padding: 6px 8px;
		background: var(--bg-surface-2);
		border-left: 2px solid var(--border-default);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		color: var(--text-secondary);
	}
	.prop-note--disclaimer strong {
		color: var(--text-primary);
		font-weight: 600;
	}

	/* Live / cut-time indicator badges on slider labels */
	.live-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 1px 5px;
		border-radius: 3px;
		background: color-mix(in srgb, var(--color-success, #00D68F) 15%, transparent);
		color: var(--color-success, #00D68F);
		border: 1px solid color-mix(in srgb, var(--color-success, #00D68F) 30%, transparent);
	}
	.cut-time-badge {
		display: inline-flex;
		font-size: 0.58rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 1px 4px;
		border-radius: 3px;
		background: var(--bg-surface-3);
		color: var(--text-tertiary);
		vertical-align: middle;
		margin-left: 3px;
	}

	.conn-status {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8rem;
		color: var(--text-primary);
		margin-bottom: 4px;
	}
	.conn-status--ok { color: var(--color-success, #00D68F); }
	.conn-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}

	.prop-slider-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.prop-slider-name {
		font-size: 0.75rem;
		color: var(--text-secondary);
		min-width: 72px;
	}

	.prop-slider {
		flex: 1;
		-webkit-appearance: none;
		height: 3px;
		background: var(--bg-surface-3);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.prop-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--color-brand-dim);
		cursor: pointer;
		border: 1px solid rgba(0, 0, 0, 0.2);
	}

	.prop-slider-val {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
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
		font-size: 0.625rem;
		color: var(--text-tertiary);
	}

	/* Pattern cards */
	.pattern-card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			border-color 0.12s,
			background 0.12s;
		margin-bottom: 6px;
	}

	.pattern-card:hover {
		border-color: var(--border-default);
		background: var(--bg-surface-3);
	}
	.pattern-card.active {
		border-color: var(--color-brand-dim);
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
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pattern-card__meta {
		font-family: var(--font-mono);
		font-size: 0.625rem;
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
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-tertiary, var(--text-muted));
		flex: 1;
	}

	.vehicle-section__count {
		font-size: 0.6875rem;
		font-family: var(--font-mono, monospace);
		color: var(--text-tertiary, var(--text-muted));
		background: var(--bg-surface-2, var(--bg-elevated));
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		padding: 0 5px;
		line-height: 1.6;
	}

	.patterns-count {
		display: inline-flex;
		align-items: center;
		padding: 0 5px;
		font-size: 0.6875rem;
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
	.studio__statusbar {
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
		font-size: 0.5625rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 1px;
	}

	.status-metric__value {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
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
		font-size: 0.625rem;
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

	.roll-pill {
		padding: 4px 10px;
		border-radius: 99px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		font-family: var(--font-mono);
		font-size: 0.625rem;
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
		font-size: 0.5rem;
		letter-spacing: 0.06em;
		font-weight: 600;
		text-transform: uppercase;
		padding: 1px 5px;
		border-radius: 3px;
		white-space: nowrap;
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
		font-size: 0.8rem;
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
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.detect-result__detail {
		font-size: 0.625rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.detect-badge {
		font-family: var(--font-mono);
		font-size: 0.5rem;
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
		font-size: 0.5rem;
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
		font-size: 0.5625rem;
		color: var(--text-tertiary);
	}
	.plotter-spec strong { color: var(--text-secondary); }

	/* Compatibility warnings */
	.compat-warn {
		font-size: 0.72rem;
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
		font-size: 0.72rem;
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
		font-size: 0.875rem;
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
		font-size: 0.6875rem;
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
	.network-device__ms   { font-size: 0.5625rem; color: var(--text-tertiary); margin-left: auto; }
</style>
