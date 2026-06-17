<script lang="ts">
	import { traceImageData } from '$lib/utils/trace';
	import { smoothBezierJunctions } from '$lib/utils/bezier-smooth';

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
	}
	let { value = $bindable(""), id = "svgPath", error = false, showMirror = false, mirrorOrigLabel, mirrorFlipLabel, onMultiExtract, autoExtract = false, onVectorizingChange }: Props = $props();

	// ─── Tab state ────────────────────────────────
	type Tab = "vectorize" | "paste" | "trace";
	let tab = $state<Tab>("vectorize");

	// ─── Per-tab state ────────────────────────────
	let traceErr      = $state("");
	let tracing       = $state(false);
	let vectorizeErr  = $state("");
	let vectorizing   = $state(false);

	// ─── Scan animation state ─────────────────────
	let scanImageUrl  = $state("");
	let scanProgress  = $state(0);
	let scanElapsed   = $state(0);
	let scanPhases    = $state<Array<{ label: string; end: number }>>([]);
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

	function startScanAnimation(file: File, isMulti: boolean) {
		// Clear any stale stop-timeout so it can't revoke the new URL.
		if (_scanTimeout !== null) { clearTimeout(_scanTimeout); _scanTimeout = null; }
		if (_scanTimer   !== null) { clearInterval(_scanTimer);  _scanTimer   = null; }
		if (scanImageUrl) URL.revokeObjectURL(scanImageUrl);

		scanImageUrl = URL.createObjectURL(file);
		scanProgress = 0;
		scanElapsed  = 0;
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
		scanProgress = 0;
		scanElapsed  = 0;
		scanPhases   = [];
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

	$effect(() => {
		const path = previewPath;
		if (!path || typeof document === 'undefined') {
			previewViewBox = "0 0 100 100";
			return;
		}
		try {
			const ns  = "http://www.w3.org/2000/svg";
			const svg = document.createElementNS(ns, "svg") as SVGSVGElement;
			svg.style.cssText = "position:absolute;visibility:hidden;width:0;height:0;";
			const el = document.createElementNS(ns, "path") as SVGPathElement;
			el.setAttribute("d", path);
			svg.appendChild(el);
			document.body.appendChild(svg);
			let bbox: SVGRect;
			try { bbox = el.getBBox(); } finally { document.body.removeChild(svg); }
			if (!bbox.width || !bbox.height) { previewViewBox = "0 0 100 100"; return; }
			const buf = 4;
			previewViewBox = `${bbox.x - buf} ${bbox.y - buf} ${bbox.width + buf * 2} ${bbox.height + buf * 2}`;
		} catch {
			previewViewBox = "0 0 100 100";
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

	// When autoExtract is set, fire onMultiExtract immediately instead of
	// waiting for the user to click the "Split" button in the warning banner.
	$effect(() => {
		if (autoExtract && onMultiExtract && subpathCount > 1 && previewPath) {
			onMultiExtract(extractSubpaths(previewPath));
		}
	});

	// ─── Shared SVG processing ───────────────────
	// Used by both the SVG file upload and the vectorize (image → SVG) paths.
	// Finds the longest <path> in the SVG text, resolves the full ancestor CTM
	// (catches Y-flips from tools like Illustrator), then normalises to 0–100.
	function processSvgText(svgText: string): string {
		const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
		if (doc.querySelector("parseerror")) throw new Error("Invalid SVG.");

		const paths = Array.from(doc.querySelectorAll("path"));
		if (paths.length === 0) throw new Error("No <path> elements found.");

		let mainIdx = 0;
		for (let i = 1; i < paths.length; i++) {
			if ((paths[i].getAttribute("d")?.length ?? 0) > (paths[mainIdx].getAttribute("d")?.length ?? 0))
				mainIdx = i;
		}
		const d = paths[mainIdx].getAttribute("d");
		if (!d) throw new Error("Path element has no d attribute.");

		const container = document.createElement("div");
		container.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;";
		container.innerHTML = svgText;
		document.body.appendChild(container);
		let ctm: DOMMatrix | null = null;
		try {
			const livePath = container.querySelectorAll("path")[mainIdx] as SVGPathElement | undefined;
			ctm = livePath?.getCTM() ?? null;
		} finally {
			document.body.removeChild(container);
		}

		return normalizeSvgPath(d, 3, ctm);
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
	async function handleVectorize(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
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
				// SVG: lossless direct path extraction — no rasterisation at all.
				value = processSvgText(await file.text());
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
				scanProgress = 25;
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
				const canvases = crops.map(({ x, y, w, h }) => {
					const canvas = document.createElement('canvas');
					canvas.width  = w + BORDER_PX * 2;
					canvas.height = h + BORDER_PX * 2;
					const ctx = canvas.getContext('2d')!;
					ctx.fillStyle = '#ffffff';
					ctx.fillRect(0, 0, canvas.width, canvas.height);
					ctx.drawImage(imgEl, x, y, w, h, BORDER_PX, BORDER_PX, w, h);
					return canvas;
				});
				URL.revokeObjectURL(imgUrl);

				// Parallel trace with concurrency limit.
				const CONCURRENCY = 3;
				const svgsOrdered = new Array<string>(crops.length);
				let nextIdx   = 0;
				let doneCount = 0;

				async function cropWorker(): Promise<void> {
					while (nextIdx < crops.length) {
						const i = nextIdx++;
						const blob = await new Promise<Blob>((resolve, reject) =>
							canvases[i].toBlob(b => b ? resolve(b) : reject(new Error('Canvas export failed')), 'image/png')
						);
						const cropFd = new FormData();
						cropFd.append("image", new File([blob], 'crop.png', { type: 'image/png' }));
						const res = await fetch("/api/vectorize", { method: "POST", body: cropFd, signal });
						if (!res.ok) {
							const body = await res.text().catch(() => "");
							let msg = "";
							try { msg = (JSON.parse(body) as { message?: string }).message ?? ""; } catch { msg = body; }
							throw new Error(msg || `Server error ${res.status}`);
						}
						const { svg } = await res.json() as { svg: string };
						svgsOrdered[i] = svg;
						scanProgress = Math.min(94, 25 + 68 * (++doneCount / crops.length));
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
			(e.target as HTMLInputElement).value = "";
		}
	}

	// Normalises an SVG path d-string to the 0-100 coordinate space used by the
	// nesting engine, using uniform (aspect-ratio preserving) scaling so that an
	// oval stays an oval. Uses the browser's getBBox() for exact geometry.
	// ctm: accumulated transform from path local coords → SVG viewport (from getCTM()).
	// Applying it first corrects Y-axis flips and other ancestor transforms before
	// the bbox-based normalisation is computed.
	function normalizeSvgPath(d: string, margin = 3, ctm: DOMMatrix | null = null): string {
		const svgNs = "http://www.w3.org/2000/svg";

		// Apply CTM to get path in visual (SVG viewport) coordinate space.
		const isIdentity = !ctm || (ctm.a === 1 && ctm.b === 0 && ctm.c === 0 && ctm.d === 1 && ctm.e === 0 && ctm.f === 0);
		const dVis = isIdentity ? d : transformPathCoords(d, { a: ctm!.a, b: ctm!.b, c: ctm!.c, d: ctm!.d, e: ctm!.e, f: ctm!.f });

		// Compute bbox of the visually-correct path.
		const svg = document.createElementNS(svgNs, "svg") as SVGSVGElement;
		svg.style.cssText = "position:absolute;visibility:hidden;width:0;height:0;";
		const pathEl = document.createElementNS(svgNs, "path") as SVGPathElement;
		pathEl.setAttribute("d", dVis);
		svg.appendChild(pathEl);
		document.body.appendChild(svg);
		let bbox: SVGRect;
		try {
			bbox = pathEl.getBBox();
		} finally {
			document.body.removeChild(svg);
		}
		if (!bbox.width || !bbox.height) throw new Error("Path has no drawable extent.");

		const size  = 100 - margin * 2;
		const scale = size / Math.max(bbox.width, bbox.height);
		const tx    = margin + (size - bbox.width  * scale) / 2 - bbox.x * scale;
		const ty    = margin + (size - bbox.height * scale) / 2 - bbox.y * scale;

		return transformPathCoords(dVis, { a: scale, b: 0, c: 0, d: scale, e: tx, f: ty });
	}

	// ─── Affine matrix type ───────────────────────
	// Matches SVGMatrix / DOMMatrix: x' = a·x + c·y + e,  y' = b·x + d·y + f
	type Mat = { a: number; b: number; c: number; d: number; e: number; f: number };

	// Applies a 2-D affine matrix to every coordinate in an SVG path string.
	// Handles all SVG path commands (M L H V C S Q T A Z and lowercase relatives).
	// Arc sweep flags are inverted when the matrix is reflective (det < 0, e.g. Y-flip).
	// H/V commands assume no shear (b=0, c=0); this holds for all scale/flip/translate
	// matrices used in practice. Radii are scaled by the per-axis scale factor.
	function transformPathCoords(d: string, mat: Mat): string {
		const r  = (n: number) => Math.round(n * 100) / 100;
		// Absolute point: full affine
		const ta = (x: number, y: number) =>
			`${r(mat.a * x + mat.c * y + mat.e)},${r(mat.b * x + mat.d * y + mat.f)}`;
		// Relative delta: linear part only (no translation)
		const tr = (x: number, y: number) =>
			`${r(mat.a * x + mat.c * y)},${r(mat.b * x + mat.d * y)}`;
		// H/h: x-only (assumes c=0 / no shear)
		const ah = (x: number) => r(mat.a * x + mat.e);
		const rh = (x: number) => r(mat.a * x);
		// V/v: y-only (assumes b=0 / no shear)
		const av = (y: number) => r(mat.d * y + mat.f);
		const rv = (y: number) => r(mat.d * y);
		// Arc radii: scale by per-axis magnitudes
		const scX = Math.sqrt(mat.a * mat.a + mat.b * mat.b);
		const scY = Math.sqrt(mat.c * mat.c + mat.d * mat.d);
		const ra  = (rx: number, ry: number) => `${r(scX * Math.abs(rx))},${r(scY * Math.abs(ry))}`;
		// Sweep flag inverts when the matrix is reflective (det < 0 → Y-flip, etc.)
		const flipSweep = mat.a * mat.d - mat.b * mat.c < 0;

		const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
		const tokens: string[] = [];
		let tok: RegExpExecArray | null;
		while ((tok = re.exec(d)) !== null) tokens.push(tok[0]);

		let out = "";
		let i = 0;
		while (i < tokens.length) {
			const cmd = tokens[i++];
			if (!/^[MmLlHhVvCcSsQqTtAaZz]$/.test(cmd)) continue;

			const nums: number[] = [];
			while (i < tokens.length && !/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tokens[i]))
				nums.push(parseFloat(tokens[i++]));

			switch (cmd) {
				case 'M': case 'L': case 'T':
					out += cmd;
					for (let j = 0; j < nums.length; j += 2) out += ` ${ta(nums[j], nums[j+1])}`;
					break;
				case 'm': case 'l': case 't':
					out += cmd;
					for (let j = 0; j < nums.length; j += 2) out += ` ${tr(nums[j], nums[j+1])}`;
					break;
				case 'H': out += cmd; for (const x of nums) out += ` ${ah(x)}`; break;
				case 'h': out += cmd; for (const x of nums) out += ` ${rh(x)}`; break;
				case 'V': out += cmd; for (const y of nums) out += ` ${av(y)}`; break;
				case 'v': out += cmd; for (const y of nums) out += ` ${rv(y)}`; break;
				case 'C':
					out += cmd;
					for (let j = 0; j < nums.length; j += 6)
						out += ` ${ta(nums[j], nums[j+1])} ${ta(nums[j+2], nums[j+3])} ${ta(nums[j+4], nums[j+5])}`;
					break;
				case 'c':
					out += cmd;
					for (let j = 0; j < nums.length; j += 6)
						out += ` ${tr(nums[j], nums[j+1])} ${tr(nums[j+2], nums[j+3])} ${tr(nums[j+4], nums[j+5])}`;
					break;
				case 'S': case 'Q':
					out += cmd;
					for (let j = 0; j < nums.length; j += 4)
						out += ` ${ta(nums[j], nums[j+1])} ${ta(nums[j+2], nums[j+3])}`;
					break;
				case 's': case 'q':
					out += cmd;
					for (let j = 0; j < nums.length; j += 4)
						out += ` ${tr(nums[j], nums[j+1])} ${tr(nums[j+2], nums[j+3])}`;
					break;
				case 'A':
					out += cmd;
					for (let j = 0; j < nums.length; j += 7) {
						const sw = flipSweep ? 1 - nums[j+4] : nums[j+4];
						out += ` ${ra(nums[j], nums[j+1])} ${nums[j+2]} ${nums[j+3]},${sw} ${ta(nums[j+5], nums[j+6])}`;
					}
					break;
				case 'a':
					out += cmd;
					for (let j = 0; j < nums.length; j += 7) {
						const sw = flipSweep ? 1 - nums[j+4] : nums[j+4];
						out += ` ${ra(nums[j], nums[j+1])} ${nums[j+2]} ${nums[j+3]},${sw} ${tr(nums[j+5], nums[j+6])}`;
					}
					break;
				case 'Z': case 'z': out += cmd; break;
			}
			out += ' ';
		}
		return out.trim();
	}

	// ─── Subpath extraction for multi-pattern mode ──
	// Splits a combined potrace path (multiple M…Z segments) into individually
	// normalized 0-100 paths — one per contour. Degenerate or zero-extent
	// contours are silently dropped. Only call this client-side (uses getBBox).
	function extractSubpaths(fullPath: string): string[] {
		const segs = fullPath.match(/M[^Mm]*/gi)?.map(s => s.trim()).filter(Boolean) ?? [fullPath];
		const result: string[] = [];
		for (const seg of segs) {
			try {
				const closed = /[Zz]\s*$/.test(seg) ? seg : seg + ' Z';
				result.push(normalizeSvgPath(closed));
			} catch {
				// degenerate path — skip
			}
		}
		return result;
	}

	// ─── Image trace ─────────────────────────────
	async function handleImageFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		traceErr = "";
		tracing = true;
		try {
			value = await traceImage(file);
		} catch (err) {
			traceErr = err instanceof Error ? err.message : "Tracing failed.";
		} finally {
			tracing = false;
			(e.target as HTMLInputElement).value = "";
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
	<!-- ─── Tab bar ─── -->
	<div class="spi__tabs" role="tablist">
		<button type="button" class="spi__tab" class:spi__tab--active={tab === "vectorize"}
			role="tab" aria-selected={tab === "vectorize"} onclick={() => (tab = "vectorize")}>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
			Vectorize
			<span class="spi__badge spi__badge--rec">Recommended</span>
		</button>
		<button type="button" class="spi__tab" class:spi__tab--active={tab === "paste"}
			role="tab" aria-selected={tab === "paste"} onclick={() => (tab = "paste")}>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z"/></svg>
			Paste
		</button>
		<button type="button" class="spi__tab" class:spi__tab--active={tab === "trace"}
			role="tab" aria-selected={tab === "trace"} onclick={() => (tab = "trace")}>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
			Trace Image
			<span class="spi__badge spi__badge--exp">Experimental</span>
		</button>
	</div>

	<!-- ─── Content + preview ─── -->
	<div class="spi__body">
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
								<span class="spi__scan-label">{scanPhases[scanPhaseIndex]?.label ?? "Vectorizing"}</span>
								<span class="spi__scan-elapsed">{scanElapsed}s</span>
							</div>
							<button type="button" class="spi__scan-cancel" onclick={cancelVectorize}>Cancel</button>
							{#if scanPhases.length > 1}
								<p class="spi__scan-notice">
									<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
									<span>Stay on this page — each pattern takes 10–30s (longer for complex shapes). Don't refresh or reload. If it fails, an error will appear; otherwise it's still running.</span>
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
					<label class="spi__drop">
						<input type="file" accept=".svg,image/svg+xml,image/*" onchange={handleVectorize} class="spi__file-input"/>
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
						<span class="spi__drop-label">Click to upload a file</span>
						<span class="spi__drop-sub">SVG — extracted losslessly &nbsp;·&nbsp; PNG, JPG, WebP, BMP — converted to precise bezier curves</span>
					</label>
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

			{:else if tab === "paste"}
				<textarea
					{id}
					class="spi__textarea"
					class:spi__textarea--error={error && !value.trim()}
					bind:value
					rows="6"
					spellcheck="false"
					placeholder={"M 5,5 L 95,5 95,95 5,95 Z\nM 50,5 L 95,80 5,80 Z\nM 15,50 C 15,15 85,15 85,50 C 85,85 15,85 15,50 Z"}
				></textarea>

			{:else}
				<!-- Trace Image: in-browser B&W tracing -->
				{#if tracing}
					<div class="spi__tracing">
						<span class="spi__spinner" aria-hidden="true"></span>
						<span>Tracing shape…</span>
					</div>
				{:else}
					<label class="spi__drop">
						<input type="file" accept="image/png,image/jpeg,image/webp" onchange={handleImageFile} class="spi__file-input"/>
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
						<span class="spi__drop-label">Click to upload a B&W image</span>
						<span class="spi__drop-sub">PNG, JPG or WebP — shape traced in-browser</span>
					</label>
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
			{/if}

		</div>

	</div>

	<!-- ─── Zoomable preview panel ─── -->
	<div class="spi__pview">
		{#if scanImageUrl}
			<!-- Scan effect: image with a sweeping beam tracking progress -->
			<div class="spi__scan-view" aria-hidden="true">
				<img src={scanImageUrl} alt="" class="spi__scan-img"/>
				<div class="spi__scan-dim" style="top: {Math.round(scanProgress)}%"></div>
				<div class="spi__scan-beam" style="top: calc({Math.round(scanProgress)}% - 1px)"></div>
				<div class="spi__scan-hud">
					<span>{scanPhases[scanPhaseIndex]?.label ?? "Analyzing"}</span>
					<span class="spi__scan-pct-hud">{Math.round(scanProgress)}%</span>
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
					<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" class="spi__pview-svg" aria-label="Original path orientation">
						<defs>
							<pattern id="spi-grid-l" width="10" height="10" patternUnits="userSpaceOnUse">
								<path d="M 10 0 L 0 0 0 10" fill="none" stroke="var(--border-default)" stroke-width="0.3" opacity="0.5"/>
							</pattern>
						</defs>
						<rect x="0" y="0" width="100" height="100" fill="url(#spi-grid-l)"/>
						<path d={previewPath} fill="rgba(0,229,255,0.07)" stroke="var(--color-brand)" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
					<span class="spi__mirror-lbl">{mirrorOrigLabel ?? "As uploaded"}</span>
				</div>
				<div class="spi__mirror-divider" aria-hidden="true"></div>
				<div class="spi__mirror-panel">
					<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" class="spi__pview-svg" aria-label="Mirrored path orientation">
						<defs>
							<pattern id="spi-grid-r" width="10" height="10" patternUnits="userSpaceOnUse">
								<path d="M 10 0 L 0 0 0 10" fill="none" stroke="var(--border-default)" stroke-width="0.3" opacity="0.5"/>
							</pattern>
						</defs>
						<rect x="0" y="0" width="100" height="100" fill="url(#spi-grid-r)"/>
						<path d={previewPath} transform="matrix(-1 0 0 1 100 0)" fill="rgba(0,229,255,0.07)" stroke="var(--color-brand)" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
					<span class="spi__mirror-lbl">{mirrorFlipLabel ?? "Mirrored"}</span>
				</div>
			</div>
		{:else if previewPath}
			<div class="spi__pview-toolbar">
				<button type="button" class="spi__pview-btn" onclick={zoomOut} title="Zoom out">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>
				</button>
				<span class="spi__pview-zoom">{Math.round(zoom * 100)}%</span>
				<button type="button" class="spi__pview-btn" onclick={zoomIn} title="Zoom in">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				</button>
				<button type="button" class="spi__pview-btn spi__pview-fit" onclick={resetView} title="Reset to fit">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
					Fit
				</button>
			</div>
			<svg
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
				</defs>
				<rect x="-9999" y="-9999" width="19998" height="19998" fill="url(#spi-grid)"/>
				<path d={previewPath} fill="rgba(0,229,255,0.07)" stroke="var(--color-brand)" stroke-width={1.5 / zoom} stroke-linecap="round"/>
			</svg>
		{:else}
			<div class="spi__pview-empty">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
				<span>Preview appears here</span>
			</div>
		{/if}
	</div>

	<!-- Coordinate space note — shown for paste and after trace -->
	<p class="spi__note">
		Coordinates must be in <strong>0–100 normalized space</strong> — the nesting engine scales to real dimensions using your width/height values. Traced images are auto-normalized.
	</p>

	{#if subpathCount > 1}
		<div class="spi__subpath-warn">
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
			<span>This path has <strong>{subpathCount} separate contours</strong>. The cutter will lift the blade between them — verify the shape is intentionally multi-part.</span>
			{#if onMultiExtract}
				<button type="button" class="spi__extract-btn" onclick={() => onMultiExtract!(extractSubpaths(value))}>
					Split into {subpathCount} patterns →
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.spi {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	/* ─── Tab bar ─── */
	.spi__tabs {
		display: flex;
		gap: 2px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 3px;
		width: fit-content;
	}

	.spi__tab {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 8px 16px;
		font-size: 0.9375rem;
		font-weight: 500;
		font-family: var(--font-body);
		color: var(--text-tertiary);
		background: transparent;
		border: none;
		border-radius: calc(var(--radius-md) - 2px);
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
		white-space: nowrap;
	}
	.spi__tab:hover { color: var(--text-secondary); }

	/* Vertical divider between tabs */
	.spi__tab + .spi__tab {
		position: relative;
	}
	.spi__tab + .spi__tab::before {
		content: '';
		position: absolute;
		left: -1px;
		top: 18%;
		height: 64%;
		width: 1px;
		background: var(--border-default);
	}

	.spi__tab--active {
		background: var(--bg-surface);
		color: var(--text-primary);
		box-shadow: 0 1px 3px rgba(0,0,0,0.12);
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

	/* ─── Body: input only, full width ─── */
	.spi__body {
		display: block;
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
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-surface-3);
		overflow: hidden;
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
		margin-left: auto;
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

	/* ─── Note ─── */
	.spi__note {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		line-height: 1.5;
		padding: 6px 10px;
		background: color-mix(in srgb, #f59e0b 8%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, #f59e0b 22%, transparent);
		border-radius: var(--radius-md);
		margin: 0;
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
