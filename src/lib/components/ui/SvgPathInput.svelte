<script lang="ts">
	// ─── Props ────────────────────────────────────
	interface Props {
		value: string;
		id?: string;
		error?: boolean;
	}
	let { value = $bindable(""), id = "svgPath", error = false }: Props = $props();

	// ─── Tab state ────────────────────────────────
	type Tab = "paste" | "svg" | "trace";
	let tab = $state<Tab>("paste");

	// ─── Per-tab state ────────────────────────────
	let svgErr     = $state("");
	let svgTracing = $state(false);
	let traceErr   = $state("");
	let tracing    = $state(false);

	// Preview live from value
	const previewPath = $derived(value.trim());

	// Warn when a path contains multiple subpaths (multiple M/m commands).
	// The cutter handles them correctly (blade lifts between contours), but the
	// user should know — most PPF/tint patterns should be a single closed outline.
	const subpathCount = $derived(
		previewPath ? (previewPath.match(/(?<=[^\s])[Mm]/g)?.length ?? 0) + 1 : 0
	);

	// ─── SVG file upload ─────────────────────────
	// Extracts the path directly from the SVG DOM — no rasterisation, no lossy trace.
	// Coordinates are mathematically normalised to 0-100 space using the browser's
	// own geometry engine (getBBox), so bezier curves and arcs are preserved exactly.
	async function handleSVGFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		svgErr = "";
		svgTracing = true;
		try {
			const text = await file.text();
			const doc  = new DOMParser().parseFromString(text, "image/svg+xml");
			if (doc.querySelector("parseerror")) throw new Error("Invalid SVG file.");

			const paths = Array.from(doc.querySelectorAll("path"));
			if (paths.length === 0) throw new Error("No <path> elements found in this SVG.");

			// Take the path with the longest d attribute (most likely the main outline)
			const main = paths.reduce((a, b) =>
				(a.getAttribute("d")?.length ?? 0) >= (b.getAttribute("d")?.length ?? 0) ? a : b
			);
			const d = main.getAttribute("d");
			if (!d) throw new Error("Path element has no d attribute.");

			value = normalizeSvgPath(d);
		} catch (err) {
			svgErr = err instanceof Error ? err.message : "Could not process SVG file.";
		} finally {
			svgTracing = false;
			(e.target as HTMLInputElement).value = "";
		}
	}

	// Normalises an SVG path d-string to the 0-100 coordinate space used by the
	// nesting engine, using uniform (aspect-ratio preserving) scaling so that an
	// oval stays an oval. Uses the browser's getBBox() for exact geometry.
	function normalizeSvgPath(d: string, margin = 3): string {
		const ns = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(ns, "svg");
		svg.style.cssText = "position:absolute;visibility:hidden;width:0;height:0;";
		const pathEl = document.createElementNS(ns, "path") as SVGPathElement;
		pathEl.setAttribute("d", d);
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

		return transformPathCoords(d, scale, tx, ty);
	}

	// Applies a uniform scale+translate to every coordinate in an SVG path string,
	// handling all SVG path commands (M L H V C S Q T A Z and their lowercase forms).
	function transformPathCoords(d: string, sc: number, tx: number, ty: number): string {
		const r  = (n: number) => Math.round(n * 100) / 100;
		const ax = (x: number) => r(x * sc + tx);  // absolute coord
		const ay = (y: number) => r(y * sc + ty);
		const dx = (x: number) => r(x * sc);        // relative delta
		const dy = (y: number) => r(y * sc);
		const ra = (v: number) => r(v * sc);        // radius (scale only)

		const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
		const tokens: string[] = [];
		let m: RegExpExecArray | null;
		while ((m = re.exec(d)) !== null) tokens.push(m[0]);

		let out = "";
		let i = 0;
		while (i < tokens.length) {
			const cmd = tokens[i++];
			if (!/^[MmLlHhVvCcSsQqTtAaZz]$/.test(cmd)) continue;

			const ns: number[] = [];
			while (i < tokens.length && !/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tokens[i]))
				ns.push(parseFloat(tokens[i++]));

			switch (cmd) {
				case 'M': case 'L': case 'T':
					out += cmd;
					for (let j = 0; j < ns.length; j += 2) out += ` ${ax(ns[j])},${ay(ns[j+1])}`;
					break;
				case 'm': case 'l': case 't':
					out += cmd;
					for (let j = 0; j < ns.length; j += 2) out += ` ${dx(ns[j])},${dy(ns[j+1])}`;
					break;
				case 'H': out += cmd; for (const x of ns) out += ` ${ax(x)}`; break;
				case 'h': out += cmd; for (const x of ns) out += ` ${dx(x)}`; break;
				case 'V': out += cmd; for (const y of ns) out += ` ${ay(y)}`; break;
				case 'v': out += cmd; for (const y of ns) out += ` ${dy(y)}`; break;
				case 'C':
					out += cmd;
					for (let j = 0; j < ns.length; j += 6)
						out += ` ${ax(ns[j])},${ay(ns[j+1])} ${ax(ns[j+2])},${ay(ns[j+3])} ${ax(ns[j+4])},${ay(ns[j+5])}`;
					break;
				case 'c':
					out += cmd;
					for (let j = 0; j < ns.length; j += 6)
						out += ` ${dx(ns[j])},${dy(ns[j+1])} ${dx(ns[j+2])},${dy(ns[j+3])} ${dx(ns[j+4])},${dy(ns[j+5])}`;
					break;
				case 'S': case 'Q':
					out += cmd;
					for (let j = 0; j < ns.length; j += 4)
						out += ` ${ax(ns[j])},${ay(ns[j+1])} ${ax(ns[j+2])},${ay(ns[j+3])}`;
					break;
				case 's': case 'q':
					out += cmd;
					for (let j = 0; j < ns.length; j += 4)
						out += ` ${dx(ns[j])},${dy(ns[j+1])} ${dx(ns[j+2])},${dy(ns[j+3])}`;
					break;
				case 'A':
					out += cmd;
					for (let j = 0; j < ns.length; j += 7)
						out += ` ${ra(ns[j])},${ra(ns[j+1])} ${ns[j+2]} ${ns[j+3]},${ns[j+4]} ${ax(ns[j+5])},${ay(ns[j+6])}`;
					break;
				case 'a':
					out += cmd;
					for (let j = 0; j < ns.length; j += 7)
						out += ` ${ra(ns[j])},${ra(ns[j+1])} ${ns[j+2]} ${ns[j+3]},${ns[j+4]} ${dx(ns[j+5])},${dy(ns[j+6])}`;
					break;
				case 'Z': case 'z': out += cmd; break;
			}
			out += ' ';
		}
		return out.trim();
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

	// ── Core tracing pipeline ─────────────────────
	async function traceImage(file: File): Promise<string> {
		const url = URL.createObjectURL(file);
		const img = await new Promise<HTMLImageElement>((res, rej) => {
			const el = new Image();
			el.onload = () => res(el);
			el.onerror = () => rej(new Error("Could not load image. Use PNG or JPG."));
			el.src = url;
		});
		URL.revokeObjectURL(url);
		return traceFromImage(img);
	}

	async function traceFromImage(img: HTMLImageElement): Promise<string> {
		const W = img.naturalWidth || 512, H = img.naturalHeight || 512;
		if (W < 8 || H < 8) throw new Error("Image too small — minimum 8×8 px.");

		// Draw to offscreen canvas; white fill ensures SVG stroke-only paths
		// (transparent interior) render against a known background colour.
		const canvas = document.createElement("canvas");
		canvas.width = W; canvas.height = H;
		const ctx = canvas.getContext("2d")!;
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, W, H);
		ctx.drawImage(img, 0, 0, W, H);
		const { data } = ctx.getImageData(0, 0, W, H);

		// 3. Convert to binary grid (1 = shape, 0 = background)
		//    Auto-detect polarity by sampling the four corners
		const corners = [0, (W - 1), (H - 1) * W, (H - 1) * W + (W - 1)];
		const cornerLuma = corners.reduce((s, i) =>
			s + (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 4, 0);
		const darkBg = cornerLuma < 128; // corners dark → light shape on dark bg → invert

		const grid = new Uint8Array(W * H);
		for (let i = 0; i < W * H; i++) {
			const alpha = data[i * 4 + 3];
			if (alpha < 128) { grid[i] = 0; continue; } // transparent = background
			const luma = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
			grid[i] = darkBg ? (luma > 128 ? 1 : 0) : (luma < 128 ? 1 : 0);
		}

		// 4. Scanline outline — left/right edge per row
		//    Works correctly for convex and mildly concave shapes (all standard tint/PPF patterns)
		const leftPts: [number, number][] = [];
		const rightPts: [number, number][] = [];
		for (let y = 0; y < H; y++) {
			let lx = -1, rx = -1;
			for (let x = 0; x < W; x++) {
				if (grid[y * W + x]) { if (lx < 0) lx = x; rx = x; }
			}
			if (lx >= 0) {
				leftPts.push([lx, y]);
				if (rx !== lx) rightPts.push([rx, y]);
			}
		}
		if (leftPts.length === 0) throw new Error("No shape detected. Make sure the image is black and white with a clear outline.");

		// Closed contour: left edge top→bottom, right edge bottom→top
		const contour: [number, number][] = [...leftPts, ...[...rightPts].reverse()];

		// 5. RDP simplification — tolerance scales with image size
		const tolerance = Math.max(W, H) * 0.012;
		const simplified = rdp(contour, tolerance);
		if (simplified.length < 3) throw new Error("Shape too simple or too small to trace.");

		// 6. Normalize to 0-100 coordinate space with uniform (aspect-preserving) scale
		const xs = simplified.map(p => p[0]), ys = simplified.map(p => p[1]);
		const minX = Math.min(...xs), maxX = Math.max(...xs);
		const minY = Math.min(...ys), maxY = Math.max(...ys);
		const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
		const margin = 3, size = 100 - margin * 2;
		const scale  = size / Math.max(rangeX, rangeY);
		const norm = simplified.map(([x, y]): [number, number] => [
			(x - minX) * scale + margin + (size - rangeX * scale) / 2,
			(y - minY) * scale + margin + (size - rangeY * scale) / 2,
		]);

		// 7. Smooth path via Catmull-Rom → Cubic Bezier
		return toCubicSVGPath(norm);
	}

	// ── Ramer-Douglas-Peucker simplification ─────
	function rdp(pts: [number, number][], eps: number): [number, number][] {
		if (pts.length <= 2) return pts;
		const [p1, pn] = [pts[0], pts[pts.length - 1]];
		let maxD = 0, maxI = 0;
		for (let i = 1; i < pts.length - 1; i++) {
			const d = perpDist(pts[i], p1, pn);
			if (d > maxD) { maxD = d; maxI = i; }
		}
		if (maxD > eps) {
			const L = rdp(pts.slice(0, maxI + 1), eps);
			const R = rdp(pts.slice(maxI), eps);
			return [...L.slice(0, -1), ...R];
		}
		return [p1, pn];
	}

	function perpDist([px, py]: [number, number], [x1, y1]: [number, number], [x2, y2]: [number, number]) {
		const dx = x2 - x1, dy = y2 - y1;
		const len = Math.hypot(dx, dy);
		if (len === 0) return Math.hypot(px - x1, py - y1);
		return Math.abs((py - y1) * dx - (px - x1) * dy) / len;
	}

	// ── Catmull-Rom → Cubic Bezier SVG path ──────
	function toCubicSVGPath(pts: [number, number][]): string {
		const n = pts.length;
		const r = (v: number) => Math.round(v * 10) / 10;
		let d = `M ${r(pts[0][0])},${r(pts[0][1])}`;
		for (let i = 0; i < n; i++) {
			const p0 = pts[(i - 1 + n) % n];
			const p1 = pts[i];
			const p2 = pts[(i + 1) % n];
			const p3 = pts[(i + 2) % n];
			// Catmull-Rom control points
			const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
			const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
			const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
			const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
			d += ` C ${r(cp1x)},${r(cp1y)} ${r(cp2x)},${r(cp2y)} ${r(p2[0])},${r(p2[1])}`;
		}
		return d + " Z";
	}
