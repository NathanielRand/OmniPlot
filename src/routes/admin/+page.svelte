<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { formatRelativeTime } from "$lib/utils";

	// Mock metrics
	const METRICS = [
		{
			label: "Total Users",
			value: "1,284",
			change: "+12%",
			up: true,
			sub: "vs last month",
		},
		{
			label: "Active Today",
			value: "94",
			change: "+8%",
			up: true,
			sub: "unique sessions",
		},
		{
			label: "Cuts Today",
			value: "347",
			change: "+22%",
			up: true,
			sub: "jobs processed",
		},
		{
			label: "MRR",
			value: "$8,430",
			change: "+18%",
			up: true,
			sub: "monthly recurring",
		},
		{
			label: "Free Users",
			value: "891",
			change: "+9%",
			up: true,
			sub: "69% of total",
		},
		{
			label: "Lite Subscribers",
			value: "287",
			change: "+15%",
			up: true,
			sub: "$8,323/mo",
		},
		{
			label: "Pro Subscribers",
			value: "106",
			change: "+31%",
			up: true,
			sub: "$8,374/mo",
		},
		{
			label: "Churn Rate",
			value: "2.1%",
			change: "-0.4%",
			up: true,
			sub: "vs last month",
		},
	];

	const RECENT_USERS = [
		{
			name: "Marcus T.",
			email: "marcus@tbwraps.com",
			tier: "pro",
			joinedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
		},
		{
			name: "Sarah K.",
			email: "sarah@clearshield.com",
			tier: "lite",
			joinedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
		},
		{
			name: "James R.",
			email: "james@proguard.com",
			tier: "pro",
			joinedAt: new Date(Date.now() - 18 * 60 * 60 * 1000),
		},
		{
			name: "Aisha M.",
			email: "aisha@wraplab.co",
			tier: "free",
			joinedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
		},
		{
			name: "Tom B.",
			email: "tom@detailking.com",
			tier: "lite",
			joinedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
		},
	];

	const RECENT_JOBS = [
		{
			user: "marcus@tbwraps.com",
			vehicle: "2024 BMW M4",
			pieces: 5,
			status: "completed",
			ago: "4 min ago",
		},
		{
			user: "sarah@clearshield.com",
			vehicle: "2024 Tesla Model 3",
			pieces: 3,
			status: "completed",
			ago: "18 min ago",
		},
		{
			user: "james@proguard.com",
			vehicle: "2024 Porsche 911 GT3",
			pieces: 10,
			status: "completed",
			ago: "42 min ago",
		},
		{
			user: "aisha@wraplab.co",
			vehicle: "2024 Mercedes G63",
			pieces: 2,
			status: "failed",
			ago: "1h ago",
		},
		{
			user: "tom@detailking.com",
			vehicle: "2024 Ford F-150",
			pieces: 4,
			status: "completed",
			ago: "2h ago",
		},
	];

	const PATTERN_REQUESTS = [
		{ vehicle: "2025 BMW M5", votes: 34, status: "in-progress" },
		{ vehicle: "2025 Mercedes CLE", votes: 28, status: "queued" },
		{ vehicle: "2025 Tesla Model Y", votes: 22, status: "queued" },
		{ vehicle: "2024 Lamborghini Urus", votes: 18, status: "queued" },
	];

	// Sparkline data (fake weekly cuts)
	const SPARKLINE = [120, 145, 132, 178, 201, 189, 347];
	const sparkMax = Math.max(...SPARKLINE);
	const sparkW = 80;
	const sparkH = 24;

	function sparkPoints(data: number[]) {
		return data
			.map((v, i) => {
				const x = (i / (data.length - 1)) * sparkW;
				const y = sparkH - (v / sparkMax) * sparkH;
				return `${x},${y}`;
			})
			.join(" ");
	}
</script>

<svelte:head><title>Admin — OmniPlot</title></svelte:head>

