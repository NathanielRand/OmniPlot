<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";

	type Range = "7d" | "30d" | "90d" | "ytd";

	let range = $state<Range>("30d");

	// ── Synthetic time-series data ──────────────────────────
	const SERIES: Record<Range, number[]> = {
		"7d":  [189, 220, 198, 241, 267, 312, 347],
		"30d": [88, 95, 102, 112, 98, 120, 135, 141, 155, 148, 162, 170, 158, 172, 180, 195, 188, 201, 215, 222, 210, 228, 241, 255, 248, 262, 278, 289, 301, 347],
		"90d": Array.from({ length: 90 }, (_, i) => Math.round(80 + i * 2.8 + Math.sin(i / 7) * 20)),
		"ytd": Array.from({ length: 135 }, (_, i) => Math.round(60 + i * 2.2 + Math.cos(i / 10) * 15)),
	};

	const RANGE_LABELS: Record<Range, string> = {
		"7d": "Last 7 days",
		"30d": "Last 30 days",
		"90d": "Last 90 days",
		"ytd": "Year to date",
	};

	const series = $derived(SERIES[range]);
	const seriesMax = $derived(Math.max(...series));

	// Chart dimensions
	const CW = 540;
	const CH = 80;

	function polyPoints(data: number[]) {
		return data
			.map((v, i) => {
				const x = (i / (data.length - 1)) * CW;
				const y = CH - (v / seriesMax) * CH * 0.9 - CH * 0.05;
				return `${x},${y}`;
			})
			.join(" ");
	}

	function areaPoints(data: number[]) {
		const pts = data.map((v, i) => {
			const x = (i / (data.length - 1)) * CW;
			const y = CH - (v / seriesMax) * CH * 0.9 - CH * 0.05;
			return `${x},${y}`;
		});
		return `0,${CH} ${pts.join(" ")} ${CW},${CH}`;
	}

	// ── Metrics ──────────────────────────────────────────────
	const METRICS: Record<Range, { cuts: string; users: string; signups: string; mrr: string }> = {
		"7d":  { cuts: "1,874", users: "94",   signups: "23",  mrr: "$8,430" },
		"30d": { cuts: "6,284", users: "412",  signups: "118", mrr: "$8,430" },
		"90d": { cuts: "17,921", users: "840",  signups: "341", mrr: "$8,430" },
		"ytd": { cuts: "31,440", users: "1,284", signups: "502", mrr: "$8,430" },
	};

	const metrics = $derived(METRICS[range]);

	// ── Top vehicles ─────────────────────────────────────────
	const TOP_VEHICLES = [
		{ name: "2024 BMW M4",          cuts: 892,  pct: 100 },
		{ name: "2024 Tesla Model 3",    cuts: 741,  pct: 83  },
		{ name: "2024 Porsche 911 GT3",  cuts: 620,  pct: 70  },
		{ name: "2024 Ford F-150",       cuts: 511,  pct: 57  },
		{ name: "2024 Mercedes G63 AMG", cuts: 478,  pct: 54  },
		{ name: "2024 Toyota GR86",      cuts: 389,  pct: 44  },
	];

	// ── Recent jobs ──────────────────────────────────────────
	const JOBS = [
		{ user: "marcus@tbwraps.com",     vehicle: "2024 BMW M4",          pieces: 5,  status: "completed", ago: "4 min" },
		{ user: "sarah@clearshield.com",  vehicle: "2024 Tesla Model 3",   pieces: 3,  status: "completed", ago: "18 min" },
		{ user: "james@proguard.com",     vehicle: "2024 Porsche 911 GT3", pieces: 10, status: "completed", ago: "42 min" },
		{ user: "aisha@wraplab.co",       vehicle: "2024 Mercedes G63",    pieces: 2,  status: "failed",    ago: "1h" },
		{ user: "tom@detailking.com",     vehicle: "2024 Ford F-150",      pieces: 4,  status: "completed", ago: "2h" },
		{ user: "chris@slickcoat.io",     vehicle: "2024 Audi RS6",        pieces: 6,  status: "completed", ago: "3h" },
		{ user: "dana@nanoguard.com",     vehicle: "2024 BMW M4",          pieces: 3,  status: "completed", ago: "4h" },
		{ user: "raj@elitefilm.com",      vehicle: "2024 Toyota GR86",     pieces: 7,  status: "completed", ago: "5h" },
	];

	// ── Tier distribution ────────────────────────────────────
	const TIERS = [
		{ label: "Free",  count: 891,  pct: 69, color: "var(--text-tertiary)" },
		{ label: "Lite",  count: 287,  pct: 22, color: "#a78bfa" },
		{ label: "Pro",   count: 106,  pct: 9,  color: "#60a5ff" },
	];
</script>

<svelte:head><title>Analytics — Admin — OmniPlot</title></svelte:head>

