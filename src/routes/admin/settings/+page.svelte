<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";

	// ── Feature flags ─────────────────────────────────────────
	let flags = $state({
		aiAssist:         { label: "AI Assist",         desc: "Pattern suggestions and smart nesting.", on: true  },
		commandPalette:   { label: "Command palette",   desc: "Keyboard-driven command search (⌘K).", on: true  },
		exportDXF:        { label: "DXF export",        desc: "Export cut files as DXF format.", on: false },
		exportPDF:        { label: "PDF export",        desc: "Export cut sheets as PDF.", on: true  },
		cutAgent:         { label: "Cut Agent",         desc: "Direct USB/network plotter connection.", on: false },
		openRegistration: { label: "Open registration", desc: "Allow new users to sign up.", on: true  },
		maintenanceMode:  { label: "Maintenance mode",  desc: "Show maintenance banner to all users.", on: false },
	});

	// ── Platform settings ─────────────────────────────────────
	let platform = $state({
		appName:      "OmniPlot",
		supportEmail: "support@omniplot.app",
		docsUrl:      "https://docs.omniplot.app",
		maxFreecuts:  5,
		maxLiteCuts:  50,
	});

	// ── Stripe config ─────────────────────────────────────────
	let stripe = $state({
		publicKey:     "pk_live_••••••••••••••••",
		webhookSecret: "whsec_••••••••••••••••",
		liteMonthlyId: "price_lite_monthly_001",
		proMonthlyId:  "price_pro_monthly_001",
		liteYearlyId:  "price_lite_yearly_001",
		proYearlyId:   "price_pro_yearly_001",
	});

	// ── Admin users ───────────────────────────────────────────
	const ADMINS = [
		{ name: "Nathan R.", email: "nathan@omniplot.app", role: "owner",  since: "2024-07-01" },
		{ name: "Dev Bot",   email: "dev@omniplot.app",   role: "dev",    since: "2024-08-15" },
	];

	let platformSaved  = $state(false);
	let stripeSaved    = $state(false);
	let dangerConfirm  = $state("");
	const DANGER_PHRASE = "delete all data";

	function savePlatform() {
		platformSaved = true;
		setTimeout(() => (platformSaved = false), 2500);
	}

	function saveStripe() {
		stripeSaved = true;
		setTimeout(() => (stripeSaved = false), 2500);
	}
</script>

<svelte:head><title>Settings — Admin — OmniPlot</title></svelte:head>