<div class="admin-overview">
	<!-- Page header -->
	<div class="overview-header">
		<div>
			<h1 class="overview-title">Overview</h1>
			<p class="overview-sub">
				Platform health and key metrics at a glance.
			</p>
		</div>
		<div class="header-actions">
			<Badge variant="success" dot>All systems operational</Badge>
		</div>
	</div>

	<!-- Metrics grid -->
	<div class="metrics-grid">
		{#each METRICS as m}
			<div class="metric-card">
				<div class="metric-card__label">{m.label}</div>
				<div class="metric-card__row">
					<div class="metric-card__value">{m.value}</div>
					<div class="metric-card__sparkline" aria-hidden="true">
						<svg
							width={sparkW}
							height={sparkH}
							viewBox="0 0 {sparkW} {sparkH}"
						>
							<polyline
								points={sparkPoints(SPARKLINE)}
								fill="none"
								stroke="var(--color-brand-dim)"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								opacity="0.5"
							/>
						</svg>
					</div>
				</div>
				<div class="metric-card__footer">
					<span
						class="metric-card__change"
						class:up={m.up}
						class:down={!m.up}>{m.change}</span
					>
					<span class="metric-card__sub">{m.sub}</span>
				</div>
			</div>
		{/each}
	</div>

	<!-- Two-column section -->
	<div class="overview-cols">
		<!-- Recent signups -->
		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Recent Signups</h2>
				<a href="/admin/users" class="admin-panel__link">View all →</a>
			</div>
			<table class="mini-table" aria-label="Recent signups">
				<thead>
					<tr>
						<th>User</th>
						<th>Tier</th>
						<th>Joined</th>
					</tr>
				</thead>
				<tbody>
					{#each RECENT_USERS as u}
						<tr>
							<td>
								<div class="user-cell">
									<div class="user-avatar" aria-hidden="true">
										{u.name[0]}
									</div>
									<div>
										<div class="user-name">{u.name}</div>
										<div class="user-email">{u.email}</div>
									</div>
								</div>
							</td>
							<td>
								<Badge
									variant={u.tier === "pro"
										? "pro"
										: u.tier === "lite"
											? "lite"
											: "free"}
									size="sm"
								>
									{u.tier}
								</Badge>
							</td>
							<td class="td-time"
								>{formatRelativeTime(u.joinedAt)}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Recent jobs -->
		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Recent Cut Jobs</h2>
				<a href="/admin/analytics" class="admin-panel__link"
					>View all →</a
				>
			</div>
			<table class="mini-table" aria-label="Recent cut jobs">
				<thead>
					<tr>
						<th>User</th>
						<th>Vehicle</th>
						<th>Status</th>
					</tr>
				</thead>
				<tbody>
					{#each RECENT_JOBS as j}
						<tr>
							<td class="td-email">{j.user.split("@")[0]}</td>
							<td class="td-vehicle">{j.vehicle}</td>
							<td>
								<Badge
									variant={j.status === "completed"
										? "success"
										: "danger"}
									size="sm"
									dot
								>
									{j.status}
								</Badge>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Pattern requests -->
	<div class="admin-panel">
		<div class="admin-panel__header">
			<h2 class="admin-panel__title">Pattern Requests</h2>
			<a href="/admin/patterns" class="admin-panel__link">Manage →</a>
		</div>
		<div class="requests-list">
			{#each PATTERN_REQUESTS as r}
				<div class="request-row">
					<div class="request-vehicle">{r.vehicle}</div>
					<div class="request-votes">
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							aria-hidden="true"
							><path
								d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z"
							/></svg
						>
						{r.votes} votes
					</div>
					<Badge
						variant={r.status === "in-progress"
							? "brand"
							: "default"}
						size="sm"
					>
						{r.status}
					</Badge>
					<button class="request-action">
						{r.status === "in-progress" ? "Mark done" : "Start"}
					</button>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.admin-overview {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 1200px;
	}

	.overview-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.overview-title {
		font-size: 1.375rem;
		margin-bottom: 3px;
	}
	.overview-sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	/* Metrics grid */
	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
	}

	.metric-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		transition: border-color 0.15s;
	}

	.metric-card:hover {
		border-color: var(--border-default);
	}

	.metric-card__label {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-family: var(--font-mono);
	}

	.metric-card__row {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 8px;
	}

	.metric-card__value {
		font-family: var(--font-display);
		font-size: 1.625rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		color: var(--text-primary);
		line-height: 1;
	}

	.metric-card__footer {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.75rem;
	}

	.metric-card__change {
		font-weight: 600;
		font-family: var(--font-mono);
	}
	.metric-card__change.up {
		color: var(--color-success);
	}
	.metric-card__change.down {
		color: var(--color-danger);
	}
	.metric-card__sub {
		color: var(--text-tertiary);
	}

	/* Two-col */
	.overview-cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	/* Panels */
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

	.admin-panel__title {
		font-size: 0.9375rem;
		font-weight: 600;
	}
	.admin-panel__link {
		font-size: 0.8125rem;
		color: var(--text-brand);
		text-decoration: none;
	}
	.admin-panel__link:hover {
		text-decoration: underline;
	}

	/* Mini table */
	.mini-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.mini-table thead {
		background: var(--bg-surface-2);
	}

	.mini-table th {
		padding: 8px 16px;
		text-align: left;
		font-size: 0.625rem;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.mini-table tbody tr {
		border-top: 1px solid var(--border-subtle);
	}
	.mini-table tbody tr:hover {
		background: var(--interactive-hover);
	}
	.mini-table td {
		padding: 10px 16px;
		vertical-align: middle;
	}

	.user-cell {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.user-avatar {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-brand-dim), #7b5ea7);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-size: 0.625rem;
		font-weight: 700;
		color: #fff;
		flex-shrink: 0;
	}

	.user-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-primary);
	}
	.user-email {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
	}

	.td-time {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}
	.td-email {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-secondary);
	}
	.td-vehicle {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	/* Pattern requests */
	.requests-list {
		padding: 4px 0;
	}

	.request-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border-top: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}

	.request-row:first-child {
		border-top: none;
	}
	.request-row:hover {
		background: var(--interactive-hover);
	}

	.request-vehicle {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
		flex: 1;
	}

	.request-votes {
		display: flex;
		align-items: center;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.request-action {
		padding: 4px 10px;
		font-size: 0.75rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
		white-space: nowrap;
	}

	.request-action:hover {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}

	/* Responsive */
	@media (max-width: 1024px) {
		.metrics-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 768px) {
		.admin-overview {
			padding: 16px;
		}
		.metrics-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.overview-cols {
			grid-template-columns: 1fr;
		}
	}
</style>
