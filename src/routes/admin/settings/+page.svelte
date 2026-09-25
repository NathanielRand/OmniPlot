<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { auth } from "$lib/firebase/client";
	import { onMount } from "svelte";
	import { toastStore, platformStore } from "$lib/stores";
	import { PLATFORM_FLAGS, DEFAULT_PLATFORM_FLAGS, type PlatformFlag, type PlatformFlags } from "$lib/platform";

	// ── State ──────────────────────────────────────
	let loading = $state(true);
	let error   = $state<string | null>(null);

	let flags = $state<PlatformFlags>({ ...DEFAULT_PLATFORM_FLAGS });
	let stripeAccount = $state<{ id: string; name: string | null; email: string | null } | null>(null);
	let admins = $state<{ uid: string; displayName: string; email: string; createdAt: string | null }[]>([]);

	let flagSaving = $state<PlatformFlag | null>(null);

	// Built features first; unbuilt ones stay listed as a roadmap reminder.
	const FLAG_KEYS = (Object.keys(PLATFORM_FLAGS) as PlatformFlag[])
		.sort((a, b) => Number(PLATFORM_FLAGS[b].built) - Number(PLATFORM_FLAGS[a].built));

	async function authHeader(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	// ── Load settings ──────────────────────────────
	async function loadSettings() {
		loading = true;
		error   = null;
		try {
			const res = await fetch("/api/admin/settings", { headers: await authHeader() });
			if (!res.ok) throw new Error("Failed to load settings");
			const data = await res.json();
			flags         = data.flags;
			stripeAccount = data.stripeAccount ?? null;
			admins        = data.admins ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not load settings";
		} finally {
			loading = false;
		}
	}

	onMount(loadSettings);

	// ── Toggle a feature flag ──────────────────────
	async function toggleFlag(key: PlatformFlag) {
		const next = { ...flags, [key]: !flags[key] };
		flags      = next; // optimistic
		flagSaving = key;
		try {
			const res = await fetch("/api/admin/settings", {
				method:  "POST",
				headers: { "Content-Type": "application/json", ...(await authHeader()) },
				body:    JSON.stringify({ flags: next }),
			});
			if (!res.ok) throw new Error("Save failed");
			platformStore.load(true); // this tab reflects it right away (e.g. the maintenance banner)
		} catch {
			flags = { ...next, [key]: !next[key] }; // revert
			toastStore.error("Save failed", "Could not update feature flag");
		} finally {
			flagSaving = null;
		}
	}
</script>

<svelte:head><title>Settings — Admin — OmniPlot</title></svelte:head>

<div class="settings-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Settings</h1>
			<p class="page-sub">Platform configuration, feature flags, and admin access.</p>
		</div>
	</div>

	{#if error}
		<div class="load-error">
			<p>{error}</p>
			<button class="retry-btn" onclick={loadSettings}>Retry</button>
		</div>
	{/if}

	<!-- Feature flags -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Feature flags</h2>
			<Badge variant="info" size="sm">Saved to Firestore immediately</Badge>
		</div>
		<div class="flags-list">
			{#each FLAG_KEYS as key (key)}
				{@const flag = PLATFORM_FLAGS[key]}
				<div class="flag-row" class:flag-row--unbuilt={!flag.built}>
					<div class="flag-info">
						<div class="flag-label">
							{flag.label}
							{#if !flag.built}<Badge variant="default" size="sm">Not built yet</Badge>{/if}
						</div>
						<div class="flag-desc">{flag.desc}</div>
					</div>
					<button
						class="toggle"
						class:toggle--on={flags[key]}
						class:toggle--saving={flagSaving === key}
						role="switch"
						aria-checked={flags[key]}
						aria-label="Toggle {flag.label}"
						onclick={() => toggleFlag(key)}
						disabled={!flag.built || loading || flagSaving !== null}
					>
						<span class="toggle__thumb"></span>
					</button>
				</div>
			{/each}
		</div>
		<p class="flags-note">Cut limits and plan features (free/lite/pro) live on <a href="/admin/products">Products → Plan allowances</a>.</p>
	</div>

	<!-- Stripe (read-only reference — configured via .env) -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Stripe</h2>
			<Badge variant="default" size="sm">Configured via environment variables</Badge>
		</div>
		<div class="info-body">
			<!-- Connected account identity -->
			<div class="stripe-account-card">
				<div class="stripe-account-icon" aria-hidden="true">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
				</div>
				<div class="stripe-account-details">
					{#if stripeAccount?.name}
						<span class="stripe-account-name">{stripeAccount.name}</span>
					{:else}
						<span class="stripe-account-name stripe-account-name--unknown">{loading ? "Loading…" : "Account name unavailable"}</span>
					{/if}
					<div class="stripe-account-meta">
						{#if stripeAccount?.email}
							<span class="stripe-account-email">{stripeAccount.email}</span>
							<span class="stripe-account-sep" aria-hidden="true">·</span>
						{/if}
						<code class="stripe-account-id">{stripeAccount?.id ?? "—"}</code>
					</div>
				</div>
				{#if !loading}
					{#if stripeAccount?.name || stripeAccount?.email}
						<Badge variant="success" size="sm" dot={true}>Connected</Badge>
					{:else}
						<Badge variant="danger" size="sm" dot={true}>Unreachable</Badge>
					{/if}
				{/if}
			</div>

			<p class="info-text">
				Stripe keys are set in your <code>.env</code> file and are not editable here —
				change the environment variables and redeploy. Price IDs are managed from
				<a href="/admin/products">Products</a>.
			</p>
			<div class="env-list">
				{#each [
					"STRIPE_SECRET_KEY",
					"STRIPE_WEBHOOK_SECRET",
					"STRIPE_CONNECTED_ACCOUNT_ID",
					"VITE_STRIPE_PUBLISHABLE_KEY",
				] as key}
					<div class="env-row">
						<code class="env-key">{key}</code>
						<span class="env-status">set via .env</span>
					</div>
				{/each}
			</div>
			<a href="https://dashboard.stripe.com/{stripeAccount?.id ?? ''}" target="_blank" rel="noopener noreferrer" class="stripe-link">
				Open Stripe Dashboard ↗
			</a>
		</div>
	</div>

	<!-- Admin users -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Admin users</h2>
			<p class="section-note">Grant admin tier via the Users page.</p>
		</div>
		{#if loading}
			<div style="padding:16px;display:flex;flex-direction:column;gap:12px;">
				{#each { length: 2 } as _}
					<div style="display:flex;gap:10px;align-items:center;">
						<div class="skel" style="width:28px;height:28px;border-radius:50%;"></div>
						<div class="skel" style="flex:1;height:12px;border-radius:4px;"></div>
					</div>
				{/each}
			</div>
		{:else if admins.length === 0}
			<div class="panel-empty">
				<p>No admin users found.</p>
				<span>Set a user's tier to "admin" on the Users page.</span>
			</div>
		{:else}
			<div class="table-scroll">
				<table class="data-table" aria-label="Admin users">
					<thead>
						<tr><th>User</th><th>Email</th><th>Joined</th></tr>
					</thead>
					<tbody>
						{#each admins as a}
							<tr>
								<td>
									<div class="user-cell">
										<div class="user-avatar" aria-hidden="true">{(a.displayName || a.email)[0]?.toUpperCase()}</div>
										<div class="user-name">{a.displayName || "—"}</div>
									</div>
								</td>
								<td class="td-email">{a.email}</td>
								<td class="td-date">{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<style>
	.settings-page {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 860px;
		margin: 0 auto;
	}

	.page-header { margin-bottom: 4px; }
	.page-title  { font-size: 1.375rem; margin-bottom: 3px; }
	.page-sub    { font-size: 0.875rem; color: var(--text-secondary); }

	/* Error / retry */
	.load-error {
		background: var(--bg-surface); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg); padding: 16px 20px; font-size: 0.875rem;
		color: var(--text-secondary); display: flex; align-items: center; justify-content: space-between; gap: 12px;
	}
	.load-error p { margin: 0; }
	.retry-btn {
		padding: 6px 14px; font-size: 0.8125rem; background: var(--bg-surface-2);
		border: 1px solid var(--border-default); border-radius: var(--radius-md);
		color: var(--text-secondary); cursor: pointer; white-space: nowrap;
	}
	.retry-btn:hover { background: var(--bg-surface-3); }

	/* Sections */
	.section { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); overflow: hidden; }
	.section-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 14px 16px; border-bottom: 1px solid var(--border-subtle); gap: 8px;
	}
	.section-title        { font-size: 0.9375rem; font-weight: 600; }
	.section-note         { font-size: 0.8125rem; color: var(--text-tertiary); margin: 0; }
	.table-scroll          { overflow-x: auto; -webkit-overflow-scrolling: touch; }

	/* Feature flags */
	.flags-list { padding: 4px 0; }
	.flag-row {
		display: flex; align-items: center; justify-content: space-between;
		padding: 14px 16px; border-top: 1px solid var(--border-subtle); gap: 16px; transition: background 0.1s;
	}
	.flag-row:first-child { border-top: none; }
	.flag-row:hover { background: var(--interactive-hover); }
	.flag-label { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); margin-bottom: 2px; display: flex; align-items: center; gap: 8px; }
	.flag-row--unbuilt .flag-label,
	.flag-row--unbuilt .flag-desc { opacity: 0.6; }
	.flags-note { margin: 0; padding: 10px 16px 14px; font-size: 0.8125rem; color: var(--text-tertiary); border-top: 1px solid var(--border-subtle); }
	.flags-note a { color: var(--text-brand); }
	.flag-desc  { font-size: 0.8125rem; color: var(--text-tertiary); }

	/* Toggle */
	@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
	.toggle {
		width: 36px; height: 20px; border-radius: 10px;
		background: var(--bg-surface-3); border: 1px solid var(--border-default);
		padding: 0; cursor: pointer; position: relative; flex-shrink: 0;
		transition: background 0.2s, border-color 0.2s;
	}
	.toggle--on     { background: var(--color-brand-dim); border-color: var(--color-brand-dim); }
	.toggle--saving { opacity: 0.6; cursor: wait; }
	.toggle:disabled { opacity: 0.5; cursor: not-allowed; }
	.toggle__thumb {
		position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
		border-radius: 50%; background: #fff; transition: transform 0.2s var(--ease-smooth);
		box-shadow: 0 1px 3px rgba(0,0,0,0.2);
	}
	.toggle--on .toggle__thumb { transform: translateX(16px); }

	/* Stripe info */
	.info-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
	.info-text  { font-size: 0.875rem; color: var(--text-secondary); margin: 0; line-height: 1.6; }
	.info-text code { font-family: var(--font-mono); font-size: 0.8125rem; background: var(--bg-surface-2); padding: 1px 5px; border-radius: 3px; }
	.env-list { display: flex; flex-direction: column; gap: 6px; }
	.env-row  { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
	.env-key  { font-family: var(--font-mono); font-size: 0.8125rem; color: var(--text-primary); }
	.env-status { font-size: 0.75rem; color: var(--text-tertiary); }
	.stripe-link { font-size: 0.875rem; color: var(--text-brand); text-decoration: none; }
	.stripe-link:hover { text-decoration: underline; }

	.stripe-account-card {
		display: flex; align-items: center; gap: 12px;
		padding: 12px 14px;
		background: var(--bg-surface-2); border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
	}
	.stripe-account-icon {
		width: 32px; height: 32px; border-radius: var(--radius-md); flex-shrink: 0;
		background: color-mix(in srgb, var(--color-success) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-success) 25%, transparent);
		display: flex; align-items: center; justify-content: center;
		color: var(--color-success);
	}
	.stripe-account-details { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
	.stripe-account-name {
		font-size: 0.9375rem; font-weight: 600; color: var(--text-primary);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.stripe-account-name--unknown { color: var(--text-tertiary); font-style: italic; font-weight: 400; }
	.stripe-account-meta { display: flex; align-items: center; gap: 6px; }
	.stripe-account-email { font-size: 0.8125rem; color: var(--text-secondary); }
	.stripe-account-sep   { font-size: 0.8125rem; color: var(--text-tertiary); }
	.stripe-account-id    { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); }

	/* Admin users table */
	.data-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
	.data-table thead { background: var(--bg-surface-2); }
	.data-table th {
		padding: 9px 16px; text-align: left; font-size: 0.625rem; font-weight: 600;
		font-family: var(--font-mono); color: var(--text-tertiary); text-transform: uppercase;
		letter-spacing: 0.08em; border-bottom: 1px solid var(--border-subtle);
	}
	.data-table tbody tr { border-bottom: 1px solid var(--border-subtle); transition: background 0.1s; }
	.data-table tbody tr:last-child { border-bottom: none; }
	.data-table tbody tr:hover { background: var(--interactive-hover); }
	.data-table td { padding: 10px 16px; vertical-align: middle; }

	.user-cell  { display: flex; align-items: center; gap: 8px; }
	.user-avatar {
		width: 28px; height: 28px; border-radius: 50%;
		background: linear-gradient(135deg, var(--color-brand-dim), #7b5ea7);
		display: flex; align-items: center; justify-content: center;
		font-family: var(--font-display); font-size: 0.6875rem; font-weight: 700; color: #fff; flex-shrink: 0;
	}
	.user-name  { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); }
	.td-email   { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); }
	.td-date    { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); }

	/* Panel empty */
	.panel-empty {
		display: flex; flex-direction: column; align-items: center; gap: 4px;
		padding: 28px 16px; text-align: center;
	}
	.panel-empty p    { margin: 0; font-size: 0.875rem; color: var(--text-secondary); }
	.panel-empty span { font-size: 0.8125rem; color: var(--text-tertiary); }

	/* Skeleton */
	@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
	.skel {
		background: linear-gradient(90deg, var(--bg-surface-2) 25%, var(--bg-surface-3) 50%, var(--bg-surface-2) 75%);
		background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px;
	}

	@media (max-width: 700px) {
		.section-header { flex-wrap: wrap; }
	}
	@media (max-width: 480px) {
		.settings-page { padding: 16px; }
	}
</style>
