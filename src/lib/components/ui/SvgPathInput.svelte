<script lang="ts" module>
	import type { PatternUploadSource } from '$lib/types';
	export type SvgInputSource = Omit<PatternUploadSource, "flow" | "batchSize">;
</script>

<script lang="ts">
	import { traceImageData } from '$lib/utils/trace';
	import { smoothBezierJunctions } from '$lib/utils/bezier-smooth';
	import { tooltip } from '$lib/actions/tooltip';
	import {
		parsePath, pathBBox, transformSegs, normalizeOutline, splitSubpathSegs, serializePath,
		flattenSegs, splitIntoPieces, rectSegs, ellipseSegs, polySegs, type Seg, type Mat,
	} from '$lib/utils/pathGeometry';

	// ─── Props ────────────────────────────────────
	interface Props {
		value: string;
		id?: string;
		error?: boolean;
		showMirror?: boolean;
		mirrorOrigLabel?: string;
		mirrorFlipLabel?: string;
		onMultiExtract?: (paths: string[]) => void;
		autoExtract?: boolean; // auto-fire onMultiExtract when multiple subpaths detected
		onVectorizingChange?: (v: boolean) => void; // parent can lock its form actions
		/** Real size from the form. When both are set the preview shows the
		 *  true proportions the cutter will produce (it stretches the path's
		 *  bounding box to exactly this size); otherwise the path's own. */
		widthInches?: number;
		heightInches?: number;
		/** Called after an SVG file is imported: the shape's real size when the
		 *  file declares absolute units (in/mm/cm/pt/pc), otherwise null. Never
		 *  called for traced images/PDFs (their size is unknown). */
		onFileSize?: (size: { widthInches: number; heightInches: number } | null) => void;
		/** Where the current value came from (file kind + import method) —
		 *  saved with the pattern for Admin → Uploads. Null until there's a value. */
		source?: SvgInputSource | null;
	}
	let { value = $bindable(""), id = "svgPath", error = false, showMirror = false, mirrorOrigLabel, mirrorFlipLabel, onMultiExtract, autoExtract = false, onVectorizingChange, widthInches, heightInches, onFileSize, source = $bindable(null) }: Props = $props();

	// ─── Resolution rating (shared by the Input / Output info bars) ─────────
	interface ImgDims { w: number; h: number }
	function loadImageDims(url: string): Promise<ImgDims> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
			img.onerror = () => reject(new Error("Could not read image dimensions."));
			img.src = url;
		});
	}
	function loadImageEl(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload  = () => resolve(img);
			img.onerror = () => reject(new Error("Could not load image."));
			img.src = url;
		});
	}
	type ResTier = "low" | "med" | "high";
	function resRating(longEdge: number): { label: string; tier: ResTier } {
		if (longEdge < 500)  return { label: "Low res",    tier: "low"  };
		if (longEdge < 1500) return { label: "Medium res", tier: "med"  };
		return { label: "High res", tier: "high" };
	}

	// ─── Tab state ────────────────────────────────
	// No default — nothing is selected/run until the user explicitly picks a
	// method. Picking a method processes the uploaded image for real.
	type Tab = "vectorize" | "cutout" | "paste" | "trace";
	let tab = $state<Tab | null>(null);

	// ─── Per-tab state ────────────────────────────
	let traceErr      = $state("");
	let tracing       = $state(false);
	let vectorizeErr  = $state("");
	let vectorizing   = $state(false);
	let cutoutErr     = $state("");
	let pasteErr      = $state("");

	// ─── Manual paste: full SVG code (extracted) vs raw path data (used as-is) ──
	type PasteMode = "svg" | "path";
	let pasteMode     = $state<PasteMode>("svg");
	let pastedSvgText = $state("");

	function extractPastedSvg() {
		if (!pastedSvgText.trim()) return;
		touched = true;
		pasteErr = "";
		try {
			value = importSvgFile(pastedSvgText);
		} catch (err) {
			pasteErr = err instanceof Error ? err.message : "Could not extract path data.";
		}
	}

	// ─── Uploaded source image (input) ─────────────
	// Persisted across method switches so a change of import type can re-run the
	// selected pipeline against the same source instead of asking to re-upload.
	let uploadedFile        = $state<File | null>(null);
	let uploadedPreviewUrl  = $state("");
	// The file the user actually picked — uploadedFile may be a rasterized
	// PDF or an enhanced/rotated copy of it.
	let originalFile        = $state<File | null>(null);
	// True once the user has provided *some* input — either a file or raw path
	// data — at which point the method picker / contour options are revealed.
	const hasStarted = $derived(!!uploadedFile || !!value.trim());

	// Cache of the output already produced for each method, keyed by tab —
	// so switching back to a method that already ran on this input re-shows
	// its result (and matching contour/layer state) instead of re-running
	// (and re-billing) the pipeline.
	interface TabResult {
		value: string;
		detectedLayers: { d: string; area: number }[];
		layerSelection: boolean[];
	}
	let resultsByTab = $state<Partial<Record<Tab, TabResult>>>({});

	// ─── Enhance (sharpen/clean up a low-quality input image) ─────────────
	let enhancing = $state(false);
	let enhanceErr = $state("");
	let enhanceDone = $state(false);
	let _enhanceDoneTimeout: ReturnType<typeof setTimeout> | null = null;

	// Before/after snapshot from the most recent enhance run, so the user can
	// see exactly what changed rather than just trusting a silent file swap.
	interface CompareSnap extends ImgDims { url: string }
	let compareBefore = $state<CompareSnap | null>(null);
	let compareAfter  = $state<CompareSnap | null>(null);

	async function enhanceUploadedImage() {
		if (!uploadedFile || enhancing) return;
		enhanceErr = "";
		enhancing = true;
		if (_enhanceDoneTimeout !== null) { clearTimeout(_enhanceDoneTimeout); _enhanceDoneTimeout = null; }
		enhanceDone = false;
		let beforeUrl = "";
		try {
			const isRasterImage = uploadedFile.type.startsWith("image/") && uploadedFile.type !== "image/svg+xml";
			if (!isRasterImage) throw new Error("Enhance only applies to raster images.");

			// Snapshot the current image before it gets replaced — this is what
			// "before" compares against, independent of the live preview URL.
			beforeUrl = URL.createObjectURL(uploadedFile);
			const beforeDims = await loadImageDims(beforeUrl);

			const fd = new FormData();
			fd.append("image", uploadedFile);
			const res = await fetch("/api/enhance", { method: "POST", body: fd });
			if (!res.ok) {
				const body = await res.text().catch(() => "");
				let msg = "";
				try { msg = (JSON.parse(body) as { message?: string }).message ?? ""; } catch { msg = body; }
				throw new Error(msg || `Server error ${res.status}`);
			}
			const { image } = await res.json() as { image: string };
			const blob = await (await fetch(image)).blob();
			const enhancedFile = new File([blob], uploadedFile.name.replace(/\.\w+$/, "") + "-enhanced.png", { type: "image/png" });

			setUploadedFile(enhancedFile, { keepCompare: true });
			const afterDims = await loadImageDims(uploadedPreviewUrl);

			if (compareBefore) URL.revokeObjectURL(compareBefore.url);
			compareBefore = { url: beforeUrl, ...beforeDims };
			compareAfter  = { url: uploadedPreviewUrl, ...afterDims };
			beforeUrl = ""; // ownership transferred to compareBefore — don't revoke below

			enhanceDone = true;
			_enhanceDoneTimeout = setTimeout(() => { enhanceDone = false; _enhanceDoneTimeout = null; }, 2200);
		} catch (err) {
			enhanceErr = err instanceof Error ? err.message : "Enhance failed.";
			if (beforeUrl) URL.revokeObjectURL(beforeUrl);
		} finally {
			enhancing = false;
		}
	}

	function dismissCompare() {
		if (compareBefore) URL.revokeObjectURL(compareBefore.url);
		compareBefore = null;
		compareAfter  = null;
	}

	// ─── Manual rotation (fix a sideways/upside-down input photo) ──────────
	// Rotates the actual uploaded pixels (via canvas), not just the preview —
	// the pattern still needs to trace right-side-up regardless of which way
	// the source photo happened to be shot. Done entirely client-side since
	// it's a cheap transform with no need for a server round trip.
	let rotating = $state(false);
	async function rotateUploadedImage(deg: 90 | -90) {
		if (!uploadedFile || rotating || enhancing || pdfConverting) return;
		const isRasterImage = uploadedFile.type.startsWith("image/") && uploadedFile.type !== "image/svg+xml";
		if (!isRasterImage) return;
		rotating = true;
		try {
			const img = await loadImageEl(uploadedPreviewUrl);
			const canvas = document.createElement("canvas");
			canvas.width  = img.naturalHeight;
			canvas.height = img.naturalWidth;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("Canvas not supported.");
			ctx.translate(canvas.width / 2, canvas.height / 2);
			ctx.rotate((deg * Math.PI) / 180);
			ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
			if (!blob) throw new Error("Could not export rotated image.");
			const rotatedFile = new File([blob], uploadedFile.name.replace(/\.\w+$/, "") + "-rotated.png", { type: "image/png" });
			setUploadedFile(rotatedFile);
		} finally {
			rotating = false;
		}
	}

	function setUploadedFile(file: File, opts?: { keepCompare?: boolean }) {
		uploadedFile = file;
		if (uploadedPreviewUrl) URL.revokeObjectURL(uploadedPreviewUrl);
		uploadedPreviewUrl = URL.createObjectURL(file);
		resetInputView();
		// New source image — any cached outputs and errors belong to the old one.
		resultsByTab = {};
		value = "";
		tab = null;
		vectorizeErr = "";
		cutoutErr    = "";
		pasteErr     = "";
		traceErr     = "";
		// A genuinely new upload (not the result of Enhance replacing the image
		// with its own cleaned-up version) invalidates any pending before/after.
		if (!opts?.keepCompare) {
			if (compareBefore) URL.revokeObjectURL(compareBefore.url);
			compareBefore = null;
			compareAfter  = null;
		}
	}

	// ─── Input image resolution (for the Input info bar) ─────────────────
	let inputDims = $state<ImgDims | null>(null);
	$effect(() => {
		const url = uploadedPreviewUrl;
		if (!url) { inputDims = null; return; }
		let cancelled = false;
		loadImageDims(url).then(d => { if (!cancelled) inputDims = d; }).catch(() => { if (!cancelled) inputDims = null; });
		return () => { cancelled = true; };
	});

	function tabError(t: Tab): string {
		if (t === "vectorize") return vectorizeErr;
		if (t === "cutout")    return cutoutErr;
		if (t === "paste")     return pasteErr;
		return traceErr;
	}

	// Runs the pipeline for a given tab against a given file — real processing,
	// not a cached/faked result — then caches the output so switching back to
	// this method later doesn't re-run it.
	async function runForTab(t: Tab, file: File) {
		if (t === "vectorize") await runVectorize(file);
		else if (t === "cutout") await runCutout(file);
		else if (t === "paste") await runPasteExtract(file);
		else await runTraceImage(file);
		if (!tabError(t) && value.trim()) {
			resultsByTab = { ...resultsByTab, [t]: { value, detectedLayers, layerSelection } };
		}
	}

	// Single handler for every file input in this component (initial upload,
	// per-tab dropzones, and the "Replace" control on the Input preview).
	// Uploading only stores the image — no method runs until the user picks one.
	function handleFileSelected(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = "";
		if (!file) return;
		touched = true;
		originalFile = file;
		const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
		if (isPdf) {
			convertPdfAndUse(file);
			return;
		}
		setUploadedFile(file);
	}

	// ─── Source tracking ───────────────────────────
	// An SVG file is imported as-is whichever method tab is picked; a raster
	// (or rasterized PDF) goes through the picked pipeline.
	const currentSource = $derived.by((): SvgInputSource | null => {
		if (!value.trim()) return null;
		if (!uploadedFile) return { input: pasteMode === "path" ? "path-paste" : "svg-paste" };
		const orig = originalFile ?? uploadedFile;
		const fromPdf = orig.type === "application/pdf" || orig.name.toLowerCase().endsWith(".pdf");
		const isSvg = !fromPdf && (uploadedFile.type === "image/svg+xml" || uploadedFile.name.toLowerCase().endsWith(".svg"));
		return {
			input: isSvg ? "svg-file" : tab === "vectorize" || tab === "cutout" || tab === "trace" ? `image-${tab}` : "unknown",
			...(fromPdf ? { fromPdf: true } : {}),
			fileName:  orig.name.slice(0, 200),
			fileType:  orig.type || undefined,
			fileBytes: orig.size,
		};
	});
	// Only once the user has imported something here — a value restored from
	// a draft keeps the source the parent restored with it.
	let touched = $state(false);
	$effect(() => { if (touched) source = currentSource; });

	// ─── PDF support ───────────────────────────────
	// PDFs aren't a raster or an in-DOM SVG, so they can't go through either
	// existing path directly. Render the first page to a PNG server-side
	// (pdfjs-dist + a Canvas2D surface) and hand that PNG to setUploadedFile —
	// from that point on it's an ordinary raster image and every existing
	// pipeline (Vectorize, Cutout, Enhance, Trace) works unmodified.
	let pdfConverting = $state(false);
	let pdfConvertErr = $state("");
	async function convertPdfAndUse(file: File) {
		pdfConvertErr = "";
		pdfConverting = true;
		try {
			const fd = new FormData();
			fd.append("file", file);
			const res = await fetch("/api/pdf-convert", { method: "POST", body: fd });
			if (!res.ok) {
				const body = await res.text().catch(() => "");
				let msg = "";
				try { msg = (JSON.parse(body) as { message?: string }).message ?? ""; } catch { msg = body; }
				throw new Error(msg || `Server error ${res.status}`);
			}
			const { image } = await res.json() as { image: string };
			const blob = await (await fetch(image)).blob();
			const pngFile = new File([blob], file.name.replace(/\.pdf$/i, "") + ".png", { type: "image/png" });
			setUploadedFile(pngFile);
		} catch (err) {
			pdfConvertErr = err instanceof Error ? err.message : "Could not convert PDF.";
		} finally {
			pdfConverting = false;
		}
	}

	// Switching import type re-uses the already-uploaded input. If this method
	// already ran on it, its cached output is restored instead of re-running.
	function switchTab(next: Tab) {
		tab = next;
		if (!uploadedFile) return;
		const cached = resultsByTab[next];
		if (cached !== undefined) {
			value           = cached.value;
			detectedLayers  = cached.detectedLayers;
			layerSelection  = cached.layerSelection;
		} else {
			runForTab(next, uploadedFile);
		}
	}

	// ─── Layer filtering (outer/inner contour detection) ─────────────────
	// Lossless SVG extraction (Vectorize's SVG branch, Path Data upload) can pull
	// in nested contours from the source file — e.g. a "ribbon" shape whose outer
	// boundary and inner hole are both traced, producing a visible double line.
	// PRECISION: by default EVERY contour in the file is kept — the upload is
	// reproduced exactly as drawn (holes, multi-part art, everything). Only an
	// explicit user choice ("outer"/"inner"/manual) may drop a contour.
	let layerAutoKeep    = $state(false);
	let layerPreference  = $state<"outer" | "inner">("outer");
	let layerManualMode  = $state(false);
	let detectedLayers   = $state<{ d: string; area: number }[]>([]);
	let layerSelection   = $state<boolean[]>([]);
	let layerManageOpen  = $state(false);

	// Splits an already-normalized (0-100) multi-subpath d string into its
	// individual contours (exact parser — correct for relative commands),
	// each with its signed area (from the exact flattening).
	function splitLayers(d: string): { d: string; area: number }[] {
		let subs: Seg[][];
		try { subs = splitSubpathSegs(parsePath(d)); } catch { return [{ d, area: 0 }]; }
		return subs.map((seg) => {
			const pts = flattenSegs(seg, 0.01)[0]?.points ?? [];
			let area = 0;
			for (let i = 0; i < pts.length; i++) {
				const j = (i + 1) % pts.length;
				area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
			}
			return { d: serializePath(seg), area: area / 2 };
		});
	}

	// Recomputes `value` from the currently-selected layers.
	function rebuildFromSelection() {
		const selected = detectedLayers.filter((_, i) => layerSelection[i]);
		value = (selected.length ? selected : detectedLayers).map(l => l.d).join(' ');
	}

	// Called whenever a losslessly-extracted SVG (multi-layer capable) is loaded.
	// Detects contours; if more than one, applies the auto-keep preference unless
	// the user has already taken manual control of layer selection.
	function processDetectedLayers(fullD: string): string {
		const layers = splitLayers(fullD);
		detectedLayers  = layers;
		layerManageOpen = false;
		if (layers.length <= 1) {
			layerManualMode = false;
			layerSelection  = layers.map(() => true);
			return fullD;
		}
		if (!layerAutoKeep) {
			layerManualMode = false;
			layerSelection  = layers.map(() => true);
			return fullD;
		}
		layerManualMode = false;
		const ranked = layers.map((l, i) => ({ i, abs: Math.abs(l.area) })).sort((a, b) => b.abs - a.abs);
		const chosen = layerPreference === "outer" ? ranked[0].i : (ranked[1]?.i ?? ranked[0].i);
		layerSelection = layers.map((_, i) => i === chosen);
		return layers[chosen].d;
	}

	function toggleLayer(i: number) {
		layerManualMode = true;
		layerSelection = layerSelection.map((sel, idx) => idx === i ? !sel : sel);
		rebuildFromSelection();
	}

	function resetLayersToAuto() {
		layerManualMode = false;
		if (detectedLayers.length <= 1 || !layerAutoKeep) {
			layerSelection = detectedLayers.map(() => true);
			rebuildFromSelection();
			return;
		}
		const ranked = detectedLayers.map((l, i) => ({ i, abs: Math.abs(l.area) })).sort((a, b) => b.abs - a.abs);
		const chosen = layerPreference === "outer" ? ranked[0].i : (ranked[1]?.i ?? ranked[0].i);
		layerSelection = detectedLayers.map((_, i) => i === chosen);
		rebuildFromSelection();
	}

	// Ranking (largest → smallest by |area|) of the currently detected layers —
	// index 0 is treated as the "Outer" contour, everything else as "Inner"
	// (a simplification when there are more than two nested contours).
	const layerRankOrder = $derived(
		detectedLayers
			.map((l, i) => ({ i, abs: Math.abs(l.area) }))
			.sort((a, b) => b.abs - a.abs)
			.map(r => r.i)
	);
	function layerBadge(i: number): "Outer" | "Inner" {
		return layerRankOrder[0] === i ? "Outer" : "Inner";
	}

	// Quick action from the subpath-count warning banner — jump straight to
	// "keep the single outer contour" without opening the layer panel.
	function quickKeepOuter() {
		const layers = splitLayers(value);
		if (layers.length <= 1) return;
		detectedLayers  = layers;
		const ranked = layers.map((l, i) => ({ i, abs: Math.abs(l.area) })).sort((a, b) => b.abs - a.abs);
		const chosen = ranked[0].i;
		layerSelection  = layers.map((_, i) => i === chosen);
		layerAutoKeep   = true;
		layerPreference = "outer";
		layerManualMode = true;
		value = layers[chosen].d;
	}

	// ─── Pre-upload contour preference ────────────────────────────────────
	// Lets the user resolve ahead of time how nested contours should be
	// handled, instead of only after the fact in the layer panel.
	type ContourPref = "outer" | "inner" | "all";
	const contourPref = $derived(!layerAutoKeep ? "all" : layerPreference) as ContourPref;
	function setContourPref(pref: ContourPref) {
		// Explicit choice from the picker always wins over any prior manual
		// layer selection — this is meant to resolve the outcome up front.
		if (pref === "all") {
			layerAutoKeep   = false;
			layerManualMode = false;
			layerSelection  = detectedLayers.map(() => true);
			rebuildFromSelection();
			return;
		}
		layerAutoKeep   = true;
		layerPreference = pref;
		layerManualMode = false;
		resetLayersToAuto();
	}

	// ─── Input (uploaded image) zoom / pan / fullscreen — mirrors the output preview ──
	let inputFullscreen = $state(false);
	$effect(() => {
		if (!inputFullscreen) return;
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") inputFullscreen = false; };
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	let inputZoom      = $state(1);
	let inputPanX      = $state(0);
	let inputPanY      = $state(0);
	let inputIsPanning = $state(false);
	type InputDragOrigin = { clientX: number; clientY: number; panX: number; panY: number };
	let inputDragOrigin: InputDragOrigin | null = null;

	function resetInputView() { inputZoom = 1; inputPanX = 0; inputPanY = 0; }

	function inputOnWheel(e: WheelEvent) {
		e.preventDefault();
		const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
		inputZoom = Math.min(8, Math.max(1, inputZoom * factor));
		if (inputZoom === 1) { inputPanX = 0; inputPanY = 0; }
	}
	function inputOnPointerDown(e: PointerEvent) {
		if (e.button !== 0 || inputZoom <= 1) return;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		inputIsPanning  = true;
		inputDragOrigin = { clientX: e.clientX, clientY: e.clientY, panX: inputPanX, panY: inputPanY };
	}
	function inputOnPointerMove(e: PointerEvent) {
		if (!inputIsPanning || !inputDragOrigin) return;
		inputPanX = inputDragOrigin.panX + (e.clientX - inputDragOrigin.clientX);
		inputPanY = inputDragOrigin.panY + (e.clientY - inputDragOrigin.clientY);
	}
	function inputOnPointerUp(e: PointerEvent) {
		(e.currentTarget as Element).releasePointerCapture(e.pointerId);
		inputIsPanning  = false;
		inputDragOrigin = null;
	}
	function inputZoomIn()  { inputZoom = Math.min(8, inputZoom * 1.25); }
	function inputZoomOut() { inputZoom = Math.max(1, inputZoom / 1.25); if (inputZoom === 1) { inputPanX = 0; inputPanY = 0; } }

	// ─── Fullscreen preview (output) ────────────────────────────────────────
	let previewFullscreen = $state(false);
	$effect(() => {
		if (!previewFullscreen) return;
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") previewFullscreen = false; };
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	// ─── Scan animation state ─────────────────────
	let scanImageUrl     = $state("");
	let scanProgress     = $state(0);
	let scanElapsed      = $state(0);
	let scanPhases       = $state<Array<{ label: string; end: number }>>([]);
	let scanTotalCount   = $state(0);
	let scanDoneCount    = $state(0);
	let scanPatternStates = $state<Array<'queued' | 'active' | 'done'>>([]);
	let _scanTimer:   ReturnType<typeof setInterval> | null = null;
	let _scanTimeout: ReturnType<typeof setTimeout>  | null = null;
	let _abortCtrl:   AbortController | null = null;

	const scanPhaseIndex = $derived.by(() => {
		if (!scanPhases.length) return 0;
		for (let i = 0; i < scanPhases.length; i++) {
			if (scanProgress < scanPhases[i].end) return i;
		}
		return scanPhases.length - 1;
	});

	const scanLabel = $derived.by(() => {
		if (!scanPhases.length) return "Vectorizing";
		const phase = scanPhases[scanPhaseIndex];
		if (scanTotalCount > 0 && scanPhaseIndex === 1) {
			if (scanDoneCount === 0) return `${scanTotalCount} shape${scanTotalCount === 1 ? '' : 's'} found — tracing…`;
			return `${scanDoneCount} / ${scanTotalCount} shapes traced`;
		}
		return phase?.label ?? "Vectorizing";
	});

	function startScanAnimation(file: File, isMulti: boolean) {
		// Clear any stale stop-timeout so it can't revoke the new URL.
		if (_scanTimeout !== null) { clearTimeout(_scanTimeout); _scanTimeout = null; }
		if (_scanTimer   !== null) { clearInterval(_scanTimer);  _scanTimer   = null; }
		if (scanImageUrl) URL.revokeObjectURL(scanImageUrl);

		scanImageUrl      = URL.createObjectURL(file);
		scanProgress      = 0;
		scanElapsed       = 0;
		scanTotalCount    = 0;
		scanDoneCount     = 0;
		scanPatternStates = [];
		scanPhases = isMulti ? [
			{ label: "Detecting shapes", end: 25 },
			{ label: "Tracing shapes",   end: 95 },
		] : [
			{ label: "Preprocessing",  end: 45 },
			{ label: "Tracing curves", end: 95 },
		];

		const t0  = Date.now();
		const tau = isMulti ? 20 : 8;
		_scanTimer = setInterval(() => {
			const s = (Date.now() - t0) / 1000;
			scanElapsed  = Math.floor(s);
			scanProgress = Math.min(95, 95 * (1 - Math.exp(-s / tau)));
		}, 100);
	}

	function stopScanAnimation() {
		if (_scanTimer !== null) { clearInterval(_scanTimer); _scanTimer = null; }
		scanProgress = 100;
		_scanTimeout = setTimeout(() => {
			_scanTimeout = null;
			if (scanImageUrl) { URL.revokeObjectURL(scanImageUrl); scanImageUrl = ""; }
		}, 600);
	}

	function cancelVectorize() {
		_abortCtrl?.abort();
		_abortCtrl = null;
		if (_scanTimer   !== null) { clearInterval(_scanTimer);  _scanTimer   = null; }
		if (_scanTimeout !== null) { clearTimeout(_scanTimeout); _scanTimeout = null; }
		if (scanImageUrl) { URL.revokeObjectURL(scanImageUrl); scanImageUrl = ""; }
		scanProgress      = 0;
		scanElapsed       = 0;
		scanPhases        = [];
		scanTotalCount    = 0;
		scanDoneCount     = 0;
		scanPatternStates = [];
		vectorizing  = false;
		vectorizeErr = "";
		onVectorizingChange?.(false);
	}

	// Warn before page unload while vectorizing (refresh, tab close, browser nav).
	$effect(() => {
		if (!vectorizing) return;
		const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
		window.addEventListener('beforeunload', guard);
		return () => window.removeEventListener('beforeunload', guard);
	});

	// Preview live from value
	const previewPath = $derived(value.trim());

	// ─── Dynamic preview viewBox ──────────────────
	// Computes tight bbox of the current path and adds a small buffer so the
	// stroke never clips at the edge. Uses a hidden off-DOM SVG so the browser's
	// geometry engine handles all path types correctly.
	let previewViewBox = $state("0 0 100 100");
	let pathBox = $state<{ x: number; y: number; w: number; h: number } | null>(null);

	// Vertical stretch that turns the path's own proportions into the real
	// widthInches × heightInches ones — the same mapping the cutter applies.
	// Width is kept, height is scaled about the box's top edge.
	const ratioK = $derived.by(() => {
		if (!pathBox || !(widthInches! > 0) || !(heightInches! > 0)) return 1;
		return (heightInches! / widthInches!) / (pathBox.h / pathBox.w);
	});
	const ratioTransform = $derived(pathBox && ratioK !== 1 ? `matrix(1 0 0 ${ratioK} 0 ${pathBox.y * (1 - ratioK)})` : undefined);
	// The outline stroke must stay non-scaling under that stretch (a vertical
	// scale would thicken/thin its horizontal edges), which makes stroke-width
	// pixels. To keep the same 1.1-unit weight it always had, convert units →
	// px from each preview's rendered size.
	let mainSvgEl   = $state<SVGSVGElement | null>(null);
	let mirrorSvgEl = $state<SVGSVGElement | null>(null);
	let mainSize    = $state({ w: 0, h: 0 });
	let mirrorSize  = $state({ w: 0, h: 0 });
	function observeSize(el: SVGSVGElement | null, set: (s: { w: number; h: number }) => void) {
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); set({ w: r.width, h: r.height }); });
		ro.observe(el);
		return () => ro.disconnect();
	}
	$effect(() => observeSize(mainSvgEl, (v) => (mainSize = v)));
	$effect(() => observeSize(mirrorSvgEl, (v) => (mirrorSize = v)));
	function unitsToPx(units: number, size: { w: number; h: number }): number {
		const [, , vw, vh] = previewViewBox.split(" ").map(Number);
		if (!size.w || !size.h || !vw || !vh) return units;
		return units * Math.min(size.w / vw, size.h / vh);
	}

	// Horizontal flip about the shape's own centre, for the mirror panel.
	const flipTransform = $derived(pathBox ? `matrix(-1 0 0 1 ${2 * pathBox.x + pathBox.w} 0)` : "matrix(-1 0 0 1 100 0)");

	$effect(() => {
		const path = previewPath;
		const k = ratioK;
		if (!path || typeof document === 'undefined') {
			previewViewBox = "0 0 100 100";
			pathBox = null;
			return;
		}
		try {
			// Same analytic bbox the cutter uses (pathGeometry) — not getBBox().
			const bbox = pathBBox(parsePath(path));
			if (!bbox.width || !bbox.height) { previewViewBox = "0 0 100 100"; pathBox = null; return; }
			if (!pathBox || pathBox.x !== bbox.x || pathBox.y !== bbox.y || pathBox.w !== bbox.width || pathBox.h !== bbox.height) {
				pathBox = { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
			}
			const buf = 4;
			const h = bbox.height * k;
			previewViewBox = `${bbox.x - buf} ${bbox.y - buf} ${bbox.width + buf * 2} ${h + buf * 2}`;
		} catch {
			previewViewBox = "0 0 100 100";
			pathBox = null;
		}
	});

	// ─── Preview zoom / pan ───────────────────────
	let zoom      = $state(1);
	let panX      = $state(0);   // offset in viewBox units
	let panY      = $state(0);
	let isPanning = $state(false);

	type DragOrigin = { clientX: number; clientY: number; panX: number; panY: number };
	let dragOrigin: DragOrigin | null = null;

	// Reset to fit whenever a new path is loaded.
	$effect(() => {
		previewPath;   // track
		zoom = 1; panX = 0; panY = 0;
	});

	function parsedBase(): [number, number, number, number] {
		const p = previewViewBox.split(' ').map(Number);
		return [p[0], p[1], p[2], p[3]];
	}

	const zoomedViewBox = $derived((() => {
		const [bx, by, bw, bh] = parsedBase();
		if (!bw || !bh) return previewViewBox;
		const zw = bw / zoom;
		const zh = bh / zoom;
		return `${bx + panX + (bw - zw) / 2} ${by + panY + (bh - zh) / 2} ${zw} ${zh}`;
	})());

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const factor  = e.deltaY < 0 ? 1.18 : 1 / 1.18;
		const newZoom = Math.min(40, Math.max(0.5, zoom * factor));
		const svgEl   = e.currentTarget as SVGSVGElement;
		const rect    = svgEl.getBoundingClientRect();
		const [bx, by, bw, bh] = parsedBase();
		// Current visible window in viewBox space
		const zw = bw / zoom,  zh = bh / zoom;
		const zx = bx + panX + (bw - zw) / 2;
		const zy = by + panY + (bh - zh) / 2;
		// SVG-space coords of the cursor
		const cx = zx + (e.clientX - rect.left)  / rect.width  * zw;
		const cy = zy + (e.clientY - rect.top)   / rect.height * zh;
		// Recompute pan so cx/cy stays under cursor after zoom
		const nzw = bw / newZoom, nzh = bh / newZoom;
		const nzx = cx - (e.clientX - rect.left)  / rect.width  * nzw;
		const nzy = cy - (e.clientY - rect.top)   / rect.height * nzh;
		panX  = nzx - bx - (bw - nzw) / 2;
		panY  = nzy - by - (bh - nzh) / 2;
		zoom  = newZoom;
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		isPanning  = true;
		dragOrigin = { clientX: e.clientX, clientY: e.clientY, panX, panY };
	}

	function onPointerMove(e: PointerEvent) {
		if (!isPanning || !dragOrigin) return;
		const svgEl = e.currentTarget as SVGSVGElement;
		const rect  = svgEl.getBoundingClientRect();
		const [,, bw, bh] = parsedBase();
		panX = dragOrigin.panX - (e.clientX - dragOrigin.clientX) / rect.width  * (bw / zoom);
		panY = dragOrigin.panY - (e.clientY - dragOrigin.clientY) / rect.height * (bh / zoom);
	}

	function onPointerUp(e: PointerEvent) {
		(e.currentTarget as Element).releasePointerCapture(e.pointerId);
		isPanning  = false;
		dragOrigin = null;
	}

	function zoomIn()    { zoom = Math.min(40,  zoom * 1.25); }
	function zoomOut()   { zoom = Math.max(0.5, zoom / 1.25); }
	function resetView() { zoom = 1; panX = 0; panY = 0; }

	// Warn when a path contains multiple subpaths (multiple M/m commands).
	// The cutter handles them correctly (blade lifts between contours), but the
	// user should know — most PPF/tint patterns should be a single closed outline.
	// Count top-level M/m command letters — each one starts a new subpath.
	// The old lookbehind regex (/(?<=[^\s])[Mm]/g) missed subpaths separated
	// by "Z M" (space before M) as produced by normalizeSvgPath/potrace output.
	const subpathCount = $derived(
		previewPath ? (previewPath.match(/[Mm]/g)?.length ?? 0) : 0
	);
	// Physical pieces (an outer contour together with its holes) — what a
	// split actually produces. A shape with a hole is ONE piece.
	const pieceCount = $derived.by(() => {
		if (subpathCount <= 1) return subpathCount;
		try { return splitIntoPieces(previewPath).length; } catch { return subpathCount; }
	});

	// When autoExtract is set, fire onMultiExtract immediately instead of
	// waiting for the user to click the "Split" button in the warning banner.
	$effect(() => {
		if (autoExtract && onMultiExtract && pieceCount > 1 && previewPath) {
			onMultiExtract(extractSubpaths(previewPath));
		}
	});

	// ─── Shared SVG processing ───────────────────
	// ⚠ PRECISION: an uploaded SVG is reproduced EXACTLY. Every rendered shape
	// in the file (path, rect, circle, ellipse, line, polyline, polygon) is
	// converted to exact path geometry with its full placement transform
	// (groups, nested <svg>, viewBox, Y-flips, rotation, skew) and kept —
	// nothing is dropped, rounded, smoothed or simplified. Content we cannot
	// reproduce exactly (text, embedded images, <use>, HTML) is REJECTED with
	// a clear message rather than silently left out. The combined outline is
	// stored in the 0–100 box by one uniform scale (a pure similarity).
	const SKIP_CONTAINERS = "defs, clipPath, mask, symbol, marker, pattern, linearGradient, radialGradient, filter, metadata, title, desc, style";
	const UNSUPPORTED: Record<string, string> = {
		text: "text (convert text to outlines first)",
		image: "embedded images",
		use: "<use> references (expand/ungroup them first)",
		foreignObject: "embedded HTML",
	};

	function isRendered(el: Element, root: Element): boolean {
		for (let n: Element | null = el; n && n !== root.parentElement; n = n.parentElement) {
			if (getComputedStyle(n).display === "none") return false;
		}
		return getComputedStyle(el).visibility === "visible";
	}

	function elementSegs(el: Element): Seg[] {
		switch (el.localName) {
			case "path": { const d = el.getAttribute("d"); return d ? parsePath(d) : []; }
			case "rect": {
				const r = el as SVGRectElement;
				const hasRx = el.hasAttribute("rx"), hasRy = el.hasAttribute("ry");
				let rx = hasRx ? r.rx.baseVal.value : 0, ry = hasRy ? r.ry.baseVal.value : 0;
				if (hasRx && !hasRy) ry = rx;
				if (hasRy && !hasRx) rx = ry;
				const w = r.width.baseVal.value, h = r.height.baseVal.value;
				return w > 0 && h > 0 ? rectSegs(r.x.baseVal.value, r.y.baseVal.value, w, h, rx, ry) : [];
			}
			case "circle": {
				const c = el as SVGCircleElement;
				const rr = c.r.baseVal.value;
				return rr > 0 ? ellipseSegs(c.cx.baseVal.value, c.cy.baseVal.value, rr, rr) : [];
			}
			case "ellipse": {
				const e = el as SVGEllipseElement;
				const rx = e.rx.baseVal.value, ry = e.ry.baseVal.value;
				return rx > 0 && ry > 0 ? ellipseSegs(e.cx.baseVal.value, e.cy.baseVal.value, rx, ry) : [];
			}
			case "line": {
				const l = el as SVGLineElement;
				return polySegs([{ x: l.x1.baseVal.value, y: l.y1.baseVal.value }, { x: l.x2.baseVal.value, y: l.y2.baseVal.value }], false);
			}
			case "polyline": case "polygon": {
				const pts = Array.from((el as SVGPolygonElement).points, (p) => ({ x: p.x, y: p.y }));
				return polySegs(pts, el.localName === "polygon");
			}
		}
		return [];
	}

	/** Import an SVG file exactly. Returns the normalized outline and, when the
	 *  file declares absolute units, the shape's real size in inches. */
	function importSvgExact(svgText: string): { d: string; size: { widthInches: number; heightInches: number } | null } {
		const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
		if (doc.querySelector("parsererror") || doc.documentElement.localName !== "svg") throw new Error("Invalid SVG file.");
		const root = doc.documentElement;
		// Never execute anything from the file.
		root.querySelectorAll("script").forEach((n) => n.remove());
		for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
			for (const attr of Array.from(el.attributes)) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
		}

		// Render in an isolated, off-screen shadow root so the browser resolves
		// every transform/unit exactly, without page CSS leaking in or out.
		const host = document.createElement("div");
		host.style.cssText = "position:fixed;left:-100000px;top:0;width:4000px;height:4000px;pointer-events:none;opacity:0;";
		document.body.appendChild(host);
		try {
			const shadow = host.attachShadow({ mode: "open" });
			const live = document.importNode(root, true) as unknown as SVGSVGElement;
			shadow.appendChild(live);

			const rendered = (el: Element) => !el.closest(SKIP_CONTAINERS) && isRendered(el, live);
			const bad = new Set<string>();
			live.querySelectorAll(Object.keys(UNSUPPORTED).join(",")).forEach((el) => {
				if (rendered(el)) bad.add(UNSUPPORTED[el.localName] ?? el.localName);
			});
			if (bad.size) throw new Error(`This SVG contains ${[...bad].join(", ")}, which can't be cut exactly. Fix that in your design tool and re-upload.`);

			const all: Seg[] = [];
			live.querySelectorAll("path, rect, circle, ellipse, line, polyline, polygon").forEach((el) => {
				if (!rendered(el)) return;
				const segs = elementSegs(el);
				if (!segs.length) return;
				const ctm = (el as SVGGraphicsElement).getScreenCTM();
				if (!ctm) throw new Error("Could not resolve the position of a shape in this SVG.");
				const m: Mat = { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f };
				all.push(...transformSegs(segs, m));
			});
			if (!all.length) throw new Error("No shapes found in this SVG.");

			// Real size: only when the file's width AND height use absolute units.
			// Screen coordinates are CSS px, and 1in = 96 CSS px by definition.
			const unit = (v: string | null) => /^\s*[\d.]+(?:e[-+]?\d+)?\s*(in|mm|cm|pt|pc|q)\s*$/i.exec(v ?? "")?.[1];
			let size: { widthInches: number; heightInches: number } | null = null;
			if (unit(root.getAttribute("width")) && unit(root.getAttribute("height"))) {
				const b = pathBBox(all);
				size = { widthInches: b.width / 96, heightInches: b.height / 96 };
			}
			return { d: normalizeOutline(all), size };
		} finally {
			host.remove();
		}
	}

	// Traced images (potrace output) and multi-crop results: exact import of
	// the generated SVG, no size reporting (a traced image has no real size).
	function processSvgText(svgText: string): string {
		return processDetectedLayers(importSvgExact(svgText).d);
	}

	// A user's own SVG file: exact import + report its declared real size.
	function importSvgFile(svgText: string): string {
		const { d, size } = importSvgExact(svgText);
		onFileSize?.(size);
		return processDetectedLayers(d);
	}

	// ─── Vectorize (SVG or any raster image → normalized path) ──
	// SVG files are extracted directly from the DOM — no rasterisation, bezier curves
	// and arcs preserved exactly. Raster images (PNG, JPG, WebP, BMP, GIF) are sent
	// to /api/vectorize which preprocesses (upsample → normalize contrast → threshold)
	// then runs potrace to produce high-precision bezier curves.
	//
	// When autoExtract + onMultiExtract are both set (single-file multi-pattern mode),
	// raster images go to /api/vectorize-multi instead: the server crops each shape
	// individually, upscales each crop to full resolution, and potraces separately —
	// giving every shape the same quality as a dedicated single-shape upload.
	async function runVectorize(file: File) {
		vectorizeErr = "";
		vectorizing = true;
		onVectorizingChange?.(true);
		const isRaster = !(file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg"));
		const isMulti  = !!(autoExtract && onMultiExtract);
		if (isRaster) startScanAnimation(file, isMulti);

		_abortCtrl = new AbortController();
		const { signal } = _abortCtrl;

		try {
			if (!isRaster) {
				// SVG: exact direct extraction — no rasterisation at all.
				value = importSvgFile(await file.text());
			} else if (isMulti) {
				// Multi-pattern raster: detect blobs server-side (fast), crop client-side,
				// then trace each crop in parallel via /api/vectorize (one invocation per shape).
				// This keeps every individual function call well under Vercel's per-invocation
				// timeout regardless of how many patterns are in the combined file.

				// Phase 1: detect — returns original-space crop bboxes.
				const fd1 = new FormData();
				fd1.append("image", file);
				const detectRes = await fetch("/api/vectorize-detect", { method: "POST", body: fd1, signal });
				if (!detectRes.ok) {
					const body = await detectRes.text().catch(() => "");
					let msg = "";
					try { msg = (JSON.parse(body) as { message?: string }).message ?? ""; } catch { msg = body; }
					throw new Error(msg || `Server error ${detectRes.status}`);
				}
				const { crops } = await detectRes.json() as { crops: Array<{ x: number; y: number; w: number; h: number }> };

				// Stop time-based animation; switch to count-based progress for tracing.
				// Keep a lightweight elapsed-only interval so the HUD timer doesn't freeze.
				if (_scanTimer !== null) { clearInterval(_scanTimer); _scanTimer = null; }
				scanProgress      = 25;
				scanTotalCount    = crops.length;
				scanDoneCount     = 0;
				scanPatternStates = Array(crops.length).fill('queued') as Array<'queued' | 'active' | 'done'>;
				const _elapsedBase = scanElapsed;
				const _elapsedT0   = Date.now();
				_scanTimer = setInterval(() => {
					scanElapsed = _elapsedBase + Math.floor((Date.now() - _elapsedT0) / 1000);
				}, 500);

				// Phase 2: crop each blob client-side using canvas, send each to /api/vectorize.
				const BORDER_PX = 20;
				const imgUrl = URL.createObjectURL(file);
				const imgEl  = await new Promise<HTMLImageElement>((resolve, reject) => {
					const el = new Image();
					el.onload  = () => resolve(el);
					el.onerror = () => reject(new Error('Could not load image for cropping'));
					el.src = imgUrl;
				});

				// Draw all crops while the image is in memory, then revoke the URL.
				// Cap the canvas long edge to CROP_MAX_EDGE so we don't upload huge PNGs.
				const CROP_MAX_EDGE = 3000;
				const canvases = crops.map(({ x, y, w, h }) => {
					const rawW = w + BORDER_PX * 2;
					const rawH = h + BORDER_PX * 2;
					const longEdge = Math.max(rawW, rawH);
					const scale = longEdge > CROP_MAX_EDGE ? CROP_MAX_EDGE / longEdge : 1;
					const canvas = document.createElement('canvas');
					canvas.width  = Math.round(rawW * scale);
					canvas.height = Math.round(rawH * scale);
					const ctx = canvas.getContext('2d')!;
					ctx.fillStyle = '#ffffff';
					ctx.fillRect(0, 0, canvas.width, canvas.height);
					const dstBorderPx = Math.round(BORDER_PX * scale);
					ctx.drawImage(imgEl, x, y, w, h, dstBorderPx, dstBorderPx, canvas.width - dstBorderPx * 2, canvas.height - dstBorderPx * 2);
					return canvas;
				});
				URL.revokeObjectURL(imgUrl);

				// Parallel trace with concurrency limit.
				const CONCURRENCY = 3;
				const svgsOrdered = new Array<string>(crops.length);
				let nextIdx = 0;

				async function cropWorker(): Promise<void> {
					while (nextIdx < crops.length) {
						const i = nextIdx++;
						scanPatternStates[i] = 'active';
						const blob = await new Promise<Blob>((resolve, reject) =>
							canvases[i].toBlob(b => b ? resolve(b) : reject(new Error('Canvas export failed')), 'image/png')
						);
						const cropFd = new FormData();
						cropFd.append("image", new File([blob], 'crop.png', { type: 'image/png' }));
						cropFd.append("targetEdge", "3000");
						const res = await fetch("/api/vectorize", { method: "POST", body: cropFd, signal });
						if (!res.ok) {
							const body = await res.text().catch(() => "");
							let msg = "";
							try { msg = (JSON.parse(body) as { message?: string }).message ?? ""; } catch { msg = body; }
							throw new Error(msg || `Server error ${res.status}`);
						}
						const { svg } = await res.json() as { svg: string };
						svgsOrdered[i] = svg;
						scanPatternStates[i] = 'done';
						scanDoneCount++;
						scanProgress = Math.min(94, 25 + 68 * (scanDoneCount / crops.length));
					}
				}

				await Promise.all(Array.from({ length: Math.min(CONCURRENCY, crops.length) }, cropWorker));
				// Call directly — don't set value, avoids the autoExtract $effect double-firing.
				onMultiExtract(svgsOrdered.map(svg => smoothBezierJunctions(processSvgText(svg))));
			} else {
				// Raster: server-side preprocessing + potrace → high-precision SVG.
				const fd = new FormData();
				fd.append("image", file);
				const res = await fetch("/api/vectorize", { method: "POST", body: fd, signal });
				if (!res.ok) {
					// SvelteKit error responses are JSON: { message: "...", status: N }
					const body = await res.text().catch(() => "");
					let msg = "";
					try { msg = (JSON.parse(body) as { message?: string }).message ?? ""; } catch { msg = body; }
					throw new Error(msg || `Server error ${res.status}`);
				}
				const { svg } = await res.json() as { svg: string };
				// Normalize coordinates first, then smooth junctions on the normalized path.
				// Smoothing is raster-only — SVG uploads are already mathematically exact.
				value = smoothBezierJunctions(processSvgText(svg));
			}
		} catch (err) {
			if (signal.aborted) return;
			vectorizeErr = err instanceof Error ? err.message : "Vectorization failed.";
		} finally {
			if (vectorizing) {
				vectorizing = false;
				onVectorizingChange?.(false);
				if (isRaster) stopScanAnimation();
				_abortCtrl = null;
			}
		}
	}

	// ─── Cutout (upscale/sharpen → remove background → trace silhouette) ────
	// Simpler experimental alternative to Vectorize: instead of a global
	// black/white threshold, the server flood-fills the background from the
	// image borders (tolerant of gentle lighting variation) and traces only
	// what's left — the foreground silhouette. Works best on photos shot
	// against a fairly uniform backdrop.
	async function runCutout(file: File) {
		cutoutErr   = "";
		vectorizing = true;
		onVectorizingChange?.(true);
		startScanAnimation(file, false);

		_abortCtrl = new AbortController();
		const { signal } = _abortCtrl;
		try {
			const fd = new FormData();
			fd.append("image", file);
			const res = await fetch("/api/vectorize-cutout", { method: "POST", body: fd, signal });
			if (!res.ok) {
				const body = await res.text().catch(() => "");
				let msg = "";
				try { msg = (JSON.parse(body) as { message?: string }).message ?? ""; } catch { msg = body; }
				throw new Error(msg || `Server error ${res.status}`);
			}
			const { svg } = await res.json() as { svg: string };
			value = smoothBezierJunctions(processSvgText(svg));
		} catch (err) {
			if (signal.aborted) return;
			cutoutErr = err instanceof Error ? err.message : "Background removal failed.";
		} finally {
			if (vectorizing) {
				vectorizing = false;
				onVectorizingChange?.(false);
				stopScanAnimation();
				_abortCtrl = null;
			}
		}
	}

	// ─── Path Data: SVG file upload (extracts <path> d= losslessly) ────────
	async function runPasteExtract(file: File) {
		pasteErr = "";
		const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
		if (!isSvg) {
			pasteErr = "Path Data only accepts SVG files — switch to Vectorize for raster images, or paste path data directly below.";
			return;
		}
		try {
			value = importSvgFile(await file.text());
		} catch (err) {
			pasteErr = err instanceof Error ? err.message : "Could not extract path data.";
		}
	}

	// ─── Split a combined outline into separate patterns ──
	// Explicit user action ("Split into N patterns") or the combined-file
	// importer. Contours are grouped into physical pieces — an outer contour
	// keeps every hole inside it — and each piece is stored exactly (uniform
	// scale only). Nothing is dropped.
	function extractSubpaths(fullPath: string): string[] {
		return splitIntoPieces(fullPath).map((piece) => normalizeOutline(parsePath(piece)));
	}

	// ─── Image trace ─────────────────────────────
	async function runTraceImage(file: File) {
		traceErr = "";
		tracing = true;
		try {
			value = await traceImage(file);
		} catch (err) {
			traceErr = err instanceof Error ? err.message : "Tracing failed.";
		} finally {
			tracing = false;
		}
	}

	// Handles the DOM glue (file → image → canvas → pixel data).
	// All pure tracing logic lives in src/lib/utils/trace.ts.
	async function traceImage(file: File): Promise<string> {
		const url = URL.createObjectURL(file);
		const img = await new Promise<HTMLImageElement>((res, rej) => {
			const el = new Image();
			el.onload = () => res(el);
			el.onerror = () => rej(new Error("Could not load image. Use PNG or JPG."));
			el.src = url;
		});
		URL.revokeObjectURL(url);

		const W = img.naturalWidth || 512, H = img.naturalHeight || 512;
		const canvas = document.createElement("canvas");
		canvas.width = W; canvas.height = H;
		const ctx = canvas.getContext("2d")!;
		// White fill so stroke-only SVG shapes render against a known background.
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, W, H);
		ctx.drawImage(img, 0, 0, W, H);
		const { data } = ctx.getImageData(0, 0, W, H);
		return traceImageData(data, W, H);
	}