<div class="analytics-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Analytics</h1>
			<p class="page-sub">Usage, revenue, and growth metrics.</p>
		</div>
		<div class="range-tabs" role="group" aria-label="Date range">
			{#each (["7d", "30d", "90d", "ytd"] as Range[]) as r}
				<button
					class="range-tab"
					class:active={range === r}
					onclick={() => (range = r)}
				>
					{RANGE_LABELS[r]}
				</button>
			{/each}
		</div>
	</div>

	<!-- KPI row -->
	<div class="kpi-row">
		{#each [
			{ label: "Cut jobs",      value: metrics.cuts,    change: "+22%", up: true },
			{ label: "Active users",  value: metrics.users,   change: "+8%",  up: true },
			{ label: "New signups",   value: metrics.signups, change: "+15%", up: true },
			{ label: "MRR",           value: metrics.mrr,     change: "+18%", up: true },
		] as kpi}
			<div class="kpi-card">
				<div class="kpi-label">{kpi.label}</div>
				<div class="kpi-value">{kpi.value}</div>
				<div class="kpi-change" class:up={kpi.up} class:down={!kpi.up}>{kpi.change} vs prior period</div>
			</div>
		{/each}
	</div>

	<!-- Chart + tier breakdown -->
	<div class="chart-row">
		<div class="admin-panel chart-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Cut jobs — {RANGE_LABELS[range]}</h2>
				<span class="chart-peak">{seriesMax.toLocaleString()} peak</span>
			</div>
			<div class="chart-body">
				<svg
					class="area-chart"
					viewBox="0 0 {CW} {CH}"
					preserveAspectRatio="none"
					aria-label="Cut jobs chart"
					role="img"
				>
					<defs>
						<linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="var(--color-brand-dim)" stop-opacity="0.25"/>
							<stop offset="100%" stop-color="var(--color-brand-dim)" stop-opacity="0"/>
						</linearGradient>
					</defs>
					<polygon points={areaPoints(series)} fill="url(#area-grad)" />
					<polyline
						points={polyPoints(series)}
						fill="none"
						stroke="var(--color-brand-dim)"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<div class="chart-labels">
					{#if range === "7d"}
						{#each ["6d ago", "5d ago", "4d ago", "3d ago", "2d ago", "Yesterday", "Today"] as label}
							<span>{label}</span>
						{/each}
					{:else if range === "30d"}
						{#each ["30d ago", "25d ago", "20d ago", "15d ago", "10d ago", "5d ago", "Today"] as label}
							<span>{label}</span>
						{/each}
					{:else}
						<span>Start</span>
						<span>Mid</span>
						<span>Today</span>
					{/if}
				</div>
			</div>
		</div>

		<div class="admin-panel tier-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Tier distribution</h2>
				<span class="chart-peak">1,284 total</span>
			</div>
			<div class="tier-body">
				{#each TIERS as t}
					<div class="tier-row">
						<div class="tier-label">{t.label}</div>
						<div class="tier-bar-wrap">
							<div class="tier-bar" style="width: {t.pct}%; background: {t.color}; opacity: 0.7"></div>
						</div>
						<div class="tier-count" style="color: {t.color}">{t.count}</div>
						<div class="tier-pct">{t.pct}%</div>
					</div>
				{/each}
				<div class="tier-donut" aria-hidden="true">
					<svg viewBox="0 0 36 36" width="90" height="90">
						<!-- Free -->
						<circle cx="18" cy="18" r="15.9" fill="transparent" stroke="var(--bg-surface-3)" stroke-width="3.2"/>
						<circle cx="18" cy="18" r="15.9" fill="transparent"
							stroke="var(--text-tertiary)" stroke-width="3.2" stroke-opacity="0.6"
							stroke-dasharray="69 31"
							stroke-dashoffset="25"
							stroke-linecap="round"/>
						<!-- Lite -->
						<circle cx="18" cy="18" r="15.9" fill="transparent"
							stroke="#a78bfa" stroke-width="3.2" stroke-opacity="0.7"
							stroke-dasharray="22 78"
							stroke-dashoffset="-44"
							stroke-linecap="round"/>
						<!-- Pro -->
						<circle cx="18" cy="18" r="15.9" fill="transparent"
							stroke="#60a5ff" stroke-width="3.2" stroke-opacity="0.8"
							stroke-dasharray="9 91"
							stroke-dashoffset="-66"
							stroke-linecap="round"/>
					</svg>
				</div>
			</div>
		</div>
	</div>

	<!-- Two columns: top vehicles + recent jobs -->
	<div class="bottom-row">
		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Top vehicles</h2>
				<span class="chart-peak">by cut count</span>
			</div>
			<div class="vehicles-list">
				{#each TOP_VEHICLES as v, i}
					<div class="vehicle-row">
						<span class="vehicle-rank">{i + 1}</span>
						<div class="vehicle-info">
							<div class="vehicle-name">{v.name}</div>
							<div class="vehicle-bar-wrap">
								<div class="vehicle-bar" style="width: {v.pct}%"></div>
							</div>
						</div>
						<span class="vehicle-cuts">{v.cuts.toLocaleString()}</span>
					</div>
				{/each}
			</div>
		</div>

		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Recent cut jobs</h2>
			</div>
			<table class="mini-table" aria-label="Recent cut jobs">
				<thead>
					<tr>
						<th>User</th>
						<th>Vehicle</th>
						<th>Pcs</th>
						<th>Status</th>
						<th>Ago</th>
					</tr>
				</thead>
				<tbody>
					{#each JOBS as j}
						<tr>
							<td class="td-user">{j.user.split("@")[0]}</td>
							<td class="td-vehicle">{j.vehicle}</td>
							<td class="td-mono">{j.pieces}</td>
							<td>
								<Badge variant={j.status === "completed" ? "success" : "danger"} size="sm" dot>
									{j.status}
								</Badge>
							</td>
							<td class="td-time">{j.ago}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>

<style>
	.analytics-page {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 1200px;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.page-title { font-size: 1.375rem; margin-bottom: 3px; }
	.page-sub   { font-size: 0.875rem; color: var(--text-secondary); }

	.range-tabs {
		display: flex;
		gap: 2px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 3px;
	}

	.range-tab {
		padding: 5px 12px;
		font-size: 0.75rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.12s;
	}
	.range-tab:hover  { color: var(--text-primary); }
	.range-tab.active { background: var(--bg-surface-3); color: var(--text-primary); }

	/* KPI row */
	.kpi-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
	}

	.kpi-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		transition: border-color 0.15s;
	}
	.kpi-card:hover { border-color: var(--border-default); }

	.kpi-label {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-family: var(--font-mono);
	}

	.kpi-value {
		font-family: var(--font-display);
		font-size: 1.625rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		color: var(--text-primary);
		line-height: 1.1;
	}

	.kpi-change {
		font-size: 0.75rem;
		font-family: var(--font-mono);
	}
	.kpi-change.up   { color: var(--color-success); }
	.kpi-change.down { color: var(--color-danger); }

	/* Chart + tier row */
	.chart-row {
		display: grid;
		grid-template-columns: 1fr 320px;
		gap: 16px;
	}

	.admin-panel {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		overflow: hidden;
	}

	.admin-panel__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border-subtle);
	}

	.admin-panel__title { font-size: 0.9375rem; font-weight: 600; }

	.chart-peak {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
	}

	.chart-body {
		padding: 16px;
	}

	.area-chart {
		width: 100%;
		height: 80px;
		display: block;
	}

	.chart-labels {
		display: flex;
		justify-content: space-between;
		margin-top: 8px;
		font-size: 0.625rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
	}

	/* Tier panel */
	.tier-body {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		align-items: center;
	}

	.tier-row {
		display: grid;
		grid-template-columns: 36px 1fr 44px 36px;
		align-items: center;
		gap: 8px;
		width: 100%;
	}

	.tier-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.tier-bar-wrap {
		height: 6px;
		background: var(--bg-surface-3);
		border-radius: 3px;
		overflow: hidden;
	}

	.tier-bar {
		height: 100%;
		border-radius: 3px;
		transition: width 0.4s var(--ease-smooth);
	}

	.tier-count {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		text-align: right;
	}

	.tier-pct {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-align: right;
	}

	.tier-donut {
		margin-top: 4px;
	}

	/* Bottom row */
	.bottom-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	.vehicles-list {
		padding: 8px 0;
	}

	.vehicle-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-top: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}
	.vehicle-row:first-child { border-top: none; }
	.vehicle-row:hover { background: var(--interactive-hover); }

	.vehicle-rank {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
		width: 16px;
		text-align: center;
		flex-shrink: 0;
	}

	.vehicle-info { flex: 1; min-width: 0; }

	.vehicle-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-primary);
		margin-bottom: 5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.vehicle-bar-wrap {
		height: 3px;
		background: var(--bg-surface-3);
		border-radius: 2px;
		overflow: hidden;
	}

	.vehicle-bar {
		height: 100%;
		background: var(--color-brand-dim);
		opacity: 0.6;
		border-radius: 2px;
	}

	.vehicle-cuts {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	/* Mini table */
	.mini-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.mini-table thead { background: var(--bg-surface-2); }

	.mini-table th {
		padding: 8px 14px;
		text-align: left;
		font-size: 0.625rem;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		border-bottom: 1px solid var(--border-subtle);
	}

	.mini-table tbody tr {
		border-top: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}
	.mini-table tbody tr:hover { background: var(--interactive-hover); }
	.mini-table td { padding: 9px 14px; vertical-align: middle; }

	.td-user    { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-secondary); }
	.td-vehicle { font-size: 0.8125rem; color: var(--text-secondary); white-space: nowrap; }
	.td-mono    { font-family: var(--font-mono); font-size: 0.8125rem; }
	.td-time    { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap; }

	@media (max-width: 1100px) {
		.chart-row  { grid-template-columns: 1fr; }
		.bottom-row { grid-template-columns: 1fr; }
	}
	@media (max-width: 900px) {
		.kpi-row { grid-template-columns: repeat(2, 1fr); }
	}
</style>
