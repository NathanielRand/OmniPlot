<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { formatDate, formatRelativeTime } from "$lib/utils";

	type Tier = "free" | "lite" | "pro" | "admin";

	interface User {
		id: string;
		name: string;
		email: string;
		tier: Tier;
		cutsTotal: number;
		joinedAt: Date;
		lastActiveAt: Date;
		shopName?: string;
		status: "active" | "suspended";
	}

	const USERS: User[] = [
		{
			id: "u1",
			name: "Marcus T.",
			email: "marcus@tbwraps.com",
			tier: "pro",
			cutsTotal: 892,
			joinedAt: new Date("2024-08-12"),
			lastActiveAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
			shopName: "Tampa Bay Wraps",
			status: "active",
		},
		{
			id: "u2",
			name: "Sarah K.",
			email: "sarah@clearshield.com",
			tier: "lite",
			cutsTotal: 231,
			joinedAt: new Date("2024-09-03"),
			lastActiveAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
			shopName: "ClearShield PDX",
			status: "active",
		},
		{
			id: "u3",
			name: "James R.",
			email: "james@proguard.com",
			tier: "pro",
			cutsTotal: 1204,
			joinedAt: new Date("2024-07-22"),
			lastActiveAt: new Date(Date.now() - 18 * 60 * 60 * 1000),
			shopName: "ProGuard Miami",
			status: "active",
		},
		{
			id: "u4",
			name: "Aisha M.",
			email: "aisha@wraplab.co",
			tier: "free",
			cutsTotal: 1,
			joinedAt: new Date("2024-12-01"),
			lastActiveAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
			shopName: "WrapLab Co",
			status: "active",
		},
		{
			id: "u5",
			name: "Tom B.",
			email: "tom@detailking.com",
			tier: "lite",
			cutsTotal: 88,
			joinedAt: new Date("2024-10-14"),
			lastActiveAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
			shopName: "Detail King",
			status: "active",
		},
		{
			id: "u6",
			name: "Chris W.",
			email: "chris@slickcoat.io",
			tier: "pro",
			cutsTotal: 440,
			joinedAt: new Date("2024-08-30"),
			lastActiveAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
			shopName: "SlickCoat Studio",
			status: "active",
		},
		{
			id: "u7",
			name: "Dana L.",
			email: "dana@nanoguard.com",
			tier: "lite",
			cutsTotal: 52,
			joinedAt: new Date("2024-11-05"),
			lastActiveAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
			shopName: "NanoGuard Auto",
			status: "suspended",
		},
		{
			id: "u8",
			name: "Raj P.",
			email: "raj@elitefilm.com",
			tier: "free",
			cutsTotal: 0,
			joinedAt: new Date("2024-12-15"),
			lastActiveAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
			shopName: "Elite Film Works",
			status: "active",
		},
	];

	let search = $state("");
	let filterTier = $state<"all" | Tier>("all");
	let selectedIds = $state<Set<string>>(new Set());

	const filtered = $derived(
		USERS.filter((u) => {
			const q = search.toLowerCase();
			const mq =
				!q ||
				u.name.toLowerCase().includes(q) ||
				u.email.toLowerCase().includes(q) ||
				(u.shopName ?? "").toLowerCase().includes(q);
			const mt = filterTier === "all" || u.tier === filterTier;
			return mq && mt;
		}),
	);

	function toggleSelect(id: string) {
		const s = new Set(selectedIds);
		s.has(id) ? s.delete(id) : s.add(id);
		selectedIds = s;
	}

	const tierCounts = $derived(
		USERS.reduce(
			(acc, u) => {
				acc[u.tier] = (acc[u.tier] ?? 0) + 1;
				return acc;
			},
			{} as Record<Tier, number>,
		),
	);
</script>

<svelte:head><title>Users — Admin — OmniPlot</title></svelte:head>

