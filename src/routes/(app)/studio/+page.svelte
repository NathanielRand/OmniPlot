<script lang="ts">
	import {
		canvasStore,
		plotterStore,
		toastStore,
		uiStore,
		userStore,
	} from "$lib/stores";
	import { autoNest } from "$lib/utils/nesting";
	import {
		downloadHpgl,
		downloadSvg,
		calcEfficiency,
		estimateCutTime,
	} from "$lib/utils/hpgl";
	import {
		canCut,
		formatDimensions,
		getItemColor,
		uid,
		formatCutTime,
		formatEfficiency,
	} from "$lib/utils";
	import { DEFAULT_MATERIALS, PLOTTER_PRESETS } from "$lib/config";
	import Button from "$lib/components/ui/Button.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import type { CanvasItem } from "$lib/types";

	// ─── Derived metrics ──────────────────────────
	const efficiency = $derived(
		calcEfficiency(canvasStore.items, canvasStore.sheet),
	);
	const cutTimeSecs = $derived(
		estimateCutTime(canvasStore.items, plotterStore.config.cuttingSpeed),
	);
	const overlaps = $derived(canvasStore.items.length); // simplified

	// ─── Active panel tab ─────────────────────────
	let panelTab = $state<"properties" | "patterns" | "plotter">("properties");

	// ─── Canvas interaction ───────────────────────
	let canvasEl = $state<HTMLDivElement | null>(null);
	let cursorX = $state(0);
	let cursorY = $state(0);

	function onCanvasMouseMove(e: MouseEvent) {
		if (!canvasEl) return;
		const rect = canvasEl.getBoundingClientRect();
		const sheetPxW =
			canvasStore.sheet.widthInches * 48 * (canvasStore.zoom / 100);
		const sheetPxH =
			canvasStore.sheet.heightInches * 48 * (canvasStore.zoom / 100);
		const ox = (rect.width - sheetPxW) / 2;
		const oy = (rect.height - sheetPxH) / 2;
		cursorX = Math.max(
			0,
			(e.clientX - rect.left - ox) / (canvasStore.zoom / 100) / 48,
		);
		cursorY = Math.max(
			0,
			(e.clientY - rect.top - oy) / (canvasStore.zoom / 100) / 48,
		);
	}

	function onCanvasClick(e: MouseEvent) {
		if ((e.target as HTMLElement).closest(".cut-item")) return;
		canvasStore.deselect();
	}

	// ─── Actions ──────────────────────────────────
	function handleAutoNest() {
		const nested = autoNest(canvasStore.items, canvasStore.sheet);
		canvasStore.setItems(nested);
		toastStore.success(
			"Auto-nested",
			`${nested.length} pieces · ${formatEfficiency(calcEfficiency(nested, canvasStore.sheet))} efficiency`,
		);
	}

	function handleCut() {
		const user = userStore.user;
		if (user) {
			const check = canCut(user);
			if (!check.allowed) {
				toastStore.warning("Cut limit reached", check.reason);
				uiStore.openPricing();
				return;
			}
		}
		if (!canvasStore.items.length) {
			toastStore.warning(
				"No patterns",
				"Add patterns to the sheet before cutting.",
			);
			return;
		}
		downloadHpgl(canvasStore.state, plotterStore.config, "omniplot-job");
		toastStore.success(
			"Cutting!",
			`Sent ${canvasStore.items.length} paths to plotter.`,
		);
	}

	function handleExport(format: "hpgl" | "svg") {
		if (!canvasStore.items.length) {
			toastStore.warning("Nothing to export", "Add patterns first.");
			return;
		}
		if (format === "hpgl") {
			downloadHpgl(canvasStore.state, plotterStore.config);
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
		const item: CanvasItem = {
			id: uid("item_"),
			patternId: `demo_${idx}`,
			pattern: {
				id: `demo_${idx}`,
				vehicleId: "bmw-m4-2024",
				zone: "hood",
				name: ["Hood Main", "Fender L", "Bumper Front", "Rocker L"][
					idx % 4
				],
				coverage: "full",
				svgPath: "M10,90 Q15,20 50,5 Q85,20 90,90",
				widthInches: 18 - idx * 2,
				heightInches: 12 - idx,
				revision: "2024-11",
				isPublished: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			x: idx * 3 + 0.5,
			y: idx * 1.5 + 0.5,
			width: 18 - idx * 2,
			height: 12 - idx,
			rotation: 0,
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
		canvasStore.setItems([...canvasStore.items, item]);
		canvasStore.select(item.id);
		toastStore.info("Pattern added", item.label);
	}

	// ─── Selected item ────────────────────────────
	const selectedItem = $derived(
		canvasStore.selected.length === 1
			? canvasStore.items.find((i) => i.id === canvasStore.selected[0])
			: null,
	);

	// ─── Zoom shortcuts ───────────────────────────
	let showExport = $state(false);
</script>

<svelte:head>
	<title>Studio — OmniPlot</title>
</svelte:head>

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
		<div class="tool-group">
			<button
				class="tool-btn"
				title="Auto-nest"
				onclick={handleAutoNest}
				aria-label="Auto-nest patterns"
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
					><rect x="2" y="2" width="9" height="11" rx="1" /><rect
						x="13"
						y="2"
						width="9"
						height="7"
						rx="1"
					/><rect x="13" y="13" width="9" height="9" rx="1" /><rect
						x="2"
						y="17"
						width="9"
						height="5"
						rx="1"
					/></svg
				>
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
		<button class="cut-btn" onclick={handleCut}>
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
			{#each [["hpgl", "PLT", "Universal plotter format. Works with any cutter."], ["svg", "SVG", "For FlexiSIGN, Inkscape, Illustrator."]] as const as [fmt, label, desc]}
				<button class="export-option" onclick={() => handleExport(fmt)}>
					<div class="export-option__icon">{label}</div>
					<div>
						<div class="export-option__title">{label} file</div>
						<div class="export-option__desc">{desc}</div>
					</div>
				</button>
			{/each}
		</div>
	{/if}

	<!-- ─── Main area ─── -->
	<div class="studio__body">
		<!-- Canvas -->
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="canvas-area"
			bind:this={canvasEl}
			onmousemove={onCanvasMouseMove}
			onclick={onCanvasClick}
			role="application"
			aria-label="Cut layout canvas"
		>
			{#if canvasStore.state.showGrid}
				<div class="canvas-grid" aria-hidden="true"></div>
				<div class="canvas-grid-major" aria-hidden="true"></div>
			{/if}

			<div
				class="canvas-content"
				style="transform: scale({canvasStore.zoom / 100})"
			>
				<!-- Material sheet -->
				<div
					class="material-sheet"
					style="
            width: {canvasStore.sheet.widthInches * 48}px;
            height: {Math.min(canvasStore.sheet.heightInches, 24) * 48}px;
          "
				>
					<span class="sheet-label"
						>{canvasStore.sheet.name} · {canvasStore.sheet
							.widthInches}" roll</span
					>
					<span class="sheet-dim"
						>{canvasStore.sheet.widthInches}" × {Math.min(
							canvasStore.sheet.heightInches,
							24,
						)}" working area</span
					>

					<!-- Cut items -->
					{#each canvasStore.items as item (item.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							class="cut-item"
							class:selected={canvasStore.selected.includes(
								item.id,
							)}
							style="
                left: {item.x * 48}px;
                top: {item.y * 48}px;
                width: {item.width * 48}px;
                height: {item.height * 48}px;
                transform: rotate({item.rotation}deg);
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
								viewBox="0 0 100 100"
								preserveAspectRatio="none"
								aria-hidden="true"
							>
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
			<div class="panel-tabs" role="tablist">
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
						<div class="prop-label">Cut Settings</div>
						{#each [["Blade force", "bladeForce", 10, 200, "g"], ["Speed mm/s", "cuttingSpeed", 50, 900, ""], ["Passes", "passes", 1, 4, ""], ["Overcut mm", "overcut", 0, 2, ""]] as const as [label, key, min, max, unit]}
							<div class="prop-slider-row">
								<span class="prop-slider-name">{label}</span>
								<input
									type="range"
									class="prop-slider"
									{min}
									{max}
									step={key === "overcut" ? 0.1 : 1}
									value={plotterStore.config[key]}
									aria-label={label}
									oninput={(e) =>
										plotterStore.update({
											[key]: parseFloat(
												(e.target as HTMLInputElement)
													.value,
											),
										})}
								/>
								<span class="prop-slider-val"
									>{plotterStore.config[key]}{unit}</span
								>
							</div>
						{/each}
					</div>

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
								if (mat) canvasStore.setSheet(mat);
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
					</div>
					{#if canvasStore.items.length}
						{#each canvasStore.items as item (item.id)}
							<div
								class="pattern-card"
								class:active={canvasStore.selected.includes(
									item.id,
								)}
								role="button"
								tabindex="0"
								aria-pressed={canvasStore.selected.includes(
									item.id,
								)}
								onclick={() => canvasStore.select(item.id)}
								onkeydown={(e) =>
									e.key === "Enter" &&
									canvasStore.select(item.id)}
							>
								<div
									class="pattern-card__thumb"
									style="border-color: {item.color}20"
								>
									<svg
										width="44"
										height="30"
										viewBox="0 0 100 90"
										aria-hidden="true"
									>
										<path
											d={item.pattern.svgPath}
											fill="none"
											stroke={item.color}
											stroke-width="2"
										/>
									</svg>
								</div>
								<div class="pattern-card__info">
									<div class="pattern-card__name">
										{item.label ?? item.pattern.name}
									</div>
									<div class="pattern-card__meta">
										{item.width.toFixed(1)}" × {item.height.toFixed(
											1,
										)}"
									</div>
								</div>
								<button
									class="pattern-card__del"
									onclick={(e) => {
										e.stopPropagation();
										canvasStore.select(item.id);
										canvasStore.removeSelected();
									}}
									aria-label="Remove {item.label}"
								>
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2.5"
										stroke-linecap="round"
										aria-hidden="true"
										><path d="M18 6L6 18M6 6l12 12" /></svg
									>
								</button>
							</div>
						{/each}
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
					<div class="prop-section">
						<div class="prop-label">Plotter Device</div>
						<select
							class="prop-select"
							aria-label="Plotter preset"
							onchange={(e) => {
								const preset = PLOTTER_PRESETS.find(
									(p) =>
										p.name ===
										(e.target as HTMLSelectElement).value,
								);
								if (preset) plotterStore.applyPreset(preset);
							}}
						>
							{#each PLOTTER_PRESETS as preset}
								<option value={preset.name}
									>{preset.name}</option
								>
							{/each}
						</select>
					</div>

					<div class="prop-section">
						<div class="prop-label">Connection</div>
						<select
							class="prop-select"
							aria-label="Connection method"
							onchange={(e) =>
								plotterStore.update({
									connection: (e.target as HTMLSelectElement)
										.value as any,
								})}
						>
							{#each [["download", "Download PLT file"], ["usb-serial", "USB (Web Serial — Chrome/Edge)"], ["network", "Network (TCP/IP)"], ["cut-agent", "Local Cut Agent"]] as const as [val, label]}
								<option
									value={val}
									selected={plotterStore.config.connection ===
										val}>{label}</option
								>
							{/each}
						</select>
					</div>

					<div class="prop-section">
						<div class="prop-label">Output Format</div>
						<select class="prop-select" aria-label="Output format">
							<option>HPGL (.plt)</option>
							<option>HPGL/2 (.plt)</option>
							<option>SVG vector</option>
							<option>DXF (AutoCAD)</option>
						</select>
					</div>

					{#each [["Scale %", "mediaWidthMm", 90, 110, 0.5], ["Origin X", "originX", 0, 200, 1], ["Origin Y", "originY", 0, 200, 1]] as const as [label, key, min, max, step]}
						<div class="prop-section">
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
											[key]: parseFloat(
												(e.target as HTMLInputElement)
													.value,
											),
										})}
								/>
								<span class="prop-slider-val"
									>{plotterStore.config[key]}</span
								>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</aside>
	</div>

	<!-- ─── Status bar ─── -->
	<div class="studio__statusbar" role="status" aria-label="Job metrics">
		{#each [["Material Usage", formatEfficiency(efficiency), efficiency > 0.65 ? "good" : "warn"], ["Cut Paths", `${canvasStore.items.length}`, ""], ["Est. Cut Time", formatCutTime(cutTimeSecs), ""], ["Sheet", `${canvasStore.sheet.widthInches}" × ${Math.min(canvasStore.sheet.heightInches, 24)}"`, ""], ["Cursor", `${cursorX.toFixed(1)}" , ${cursorY.toFixed(1)}"`, ""]] as const as [label, value, cls]}
			<div class="status-metric">
				<span class="status-metric__label">{label}</span>
				<span
					class="status-metric__value"
					class:good={cls === "good"}
					class:warn={cls === "warn"}>{value}</span
				>
			</div>
		{/each}
	</div>
</div>

<style>
	.studio {
		display: grid;
		grid-template-rows: auto 1fr auto;
		height: 100%;
		overflow: hidden;
		position: relative;
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

	/* ─── Body ────── */
	.studio__body {
		display: grid;
		grid-template-columns: 1fr 280px;
		overflow: hidden;
	}

	/* ─── Canvas ────── */
	.canvas-area {
		position: relative;
		overflow: hidden;
		background: var(--canvas-bg);
		cursor: crosshair;
	}

	.canvas-grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(var(--canvas-grid) 1px, transparent 1px),
			linear-gradient(90deg, var(--canvas-grid) 1px, transparent 1px);
		background-size: 24px 24px;
		pointer-events: none;
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
	}

	.canvas-content {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		transform-origin: center center;
		transition: transform 0.15s var(--ease-smooth);
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

	/* ─── Responsive ────── */
	@media (max-width: 1024px) {
		.studio__body {
			grid-template-columns: 1fr 240px;
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

	:global(.mt-3) {
		margin-top: 12px;
	}
</style>
