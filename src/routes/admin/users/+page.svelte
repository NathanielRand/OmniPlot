<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { formatDate, formatRelativeTime } from "$lib/utils";
	import { auth } from "$lib/firebase/client";
	import { onMount } from "svelte";
	import { toastStore } from "$lib/stores";

	type Tier       = "free" | "lite" | "pro" | "admin";
	type Status     = "active" | "suspended";
	type FilterType = "all" | Tier | "shop";

	interface AdminUser {
		uid:          string;
		displayName:  string;
		email:        string;
		phone:        string | null;
		tier:         Tier;
		status:       Status;
		shopId:       string | null;
		shopName:     string | null;
		shopRole:     "owner" | "manager" | "tech" | null;
		cutsTotal:    number;
		createdAt:    string | null;
		lastActiveAt: string | null;
	}

	interface UserDetail {
		uid:             string;
		displayName:     string;
		email:           string;
		phone:           string | null;
		photoURL:        string | null;
		tier:            Tier;
		status:          Status;
		shopId:          string | null;
		shopName:        string | null;
		shopRole:        "owner" | "manager" | "tech" | null;
		activeSessionId: string | null;
		usage: {
			cutCount:     number;
			monthlyCount: number;
			lastCutAt:    string | null;
			monthResetAt: string | null;
		};
		subscription: {
			status:               string | null;
			stripeCustomerId:     string | null;
			stripeSubscriptionId: string | null;
			currentPeriodEnd:     string | null;
			trialEnd:             string | null;
			cancelAtPeriodEnd:    boolean;
		};
		preferences: {
			theme:          string;
			units:          string;
			autoNest:       boolean;
			defaultPlotter: string | null;
		};
		createdAt:    string | null;
		lastActiveAt: string | null;
		shop: {
			id:                 string;
			name:               string;
			plan:               string;
			seats:              number;
			ownerId:            string;
			subscriptionStatus: string | null;
			currentPeriodEnd:   string | null;
		} | null;
		recentJobs: {
			id:         string;
			name:       string;
			status:     string;
			pieces:     number;
			connection: string;
			createdAt:  string | null;
		}[];
	}

	// ── State ──────────────────────────────────────
	let users        = $state<AdminUser[]>([]);
	let loading      = $state(true);
	let error        = $state<string | null>(null);
	let search       = $state("");
	let filterType   = $state<FilterType>("all");
	let selectedIds  = $state<Set<string>>(new Set());

	// Detail drawer
	let detailUid     = $state<string | null>(null);
	let detail        = $state<UserDetail | null>(null);
	let detailLoading = $state(false);
	let detailError   = $state<string | null>(null);
	let drawerTier    = $state<Tier>("free");
	let drawerAction  = $state<string | null>(null);

	// ── Load list ──────────────────────────────────
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
			const mq = !q
				|| u.displayName.toLowerCase().includes(q)
				|| u.email.toLowerCase().includes(q)
				|| (u.phone ?? "").includes(q)
				|| (u.shopName ?? "").toLowerCase().includes(q);
			const mt = filterType === "all"  ? true
			         : filterType === "shop" ? u.shopId !== null
			         : u.tier === filterType;
			return mq && mt;
		}),
	);

	const tierCounts = $derived(
		users.reduce((acc, u) => {
			acc[u.tier] = (acc[u.tier] ?? 0) + 1;
			return acc;
		}, {} as Record<string, number>),
	);

	const shopMemberCount = $derived(users.filter((u) => u.shopId !== null).length);

	function toggleSelect(id: string) {
		const s = new Set(selectedIds);
		s.has(id) ? s.delete(id) : s.add(id);
		selectedIds = s;
	}

	// ── Detail drawer ──────────────────────────────
	async function openDetail(uid: string) {
		detailUid     = uid;
		detail        = null;
		detailLoading = true;
		detailError   = null;
		drawerTier    = (users.find((u) => u.uid === uid)?.tier ?? "free") as Tier;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res   = await fetch(`/api/admin/users/${uid}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (!res.ok) throw new Error("Failed to load user");
			detail     = await res.json();
			drawerTier = detail!.tier;
		} catch (e) {
			detailError = e instanceof Error ? e.message : "Could not load user";
		} finally {
			detailLoading = false;
		}
	}

	function closeDetail() {
		detailUid = null;
		detail    = null;
	}

	// Generic PATCH helper
	async function patchUser(uid: string, body: Record<string, unknown>) {
		const token = await auth.currentUser?.getIdToken();
		const res   = await fetch("/api/admin/users", {
			method:  "PATCH",
			headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body:    JSON.stringify({ uid, ...body }),
		});
		if (!res.ok) throw new Error("Request failed");
	}

	async function drawerSaveTier() {
		if (!detail || drawerTier === detail.tier) return;
		drawerAction = "tier";
		try {
			await patchUser(detail.uid, { tier: drawerTier });
			detail = { ...detail, tier: drawerTier };
			users  = users.map((u) => u.uid === detail!.uid ? { ...u, tier: drawerTier } : u);
			toastStore.success("Tier updated", `→ ${drawerTier}`);
		} catch {
			toastStore.error("Save failed");
		} finally {
			drawerAction = null;
		}
	}

	async function drawerToggleSuspend() {
		if (!detail) return;
		const next: Status = detail.status === "suspended" ? "active" : "suspended";
		drawerAction = "suspend";
		try {
			await patchUser(detail.uid, { status: next });
			detail = { ...detail, status: next };
			users  = users.map((u) => u.uid === detail!.uid ? { ...u, status: next } : u);
			toastStore.success(next === "suspended" ? "User suspended" : "User reactivated");
		} catch {
			toastStore.error("Action failed");
		} finally {
			drawerAction = null;
		}
	}

	async function drawerClearSession() {
		if (!detail) return;
		drawerAction = "session";
		try {
			await patchUser(detail.uid, { clearSession: true });
			detail = { ...detail, activeSessionId: null };
			toastStore.success("Session cleared", "User will be signed out on next request");
		} catch {
			toastStore.error("Action failed");
		} finally {
			drawerAction = null;
		}
	}

	async function drawerRemoveShop() {
		if (!detail) return;
		drawerAction = "shop";
		try {
			await patchUser(detail.uid, { removeShop: true });
			detail = { ...detail, shopId: null, shopName: null, shopRole: null, shop: null };
			users  = users.map((u) => u.uid === detail!.uid ? { ...u, shopId: null, shopName: null, shopRole: null } : u);
			toastStore.success("Removed from shop");
		} catch {
			toastStore.error("Action failed");
		} finally {
			drawerAction = null;
		}
	}

	async function copyToClipboard(text: string, label = "Copied") {
		try {
			await navigator.clipboard.writeText(text);
			toastStore.success(label);
		} catch {
			toastStore.warning("Copy failed", "Select and copy manually");
		}
	}

	// Quick suspend from row (no drawer needed)
	async function toggleSuspend(user: AdminUser) {
		const next: Status = user.status === "suspended" ? "active" : "suspended";
		try {
			await patchUser(user.uid, { status: next });
			users = users.map((u) => u.uid === user.uid ? { ...u, status: next } : u);
			if (detail?.uid === user.uid) detail = { ...detail!, status: next };
			toastStore.success(next === "suspended" ? "User suspended" : "User reactivated", user.email);
		} catch {
			toastStore.error("Action failed", "Could not update user status");
		}
	}

	const TIERS: Tier[] = ["free", "lite", "pro", "admin"];

	const FILTER_TABS: { key: FilterType; label: string }[] = [
		{ key: "all",   label: "All"   },
		{ key: "free",  label: "Free"  },
		{ key: "lite",  label: "Lite"  },
		{ key: "pro",   label: "Pro"   },
		{ key: "admin", label: "Admin" },
		{ key: "shop",  label: "Shop"  },
	];

	function tabCount(key: FilterType): number {
		if (key === "all")  return users.length;
		if (key === "shop") return shopMemberCount;
		return tierCounts[key as Tier] ?? 0;
	}

	function tierVariant(tier: string) {
		return tier === "pro" ? "pro" : tier === "lite" ? "lite" : tier === "admin" ? "info" : "free";
	}

	function subStatusVariant(status: string | null) {
		if (status === "active" || status === "trialing") return "success";
		if (status === "past_due") return "warning";
		if (status === "canceled") return "danger";
		return "default";
	}

	function connLabel(c: string) {
		return c === "cut-agent" ? "Agent" : c === "usb-serial" ? "USB" : c === "network" ? "Net" : c === "download" ? "DL" : c;
	}
</script>

<svelte:head><title>Users — Admin — OmniPlot</title></svelte:head>

<!-- ── Detail Drawer ───────────────────────────── -->
{#if detailUid}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="drawer-backdrop" onclick={closeDetail}></div>
	<div class="user-drawer" role="dialog" aria-label="User detail">
		<!-- Header -->
		<div class="drawer-header">
			<div class="drawer-avatar">
				{#if detail?.photoURL}
					<img src={detail.photoURL} alt="" class="drawer-avatar__img" />
				{:else}
					<span>{(detail?.displayName || detail?.email || detailUid)[0]?.toUpperCase()}</span>
				{/if}
			</div>
			<div class="drawer-header__info">
				{#if detail}
					<div class="drawer-header__name">{detail.displayName || "—"}</div>
					<div class="drawer-header__contact">
						{#if detail.email}<span>{detail.email}</span>{/if}
						{#if detail.phone}<span class="drawer-header__phone">{detail.phone}</span>{/if}
					</div>
					<div class="drawer-header__badges">
						<Badge variant={tierVariant(detail.tier)} size="sm">{detail.tier}</Badge>
						<Badge variant={detail.status === "active" ? "success" : "danger"} dot size="sm">{detail.status}</Badge>
						{#if detail.shopRole}
							<span class="shop-role-chip shop-role-chip--{detail.shopRole}">{detail.shopRole}</span>
						{/if}
					</div>
				{:else if detailLoading}
					<div class="skel skel--name" style="margin-bottom:6px"></div>
					<div class="skel" style="width:180px;height:10px"></div>
				{:else}
					<div class="drawer-header__name">{detailUid}</div>
				{/if}
			</div>
			<button class="drawer-close" onclick={closeDetail} aria-label="Close">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>
		</div>

		<!-- UID bar -->
		{#if detail || detailUid}
			<div class="uid-bar">
				<span class="uid-bar__label">UID</span>
				<code class="uid-bar__value">{detail?.uid ?? detailUid}</code>
				<button class="uid-copy-btn" onclick={() => copyToClipboard(detail?.uid ?? detailUid ?? "", "UID copied")} title="Copy UID">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
				</button>
			</div>
		{/if}

		{#if detailLoading}
			<div class="drawer-loading">
				<span class="drawer-spinner"></span>
				<span>Loading…</span>
			</div>
		{:else if detailError}
			<div class="drawer-error">
				<p>{detailError}</p>
				<button class="retry-btn" onclick={() => openDetail(detailUid!)}>Retry</button>
			</div>
		{:else if detail}
			<div class="drawer-body">

				<!-- Activity -->
				<div class="drawer-section">
					<div class="drawer-section__title">Activity</div>
					<div class="drawer-kv-grid">
						<div class="drawer-kv">
							<span class="kv-label">All-time cuts</span>
							<span class="kv-value kv-value--mono">{detail.usage.cutCount.toLocaleString()}</span>
						</div>
						<div class="drawer-kv">
							<span class="kv-label">This month</span>
							<span class="kv-value kv-value--mono">{detail.usage.monthlyCount}</span>
						</div>
						<div class="drawer-kv">
							<span class="kv-label">Last cut</span>
							<span class="kv-value">{detail.usage.lastCutAt ? formatRelativeTime(new Date(detail.usage.lastCutAt)) : "—"}</span>
						</div>
						<div class="drawer-kv">
							<span class="kv-label">Joined</span>
							<span class="kv-value">{detail.createdAt ? formatDate(new Date(detail.createdAt)) : "—"}</span>
						</div>
						<div class="drawer-kv">
							<span class="kv-label">Last active</span>
							<span class="kv-value">{detail.lastActiveAt ? formatRelativeTime(new Date(detail.lastActiveAt)) : "—"}</span>
						</div>
						<div class="drawer-kv">
							<span class="kv-label">Active session</span>
							<span class="kv-value kv-value--mono" class:kv-value--dim={!detail.activeSessionId}>
								{detail.activeSessionId ? detail.activeSessionId.slice(0, 12) + "…" : "None"}
							</span>
						</div>
					</div>
				</div>

				<!-- Subscription -->
				{#if detail.subscription.stripeCustomerId || detail.subscription.status}
					<div class="drawer-section">
						<div class="drawer-section__title">Subscription</div>
						<div class="drawer-kv-grid">
							{#if detail.subscription.status}
								<div class="drawer-kv">
									<span class="kv-label">Status</span>
									<Badge variant={subStatusVariant(detail.subscription.status)} dot size="sm">
										{detail.subscription.status}
									</Badge>
								</div>
							{/if}
							{#if detail.subscription.currentPeriodEnd}
								<div class="drawer-kv">
									<span class="kv-label">Period ends</span>
									<span class="kv-value">{formatDate(new Date(detail.subscription.currentPeriodEnd))}</span>
								</div>
							{/if}
							{#if detail.subscription.trialEnd}
								<div class="drawer-kv">
									<span class="kv-label">Trial ends</span>
									<span class="kv-value">{formatDate(new Date(detail.subscription.trialEnd))}</span>
								</div>
							{/if}
							{#if detail.subscription.cancelAtPeriodEnd}
								<div class="drawer-kv drawer-kv--full">
									<span class="kv-label">Cancels at period end</span>
									<Badge variant="warning" size="sm">Scheduled</Badge>
								</div>
							{/if}
							{#if detail.subscription.stripeCustomerId}
								<div class="drawer-kv drawer-kv--full">
									<span class="kv-label">Stripe customer</span>
									<div class="kv-copy-row">
										<code class="kv-value kv-value--mono">{detail.subscription.stripeCustomerId}</code>
										<button class="uid-copy-btn" onclick={() => copyToClipboard(detail!.subscription.stripeCustomerId!, "Stripe ID copied")} title="Copy">
											<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
										</button>
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Shop membership -->
				{#if detail.shopId && detail.shop}
					<div class="drawer-section">
						<div class="drawer-section__title">Shop membership</div>
						<div class="drawer-kv-grid">
							<div class="drawer-kv">
								<span class="kv-label">Shop</span>
								<span class="kv-value">{detail.shop.name}</span>
							</div>
							<div class="drawer-kv">
								<span class="kv-label">Plan</span>
								<span class="kv-value">{detail.shop.plan}</span>
							</div>
							<div class="drawer-kv">
								<span class="kv-label">Role</span>
								<span class="kv-value">{detail.shopRole ?? "—"}</span>
							</div>
							<div class="drawer-kv">
								<span class="kv-label">Seats</span>
								<span class="kv-value kv-value--mono">{detail.shop.seats}</span>
							</div>
							{#if detail.shop.subscriptionStatus}
								<div class="drawer-kv">
									<span class="kv-label">Sub status</span>
									<Badge variant={subStatusVariant(detail.shop.subscriptionStatus)} dot size="sm">
										{detail.shop.subscriptionStatus}
									</Badge>
								</div>
							{/if}
							{#if detail.shop.currentPeriodEnd}
								<div class="drawer-kv">
									<span class="kv-label">Period ends</span>
									<span class="kv-value">{formatDate(new Date(detail.shop.currentPeriodEnd))}</span>
								</div>
							{/if}
							<div class="drawer-kv drawer-kv--full">
								<span class="kv-label">Shop ID</span>
								<div class="kv-copy-row">
									<code class="kv-value kv-value--mono">{detail.shopId}</code>
									<button class="uid-copy-btn" onclick={() => copyToClipboard(detail!.shopId!, "Shop ID copied")} title="Copy">
										<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
									</button>
								</div>
							</div>
						</div>
					</div>
				{:else if detail.shopId}
					<div class="drawer-section">
						<div class="drawer-section__title">Shop membership</div>
						<div class="drawer-kv-grid">
							<div class="drawer-kv drawer-kv--full">
								<span class="kv-label">Shop ID</span>
								<code class="kv-value kv-value--mono">{detail.shopId}</code>
							</div>
							<div class="drawer-kv">
								<span class="kv-label">Role</span>
								<span class="kv-value">{detail.shopRole ?? "—"}</span>
							</div>
						</div>
					</div>
				{/if}

				<!-- Preferences -->
				<div class="drawer-section">
					<div class="drawer-section__title">Preferences</div>
					<div class="drawer-kv-grid">
						<div class="drawer-kv">
							<span class="kv-label">Theme</span>
							<span class="kv-value">{detail.preferences.theme}</span>
						</div>
						<div class="drawer-kv">
							<span class="kv-label">Units</span>
							<span class="kv-value">{detail.preferences.units}</span>
						</div>
						<div class="drawer-kv">
							<span class="kv-label">Auto-nest</span>
							<span class="kv-value">{detail.preferences.autoNest ? "Yes" : "No"}</span>
						</div>
						{#if detail.preferences.defaultPlotter}
							<div class="drawer-kv">
								<span class="kv-label">Default plotter</span>
								<span class="kv-value kv-value--mono">{detail.preferences.defaultPlotter}</span>
							</div>
						{/if}
					</div>
				</div>

				<!-- Recent jobs -->
				{#if detail.recentJobs.length > 0}
					<div class="drawer-section">
						<div class="drawer-section__title">Recent jobs</div>
						<div class="jobs-list">
							{#each detail.recentJobs as j (j.id)}
								<div class="job-row">
									<span class="job-row__name">{j.name}</span>
									<span class="job-row__conn">{connLabel(j.connection)}</span>
									<span class="job-row__pieces">{j.pieces}pc</span>
									<Badge variant={j.status === "complete" || j.status === "completed" ? "success" : j.status === "error" ? "danger" : "default"} size="sm" dot>{j.status}</Badge>
									<span class="job-row__date">{j.createdAt ? formatRelativeTime(new Date(j.createdAt)) : "—"}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Admin actions -->
				<div class="drawer-section drawer-section--actions">
					<div class="drawer-section__title">Admin actions</div>

					<!-- Change tier -->
					<div class="action-block">
						<span class="action-block__label">Change tier</span>
						<div class="tier-picker">
							{#each TIERS as t}
								<button
									class="tier-chip"
									class:tier-chip--active={drawerTier === t}
									onclick={() => (drawerTier = t)}
								>
									<Badge variant={tierVariant(t)} size="sm">{t}</Badge>
								</button>
							{/each}
						</div>
						<button
							class="action-btn action-btn--primary"
							onclick={drawerSaveTier}
							disabled={drawerAction === "tier" || drawerTier === detail.tier}
						>
							{drawerAction === "tier" ? "Saving…" : "Save tier"}
						</button>
					</div>

					<!-- Suspend / restore -->
					<div class="action-row">
						<button
							class="action-btn {detail.status === 'suspended' ? 'action-btn--restore' : 'action-btn--danger'}"
							onclick={drawerToggleSuspend}
							disabled={drawerAction === "suspend"}
						>
							{#if drawerAction === "suspend"}
								…
							{:else if detail.status === "suspended"}
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
								Reactivate account
							{:else}
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg>
								Suspend account
							{/if}
						</button>

						{#if detail.activeSessionId}
							<button
								class="action-btn action-btn--ghost"
								onclick={drawerClearSession}
								disabled={drawerAction === "session"}
								title="Clears the active session ID, signing the user out on next request"
							>
								{drawerAction === "session" ? "Clearing…" : "Reset session"}
							</button>
						{/if}

						{#if detail.shopId}
							<button
								class="action-btn action-btn--ghost"
								onclick={drawerRemoveShop}
								disabled={drawerAction === "shop"}
							>
								{drawerAction === "shop" ? "Removing…" : "Remove from shop"}
							</button>
						{/if}
					</div>
				</div>

			</div><!-- /drawer-body -->
		{/if}
	</div>
{/if}

<!-- ── Main page ───────────────────────────────── -->
<div class="admin-users">
	<div class="page-header">
		<div>
			<h1 class="page-title">Users</h1>
			<p class="page-sub">
				{loading ? "Loading…" : error ? "—" : `${users.length.toLocaleString()} total accounts`}
			</p>
		</div>
	</div>

	<!-- Filter tabs -->
	<div class="tier-tabs" role="tablist">
		{#each FILTER_TABS as tab}
			<button
				class="tier-tab"
				class:active={filterType === tab.key}
				onclick={() => (filterType = tab.key)}
				role="tab"
				aria-selected={filterType === tab.key}
			>
				{tab.label}
				<span class="tier-tab__count">{tabCount(tab.key)}</span>
			</button>
		{/each}
	</div>

	<!-- Search + bulk bar -->
	<div class="toolbar">
		<div class="search-wrap">
			<svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
			</svg>
			<input type="search" class="search-input" placeholder="Search name, email, phone, shop…" bind:value={search} aria-label="Search users" />
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
						<th>Shop / Role</th>
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
						<tr
							class:row-selected={selectedIds.has(user.uid)}
							class:row-active={detailUid === user.uid}
							onclick={(e) => {
								if ((e.target as HTMLElement).closest(".row-actions, input")) return;
								openDetail(user.uid);
							}}
							style="cursor:pointer"
						>
							<td class="td-check" onclick={(e) => e.stopPropagation()}>
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
										style="background: linear-gradient(135deg, {user.tier === 'pro' ? '#0070FF' : user.shopId ? '#059669' : '#7B5EA7'}, {user.tier === 'pro' ? '#00E5FF' : user.shopId ? '#34d399' : '#A78BFA'})"
									>
										{(user.displayName || user.email)[0]?.toUpperCase()}
									</div>
									<div>
										<div class="user-name">{user.displayName || "—"}</div>
										<div class="user-email">{user.email || user.phone || "—"}</div>
									</div>
								</div>
							</td>
							<td class="td-shop">
								{#if user.shopName}
									<div class="shop-cell">
										<span class="shop-cell__name">{user.shopName}</span>
										{#if user.shopRole}
											<span class="shop-role-chip shop-role-chip--{user.shopRole}">{user.shopRole}</span>
										{/if}
									</div>
								{:else}
									<span class="td-none">—</span>
								{/if}
							</td>
							<td>
								<Badge variant={tierVariant(user.tier)} size="sm">{user.tier}</Badge>
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
										title="View details"
										aria-label="View details for {user.displayName || user.email}"
										onclick={(e) => { e.stopPropagation(); openDetail(user.uid); }}
									>
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
									</button>
									<button
										class="row-btn {user.status === 'suspended' ? 'row-btn--restore' : 'row-btn--danger'}"
										title={user.status === "suspended" ? "Reactivate" : "Suspend"}
										aria-label="{user.status === 'suspended' ? 'Reactivate' : 'Suspend'} {user.displayName || user.email}"
										onclick={(e) => { e.stopPropagation(); toggleSuspend(user); }}
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
								{search || filterType !== "all" ? "No users match your filters." : "No users yet."}
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

	/* ── Filter tabs ───────────────────────────── */
	.tier-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border-subtle); flex-wrap: wrap; }
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

	/* ── Toolbar ───────────────────────────────── */
	.toolbar { display: flex; align-items: center; gap: 10px; }
	.search-wrap { position: relative; max-width: 320px; width: 100%; }
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

	/* ── Skeleton ──────────────────────────────── */
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

	/* ── Table ─────────────────────────────────── */
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
	.row-active   { background: color-mix(in srgb, var(--color-brand-dim) 6%, var(--bg-surface)) !important; }
	.users-table td { padding: 10px 14px; vertical-align: middle; }

	.th-check, .td-check { width: 40px; padding-left: 16px; }
	.th-actions { width: 80px; }

	.row-check { accent-color: var(--color-brand-dim); width: 14px; height: 14px; cursor: pointer; }

	.user-cell  { display: flex; align-items: center; gap: 8px; }
	.user-avatar {
		width: 28px; height: 28px; border-radius: 50%;
		display: flex; align-items: center; justify-content: center;
		font-family: var(--font-display); font-size: 0.6875rem; font-weight: 700; color: #fff; flex-shrink: 0;
	}
	.user-name  { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); }
	.user-email { font-size: 0.6875rem; color: var(--text-tertiary); }

	.shop-cell { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
	.shop-cell__name { font-size: 0.8125rem; color: var(--text-secondary); white-space: nowrap; }
	.td-none { color: var(--text-tertiary); }

	.shop-role-chip {
		font-size: 0.625rem; font-weight: 600; font-family: var(--font-mono);
		padding: 1px 5px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.06em;
	}
	.shop-role-chip--owner   { background: rgba(234,179,8,0.15);  color: #ca8a04; border: 1px solid rgba(234,179,8,0.3);  }
	.shop-role-chip--manager { background: rgba(99,102,241,0.15); color: #6366f1; border: 1px solid rgba(99,102,241,0.3); }
	.shop-role-chip--tech    { background: rgba(20,184,166,0.15); color: #0d9488; border: 1px solid rgba(20,184,166,0.3); }

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
	.row-btn--restore          { color: #2ecc71; }
	.row-btn--restore:hover    { background: rgba(0,200,120,0.1); border-color: rgba(0,200,120,0.2); }

	.td-empty { text-align: center; padding: 40px; color: var(--text-tertiary); }

	/* ── Detail Drawer ─────────────────────────── */
	.drawer-backdrop {
		position: fixed; inset: 0; background: rgba(0,0,0,0.35);
		z-index: 200; backdrop-filter: blur(1px);
	}

	.user-drawer {
		position: fixed; top: 0; right: 0; bottom: 0;
		width: 420px; max-width: 92vw;
		background: var(--bg-surface);
		border-left: 1px solid var(--border-default);
		box-shadow: -12px 0 48px rgba(0,0,0,0.25);
		z-index: 201;
		display: flex; flex-direction: column;
		overflow: hidden;
		animation: drawer-in 0.2s var(--ease-smooth, cubic-bezier(.16,1,.3,1));
	}
	@keyframes drawer-in {
		from { transform: translateX(100%); opacity: 0.6; }
		to   { transform: translateX(0);    opacity: 1;   }
	}

	.drawer-header {
		display: flex; align-items: flex-start; gap: 12px;
		padding: 16px 16px 14px;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}
	.drawer-avatar {
		width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
		background: linear-gradient(135deg, #7B5EA7, #A78BFA);
		display: flex; align-items: center; justify-content: center;
		font-family: var(--font-display); font-size: 0.875rem; font-weight: 700; color: #fff;
		overflow: hidden;
	}
	.drawer-avatar__img { width: 100%; height: 100%; object-fit: cover; }
	.drawer-header__info { flex: 1; min-width: 0; }
	.drawer-header__name {
		font-size: 0.9375rem; font-weight: 600; color: var(--text-primary);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px;
	}
	.drawer-header__contact {
		display: flex; flex-direction: column; gap: 1px; margin-bottom: 6px;
		font-size: 0.75rem; color: var(--text-tertiary);
	}
	.drawer-header__phone { font-family: var(--font-mono); }
	.drawer-header__badges { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }

	.drawer-close {
		width: 28px; height: 28px; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
		background: none; border: 1px solid var(--border-default); border-radius: var(--radius-md);
		color: var(--text-tertiary); cursor: pointer; transition: all 0.12s; margin-top: 2px;
	}
	.drawer-close:hover { background: var(--bg-surface-2); color: var(--text-primary); }

	.uid-bar {
		display: flex; align-items: center; gap: 6px;
		padding: 6px 16px; background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}
	.uid-bar__label { font-size: 0.625rem; font-weight: 600; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.uid-bar__value { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.uid-copy-btn {
		width: 20px; height: 20px; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
		background: none; border: none; color: var(--text-tertiary); cursor: pointer;
		border-radius: var(--radius-sm); transition: color 0.12s, background 0.12s;
	}
	.uid-copy-btn:hover { color: var(--text-primary); background: var(--bg-surface-3); }

	.drawer-loading {
		display: flex; align-items: center; justify-content: center; gap: 10px;
		flex: 1; color: var(--text-tertiary); font-size: 0.875rem;
	}
	.drawer-spinner {
		width: 18px; height: 18px; border-radius: 50%;
		border: 2px solid var(--border-default); border-top-color: var(--color-brand);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.drawer-error {
		padding: 24px; text-align: center; color: var(--text-secondary); font-size: 0.875rem;
	}

	.drawer-body {
		flex: 1; overflow-y: auto;
		display: flex; flex-direction: column;
	}

	.drawer-section {
		padding: 14px 16px;
		border-bottom: 1px solid var(--border-subtle);
	}
	.drawer-section:last-child { border-bottom: none; }
	.drawer-section--actions { background: var(--bg-surface-2); }

	.drawer-section__title {
		font-size: 0.6875rem; font-weight: 600; font-family: var(--font-mono);
		text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary);
		margin-bottom: 10px;
	}

	/* KV grid */
	.drawer-kv-grid {
		display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px;
	}
	.drawer-kv { display: flex; flex-direction: column; gap: 2px; }
	.drawer-kv--full { grid-column: 1 / -1; }
	.kv-label { font-size: 0.6875rem; color: var(--text-tertiary); }
	.kv-value { font-size: 0.8125rem; color: var(--text-primary); }
	.kv-value--mono { font-family: var(--font-mono); font-size: 0.75rem; }
	.kv-value--dim  { color: var(--text-tertiary); }
	.kv-copy-row { display: flex; align-items: center; gap: 4px; }

	/* Recent jobs */
	.jobs-list { display: flex; flex-direction: column; gap: 4px; }
	.job-row {
		display: flex; align-items: center; gap: 6px;
		padding: 6px 8px; background: var(--bg-surface-2); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
	}
	.job-row__name { flex: 1; font-size: 0.8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.job-row__conn  { font-size: 0.6875rem; font-family: var(--font-mono); color: var(--text-tertiary); flex-shrink: 0; }
	.job-row__pieces{ font-size: 0.6875rem; font-family: var(--font-mono); color: var(--text-tertiary); flex-shrink: 0; }
	.job-row__date  { font-size: 0.6875rem; font-family: var(--font-mono); color: var(--text-tertiary); flex-shrink: 0; }

	/* Actions */
	.action-block { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
	.action-block__label { font-size: 0.75rem; font-weight: 500; color: var(--text-secondary); }

	.tier-picker { display: flex; flex-wrap: wrap; gap: 5px; }
	.tier-chip {
		padding: 5px 8px; border-radius: var(--radius-md);
		background: var(--bg-surface); border: 1px solid var(--border-default); cursor: pointer;
		transition: border-color 0.12s, background 0.12s;
	}
	.tier-chip:hover     { background: var(--bg-surface-3); }
	.tier-chip--active   { border-color: var(--color-brand-dim); background: color-mix(in srgb, var(--color-brand-dim) 10%, var(--bg-surface)); }

	.action-row { display: flex; flex-wrap: wrap; gap: 7px; }
	.action-btn {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 7px 13px; border-radius: var(--radius-md);
		font-size: 0.8125rem; font-weight: 500; font-family: var(--font-body);
		cursor: pointer; border: 1px solid transparent; transition: all 0.12s;
	}
	.action-btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.action-btn--primary {
		background: var(--color-brand-dim); color: #fff; border-color: var(--color-brand-dim);
		align-self: flex-start;
	}
	.action-btn--primary:not(:disabled):hover { opacity: 0.85; }
	.action-btn--danger {
		background: rgba(239,68,68,0.1); color: var(--color-danger);
		border-color: rgba(239,68,68,0.3);
	}
	.action-btn--danger:not(:disabled):hover { background: rgba(239,68,68,0.18); }
	.action-btn--restore {
		background: rgba(46,204,113,0.1); color: #2ecc71;
		border-color: rgba(46,204,113,0.3);
	}
	.action-btn--restore:not(:disabled):hover { background: rgba(46,204,113,0.18); }
	.action-btn--ghost {
		background: var(--bg-surface); color: var(--text-secondary);
		border-color: var(--border-default);
	}
	.action-btn--ghost:not(:disabled):hover { background: var(--bg-surface-3); color: var(--text-primary); }
</style>