</script>

<div class="spi">
	<!-- ─── Tab bar ─── -->
	<div class="spi__tabs" role="tablist">
		<button type="button" class="spi__tab" class:spi__tab--active={tab === "paste"}
			role="tab" aria-selected={tab === "paste"} onclick={() => (tab = "paste")}>
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z"/></svg>
			Paste
		</button>
		<button type="button" class="spi__tab" class:spi__tab--active={tab === "svg"}
			role="tab" aria-selected={tab === "svg"} onclick={() => (tab = "svg")}>
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
			SVG File
		</button>
		<button type="button" class="spi__tab" class:spi__tab--active={tab === "trace"}
			role="tab" aria-selected={tab === "trace"} onclick={() => (tab = "trace")}>
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
			Trace Image
		</button>
	</div>

	<!-- ─── Content + preview ─── -->
	<div class="spi__body">
		<div class="spi__input">

			{#if tab === "paste"}
				<textarea
					{id}
					class="spi__textarea"
					class:spi__textarea--error={error && !value.trim()}
					bind:value
					rows="6"
					spellcheck="false"
					placeholder={"M 5,5 L 95,5 95,95 5,95 Z\nM 50,5 L 95,80 5,80 Z\nM 15,50 C 15,15 85,15 85,50 C 85,85 15,85 15,50 Z"}
				></textarea>

			{:else if tab === "svg"}
				{#if svgTracing}
					<div class="spi__tracing">
						<span class="spi__spinner" aria-hidden="true"></span>
						<span>Extracting shape…</span>
					</div>
				{:else}
					<label class="spi__drop">
						<input type="file" accept=".svg,image/svg+xml" onchange={handleSVGFile} class="spi__file-input"/>
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
						<span class="spi__drop-label">Click to upload an SVG file</span>
						<span class="spi__drop-sub">SVG shape is rendered and traced to 0–100 coordinates</span>
					</label>
					{#if svgErr}
						<p class="spi__err">{svgErr}</p>
					{/if}
					{#if value && tab === "svg"}
						<p class="spi__success">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
							Shape traced — preview on the right.
						</p>
					{/if}
				{/if}

			{:else}
				<!-- Trace Image -->
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
						<span class="spi__drop-sub">PNG, JPG or WebP — shape traced automatically</span>
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

		<!-- Live SVG preview — always visible -->
		<div class="spi__preview" aria-label="SVG path preview">
			{#if previewPath}
				<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
					<path d={previewPath} fill="rgba(0,229,255,0.08)" stroke="var(--color-brand)" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
			{:else}
				<span class="spi__preview-empty">Preview</span>
			{/if}
		</div>
	</div>

	<!-- Coordinate space note — shown for paste and after trace -->
	<p class="spi__note">
		Coordinates must be in <strong>0–100 normalized space</strong> — the nesting engine scales to real dimensions using your width/height values. Traced images are auto-normalized.
	</p>

	{#if subpathCount > 1}
		<p class="spi__subpath-warn">
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
			This path has <strong>{subpathCount} separate contours</strong>. The cutter will lift the blade between them — verify the shape is intentionally multi-part.
		</p>
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
		gap: 5px;
		padding: 4px 11px;
		font-size: 0.75rem;
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
	.spi__tab--active {
		background: var(--bg-surface);
		color: var(--text-primary);
		box-shadow: 0 1px 3px rgba(0,0,0,0.12);
	}

	/* ─── Body: input + preview ─── */
	.spi__body {
		display: grid;
		grid-template-columns: 1fr 120px;
		gap: 10px;
		align-items: start;
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
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.spi__drop-sub {
		font-size: 0.75rem;
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
		font-size: 0.75rem;
		color: var(--color-danger, #f44);
		margin: 4px 0 0;
		line-height: 1.4;
	}
	.spi__success {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.75rem;
		color: #4ade80;
		margin: 4px 0 0;
	}

	/* ─── Preview ─── */
	.spi__preview {
		aspect-ratio: 1;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-surface-3);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 8px;
		overflow: hidden;
	}
	.spi__preview svg { width: 100%; height: 100%; }
	.spi__preview-empty { font-size: 0.6875rem; color: var(--text-muted); }

	/* ─── Multi-subpath warning ─── */
	.spi__subpath-warn {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		font-size: 0.6875rem;
		color: #fbbf24;
		line-height: 1.5;
		padding: 6px 10px;
		background: color-mix(in srgb, #f59e0b 9%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, #f59e0b 30%, transparent);
		border-radius: var(--radius-md);
		margin: 0;
	}
	.spi__subpath-warn svg { flex-shrink: 0; margin-top: 1px; }

	/* ─── Note ─── */
	.spi__note {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		line-height: 1.5;
		padding: 6px 10px;
		background: color-mix(in srgb, #f59e0b 8%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, #f59e0b 22%, transparent);
		border-radius: var(--radius-md);
		margin: 0;
	}
</style>