<div class="admin-users">
	<div class="page-header">
		<div>
			<h1 class="page-title">Users</h1>
			<p class="page-sub">{USERS.length} total accounts</p>
		</div>
		<Button variant="primary" size="sm">
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg
			>
			Invite user
		</Button>
	</div>

	<!-- Tier tabs -->
	<div class="tier-tabs" role="tablist">
		{#each ["all", "free", "lite", "pro"] as const as t}
			<button
				class="tier-tab"
				class:active={filterTier === t}
				onclick={() => (filterTier = t)}
				role="tab"
				aria-selected={filterTier === t}
			>
				{t.charAt(0).toUpperCase() + t.slice(1)}
				<span class="tier-tab__count">
					{t === "all" ? USERS.length : (tierCounts[t] ?? 0)}
				</span>
			</button>
		{/each}
	</div>

	<!-- Search -->
	<div class="toolbar">
		<div class="search-wrap">
			<svg
				class="search-icon"
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				aria-hidden="true"
				><circle cx="11" cy="11" r="8" /><path
					d="M21 21l-4.35-4.35"
				/></svg
			>
			<input
				type="search"
				class="search-input"
				placeholder="Search users…"
				bind:value={search}
				aria-label="Search users"
			/>
		</div>
		{#if selectedIds.size > 0}
			<div class="bulk-bar">
				<span>{selectedIds.size} selected</span>
				<button
					class="bulk-btn"
					onclick={() => (selectedIds = new Set())}>Clear</button
				>
				<button class="bulk-btn">Change tier</button>
				<button class="bulk-btn bulk-btn--danger">Suspend</button>
			</div>
		{/if}
	</div>

	<!-- Table -->
	<div class="table-wrap">
		<table class="users-table" aria-label="Users">
			<thead>
				<tr>
					<th class="th-check">
						<input
							type="checkbox"
							aria-label="Select all"
							onchange={(e) =>
								(selectedIds = (e.target as HTMLInputElement)
									.checked
									? new Set(filtered.map((u) => u.id))
									: new Set())}
						/>
					</th>
					<th>User</th>
					<th>Shop</th>
					<th>Tier</th>
					<th>Cuts</th>
					<th>Status</th>
					<th>Joined</th>
					<th>Last active</th>
					<th class="th-actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as user (user.id)}
					<tr class:row-selected={selectedIds.has(user.id)}>
						<td class="td-check">
							<input
								type="checkbox"
								class="row-check"
								checked={selectedIds.has(user.id)}
								onchange={() => toggleSelect(user.id)}
								aria-label="Select {user.name}"
							/>
						</td>
						<td>
							<div class="user-cell">
								<div
									class="user-avatar"
									aria-hidden="true"
									style="background: linear-gradient(135deg, {user.tier ===
									'pro'
										? '#0070FF'
										: '#7B5EA7'}, {user.tier === 'pro'
										? '#00E5FF'
										: '#A78BFA'})"
								>
									{user.name[0]}
								</div>
								<div>
									<div class="user-name">{user.name}</div>
									<div class="user-email">{user.email}</div>
								</div>
							</div>
						</td>
						<td class="td-shop">{user.shopName ?? "—"}</td>
						<td>
							<Badge
								variant={user.tier === "pro"
									? "pro"
									: user.tier === "lite"
										? "lite"
										: "free"}
								size="sm"
							>
								{user.tier}
							</Badge>
						</td>
						<td class="td-mono"
							>{user.cutsTotal.toLocaleString()}</td
						>
						<td>
							<Badge
								variant={user.status === "active"
									? "success"
									: "danger"}
								dot
								size="sm"
							>
								{user.status}
							</Badge>
						</td>
						<td class="td-date">{formatDate(user.joinedAt)}</td>
						<td class="td-date"
							>{formatRelativeTime(user.lastActiveAt)}</td
						>
						<td class="td-actions">
							<div class="row-actions">
								<button
									class="row-btn"
									title="View user"
									aria-label="View {user.name}"
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										aria-hidden="true"
										><path
											d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
										/><circle cx="12" cy="12" r="3" /></svg
									>
								</button>
								<button
									class="row-btn"
									title="Edit tier"
									aria-label="Edit {user.name}"
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										aria-hidden="true"
										><path
											d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
										/><path
											d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
										/></svg
									>
								</button>
								<button
									class="row-btn row-btn--danger"
									title="Suspend"
									aria-label="Suspend {user.name}"
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										aria-hidden="true"
										><circle cx="12" cy="12" r="10" /><path
											d="M4.93 4.93l14.14 14.14"
										/></svg
									>
								</button>
							</div>
						</td>
					</tr>
				{/each}
				{#if filtered.length === 0}
					<tr
						><td colspan="9" class="td-empty"
							>No users match your search.</td
						></tr
					>
				{/if}
			</tbody>
		</table>
	</div>
</div>

<style>
	.admin-users {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.page-title {
		font-size: 1.375rem;
		margin-bottom: 3px;
	}
	.page-sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	.tier-tabs {
		display: flex;
		gap: 2px;
		border-bottom: 1px solid var(--border-subtle);
	}

	.tier-tab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		transition:
			color 0.12s,
			border-color 0.12s;
		margin-bottom: -1px;
	}

	.tier-tab:hover {
		color: var(--text-primary);
	}
	.tier-tab.active {
		color: var(--text-primary);
		border-bottom-color: var(--color-brand-dim);
	}

	.tier-tab__count {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		background: var(--bg-surface-3);
		padding: 1px 5px;
		border-radius: 3px;
		color: var(--text-tertiary);
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.search-wrap {
		position: relative;
		max-width: 280px;
		width: 100%;
	}
	.search-icon {
		position: absolute;
		left: 9px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-tertiary);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 7px 10px 7px 30px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
	}
	.search-input:focus {
		border-color: var(--color-brand-dim);
	}
	.search-input::placeholder {
		color: var(--text-tertiary);
	}

	.bulk-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.bulk-btn {
		padding: 5px 10px;
		font-size: 0.75rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
	}
	.bulk-btn:hover {
		background: var(--bg-surface-3);
	}
	.bulk-btn--danger {
		color: var(--color-danger);
		border-color: rgba(255, 77, 109, 0.2);
	}
	.bulk-btn--danger:hover {
		background: rgba(255, 77, 109, 0.06);
	}

	.table-wrap {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		overflow: hidden;
		overflow-x: auto;
	}

	.users-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
		min-width: 900px;
	}

	.users-table thead {
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
	}

	.users-table th {
		padding: 10px 14px;
		text-align: left;
		font-size: 0.625rem;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		white-space: nowrap;
	}

	.users-table tbody tr {
		border-bottom: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}
	.users-table tbody tr:last-child {
		border-bottom: none;
	}
	.users-table tbody tr:hover {
		background: var(--interactive-hover);
	}
	.row-selected {
		background: rgba(0, 112, 255, 0.04) !important;
	}

	.users-table td {
		padding: 10px 14px;
		vertical-align: middle;
	}

	.th-check,
	.td-check {
		width: 40px;
		padding-left: 16px;
	}
	.th-actions {
		width: 100px;
	}

	.row-check {
		accent-color: var(--color-brand-dim);
		width: 14px;
		height: 14px;
		cursor: pointer;
	}

	.user-cell {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.user-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-size: 0.6875rem;
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

	.td-shop {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.td-mono {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}
	.td-date {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.row-actions {
		display: flex;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.12s;
	}
	tr:hover .row-actions {
		opacity: 1;
	}

	.row-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
	}
	.row-btn:hover {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}
	.row-btn--danger:hover {
		background: rgba(255, 77, 109, 0.1);
		color: var(--color-danger);
		border-color: rgba(255, 77, 109, 0.2);
	}

	.td-empty {
		text-align: center;
		padding: 40px;
		color: var(--text-tertiary);
	}
</style>