<div class="settings-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Settings</h1>
			<p class="page-sub">Platform configuration, feature flags, and integrations.</p>
		</div>
	</div>

	<!-- Feature flags -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Feature flags</h2>
			<Badge variant="info" size="sm">Changes apply immediately</Badge>
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
						role="switch"
						aria-checked={flag.on}
						aria-label="Toggle {flag.label}"
						onclick={() => (flags[key as keyof typeof flags].on = !flag.on)}
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
					<label class="field-label" for="free-cuts">Free tier daily cut limit</label>
					<input id="free-cuts" class="field-input field-input--sm" type="number" min="0" bind:value={platform.maxFreecuts} />
				</div>
				<div class="form-field">
					<label class="field-label" for="lite-cuts">Lite tier daily cut limit</label>
					<input id="lite-cuts" class="field-input field-input--sm" type="number" min="0" bind:value={platform.maxLiteCuts} />
				</div>
			</div>
			<div class="form-footer">
				<Button variant="primary" size="sm" onclick={savePlatform}>
					{#if platformSaved}
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
						Saved
					{:else}
						Save changes
					{/if}
				</Button>
			</div>
		</div>
	</div>

	<!-- Stripe integration -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Stripe</h2>
			<Badge variant="success" size="sm" dot>Connected</Badge>
		</div>
		<div class="form-body">
			<div class="form-grid">
				<div class="form-field">
					<label class="field-label" for="stripe-pk">Publishable key</label>
					<input id="stripe-pk" class="field-input field-input--mono" type="text" bind:value={stripe.publicKey} />
				</div>
				<div class="form-field">
					<label class="field-label" for="stripe-wh">Webhook secret</label>
					<input id="stripe-wh" class="field-input field-input--mono" type="password" bind:value={stripe.webhookSecret} />
				</div>
				<div class="form-field">
					<label class="field-label" for="lite-mo">Lite monthly price ID</label>
					<input id="lite-mo" class="field-input field-input--mono" type="text" bind:value={stripe.liteMonthlyId} />
				</div>
				<div class="form-field">
					<label class="field-label" for="pro-mo">Pro monthly price ID</label>
					<input id="pro-mo" class="field-input field-input--mono" type="text" bind:value={stripe.proMonthlyId} />
				</div>
				<div class="form-field">
					<label class="field-label" for="lite-yr">Lite yearly price ID</label>
					<input id="lite-yr" class="field-input field-input--mono" type="text" bind:value={stripe.liteYearlyId} />
				</div>
				<div class="form-field">
					<label class="field-label" for="pro-yr">Pro yearly price ID</label>
					<input id="pro-yr" class="field-input field-input--mono" type="text" bind:value={stripe.proYearlyId} />
				</div>
			</div>
			<div class="form-footer">
				<Button variant="primary" size="sm" onclick={saveStripe}>
					{#if stripeSaved}
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
						Saved
					{:else}
						Save changes
					{/if}
				</Button>
			</div>
		</div>
	</div>

	<!-- Admin users -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Admin users</h2>
			<Button variant="secondary" size="sm">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
				Invite admin
			</Button>
		</div>
		<table class="data-table" aria-label="Admin users">
			<thead>
				<tr>
					<th>User</th>
					<th>Role</th>
					<th>Admin since</th>
					<th class="th-actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each ADMINS as a}
					<tr>
						<td>
							<div class="user-cell">
								<div class="user-avatar" aria-hidden="true">{a.name[0]}</div>
								<div>
									<div class="user-name">{a.name}</div>
									<div class="user-email">{a.email}</div>
								</div>
							</div>
						</td>
						<td>
							<Badge variant={a.role === "owner" ? "pro" : "default"} size="sm">{a.role}</Badge>
						</td>
						<td class="td-date">{a.since}</td>
						<td class="td-actions">
							{#if a.role !== "owner"}
								<button class="row-btn row-btn--danger" title="Revoke access" aria-label="Revoke {a.name}">
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg>
								</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Danger zone -->
	<div class="section section--danger">
		<div class="section-header">
			<h2 class="section-title section-title--danger">Danger zone</h2>
			<Badge variant="danger" size="sm">Irreversible</Badge>
		</div>
		<div class="danger-body">
			<div class="danger-action">
				<div class="danger-info">
					<div class="danger-label">Flush job queue</div>
					<div class="danger-desc">Remove all queued and in-progress cut jobs. Active jobs will be aborted.</div>
				</div>
				<Button variant="danger" size="sm">Flush queue</Button>
			</div>
			<div class="danger-action">
				<div class="danger-info">
					<div class="danger-label">Clear analytics cache</div>
					<div class="danger-desc">Force-recalculate all aggregated metrics. May take several minutes.</div>
				</div>
				<Button variant="secondary" size="sm">Clear cache</Button>
			</div>
			<div class="danger-action danger-action--destructive">
				<div class="danger-info">
					<div class="danger-label">Wipe all user data</div>
					<div class="danger-desc">Permanently delete all users, jobs, and patterns. This cannot be undone. Type <code>{DANGER_PHRASE}</code> to confirm.</div>
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

	.section {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		overflow: hidden;
	}

	.section--danger { border-color: rgba(255, 77, 109, 0.25); }

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border-subtle);
		gap: 8px;
	}

	.section-title { font-size: 0.9375rem; font-weight: 600; }
	.section-title--danger { color: var(--color-danger); }

	/* Feature flags */
	.flags-list { padding: 4px 0; }

	.flag-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-top: 1px solid var(--border-subtle);
		gap: 16px;
		transition: background 0.1s;
	}
	.flag-row:first-child { border-top: none; }
	.flag-row:hover { background: var(--interactive-hover); }

	.flag-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
		margin-bottom: 2px;
	}

	.flag-desc {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	/* Toggle switch */
	.toggle {
		width: 36px;
		height: 20px;
		border-radius: 10px;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		padding: 0;
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
		transition: background 0.2s, border-color 0.2s;
	}

	.toggle--on {
		background: var(--color-brand-dim);
		border-color: var(--color-brand-dim);
	}

	.toggle__thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.2s var(--ease-smooth);
		box-shadow: 0 1px 3px rgba(0,0,0,0.2);
	}

	.toggle--on .toggle__thumb {
		transform: translateX(16px);
	}

	/* Form */
	.form-body { padding: 16px; display: flex; flex-direction: column; gap: 16px; }

	.form-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 14px;
	}

	.form-field { display: flex; flex-direction: column; gap: 6px; }

	.field-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.field-input {
		padding: 8px 10px;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
	}
	.field-input:focus { border-color: var(--color-brand-dim); }
	.field-input--sm  { max-width: 120px; }
	.field-input--mono { font-family: var(--font-mono); font-size: 0.8125rem; }

	.form-footer {
		display: flex;
		justify-content: flex-end;
		padding-top: 4px;
	}

	/* Admin users table */
	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.data-table thead { background: var(--bg-surface-2); }

	.data-table th {
		padding: 9px 16px;
		text-align: left;
		font-size: 0.625rem;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		border-bottom: 1px solid var(--border-subtle);
	}

	.data-table tbody tr {
		border-bottom: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}
	.data-table tbody tr:last-child { border-bottom: none; }
	.data-table tbody tr:hover { background: var(--interactive-hover); }
	.data-table td { padding: 10px 16px; vertical-align: middle; }

	.th-actions { width: 60px; }

	.user-cell { display: flex; align-items: center; gap: 8px; }

	.user-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-brand-dim), #7b5ea7);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-size: 0.6875rem;
		font-weight: 700;
		color: #fff;
		flex-shrink: 0;
	}

	.user-name  { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); }
	.user-email { font-size: 0.6875rem; color: var(--text-tertiary); }

	.td-date    { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); }
	.td-actions { text-align: right; }

	.row-btn {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
	}

	.row-btn--danger:hover {
		background: rgba(255, 77, 109, 0.1);
		color: var(--color-danger);
		border-color: rgba(255, 77, 109, 0.2);
	}

	/* Danger zone */
	.danger-body { padding: 4px 0; }

	.danger-action {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 16px;
		border-top: 1px solid var(--border-subtle);
	}
	.danger-action:first-child { border-top: none; }

	.danger-action--destructive { background: rgba(255, 77, 109, 0.03); }

	.danger-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
		margin-bottom: 3px;
	}

	.danger-desc {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		max-width: 520px;
		line-height: 1.5;
	}

	.danger-desc code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		background: var(--bg-surface-3);
		padding: 1px 5px;
		border-radius: 3px;
		color: var(--color-danger);
	}

	.danger-confirm-input {
		margin-top: 10px;
		padding: 7px 10px;
		width: 280px;
		background: var(--bg-base);
		border: 1px solid rgba(255, 77, 109, 0.3);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-family: var(--font-mono);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
		display: block;
	}
	.danger-confirm-input:focus { border-color: var(--color-danger); }
	.danger-confirm-input::placeholder { color: var(--text-tertiary); }

	@media (max-width: 700px) {
		.form-grid { grid-template-columns: 1fr; }
		.danger-action { flex-direction: column; }
	}
</style>
