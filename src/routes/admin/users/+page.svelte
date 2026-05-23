<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { formatDate, formatRelativeTime } from "$lib/utils";
	import { auth } from "$lib/firebase/client";
	import { onMount } from "svelte";
	import { toastStore } from "$lib/stores";

	type Tier   = "free" | "lite" | "pro" | "admin";
	type Status = "active" | "suspended";

	interface AdminUser {
		uid:          string;
		displayName:  string;
		email:        string;
		phone:        string | null;
		tier:         Tier;
		status:       Status;
		shopId:       string | null;
		shopName:     string | null;
		cutsTotal:    number;
		createdAt:    string | null;
		lastActiveAt: string | null;
	}

	// ── State ──────────────────────────────────────
	let users       = $state<AdminUser[]>([]);
	let loading     = $state(true);
	let error       = $state<string | null>(null);
	let search      = $state("");
	let filterTier  = $state<"all" | Tier>("all");
	let selectedIds = $state<Set<string>>(new Set());

	// Tier change modal
	let editUser    = $state<AdminUser | null>(null);
	let editTier    = $state<Tier>("free");
	let saving      = $state(false);

	// ── Load ───────────────────────────────────────
	async function loadUsers() {
		loading = true;
		error   = null;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res   = await fetch("/api/admin/users", {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (!res.ok) throw new Error("Failed to load users");
			const data = await res.json();
			users = data.users;
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not load users";
		} finally {
			loading = false;
		}
	}

	onMount(loadUsers);

	// ── Derived ────────────────────────────────────
	const filtered = $derived(
		users.filter((u) => {
			const q  = search.toLowerCase();
			const mq = !q || u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.shopName ?? "").toLowerCase().includes(q);
			const mt = filterTier === "all" || u.tier === filterTier;
			return mq && mt;
		}),
	);

	const tierCounts = $derived(
		users.reduce((acc, u) => {
			acc[u.tier] = (acc[u.tier] ?? 0) + 1;
			return acc;
		}, {} as Record<Tier, number>),
	);

	function toggleSelect(id: string) {
		const s = new Set(selectedIds);
		s.has(id) ? s.delete(id) : s.add(id);
		selectedIds = s;
	}

	// ── Tier change ────────────────────────────────
	function openEdit(user: AdminUser) {
		editUser = user;
		editTier = user.tier;
	}

	async function saveTier() {
		if (!editUser) return;
		saving = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res   = await fetch("/api/admin/users", {
				method:  "PATCH",
				headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body:    JSON.stringify({ uid: editUser.uid, tier: editTier }),
			});
			if (!res.ok) throw new Error("Save failed");
			// Update local state immediately
			users = users.map((u) => u.uid === editUser!.uid ? { ...u, tier: editTier } : u);
			toastStore.success("Tier updated", `${editUser.displayName || editUser.email} → ${editTier}`);
			editUser = null;
		} catch (e) {
			toastStore.error("Save failed", e instanceof Error ? e.message : "");
		} finally {
			saving = false;
		}
	}

	// ── Suspend / unsuspend ────────────────────────
	async function toggleSuspend(user: AdminUser) {
		const newStatus: Status = user.status === "suspended" ? "active" : "suspended";
		try {
			const token = await auth.currentUser?.getIdToken();
			const res   = await fetch("/api/admin/users", {
				method:  "PATCH",
				headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body:    JSON.stringify({ uid: user.uid, status: newStatus }),
			});
			if (!res.ok) throw new Error("Failed");
			users = users.map((u) => u.uid === user.uid ? { ...u, status: newStatus } : u);
			toastStore.success(newStatus === "suspended" ? "User suspended" : "User reactivated", user.email);
		} catch {
			toastStore.error("Action failed", "Could not update user status");
		}
	}

	const TIERS: Tier[] = ["free", "lite", "pro", "admin"];
</script>

<svelte:head><title>Users — Admin — OmniPlot</title></svelte:head>

