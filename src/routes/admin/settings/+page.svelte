<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { auth } from "$lib/firebase/client";
	import { onMount } from "svelte";
	import { toastStore } from "$lib/stores";

	// ── State ──────────────────────────────────────
	let loading = $state(true);
	let error   = $state<string | null>(null);

	let flags = $state<Record<string, { label: string; desc: string; on: boolean }>>({
		aiAssist:         { label: "AI Assist",         desc: "Pattern suggestions and smart nesting.", on: true  },
		commandPalette:   { label: "Command palette",   desc: "Keyboard-driven command search (⌘K).", on: true  },
		exportDXF:        { label: "DXF export",        desc: "Export cut files as DXF format.", on: false },
		exportPDF:        { label: "PDF export",        desc: "Export cut sheets as PDF.", on: true  },
		cutAgent:         { label: "Cut Agent",         desc: "Direct USB/network plotter connection.", on: false },
		openRegistration: { label: "Open registration", desc: "Allow new users to sign up.", on: true  },
		maintenanceMode:  { label: "Maintenance mode",  desc: "Show maintenance banner to all users.", on: false },
	});

	let platform = $state({
		appName:      "OmniPlot",
		supportEmail: "support@omniplot.app",
		docsUrl:      "https://docs.omniplot.app",
		maxFreeCuts:  5,
		maxLiteCuts:  50,
	});

	let admins = $state<{ uid: string; displayName: string; email: string; createdAt: string | null }[]>([]);

	let platformSaving = $state(false);
	let flagSaving     = $state<string | null>(null); // key of flag being saved
	let dangerConfirm  = $state("");
	const DANGER_PHRASE = "delete all data";

	// ── Load settings ──────────────────────────────
	async function loadSettings() {
		loading = true;
		error   = null;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res   = await fetch("/api/admin/settings", {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (!res.ok) throw new Error("Failed to load settings");
			const data = await res.json();

			// Merge loaded values into flags (preserving labels/descs)
			for (const [key, val] of Object.entries(data.flags as Record<string, boolean>)) {
				if (key in flags) flags[key].on = val;
			}
			platform = { ...platform, ...data.platform };
			admins   = data.admins ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not load settings";
		} finally {
			loading = false;
		}
	}

	onMount(loadSettings);

	// ── Toggle a feature flag ──────────────────────
	async function toggleFlag(key: string) {
		const newVal = !flags[key].on;
		flags[key].on = newVal; // optimistic
		flagSaving    = key;
		try {
			const token = await auth.currentUser?.getIdToken();
			const flagPatch: Record<string, boolean> = {};
			for (const [k, f] of Object.entries(flags)) flagPatch[k] = f.on;
			const res = await fetch("/api/admin/settings", {
				method:  "POST",
				headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body:    JSON.stringify({ flags: flagPatch }),
			});
			if (!res.ok) throw new Error("Save failed");
		} catch {
			flags[key].on = !newVal; // revert
			toastStore.error("Save failed", "Could not update feature flag");
		} finally {
			flagSaving = null;
		}
	}

	// ── Save platform settings ─────────────────────
	async function savePlatform() {
		platformSaving = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res   = await fetch("/api/admin/settings", {
				method:  "POST",
				headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body:    JSON.stringify({ platform }),
			});
			if (!res.ok) throw new Error("Save failed");
			toastStore.success("Settings saved", "Platform configuration updated.");
		} catch {
			toastStore.error("Save failed", "Could not update platform settings");
		} finally {
			platformSaving = false;
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
			{#each Object.entries(flags) as [key, flag]}
				<div class="flag-row">
					<div class="flag-info">
						<div class="flag-label">{flag.label}</div>
						<div class="flag-desc">{flag.desc}</div>
					</div>
					<button
						class="toggle"
						class:toggle--on={flag.on}
						class:toggle--saving={flagSaving === key}
						role="switch"
						aria-checked={flag.on}
						aria-label="Toggle {flag.label}"
						onclick={() => toggleFlag(key)}
						disabled={loading || flagSaving !== null}
					>
						<span class="toggle__thumb"></span>
					</button>
				</div>
			{/each}
		</div>
	</div>

	<!-- Platform settings -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Platform</h2>
		</div>
		<div class="form-body">
			{#if loading}
				<div style="display:flex;flex-direction:column;gap:10px;">
					{#each { length: 5 } as _}
						<div style="display:flex;flex-direction:column;gap:4px;">
							<div class="skel" style="width:100px;height:10px;"></div>
							<div class="skel" style="width:100%;height:34px;border-radius:6px;"></div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="form-grid">
					<div class="form-field">
						<label class="field-label" for="app-name">App name</label>
						<input id="app-name" class="field-input" type="text" bind:value={platform.appName} />
					</div>
					<div class="form-field">
						<label class="field-label" for="support-email">Support email</label>
						<input id="support-email" class="field-input" type="email" bind:value={platform.supportEmail} />
					</div>
					<div class="form-field">
						<label class="field-label" for="docs-url">Docs URL</label>
						<input id="docs-url" class="field-input" type="url" bind:value={platform.docsUrl} />
					</div>
					<div class="form-field">
						<label class="field-label" for="free-cuts">Free tier monthly cut limit</label>
						<input id="free-cuts" class="field-input field-input--sm" type="number" min="0" bind:value={platform.maxFreeCuts} />
					</div>
					<div class="form-field">
						<label class="field-label" for="lite-cuts">Lite tier monthly cut limit</label>
						<input id="lite-cuts" class="field-input field-input--sm" type="number" min="0" bind:value={platform.maxLiteCuts} />
					</div>
				</div>
				<div class="form-footer">
					<Button variant="primary" size="sm" onclick={savePlatform} disabled={platformSaving}>
						{#if platformSaving}
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" style="animation:spin 0.9s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
							Saving…
						{:else}
							Save changes
						{/if}
					</Button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Stripe (read-only reference — configured via .env) -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Stripe</h2>
			<Badge variant="default" size="sm">Configured via environment variables</Badge>
		</div>
		<div class="info-body">
			<p class="info-text">
				Stripe keys and price IDs are set in your <code>.env</code> file and are not editable here.
				To update them, modify the environment variables and redeploy.
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
			<a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" class="stripe-link">
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
			<table class="data-table" aria-label="Admin users">
				<thead>
					<tr><th>User</th><th>Email</th><th>Admin since</th></tr>
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
		{/if}
	</div>

	<!-- Danger zone -->
	<div class="section section--danger">
		<div class="section-header">
			<h2 class="section-title section-title--danger">Danger zone</h2>
			<Badge variant="danger" size="sm">Irreversible</Badge>
		</div>
		<div class="danger-body">
			<div class="danger-action danger-action--destructive">
				<div class="danger-info">
					<div class="danger-label">Wipe all user data</div>
					<div class="danger-desc">
						Permanently delete all users, jobs, and patterns from Firestore. This cannot be undone.
						Type <code>{DANGER_PHRASE}</code> to confirm.
					</div>
					<input
						class="danger-confirm-input"
						type="text"
						placeholder="Type the phrase to enable…"
						bind:value={dangerConfirm}
						aria-label="Confirm data wipe"
					/>
				</div>
				<Button variant="danger" size="sm" disabled={dangerConfirm !== DANGER_PHRASE}>
					Wipe all data
				</Button>
			</div>
		</div>
	</div>
</div>

<style>
	.settings-page {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 860px;
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
	.section--danger { border-color: rgba(255,77,109,0.25); }
	.section-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 14px 16px; border-bottom: 1px solid var(--border-subtle); gap: 8px;
	}
	.section-title        { font-size: 0.9375rem; font-weight: 600; }
	.section-title--danger { color: var(--color-danger); }
	.section-note         { font-size: 0.8125rem; color: var(--text-tertiary); margin: 0; }

	/* Feature flags */
	.flags-list { padding: 4px 0; }
	.flag-row {
		display: flex; align-items: center; justify-content: space-between;
		padding: 14px 16px; border-top: 1px solid var(--border-subtle); gap: 16px; transition: background 0.1s;
	}
	.flag-row:first-child { border-top: none; }
	.flag-row:hover { background: var(--interactive-hover); }
	.flag-label { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); margin-bottom: 2px; }
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

	/* Platform form */
	.form-body { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
	.form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
	.form-field { display: flex; flex-direction: column; gap: 6px; }
	.field-label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }
	.field-input {
		padding: 8px 10px; background: var(--bg-base); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); font-size: 0.875rem; font-family: var(--font-body);
		color: var(--text-primary); outline: none; transition: border-color 0.12s;
	}
	.field-input:focus { border-color: var(--color-brand-dim); }
	.field-input--sm   { max-width: 120px; }
	.form-footer { display: flex; justify-content: flex-end; padding-top: 4px; }

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

	/* Danger zone */
	.danger-body { padding: 4px 0; }
	.danger-action {
		display: flex; align-items: flex-start; justify-content: space-between;
		gap: 16px; padding: 16px; border-top: 1px solid var(--border-subtle);
	}
	.danger-action:first-child { border-top: none; }
	.danger-action--destructive { background: rgba(255,77,109,0.03); }
	.danger-label { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); margin-bottom: 3px; }
	.danger-desc  { font-size: 0.8125rem; color: var(--text-tertiary); max-width: 520px; line-height: 1.5; }
	.danger-desc code {
		font-family: var(--font-mono); font-size: 0.8125rem;
		background: var(--bg-surface-3); padding: 1px 5px; border-radius: 3px; color: var(--color-danger);
	}
	.danger-confirm-input {
		margin-top: 10px; padding: 7px 10px; width: 280px;
		background: var(--bg-base); border: 1px solid rgba(255,77,109,0.3);
		border-radius: var(--radius-md); font-size: 0.8125rem; font-family: var(--font-mono);
		color: var(--text-primary); outline: none; transition: border-color 0.12s; display: block;
	}
	.danger-confirm-input:focus { border-color: var(--color-danger); }
	.danger-confirm-input::placeholder { color: var(--text-tertiary); }

	@media (max-width: 700px) {
		.form-grid { grid-template-columns: 1fr; }
		.danger-action { flex-direction: column; }
	}
</style>