</script>

<div class="spi">
	{#if pdfConverting}
		<div class="spi__pdf-status">
			<span class="spi__spinner" aria-hidden="true"></span>
			<span>Converting PDF…</span>
		</div>
	{:else if pdfConvertErr}
		<p class="spi__err">{pdfConvertErr}</p>
	{/if}
	{#if !hasStarted && !pdfConverting}
		<!-- ─── Stage 1: single generic upload — method choice is revealed after input is given ─── -->
		<label class="spi__drop spi__drop--initial">
			<input type="file" accept=".svg,image/svg+xml,image/*,.pdf,application/pdf" onchange={handleFileSelected} class="spi__file-input"/>
			<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
			<span class="spi__drop-label">Click to upload a pattern image</span>
			<span class="spi__drop-sub">SVG, PDF, PNG, JPG, WebP, BMP — we'll pick the best import method automatically</span>
		</label>
		<div class="spi__or-divider"><span>or paste manually</span></div>
		<div class="spi__paste-toggle" role="radiogroup" aria-label="Paste input type">
			<button type="button" class="spi__paste-toggle-btn" class:spi__paste-toggle-btn--active={pasteMode === "svg"}
				onclick={() => (pasteMode = "svg")}>Full SVG code</button>
			<button type="button" class="spi__paste-toggle-btn" class:spi__paste-toggle-btn--active={pasteMode === "path"}
				onclick={() => (pasteMode = "path")}>Raw path data</button>
		</div>
		{#if pasteMode === "svg"}
			<textarea
				class="spi__textarea"
				bind:value={pastedSvgText}
				onblur={extractPastedSvg}
				rows="6"
				spellcheck="false"
				placeholder={"<svg xmlns=\"http://www.w3.org/2000/svg\" ...>\n  <path d=\"M 5,5 L 95,5 95,95 5,95 Z\"/>\n</svg>"}
			></textarea>
			{#if pasteErr}<p class="spi__err">{pasteErr}</p>{/if}
			<span class="spi__paste-hint">Path data will be extracted automatically when you click away.</span>
		{:else}
			<textarea
				{id}
				class="spi__textarea"
				class:spi__textarea--error={error && !value.trim()}
				bind:value
				oninput={() => (touched = true)}
				rows="6"
				spellcheck="false"
				placeholder={"M 5,5 L 95,5 95,95 5,95 Z\nM 50,5 L 95,80 5,80 Z\nM 15,50 C 15,15 85,15 85,50 C 85,85 15,85 15,50 Z"}
			></textarea>
			<span class="spi__paste-hint">Used exactly as pasted — must already be in 0–100 normalized space.</span>
		{/if}
	{:else}
	<!-- ─── Content + preview: Input / Output, side-by-side ─── -->
	<div class="spi__section">
	<span class="spi__section-title">Previews</span>
	<div class="spi__workarea">
	<div class="spi__body">
		<span class="spi__io-label">Input</span>
		{#if uploadedFile}
			{#if inputFullscreen}
				<button type="button" class="spi__pview-backdrop" aria-label="Close fullscreen preview" onclick={() => (inputFullscreen = false)}></button>
			{/if}
			<div class="spi__pview" class:spi__pview--fullscreen={inputFullscreen}>
				<button type="button" class="spi__pview-expand-btn" onclick={() => (inputFullscreen = !inputFullscreen)}
					use:tooltip={inputFullscreen ? "Exit fullscreen" : "Expand fullscreen"} aria-label={inputFullscreen ? "Exit fullscreen preview" : "Expand fullscreen preview"}>
					{#if inputFullscreen}
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
					{:else}
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
					{/if}
				</button>
				<div class="spi__pview-toolbar">
					<button type="button" class="spi__pview-btn" onclick={inputZoomOut} use:tooltip={"Zoom out"} aria-label="Zoom out">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>
					</button>
					<span class="spi__pview-zoom">{Math.round(inputZoom * 100)}%</span>
					<button type="button" class="spi__pview-btn" onclick={inputZoomIn} use:tooltip={"Zoom in"} aria-label="Zoom in">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
					</button>
					<button type="button" class="spi__pview-btn spi__pview-fit" onclick={resetInputView} use:tooltip={"Reset to fit"}>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
						Fit
					</button>
					{#if uploadedFile.type.startsWith("image/") && uploadedFile.type !== "image/svg+xml"}
						<button type="button" class="spi__pview-btn spi__pview-rotate" onclick={() => rotateUploadedImage(-90)} disabled={rotating} use:tooltip={"Rotate left 90°"} aria-label="Rotate image left 90 degrees">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>
						</button>
						<button type="button" class="spi__pview-btn" onclick={() => rotateUploadedImage(90)} disabled={rotating} use:tooltip={"Rotate right 90°"} aria-label="Rotate image right 90 degrees">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/></svg>
						</button>
					{/if}
				</div>
				<div class="spi__io-imgwrap"
					role="img"
					aria-label="Uploaded input preview — scroll to zoom, drag to pan"
					onwheel={inputOnWheel}
					onpointerdown={inputOnPointerDown}
					onpointermove={inputOnPointerMove}
					onpointerup={inputOnPointerUp}
					style="cursor: {inputIsPanning ? 'grabbing' : (inputZoom > 1 ? 'grab' : 'default')}"
				>
					<img src={uploadedPreviewUrl} alt="Uploaded input" class="spi__io-img"
						style="transform: translate({inputPanX}px, {inputPanY}px) scale({inputZoom});"/>
				</div>
				{#if uploadedFile.type.startsWith("image/") && uploadedFile.type !== "image/svg+xml"}
					<button type="button" class="spi__pview-enhance-btn" class:spi__pview-enhance-btn--done={enhanceDone} onclick={enhanceUploadedImage} disabled={enhancing}
						use:tooltip={"Enhance: sharpen and clean up edges"} aria-label="Enhance image — sharpen and clean up edges">
						{#if enhancing}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="spi__spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9"/></svg>
							<span>Enhancing…</span>
						{:else if enhanceDone}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
							<span>Enhanced</span>
						{:else}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 4 1.5 3L20 8.5 16.5 10 15 13l-1.5-3L10 8.5 13.5 7z"/><path d="m5 15 .9 1.8L8 18l-2.1.8L5 21l-.9-2.2L2 18l2.1-1.2z"/><path d="M4 4v3M2.5 5.5h3"/></svg>
							<span>Enhance</span>
						{/if}
					</button>
				{/if}
			</div>
			{#if inputDims}
				<div class="spi__io-info">
					<span class="spi__io-info-res">{inputDims.w} × {inputDims.h}px</span>
					<span class="spi__res-pill spi__res-pill--{resRating(Math.max(inputDims.w, inputDims.h)).tier}">{resRating(Math.max(inputDims.w, inputDims.h)).label}</span>
				</div>
			{/if}
			{#if enhanceErr}<span class="spi__io-enhance-err">{enhanceErr}</span>{/if}
			{#if compareBefore && compareAfter}
				<div class="spi__compare">
					<div class="spi__compare-head">
						<span>Enhance result</span>
						<button type="button" class="spi__compare-close" onclick={dismissCompare} aria-label="Dismiss comparison">×</button>
					</div>
					<div class="spi__compare-row">
						<div class="spi__compare-cell">
							<span class="spi__compare-label">Before</span>
							<img src={compareBefore.url} alt="Before enhance" class="spi__compare-img"/>
							<span class="spi__io-info-res">{compareBefore.w} × {compareBefore.h}px</span>
							<span class="spi__res-pill spi__res-pill--{resRating(Math.max(compareBefore.w, compareBefore.h)).tier}">{resRating(Math.max(compareBefore.w, compareBefore.h)).label}</span>
						</div>
						<div class="spi__compare-arrow" aria-hidden="true">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
						</div>
						<div class="spi__compare-cell">
							<span class="spi__compare-label">After</span>
							<img src={compareAfter.url} alt="After enhance" class="spi__compare-img"/>
							<span class="spi__io-info-res">{compareAfter.w} × {compareAfter.h}px</span>
							<span class="spi__res-pill spi__res-pill--{resRating(Math.max(compareAfter.w, compareAfter.h)).tier}">{resRating(Math.max(compareAfter.w, compareAfter.h)).label}</span>
						</div>
					</div>
				</div>
			{/if}
		{:else}
			<div class="spi__pview">
				<div class="spi__pview-empty">
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
					<span>No image uploaded</span>
				</div>
			</div>
		{/if}
	</div>

	<!-- ─── Zoomable preview panel ─── -->
	<div class="spi__pview-col">
	<span class="spi__io-label">Output</span>
	{#if previewFullscreen}
		<button type="button" class="spi__pview-backdrop" aria-label="Close fullscreen preview" onclick={() => (previewFullscreen = false)}></button>
	{/if}
	<div class="spi__pview" class:spi__pview--fullscreen={previewFullscreen}>
		{#if previewPath || scanImageUrl}
			<button type="button" class="spi__pview-expand-btn" onclick={() => (previewFullscreen = !previewFullscreen)}
				use:tooltip={previewFullscreen ? "Exit fullscreen" : "Expand fullscreen"} aria-label={previewFullscreen ? "Exit fullscreen preview" : "Expand fullscreen preview"}>
				{#if previewFullscreen}
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
				{:else}
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
				{/if}
			</button>
		{/if}
		{#if scanImageUrl}
			<!-- Scan effect: image with a sweeping beam tracking progress -->
			<div class="spi__scan-view" aria-hidden="true">
				<img src={scanImageUrl} alt="" class="spi__scan-img"/>
				<div class="spi__scan-dim" style="top: {Math.round(scanProgress)}%"></div>
				<div class="spi__scan-beam" style="top: calc({Math.round(scanProgress)}% - 1px)"></div>
				<div class="spi__scan-hud">
					<span>{scanLabel || (scanPhases[scanPhaseIndex]?.label ?? "Analyzing")}</span>
					{#if scanTotalCount > 0 && scanPhaseIndex === 1}
						<span class="spi__scan-pct-hud">{scanDoneCount}/{scanTotalCount}</span>
					{:else}
						<span class="spi__scan-pct-hud">{Math.round(scanProgress)}%</span>
					{/if}
					<span>{scanElapsed}s elapsed</span>
				</div>
			</div>
		{:else if showMirror && previewPath}
			<div class="spi__mirror-bar" aria-hidden="true">
				<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 00-2 2v14a2 2 0 002 2h3"/><path d="M16 3h3a2 2 0 012 2v14a2 2 0 01-2 2h-3"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
				Mirror pair — both sides shown
			</div>
			<div class="spi__mirror-panels">
				<div class="spi__mirror-panel">
					<svg bind:this={mirrorSvgEl} viewBox={previewViewBox} preserveAspectRatio="xMidYMid meet" class="spi__pview-svg" aria-label="Original path orientation">
						<defs>
							<pattern id="spi-grid-l" width="10" height="10" patternUnits="userSpaceOnUse">
								<path d="M 10 0 L 0 0 0 10" fill="none" stroke="var(--border-default)" stroke-width="0.3" opacity="0.5"/>
							</pattern>
							<filter id="spi-fade-blur-l" x="-50%" y="-50%" width="200%" height="200%">
								<feGaussianBlur stdDeviation="2"/>
							</filter>
							<mask id="spi-fade-mask-l" maskUnits="userSpaceOnUse" x="-9999" y="-9999" width="19998" height="19998">
								<path d={previewPath} fill="none" stroke="#fff" stroke-width="10" stroke-linejoin="round" stroke-linecap="round" filter="url(#spi-fade-blur-l)"/>
							</mask>
						</defs>
						<rect x="-9999" y="-9999" width="19998" height="19998" fill="url(#spi-grid-l)"/>
						<path d={previewPath} transform={ratioTransform} fill="var(--color-brand)" opacity="1" mask="url(#spi-fade-mask-l)"/>
						<path d={previewPath} transform={ratioTransform} fill="none" stroke="var(--color-brand)" stroke-width={unitsToPx(1.1, mirrorSize)} stroke-linecap="round" vector-effect="non-scaling-stroke"/>
					</svg>
					<span class="spi__mirror-lbl">{mirrorOrigLabel ?? "As uploaded"}</span>
				</div>
				<div class="spi__mirror-divider" aria-hidden="true"></div>
				<div class="spi__mirror-panel">
					<svg viewBox={previewViewBox} preserveAspectRatio="xMidYMid meet" class="spi__pview-svg" aria-label="Mirrored path orientation">
						<defs>
							<pattern id="spi-grid-r" width="10" height="10" patternUnits="userSpaceOnUse">
								<path d="M 10 0 L 0 0 0 10" fill="none" stroke="var(--border-default)" stroke-width="0.3" opacity="0.5"/>
							</pattern>
							<filter id="spi-fade-blur-r" x="-50%" y="-50%" width="200%" height="200%">
								<feGaussianBlur stdDeviation="2"/>
							</filter>
							<mask id="spi-fade-mask-r" maskUnits="userSpaceOnUse" x="-9999" y="-9999" width="19998" height="19998">
								<!-- Mask content is drawn in the referencing path's own (already transformed) space -->
								<path d={previewPath} fill="none" stroke="#fff" stroke-width="10" stroke-linejoin="round" stroke-linecap="round" filter="url(#spi-fade-blur-r)"/>
							</mask>
						</defs>
						<rect x="-9999" y="-9999" width="19998" height="19998" fill="url(#spi-grid-r)"/>
						<g transform={ratioTransform}>
							<path d={previewPath} transform={flipTransform} fill="var(--color-brand)" opacity="1" mask="url(#spi-fade-mask-r)"/>
							<path d={previewPath} transform={flipTransform} fill="none" stroke="var(--color-brand)" stroke-width={unitsToPx(1.1, mirrorSize)} stroke-linecap="round" vector-effect="non-scaling-stroke"/>
						</g>
					</svg>
					<span class="spi__mirror-lbl">{mirrorFlipLabel ?? "Mirrored"}</span>
				</div>
			</div>
		{:else if previewPath}
			<div class="spi__pview-toolbar">
				<button type="button" class="spi__pview-btn" onclick={zoomOut} use:tooltip={"Zoom out"} aria-label="Zoom out">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>
				</button>
				<span class="spi__pview-zoom">{Math.round(zoom * 100)}%</span>
				<button type="button" class="spi__pview-btn" onclick={zoomIn} use:tooltip={"Zoom in"} aria-label="Zoom in">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				</button>
				<button type="button" class="spi__pview-btn spi__pview-fit" onclick={resetView} use:tooltip={"Reset to fit"}>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
					Fit
				</button>
			</div>
			<svg
				bind:this={mainSvgEl}
				class="spi__pview-svg"
				viewBox={zoomedViewBox}
				preserveAspectRatio="xMidYMid meet"
				style="cursor: {isPanning ? 'grabbing' : 'grab'}"
				onwheel={onWheel}
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				aria-label="SVG path preview — scroll to zoom, drag to pan"
				role="img"
			>
				<defs>
					<pattern id="spi-grid" width="10" height="10" patternUnits="userSpaceOnUse">
						<path d="M 10 0 L 0 0 0 10" fill="none" stroke="var(--border-default)" stroke-width="0.3" opacity="0.5"/>
					</pattern>
					<filter id="spi-fade-blur" x="-50%" y="-50%" width="200%" height="200%">
						<feGaussianBlur stdDeviation={2 / zoom}/>
					</filter>
					<mask id="spi-fade-mask" maskUnits="userSpaceOnUse" x="-9999" y="-9999" width="19998" height="19998">
						<path d={previewPath} fill="none" stroke="#fff" stroke-width={10 / zoom} stroke-linejoin="round" stroke-linecap="round" filter="url(#spi-fade-blur)"/>
					</mask>
				</defs>
				<rect x="-9999" y="-9999" width="19998" height="19998" fill="url(#spi-grid)"/>
				<path d={previewPath} transform={ratioTransform} fill="var(--color-brand)" opacity="1" mask="url(#spi-fade-mask)"/>
				<path d={previewPath} transform={ratioTransform} fill="none" stroke="var(--color-brand)" stroke-width={ratioTransform ? unitsToPx(1.1, mainSize) : 1.1 / zoom} stroke-linecap="round" vector-effect={ratioTransform ? "non-scaling-stroke" : undefined}/>
			</svg>
		{:else}
			<div class="spi__pview-empty">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
				<span>Preview appears here</span>
			</div>
		{/if}
	</div>
	{#if previewPath}
		<div class="spi__io-info">
			<span class="spi__io-info-res">Vector · resolution-independent</span>
			<span class="spi__res-pill spi__res-pill--high">High res</span>
		</div>
	{/if}
	</div>

	<!-- ─── Import content: replace-image + active importer, full width ─── -->
	<div class="spi__full-row">
		{#if uploadedFile}
			<label class="spi__io-replace">
				<input type="file" accept=".svg,image/svg+xml,image/*,.pdf,application/pdf" onchange={handleFileSelected} class="spi__file-input"/>
				Replace image
			</label>
		{/if}
		<div class="spi__input">

			{#if tab === "vectorize"}
				<!-- Vectorize: SVG (lossless) or any raster → preprocessed potrace → normalized path -->
				{#if vectorizing}
					{#if scanImageUrl}
						<div class="spi__scan-status">
							{#if scanPhases.length > 1}
								<div class="spi__scan-steps" aria-hidden="true">
									{#each scanPhases as _phase, i}
										<div class="spi__scan-step-dot"
											class:spi__scan-step-dot--done={i < scanPhaseIndex}
											class:spi__scan-step-dot--active={i === scanPhaseIndex}
										></div>
										{#if i < scanPhases.length - 1}
											<div class="spi__scan-step-line"
												class:spi__scan-step-line--done={i < scanPhaseIndex}
											></div>
										{/if}
									{/each}
								</div>
							{/if}
							<div class="spi__scan-bar">
								<div class="spi__scan-fill"
									class:spi__scan-fill--live={scanPhaseIndex === scanPhases.length - 1 && scanProgress < 98}
									style="width: {Math.round(scanProgress)}%"
								></div>
							</div>
							<div class="spi__scan-meta">
								<span class="spi__scan-pct">{Math.round(scanProgress)}%</span>
								<span class="spi__scan-label">{scanLabel}</span>
								<span class="spi__scan-elapsed">{scanElapsed}s</span>
							</div>
							{#if scanPatternStates.length > 0}
								<div class="spi__pattern-grid">
									{#each scanPatternStates as status, i}
										<div class="spi__pattern-slot spi__pattern-slot--{status}" use:tooltip={`Pattern ${i + 1}`}></div>
									{/each}
								</div>
							{/if}
							<button type="button" class="spi__scan-cancel" onclick={cancelVectorize}>Cancel</button>
							{#if scanPhases.length > 1}
								<p class="spi__scan-notice">
									<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
									<span>{#if scanTotalCount > 0}{scanTotalCount} pattern{scanTotalCount === 1 ? '' : 's'} detected — each takes 10–30s to trace.{:else}Detecting patterns — stay on this page.{/if} Don't refresh or reload.</span>
								</p>
							{/if}
						</div>
					{:else}
						<div class="spi__tracing">
							<span class="spi__spinner" aria-hidden="true"></span>
							<span>Vectorizing…</span>
						</div>
					{/if}
				{:else}
					{#if !uploadedFile}
						<label class="spi__drop">
							<input type="file" accept=".svg,image/svg+xml,image/*,.pdf,application/pdf" onchange={handleFileSelected} class="spi__file-input"/>
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
							<span class="spi__drop-label">Click to upload a file</span>
							<span class="spi__drop-sub">SVG — extracted losslessly &nbsp;·&nbsp; PNG, JPG, WebP, BMP, PDF — converted to precise bezier curves</span>
						</label>
					{/if}
					{#if vectorizeErr}
						<p class="spi__err">{vectorizeErr}</p>
					{/if}
					{#if value && tab === "vectorize"}
						<p class="spi__success">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
							Vectorized — preview on the right. For raster images with complex backgrounds, pre-remove them first.
						</p>
					{/if}
				{/if}

			{:else if tab === "cutout"}
				<!-- Cutout: upscale/sharpen → remove background → trace silhouette -->
				{#if vectorizing}
					<div class="spi__tracing">
						<span class="spi__spinner" aria-hidden="true"></span>
						<span>Removing background…</span>
					</div>
				{:else}
					{#if !uploadedFile}
						<label class="spi__drop">
							<input type="file" accept="image/*,.pdf,application/pdf" onchange={handleFileSelected} class="spi__file-input"/>
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6 9a3 3 0 100-6 3 3 0 000 6z"/><path d="M6 21a3 3 0 100-6 3 3 0 000 6z"/><path d="M20 4L8.12 15.88"/><path d="M14.47 14.48L20 20"/><path d="M8.12 8.12L12 12"/></svg>
							<span class="spi__drop-label">Click to upload a photo</span>
							<span class="spi__drop-sub">Best with a fairly uniform backdrop — background is auto-removed, then the silhouette is traced</span>
						</label>
					{/if}
					{#if cutoutErr}
						<p class="spi__err">{cutoutErr}</p>
					{/if}
					{#if value && tab === "cutout"}
						<p class="spi__success">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
							Background removed and outline traced — check preview.
						</p>
					{/if}
				{/if}

			{:else if tab === "paste"}
				{#if !uploadedFile}
					<label class="spi__upload-row">
						<input type="file" accept=".svg,image/svg+xml" onchange={handleFileSelected} class="spi__file-input"/>
						<span class="spi__upload-row-btn">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
							Upload SVG to extract path data
						</span>
					</label>
				{/if}
				{#if pasteErr}
					<p class="spi__err">{pasteErr}</p>
				{/if}
				<div class="spi__or-divider"><span>or paste manually</span></div>
				<div class="spi__paste-toggle" role="radiogroup" aria-label="Paste input type">
					<button type="button" class="spi__paste-toggle-btn" class:spi__paste-toggle-btn--active={pasteMode === "svg"}
						onclick={() => (pasteMode = "svg")}>Full SVG code</button>
					<button type="button" class="spi__paste-toggle-btn" class:spi__paste-toggle-btn--active={pasteMode === "path"}
						onclick={() => (pasteMode = "path")}>Raw path data</button>
				</div>
				{#if pasteMode === "svg"}
					<textarea
						class="spi__textarea"
						bind:value={pastedSvgText}
						onblur={extractPastedSvg}
						rows="6"
						spellcheck="false"
						placeholder={"<svg xmlns=\"http://www.w3.org/2000/svg\" ...>\n  <path d=\"M 5,5 L 95,5 95,95 5,95 Z\"/>\n</svg>"}
					></textarea>
					<span class="spi__paste-hint">Path data will be extracted automatically when you click away.</span>
				{:else}
					<textarea
						{id}
						class="spi__textarea"
						class:spi__textarea--error={error && !value.trim()}
						bind:value
						oninput={() => (touched = true)}
						rows="6"
						spellcheck="false"
						placeholder={"M 5,5 L 95,5 95,95 5,95 Z\nM 50,5 L 95,80 5,80 Z\nM 15,50 C 15,15 85,15 85,50 C 85,85 15,85 15,50 Z"}
					></textarea>
					<span class="spi__paste-hint">Used exactly as pasted — must already be in 0–100 normalized space.</span>
				{/if}

			{:else if tab === "trace"}
				<!-- Trace Image: in-browser B&W tracing -->
				{#if tracing}
					<div class="spi__tracing">
						<span class="spi__spinner" aria-hidden="true"></span>
						<span>Tracing shape…</span>
					</div>
				{:else}
					{#if !uploadedFile}
						<label class="spi__drop">
							<input type="file" accept="image/png,image/jpeg,image/webp" onchange={handleFileSelected} class="spi__file-input"/>
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
							<span class="spi__drop-label">Click to upload a B&W image</span>
							<span class="spi__drop-sub">PNG, JPG or WebP — shape traced in-browser</span>
						</label>
					{/if}
					{#if traceErr}
						<p class="spi__err">{traceErr}</p>
					{/if}
					{#if value && tab === "trace"}
						<p class="spi__success">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
							Shape traced — check preview, then adjust dimensions above.
						</p>
					{/if}
				{/if}
			{:else}
				<div class="spi__choose-method">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
					<span>Choose an import method above to process this image.</span>
				</div>
			{/if}

		</div>
	</div>
	</div>
	</div>

	<!-- ─── Method picker (revealed once an input exists) ─── -->
	<div class="spi__section">
	<span class="spi__section-title">Import method</span>
	<div class="spi__methods" role="tablist" aria-label="Pattern import method">
		<button type="button" class="spi__method" class:spi__method--active={tab === "vectorize"}
			role="tab" aria-selected={tab === "vectorize"} onclick={() => switchTab("vectorize")}>
			<span class="spi__method-icon" aria-hidden="true">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
			</span>
			<span class="spi__method-body">
				<span class="spi__method-title">Vectorize <span class="spi__badge spi__badge--rec">Recommended</span></span>
				<span class="spi__method-sub">Any image — SVG extracted losslessly, raster traced to precise curves</span>
			</span>
		</button>
		<button type="button" class="spi__method" class:spi__method--active={tab === "cutout"}
			role="tab" aria-selected={tab === "cutout"} onclick={() => switchTab("cutout")}>
			<span class="spi__method-icon" aria-hidden="true">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9a3 3 0 100-6 3 3 0 000 6z"/><path d="M6 21a3 3 0 100-6 3 3 0 000 6z"/><path d="M20 4L8.12 15.88"/><path d="M14.47 14.48L20 20"/><path d="M8.12 8.12L12 12"/></svg>
			</span>
			<span class="spi__method-body">
				<span class="spi__method-title">Cutout <span class="spi__badge spi__badge--exp">Experimental</span></span>
				<span class="spi__method-sub">Photo on a plain background — auto-removed, then the silhouette is traced</span>
			</span>
		</button>
		<button type="button" class="spi__method" class:spi__method--active={tab === "paste"}
			role="tab" aria-selected={tab === "paste"} onclick={() => switchTab("paste")}>
			<span class="spi__method-icon" aria-hidden="true">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z"/></svg>
			</span>
			<span class="spi__method-body">
				<span class="spi__method-title">Path Data</span>
				<span class="spi__method-sub">Upload an SVG to extract its path data, or paste it directly</span>
			</span>
		</button>
		<button type="button" class="spi__method" class:spi__method--active={tab === "trace"}
			role="tab" aria-selected={tab === "trace"} onclick={() => switchTab("trace")}>
			<span class="spi__method-icon" aria-hidden="true">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
			</span>
			<span class="spi__method-body">
				<span class="spi__method-title">Trace Image <span class="spi__badge spi__badge--exp">Experimental</span></span>
				<span class="spi__method-sub">B&W image, traced entirely in-browser</span>
			</span>
		</button>
	</div>
	</div>

	<!-- ─── Contour preference ─── -->
	<div class="spi__section">
	<span class="spi__section-title">Multiple contours in a file</span>
	<div class="spi__contour-pref">
		<div class="spi__contour-pref-group" role="radiogroup" aria-label="Contour handling">
			<button type="button" class="spi__contour-pref-btn" class:spi__contour-pref-btn--active={contourPref === "outer"}
				onclick={() => setContourPref("outer")}>Keep outer only</button>
			<button type="button" class="spi__contour-pref-btn" class:spi__contour-pref-btn--active={contourPref === "inner"}
				onclick={() => setContourPref("inner")}>Keep inner only</button>
			<button type="button" class="spi__contour-pref-btn" class:spi__contour-pref-btn--active={contourPref === "all"}
				onclick={() => setContourPref("all")}>
				Keep all layers
				{#if detectedLayers.length > 1}
					<span class="spi__contour-pref-badge">{detectedLayers.length}</span>
				{/if}
			</button>
			<button type="button" class="spi__contour-pref-btn" class:spi__contour-pref-btn--active={layerManageOpen}
				disabled={detectedLayers.length <= 1}
				onclick={() => (layerManageOpen = !layerManageOpen)}>Manage layers manually</button>
		</div>
	</div>
	</div>

	{#if detectedLayers.length > 1 && layerManageOpen}
		<div class="spi__layers">
			<ul class="spi__layers-list">
				{#each detectedLayers as layer, i (i)}
					<li class="spi__layers-item">
						<label>
							<input type="checkbox" checked={layerSelection[i] ?? false} onchange={() => toggleLayer(i)}/>
							Layer {i + 1}
							<span class="spi__layers-badge" class:spi__layers-badge--outer={layerBadge(i) === "Outer"}>{layerBadge(i)}</span>
						</label>
						<span class="spi__layers-item-area">{Math.abs(layer.area) < 0.01 ? "~0" : Math.abs(layer.area).toFixed(1)} area</span>
					</li>
				{/each}
			</ul>
			{#if layerManualMode}
				<button type="button" class="spi__layers-manage-btn" onclick={resetLayersToAuto}>Reset to auto</button>
			{/if}
		</div>
	{/if}

	{#if subpathCount > 1}
		<div class="spi__subpath-warn">
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
			<span>This path has <strong>{subpathCount} separate contours</strong>. The cutter will lift the blade between them — verify the shape is intentionally multi-part.</span>
			<button type="button" class="spi__extract-btn spi__extract-btn--outer" onclick={quickKeepOuter}>
				Keep outermost layer
			</button>
			{#if onMultiExtract && pieceCount > 1}
				<button type="button" class="spi__extract-btn" onclick={() => onMultiExtract!(extractSubpaths(value))}>
					Split into {pieceCount} patterns →
				</button>
			{/if}
		</div>
	{/if}
	{/if}
</div>

<style>
	.spi {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	/* ─── Section grouping (method / contour / input-output) ─── */
	.spi__section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.spi__section + .spi__section {
		margin-top: 22px;
		padding-top: 22px;
		border-top: 1px solid var(--border-subtle);
	}
	.spi__section-title {
		font-size: 0.9375rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}

	/* ─── Method picker (2×2 card grid) ─── */
	.spi__methods {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.spi__method {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 11px 12px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		font-family: var(--font-body);
		transition: background 0.12s, border-color 0.12s;
	}
	.spi__method:hover {
		border-color: color-mix(in srgb, var(--color-brand) 40%, var(--border-default));
	}
	.spi__method--active {
		background: color-mix(in srgb, var(--color-brand) 7%, var(--bg-surface-2));
		border-color: var(--color-brand);
	}

	.spi__method-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		flex-shrink: 0;
		border-radius: var(--radius-md);
		background: var(--bg-surface-3, var(--bg-surface));
		border: 1px solid var(--border-default);
		color: var(--text-tertiary);
		transition: color 0.12s, border-color 0.12s;
	}
	.spi__method--active .spi__method-icon {
		color: var(--color-brand);
		border-color: color-mix(in srgb, var(--color-brand) 35%, transparent);
	}

	.spi__method-body {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.spi__method-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.spi__method-sub {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	.spi__badge {
		display: inline-block;
		padding: 2px 7px;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		border-radius: 99px;
		line-height: 1.6;
	}
	.spi__badge--rec {
		background: color-mix(in srgb, var(--color-brand) 16%, transparent);
		color: var(--color-brand);
	}
	.spi__badge--exp {
		background: color-mix(in srgb, #f59e0b 14%, transparent);
		color: #f59e0b;
	}

	@media (max-width: 480px) {
		.spi__methods { grid-template-columns: 1fr; }
	}

	/* ─── Contour preference ─── */
	.spi__contour-pref {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		padding: 12px 14px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
	}
	.spi__contour-pref-group {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		background: var(--bg-surface-3, var(--bg-surface));
		border: 1px solid var(--border-default);
		border-radius: 99px;
		padding: 3px;
	}
	.spi__contour-pref-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 13px;
		font-size: 0.8125rem;
		font-weight: 600;
		font-family: var(--font-body);
		color: var(--text-tertiary);
		background: transparent;
		border: none;
		border-radius: 99px;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.12s, color 0.12s;
	}
	.spi__contour-pref-btn:hover { color: var(--text-secondary); }
	.spi__contour-pref-btn--active {
		background: var(--color-brand);
		color: #080a0f;
	}
	.spi__contour-pref-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.spi__contour-pref-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 17px;
		height: 17px;
		padding: 0 5px;
		font-size: 0.6875rem;
		font-weight: 700;
		border-radius: 99px;
		background: color-mix(in srgb, currentColor 18%, transparent);
	}
	@media (max-width: 640px) {
		.spi__contour-pref-group { border-radius: var(--radius-md); }
		.spi__contour-pref-btn { flex: 1 1 calc(50% - 3px); justify-content: center; }
	}
	@media (max-width: 480px) {
		.spi__contour-pref { flex-direction: column; align-items: stretch; }
		.spi__contour-pref-group { justify-content: space-between; }
	}

	/* ─── Work area: Input / Output side-by-side (50/50) on desktop,
	   Output stacked ABOVE Input on mobile ─── */
	.spi__workarea {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		align-items: start;
	}
	@media (max-width: 640px) {
		.spi__workarea { grid-template-columns: 1fr; }
		.spi__pview-col { order: -1; }
	}

	/* ─── Full-width row below Input/Output: replace-image + active importer ─── */
	.spi__full-row {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	/* ─── Input / Output labeled row ─── */
	.spi__io-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		margin-bottom: 6px;
	}
	.spi__pview-col {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.spi__io-imgwrap {
		position: absolute;
		inset: 0;
		overflow: hidden;
		touch-action: none;
	}
	.spi__io-img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
		transform-origin: center center;
		pointer-events: none;
	}
	/* ─── Resolution info bar (Input / Output) ─── */
	.spi__io-info {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
		padding: 5px 8px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.72rem;
	}
	.spi__io-info-res {
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}
	.spi__res-pill {
		margin-left: auto;
		padding: 2px 7px;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}
	.spi__res-pill--low {
		background: color-mix(in srgb, var(--color-danger, #e5484d) 15%, transparent);
		color: var(--color-danger, #e5484d);
	}
	.spi__res-pill--med {
		background: color-mix(in srgb, #f5a623 18%, transparent);
		color: #b7791f;
	}
	.spi__res-pill--high {
		background: color-mix(in srgb, var(--color-success, #30a46c) 15%, transparent);
		color: var(--color-success, #30a46c);
	}

	/* ─── Enhance before/after comparison ─── */
	.spi__compare {
		margin-top: 8px;
		padding: 8px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
	}
	.spi__compare-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 6px;
	}
	.spi__compare-close {
		background: none;
		border: none;
		color: var(--text-tertiary);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 2px;
	}
	.spi__compare-close:hover { color: var(--text-primary); }
	.spi__compare-row {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 8px;
	}
	.spi__compare-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.spi__compare-label {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.spi__compare-img {
		width: 100%;
		aspect-ratio: 1 / 1;
		object-fit: contain;
		border-radius: calc(var(--radius-md) - 2px);
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
	}
	.spi__compare-arrow {
		display: flex;
		align-items: center;
		color: var(--text-tertiary);
	}
	.spi__compare-cell .spi__io-info-res,
	.spi__compare-cell .spi__res-pill {
		font-size: 0.68rem;
	}
	.spi__compare-cell .spi__res-pill { margin-left: 0; }

	.spi__io-replace {
		display: inline-flex;
		align-self: flex-start;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		margin-top: 6px;
		transition: border-color 0.12s, color 0.12s;
	}
	.spi__io-replace:hover {
		border-color: var(--color-brand);
		color: var(--text-primary);
	}

	/* ─── Stage 1: initial upload dropzone ─── */
	.spi__drop--initial {
		min-height: 160px;
	}

	/* ─── Body: input only, full width ─── */
	.spi__body {
		display: block;
		min-width: 0;
	}

	/* ─── Path Data tab: upload row + divider ─── */
	.spi__upload-row {
		display: block;
		cursor: pointer;
	}
	.spi__upload-row-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		padding: 10px 14px;
		border: 1.5px dashed var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-secondary);
		transition: border-color 0.12s, background 0.12s, color 0.12s;
	}
	.spi__upload-row:hover .spi__upload-row-btn {
		border-color: var(--color-brand);
		background: color-mix(in srgb, var(--color-brand) 5%, transparent);
		color: var(--text-primary);
	}

	.spi__or-divider {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 10px 0 6px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.spi__or-divider::before, .spi__or-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border-default);
	}

	/* ─── Paste mode toggle: full SVG code vs raw path data ─── */
	.spi__paste-toggle {
		display: flex;
		gap: 4px;
		margin-bottom: 8px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: 99px;
		padding: 3px;
		width: fit-content;
	}
	.spi__paste-toggle-btn {
		padding: 6px 14px;
		font-size: 0.8125rem;
		font-weight: 600;
		font-family: var(--font-body);
		color: var(--text-tertiary);
		background: transparent;
		border: none;
		border-radius: 99px;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.12s, color 0.12s;
	}
	.spi__paste-toggle-btn:hover { color: var(--text-secondary); }
	.spi__paste-toggle-btn--active {
		background: var(--color-brand);
		color: #080a0f;
	}
	.spi__paste-hint {
		display: block;
		margin-top: 6px;
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	/* ─── Paste tab ─── */
	.spi__textarea {
		width: 100%;
		min-height: 130px;
		padding: 8px 10px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 0.8125rem;
		font-family: var(--font-mono, monospace);
		resize: vertical;
		box-sizing: border-box;
		transition: border-color 0.12s;
	}
	.spi__textarea:focus {
		outline: none;
		border-color: var(--color-brand);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-brand) 18%, transparent);
	}
	.spi__textarea--error { border-color: var(--color-danger, #f44); }

	/* ─── Drop zone (SVG + Trace tabs) ─── */
	.spi__drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 130px;
		padding: 20px 16px;
		border: 1.5px dashed var(--border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: center;
		transition: border-color 0.12s, background 0.12s;
		color: var(--text-tertiary);
	}
	.spi__drop:hover {
		border-color: var(--color-brand);
		background: color-mix(in srgb, var(--color-brand) 5%, transparent);
		color: var(--text-secondary);
	}
	.spi__file-input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
		pointer-events: none;
	}
	.spi__drop-label {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.spi__drop-sub {
		font-size: 0.875rem;
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	/* ─── Tracing spinner ─── */
	.spi__tracing {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 130px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}
	.spi__spinner {
		width: 22px;
		height: 22px;
		border: 2px solid var(--border-default);
		border-top-color: var(--color-brand);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	/* ─── Status messages ─── */
	.spi__err {
		font-size: 0.875rem;
		color: var(--color-danger, #f44);
		margin: 4px 0 0;
		line-height: 1.4;
	}
	.spi__pdf-status {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
	.spi__success {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.875rem;
		color: #4ade80;
		margin: 4px 0 0;
	}

	/* ─── Zoomable preview panel ─── */
	.spi__pview {
		position: relative;
		height: 280px;
		min-width: 0;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-surface-3);
		overflow: hidden;
	}

	.spi__pview--fullscreen {
		position: fixed;
		inset: 24px;
		height: auto;
		z-index: 1001;
		box-shadow: 0 20px 60px rgba(0,0,0,0.5);
	}

	.spi__pview-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: rgba(0,0,0,0.6);
		border: none;
		padding: 0;
		cursor: default;
	}

	.spi__pview-expand-btn {
		position: absolute;
		top: 8px;
		left: 8px;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		box-shadow: 0 1px 4px rgba(0,0,0,0.18);
		transition: color 0.12s, border-color 0.12s;
	}
	.spi__pview-expand-btn:hover {
		color: var(--color-brand);
		border-color: color-mix(in srgb, var(--color-brand) 40%, var(--border-default));
	}

	.spi__pview-enhance-btn {
		position: absolute;
		bottom: 8px;
		right: 8px;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 5px 9px;
		font-size: 0.75rem;
		font-family: var(--font-body);
		font-weight: 600;
		color: var(--color-brand);
		background: var(--bg-surface-2);
		border: 1px solid color-mix(in srgb, var(--color-brand) 40%, var(--border-default));
		border-radius: var(--radius-md);
		cursor: pointer;
		box-shadow: 0 1px 4px rgba(0,0,0,0.18);
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.spi__pview-enhance-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-brand) 12%, var(--bg-surface-2));
		border-color: var(--color-brand);
	}
	.spi__pview-enhance-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.spi__pview-enhance-btn--done {
		color: var(--color-success, #30a46c);
		border-color: color-mix(in srgb, var(--color-success, #30a46c) 40%, var(--border-default));
	}
	.spi__spin { animation: spi-spin 0.8s linear infinite; }
	@keyframes spi-spin { to { transform: rotate(360deg); } }

	.spi__io-enhance-err {
		display: block;
		font-size: 0.75rem;
		color: var(--color-danger, #e5484d);
		margin-top: 4px;
	}

	.spi__pview-toolbar {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 2px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 3px 4px;
		box-shadow: 0 1px 4px rgba(0,0,0,0.18);
	}

	.spi__pview-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px 6px;
		font-size: 0.75rem;
		font-family: var(--font-body);
		font-weight: 500;
		color: var(--text-secondary);
		background: transparent;
		border: none;
		border-radius: calc(var(--radius-md) - 3px);
		cursor: pointer;
		transition: background 0.1s, color 0.1s;
		line-height: 1;
	}
	.spi__pview-btn:hover {
		background: var(--bg-surface);
		color: var(--text-primary);
	}

	.spi__pview-zoom {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		min-width: 34px;
		text-align: center;
		font-variant-numeric: tabular-nums;
		padding: 0 2px;
	}

	.spi__pview-fit {
		border-left: 1px solid var(--border-default);
		margin-left: 2px;
		padding-left: 8px;
	}
	.spi__pview-rotate {
		border-left: 1px solid var(--border-default);
		margin-left: 2px;
		padding-left: 8px;
	}
	.spi__pview-btn:disabled {
		opacity: 0.5;
		cursor: default;
		pointer-events: none;
	}

	.spi__pview-svg {
		width: 100%;
		height: 100%;
		display: block;
		touch-action: none;
		user-select: none;
	}

	.spi__pview-empty {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: var(--text-muted);
		font-size: 0.875rem;
	}

	/* ─── No method chosen yet ─── */
	.spi__choose-method {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 130px;
		padding: 20px 16px;
		border: 1.5px dashed var(--border-default);
		border-radius: var(--radius-md);
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.875rem;
	}

	/* ─── Mirror pair preview ─── */
	.spi__mirror-bar {
		position: absolute;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--text-tertiary);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		pointer-events: none;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: 99px;
		padding: 3px 10px;
	}

	.spi__mirror-panels {
		display: flex;
		height: 100%;
	}

	.spi__mirror-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		position: relative;
		min-width: 0;
	}

	.spi__mirror-lbl {
		position: absolute;
		bottom: 8px;
		left: 0;
		right: 0;
		text-align: center;
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		pointer-events: none;
	}

	.spi__mirror-divider {
		width: 1px;
		background: var(--border-default);
		flex-shrink: 0;
	}

	/* ─── Layer detection panel ─── */
	.spi__layers {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		padding: 10px 12px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		margin: 0;
	}
	.spi__layers-manage-btn {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-body);
		color: var(--color-brand);
		cursor: pointer;
	}
	.spi__layers-manage-btn:hover { text-decoration: underline; }

	.spi__layers-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.spi__layers-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 5px 8px;
		background: var(--bg-surface-3, var(--bg-surface));
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
	}
	.spi__layers-item label {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		font-weight: 500;
		color: var(--text-primary);
	}
	.spi__layers-item-area {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	/* ─── Multi-subpath warning ─── */
	.spi__subpath-warn {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		font-size: 0.8125rem;
		color: #fbbf24;
		line-height: 1.5;
		padding: 6px 10px;
		background: color-mix(in srgb, #f59e0b 9%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, #f59e0b 30%, transparent);
		border-radius: var(--radius-md);
		margin: 0;
		flex-wrap: wrap;
	}

	.spi__extract-btn {
		flex-shrink: 0;
		background: color-mix(in srgb, var(--color-brand) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-brand) 35%, transparent);
		color: var(--color-brand);
		font-size: 0.75rem;
		font-weight: 700;
		font-family: var(--font-body);
		padding: 3px 10px;
		border-radius: 99px;
		cursor: pointer;
		transition: background 0.12s;
		white-space: nowrap;
	}
	.spi__extract-btn:hover {
		background: color-mix(in srgb, var(--color-brand) 22%, transparent);
	}
	.spi__extract-btn--outer {
		margin-left: auto;
		background: var(--bg-surface-3, var(--bg-surface));
		border-color: var(--border-default);
		color: var(--text-secondary);
	}
	.spi__extract-btn--outer:hover {
		border-color: color-mix(in srgb, var(--color-brand) 40%, var(--border-default));
		color: var(--text-primary);
		background: var(--bg-surface-3, var(--bg-surface));
	}

	.spi__layers-badge {
		display: inline-block;
		padding: 1px 6px;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		border-radius: 99px;
		background: var(--bg-surface-2);
		color: var(--text-tertiary);
		border: 1px solid var(--border-default);
	}
	.spi__layers-badge--outer {
		background: color-mix(in srgb, var(--color-brand) 14%, transparent);
		border-color: color-mix(in srgb, var(--color-brand) 35%, transparent);
		color: var(--color-brand);
	}

	/* ─── Scan animation (preview panel) ─── */
	.spi__scan-view {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: var(--bg-surface-3);
	}

	/* Subtle CRT scanline texture over the image */
	.spi__scan-view::before {
		content: '';
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			transparent,
			transparent 2px,
			rgba(0, 0, 0, 0.04) 2px,
			rgba(0, 0, 0, 0.04) 4px
		);
		pointer-events: none;
		z-index: 2;
	}

	.spi__scan-img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}

	/* Dark veil over the unscanned portion below the beam */
	.spi__scan-dim {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 5, 14, 0.52);
		transition: top 0.12s linear;
		z-index: 1;
	}

	/* The glowing scan beam */
	.spi__scan-beam {
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--color-brand);
		box-shadow:
			0 0 6px 2px color-mix(in srgb, var(--color-brand) 70%, transparent),
			0 0 18px 8px color-mix(in srgb, var(--color-brand) 28%, transparent);
		transition: top 0.12s linear;
		z-index: 3;
		overflow: hidden;
	}

	/* Shimmer sweep along the beam */
	.spi__scan-beam::after {
		content: '';
		position: absolute;
		inset: -4px 0;
		background: linear-gradient(90deg,
			transparent 0%,
			color-mix(in srgb, var(--color-brand) 55%, transparent) 50%,
			transparent 100%
		);
		animation: scan-shimmer 1.6s ease-in-out infinite;
	}
	@keyframes scan-shimmer {
		0%   { transform: translateX(-100%); }
		100% { transform: translateX(100%); }
	}

	/* Status HUD at the bottom of the preview panel */
	.spi__scan-hud {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 18px 14px 10px;
		background: linear-gradient(transparent, rgba(0, 5, 14, 0.82));
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--color-brand) 75%, #cef);
		font-variant-numeric: tabular-nums;
		z-index: 4;
	}

	.spi__scan-pct-hud {
		font-size: 1.125rem;
		font-weight: 800;
		color: var(--color-brand);
		letter-spacing: 0;
		text-transform: none;
		text-shadow: 0 0 10px color-mix(in srgb, var(--color-brand) 60%, transparent);
	}

	/* ─── Scan animation (input area) ─── */
	.spi__scan-status {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 10px;
		min-height: 130px;
		padding: 20px 16px;
	}

	.spi__scan-bar {
		width: 100%;
		height: 3px;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		border-radius: 99px;
		overflow: hidden;
	}

	.spi__scan-fill {
		height: 100%;
		background: var(--color-brand);
		border-radius: 99px;
		transition: width 0.12s linear;
		box-shadow: 0 0 8px color-mix(in srgb, var(--color-brand) 80%, transparent);
	}

	.spi__scan-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}

	.spi__scan-pct {
		font-weight: 700;
		color: var(--color-brand);
	}

	.spi__scan-label {
		color: var(--text-secondary);
	}

	.spi__scan-elapsed {
		color: var(--text-tertiary);
	}

	/* Shimmer on bar fill when stuck at plateau (last phase) */
	.spi__scan-fill--live {
		background: linear-gradient(90deg,
			var(--color-brand) 0%,
			color-mix(in srgb, var(--color-brand) 55%, #fff) 50%,
			var(--color-brand) 100%
		);
		background-size: 200% 100%;
		animation: bar-live 1.8s ease-in-out infinite;
	}
	@keyframes bar-live {
		0%   { background-position: 100% 0; }
		100% { background-position: -100% 0; }
	}

	/* ─── Step progress dots ─── */
	.spi__scan-steps {
		display: flex;
		align-items: center;
	}

	.spi__scan-step-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1.5px solid var(--border-default);
		background: transparent;
		flex-shrink: 0;
		transition: border-color 0.2s, background 0.2s, transform 0.2s, box-shadow 0.2s;
	}
	.spi__scan-step-dot--done {
		background: var(--color-brand);
		border-color: var(--color-brand);
	}
	.spi__scan-step-dot--active {
		background: color-mix(in srgb, var(--color-brand) 30%, transparent);
		border-color: var(--color-brand);
		transform: scale(1.3);
		animation: step-pulse 1.2s ease-in-out infinite;
	}
	@keyframes step-pulse {
		0%, 100% { box-shadow: 0 0 4px color-mix(in srgb, var(--color-brand) 40%, transparent); }
		50%       { box-shadow: 0 0 10px color-mix(in srgb, var(--color-brand) 70%, transparent); }
	}

	.spi__scan-step-line {
		flex: 1;
		height: 1px;
		background: var(--border-default);
		margin: 0 4px;
		transition: background 0.2s;
	}
	.spi__scan-step-line--done {
		background: var(--color-brand);
	}

	/* ─── Cancel button ─── */
	.spi__scan-cancel {
		align-self: center;
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-tertiary);
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-body);
		padding: 5px 16px;
		border-radius: 99px;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
	}
	.spi__scan-cancel:hover {
		border-color: var(--color-danger, #f44);
		color: var(--color-danger, #f44);
		background: color-mix(in srgb, var(--color-danger, #f44) 8%, transparent);
	}

	/* ─── Pattern slot grid (multi-mode, shown after detect) ─── */
	.spi__pattern-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.spi__pattern-slot {
		width: 14px;
		height: 14px;
		border-radius: 3px;
		border: 1.5px solid var(--border-default);
		background: transparent;
		flex-shrink: 0;
		transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
	}

	.spi__pattern-slot--active {
		border-color: var(--color-brand);
		background: color-mix(in srgb, var(--color-brand) 25%, transparent);
		animation: pattern-pulse 1.0s ease-in-out infinite;
	}

	.spi__pattern-slot--done {
		border-color: var(--color-brand);
		background: var(--color-brand);
		box-shadow: 0 0 4px color-mix(in srgb, var(--color-brand) 50%, transparent);
	}

	@keyframes pattern-pulse {
		0%, 100% { box-shadow: 0 0 3px color-mix(in srgb, var(--color-brand) 35%, transparent); }
		50%       { box-shadow: 0 0 9px color-mix(in srgb, var(--color-brand) 65%, transparent); }
	}

	/* ─── Stay-on-page notice (multi-mode only) ─── */
	.spi__scan-notice {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 0;
		padding: 7px 10px;
		font-size: 0.75rem;
		line-height: 1.45;
		color: #fbbf24;
		background: color-mix(in srgb, #f59e0b 9%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, #f59e0b 28%, transparent);
		border-radius: var(--radius-md);
	}
</style>