<!-- Tier change modal -->
{#if editUser}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (editUser = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal__header">
				<h3 class="modal__title">Change tier</h3>
				<button class="modal__close" onclick={() => (editUser = null)} aria-label="Close">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
				</button>
			</div>
			<div class="modal__body">
				<p class="modal__user">{editUser.displayName || editUser.email}</p>
				<div class="tier-options">
					{#each TIERS as t}
						<button
							class="tier-option"
							class:selected={editTier === t}
							onclick={() => (editTier = t)}
						>
							<Badge variant={t === "pro" ? "pro" : t === "lite" ? "lite" : t === "admin" ? "info" : "free"} size="sm">{t}</Badge>
						</button>
					{/each}
				</div>
			</div>
			<div class="modal__footer">
				<button class="modal-btn modal-btn--cancel" onclick={() => (editUser = null)}>Cancel</button>
				<button class="modal-btn modal-btn--save" onclick={saveTier} disabled={saving || editTier === editUser.tier}>
					{saving ? "Saving…" : "Save"}
				</button>
			</div>
		</div>
	</div>
{/if}

<div class="admin-users">
	<div class="page-header">
		<div>
			<h1 class="page-title">Users</h1>
			<p class="page-sub">
				{loading ? "Loading…" : error ? "—" : `${users.length.toLocaleString()} total accounts`}
			</p>
		</div>
	</div>

	<!-- Tier tabs -->
	<div class="tier-tabs" role="tablist">
		{#each (["all", "free", "lite", "pro", "admin"] as const) as t}
			<button
				class="tier-tab"
				class:active={filterTier === t}
				onclick={() => (filterTier = t)}
				role="tab"
				aria-selected={filterTier === t}
			>
				{t.charAt(0).toUpperCase() + t.slice(1)}
				<span class="tier-tab__count">
					{t === "all" ? users.length : (tierCounts[t as Tier] ?? 0)}
				</span>
			</button>
		{/each}
	</div>

	<!-- Search -->
	<div class="toolbar">
		<div class="search-wrap">
			<svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
			</svg>
			<input type="search" class="search-input" placeholder="Search users…" bind:value={search} aria-label="Search users" />
		</div>
		{#if selectedIds.size > 0}
			<div class="bulk-bar">
				<span>{selectedIds.size} selected</span>
				<button class="bulk-btn" onclick={() => (selectedIds = new Set())}>Clear</button>
			</div>
		{/if}
	</div>

	<!-- Table -->
	{#if loading}
		<div class="table-skeleton">
			{#each { length: 6 } as _}
				<div class="table-skel-row">
					<div class="skel skel--avatar"></div>
					<div class="skel skel--name"></div>
					<div class="skel skel--badge"></div>
					<div class="skel skel--date"></div>
				</div>
			{/each}
		</div>
	{:else if error}
		<div class="table-error">
			<p>{error}</p>
			<button class="retry-btn" onclick={loadUsers}>Retry</button>
		</div>
	{:else}
		<div class="table-wrap">
			<table class="users-table" aria-label="Users">
				<thead>
					<tr>
						<th class="th-check">
							<input
								type="checkbox"
								aria-label="Select all"
								onchange={(e) =>
									(selectedIds = (e.target as HTMLInputElement).checked
										? new Set(filtered.map((u) => u.uid))
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
					{#each filtered as user (user.uid)}
						<tr class:row-selected={selectedIds.has(user.uid)}>
							<td class="td-check">
								<input
									type="checkbox"
									class="row-check"
									checked={selectedIds.has(user.uid)}
									onchange={() => toggleSelect(user.uid)}
									aria-label="Select {user.displayName || user.email}"
								/>
							</td>
							<td>
								<div class="user-cell">
									<div class="user-avatar" aria-hidden="true"
										style="background: linear-gradient(135deg, {user.tier === 'pro' ? '#0070FF' : '#7B5EA7'}, {user.tier === 'pro' ? '#00E5FF' : '#A78BFA'})"
									>
										{(user.displayName || user.email)[0]?.toUpperCase()}
									</div>
									<div>
										<div class="user-name">{user.displayName || "—"}</div>
										<div class="user-email">{user.email}</div>
									</div>
								</div>
							</td>
							<td class="td-shop">{user.shopName ?? "—"}</td>
							<td>
								<Badge variant={user.tier === "pro" ? "pro" : user.tier === "lite" ? "lite" : user.tier === "admin" ? "info" : "free"} size="sm">
									{user.tier}
								</Badge>
							</td>
							<td class="td-mono">{user.cutsTotal.toLocaleString()}</td>
							<td>
								<Badge variant={user.status === "active" ? "success" : "danger"} dot size="sm">
									{user.status}
								</Badge>
							</td>
							<td class="td-date">{user.createdAt ? formatDate(new Date(user.createdAt)) : "—"}</td>
							<td class="td-date">{user.lastActiveAt ? formatRelativeTime(new Date(user.lastActiveAt)) : "—"}</td>
							<td class="td-actions">
								<div class="row-actions">
									<button
										class="row-btn"
										title="Edit tier"
										aria-label="Edit tier for {user.displayName || user.email}"
										onclick={() => openEdit(user)}
									>
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
									</button>
									<button
										class="row-btn {user.status === 'suspended' ? 'row-btn--restore' : 'row-btn--danger'}"
										title={user.status === "suspended" ? "Reactivate" : "Suspend"}
										aria-label="{user.status === 'suspended' ? 'Reactivate' : 'Suspend'} {user.displayName || user.email}"
										onclick={() => toggleSuspend(user)}
									>
										{#if user.status === "suspended"}
											<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
										{:else}
											<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg>
										{/if}
									</button>
								</div>
							</td>
						</tr>
					{/each}
					{#if filtered.length === 0 && !loading}
						<tr>
							<td colspan="9" class="td-empty">
								{search || filterTier !== "all" ? "No users match your filters." : "No users yet."}
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.admin-users {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
	.page-title  { font-size: 1.375rem; margin-bottom: 3px; }
	.page-sub    { font-size: 0.875rem; color: var(--text-secondary); }

	.tier-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border-subtle); }
	.tier-tab {
		display: flex; align-items: center; gap: 6px;
		padding: 8px 14px; font-size: 0.8125rem; font-weight: 500; font-family: var(--font-body);
		background: transparent; border: none; border-bottom: 2px solid transparent;
		color: var(--text-tertiary); cursor: pointer; margin-bottom: -1px;
		transition: color 0.12s, border-color 0.12s;
	}
	.tier-tab:hover { color: var(--text-primary); }
	.tier-tab.active { color: var(--text-primary); border-bottom-color: var(--color-brand-dim); }
	.tier-tab__count {
		font-family: var(--font-mono); font-size: 0.6875rem;
		background: var(--bg-surface-3); padding: 1px 5px; border-radius: 3px; color: var(--text-tertiary);
	}

	.toolbar { display: flex; align-items: center; gap: 10px; }
	.search-wrap { position: relative; max-width: 280px; width: 100%; }
	.search-icon { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
	.search-input {
		width: 100%; padding: 7px 10px 7px 30px;
		background: var(--bg-surface); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); font-size: 0.8125rem; font-family: var(--font-body);
		color: var(--text-primary); outline: none; transition: border-color 0.12s;
	}
	.search-input:focus { border-color: var(--color-brand-dim); }
	.search-input::placeholder { color: var(--text-tertiary); }

	.bulk-bar { display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--text-secondary); }
	.bulk-btn {
		padding: 5px 10px; font-size: 0.75rem; font-weight: 500; font-family: var(--font-body);
		background: var(--bg-surface-2); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; transition: all 0.12s;
	}
	.bulk-btn:hover { background: var(--bg-surface-3); }

	/* Skeleton */
	@keyframes shimmer {
		0%   { background-position: -200% 0; }
		100% { background-position: 200% 0; }
	}
	.skel {
		background: linear-gradient(90deg, var(--bg-surface-2) 25%, var(--bg-surface-3) 50%, var(--bg-surface-2) 75%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
		border-radius: 4px;
	}
	.skel--avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; }
	.skel--name   { height: 12px; width: 140px; }
	.skel--badge  { height: 20px; width: 50px; border-radius: 10px; }
	.skel--date   { height: 10px; width: 70px; }

	.table-skeleton {
		background: var(--bg-surface); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl); padding: 8px 16px;
		display: flex; flex-direction: column; gap: 16px;
	}
	.table-skel-row { display: flex; align-items: center; gap: 16px; padding: 8px 0; border-top: 1px solid var(--border-subtle); }
	.table-skel-row:first-child { border-top: none; }

	.table-error {
		background: var(--bg-surface); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl); padding: 40px;
		text-align: center; color: var(--text-secondary); font-size: 0.875rem;
	}
	.retry-btn {
		margin-top: 10px; padding: 6px 14px; font-size: 0.8125rem;
		background: var(--bg-surface-2); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer;
	}
	.retry-btn:hover { background: var(--bg-surface-3); }

	.table-wrap {
		background: var(--bg-surface); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl); overflow: hidden; overflow-x: auto;
	}

	.users-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; min-width: 900px; }
	.users-table thead { background: var(--bg-surface-2); border-bottom: 1px solid var(--border-subtle); }
	.users-table th {
		padding: 10px 14px; text-align: left; font-size: 0.625rem; font-weight: 600;
		font-family: var(--font-mono); color: var(--text-tertiary); text-transform: uppercase;
		letter-spacing: 0.08em; white-space: nowrap;
	}
	.users-table tbody tr { border-bottom: 1px solid var(--border-subtle); transition: background 0.1s; }
	.users-table tbody tr:last-child { border-bottom: none; }
	.users-table tbody tr:hover { background: var(--interactive-hover); }
	.row-selected { background: rgba(0, 112, 255, 0.04) !important; }
	.users-table td { padding: 10px 14px; vertical-align: middle; }

	.th-check, .td-check { width: 40px; padding-left: 16px; }
	.th-actions { width: 80px; }

	.row-check { accent-color: var(--color-brand-dim); width: 14px; height: 14px; cursor: pointer; }

	.user-cell { display: flex; align-items: center; gap: 8px; }
	.user-avatar {
		width: 28px; height: 28px; border-radius: 50%;
		display: flex; align-items: center; justify-content: center;
		font-family: var(--font-display); font-size: 0.6875rem; font-weight: 700; color: #fff; flex-shrink: 0;
	}
	.user-name  { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); }
	.user-email { font-size: 0.6875rem; color: var(--text-tertiary); }
	.td-shop    { font-size: 0.8125rem; color: var(--text-secondary); white-space: nowrap; }
	.td-mono    { font-family: var(--font-mono); font-size: 0.8125rem; }
	.td-date    { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap; }

	.row-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.12s; }
	tr:hover .row-actions { opacity: 1; }
	.row-btn {
		width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
		background: var(--bg-surface-2); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; transition: all 0.12s;
	}
	.row-btn:hover             { background: var(--bg-surface-3); color: var(--text-primary); }
	.row-btn--danger:hover     { background: rgba(255,77,109,0.1); color: var(--color-danger); border-color: rgba(255,77,109,0.2); }
	.row-btn--restore          { color: var(--color-success); }
	.row-btn--restore:hover    { background: rgba(0,200,120,0.1); border-color: rgba(0,200,120,0.2); }

	.td-empty { text-align: center; padding: 40px; color: var(--text-tertiary); }

	/* Modal */
	.modal-backdrop {
		position: fixed; inset: 0; background: rgba(0,0,0,0.5);
		display: flex; align-items: center; justify-content: center; z-index: 100;
	}
	.modal {
		background: var(--bg-surface); border: 1px solid var(--border-default);
		border-radius: var(--radius-xl); width: 360px; overflow: hidden;
		box-shadow: 0 20px 60px rgba(0,0,0,0.4);
	}
	.modal__header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 14px 16px; border-bottom: 1px solid var(--border-subtle);
	}
	.modal__title { font-size: 0.9375rem; font-weight: 600; }
	.modal__close {
		width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
		background: none; border: none; color: var(--text-tertiary); cursor: pointer; border-radius: var(--radius-md);
	}
	.modal__close:hover { background: var(--bg-surface-2); color: var(--text-primary); }
	.modal__body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
	.modal__user { font-size: 0.875rem; color: var(--text-secondary); margin: 0; }
	.tier-options { display: flex; gap: 8px; }
	.tier-option {
		padding: 8px 12px; background: var(--bg-surface-2); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); cursor: pointer; transition: all 0.12s;
	}
	.tier-option:hover   { background: var(--bg-surface-3); }
	.tier-option.selected { background: color-mix(in srgb, var(--color-brand) 10%, transparent); border-color: var(--color-brand-dim); }
	.modal__footer {
		display: flex; justify-content: flex-end; gap: 8px;
		padding: 12px 16px; border-top: 1px solid var(--border-subtle);
	}
	.modal-btn {
		padding: 7px 16px; font-size: 0.875rem; font-weight: 500; font-family: var(--font-body);
		border-radius: var(--radius-md); cursor: pointer; transition: all 0.12s;
	}
	.modal-btn--cancel { background: none; border: 1px solid var(--border-default); color: var(--text-secondary); }
	.modal-btn--cancel:hover { background: var(--bg-surface-2); }
	.modal-btn--save { background: var(--color-brand-dim); border: none; color: #fff; }
	.modal-btn--save:hover:not(:disabled) { opacity: 0.85; }
	.modal-btn--save:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
