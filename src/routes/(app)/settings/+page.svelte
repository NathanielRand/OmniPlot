<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { toastStore, themeStore, plotterStore } from "$lib/stores";
	import { PLOTTER_PRESETS, PRICING_PLANS } from "$lib/config";

	let activeTab = $state<
		"profile" | "plotter" | "billing" | "notifications" | "danger"
	>("profile");

	// Profile form
	let displayName = $state("Nick Radford");
	let email = $state("nick@omniplot.app");
	let shopName = $state("Radford Auto Wraps");
	let saving = $state(false);

	async function saveProfile() {
		saving = true;
		await new Promise((r) => setTimeout(r, 800));
		saving = false;
		toastStore.success("Profile saved", "Your changes have been applied.");
	}

	// Notification prefs
	let notifs = $state({
		jobComplete: true,
		jobFailed: true,
		usageWarning: true,
		newsletter: false,
		changelog: true,
	});

	const TABS = [
		{
			id: "profile",
			label: "Profile",
			icon: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
		},
		{
			id: "plotter",
			label: "Plotter",
			icon: "M6 6a3 3 0 100-6 3 3 0 000 6zM6 18a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12",
		},
		{
			id: "billing",
			label: "Billing",
			icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
		},
		{
			id: "notifications",
			label: "Notifications",
			icon: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0",
		},
		{
			id: "danger",
			label: "Danger Zone",
			icon: "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
		},
	] as const;

	const currentPlan = PRICING_PLANS[0]; // Free for demo
</script>

<svelte:head><title>Settings — OmniPlot</title></svelte:head>

<div class="settings-page">
	<!-- Sidebar nav -->
	<nav class="settings-nav" aria-label="Settings sections">
		{#each TABS as tab}
			<button
				class="settings-nav-item"
				class:active={activeTab === tab.id}
				class:danger={tab.id === "danger"}
				onclick={() => (activeTab = tab.id)}
				aria-current={activeTab === tab.id ? "page" : undefined}
			>
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d={tab.icon} />
				</svg>
				{tab.label}
			</button>
		{/each}
	</nav>

	<!-- Content -->
	<div class="settings-content">
		<!-- ─── Profile ─── -->
		{#if activeTab === "profile"}
			<div class="settings-section">
				<h2 class="settings-section-title">Profile</h2>
				<p class="settings-section-sub">
					Your account information and shop details.
				</p>

				<div class="form-grid">
					<div class="form-field">
						<label for="displayName" class="form-label"
							>Display name</label
						>
						<input
							id="displayName"
							class="form-input"
							type="text"
							bind:value={displayName}
						/>
					</div>
					<div class="form-field">
						<label for="email" class="form-label">Email</label>
						<input
							id="email"
							class="form-input"
							type="email"
							bind:value={email}
						/>
					</div>
					<div class="form-field form-field--full">
						<label for="shopName" class="form-label"
							>Shop / Business name</label
						>
						<input
							id="shopName"
							class="form-input"
							type="text"
							bind:value={shopName}
						/>
					</div>
				</div>

				<div class="form-actions">
					<Button
						variant="primary"
						size="sm"
						loading={saving}
						onclick={saveProfile}
					>
						Save changes
					</Button>
				</div>
			</div>

			<div class="settings-divider" aria-hidden="true"></div>

			<div class="settings-section">
				<h3 class="settings-section-title">Appearance</h3>
				<div class="appearance-row">
					<div>
						<div class="form-label">Theme</div>
						<p class="form-hint">
							Choose how OmniPlot looks for you.
						</p>
					</div>
					<div
						class="theme-options"
						role="group"
						aria-label="Theme selection"
					>
						{#each ["dark", "light"] as const as t}
							<button
								class="theme-option"
								class:active={themeStore.current === t}
								onclick={() => themeStore.set(t)}
								aria-pressed={themeStore.current === t}
							>
								<div
									class="theme-option__preview theme-option__preview--{t}"
									aria-hidden="true"
								></div>
								<span
									>{t.charAt(0).toUpperCase() +
										t.slice(1)}</span
								>
							</button>
						{/each}
					</div>
				</div>
			</div>

			<!-- ─── Plotter ─── -->
		{:else if activeTab === "plotter"}
			<div class="settings-section">
				<h2 class="settings-section-title">Plotter Settings</h2>
				<p class="settings-section-sub">
					Configure your cutting device. Settings are saved
					per-session.
				</p>

				<div class="form-field">
					<label for="plotterPreset" class="form-label"
						>Device preset</label
					>
					<select
						id="plotterPreset"
						class="form-select"
						onchange={(e) => {
							const p = PLOTTER_PRESETS.find(
								(pr) =>
									pr.name ===
									(e.target as HTMLSelectElement).value,
							);
							if (p) plotterStore.applyPreset(p);
							toastStore.success("Preset applied", p?.name);
						}}
					>
						{#each PLOTTER_PRESETS as preset}
							<option
								value={preset.name}
								selected={plotterStore.config.name ===
									preset.name}>{preset.name}</option
							>
						{/each}
					</select>
				</div>

				<div class="form-grid">
					{#each [["Blade Force (g)", "bladeForce", 10, 200], ["Speed (mm/s)", "cuttingSpeed", 50, 900], ["Passes", "passes", 1, 4], ["Overcut (mm)", "overcut", 0, 2]] as const as [label, key, min, max]}
						<div class="form-field">
							<label class="form-label">{label}</label>
							<div class="slider-row">
								<input
									type="range"
									class="form-slider"
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
								<span class="slider-val"
									>{plotterStore.config[key]}</span
								>
							</div>
						</div>
					{/each}
				</div>

				<div class="form-field">
					<label for="connection" class="form-label"
						>Connection method</label
					>
					<select
						id="connection"
						class="form-select"
						onchange={(e) =>
							plotterStore.update({
								connection: (e.target as HTMLSelectElement)
									.value as any,
							})}
					>
						<option value="download"
							>Download PLT file (universal)</option
						>
						<option value="usb-serial"
							>USB via Web Serial API (Chrome/Edge only)</option
						>
						<option value="network">Network TCP/IP</option>
						<option value="cut-agent">Local Cut Agent</option>
					</select>
					<p class="form-hint">
						Web Serial requires Chrome or Edge. All other methods
						work in any browser.
					</p>
				</div>

				<div class="form-actions">
					<Button
						variant="primary"
						size="sm"
						onclick={() =>
							toastStore.success("Plotter settings saved")}
					>
						Save plotter settings
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onclick={() =>
							toastStore.info(
								"Test cut sent",
								'A 1" × 1" test square was sent to your plotter.',
							)}
					>
						Send test cut
					</Button>
				</div>
			</div>

			<!-- ─── Billing ─── -->
		{:else if activeTab === "billing"}
			<div class="settings-section">
				<h2 class="settings-section-title">Plan & Billing</h2>
				<p class="settings-section-sub">Manage your subscription.</p>

				<div class="billing-current">
					<div class="billing-plan">
						<div class="billing-plan__header">
							<div>
								<div class="billing-plan__name">Free Plan</div>
								<div class="billing-plan__desc">
									1 cut per 30 days
								</div>
							</div>
							<Badge variant="free">Current plan</Badge>
						</div>
						<div class="billing-plan__usage">
							<div class="usage-row">
								<span class="usage-label">Cuts this period</span
								>
								<span class="usage-val">0 / 1</span>
							</div>
							<div
								class="usage-bar-track"
								role="progressbar"
								aria-valuenow={0}
								aria-valuemax={1}
							>
								<div
									class="usage-bar-fill"
									style="width: 0%"
								></div>
							</div>
							<p class="usage-reset">Resets in 28 days</p>
						</div>
					</div>
				</div>

				<div class="upgrade-callout">
					<div class="upgrade-callout__icon" aria-hidden="true">
						⚡
					</div>
					<div>
						<div class="upgrade-callout__title">
							Upgrade to Lite or Pro
						</div>
						<p class="upgrade-callout__sub">
							Get more cuts, auto-nesting, and direct plotter
							control.
						</p>
					</div>
					<Button variant="primary" size="sm" href="/pricing"
						>View plans</Button
					>
				</div>

				<div class="settings-section">
					<h3 class="settings-section-title">Billing history</h3>
					<div class="billing-empty">No invoices yet.</div>
				</div>
			</div>

			<!-- ─── Notifications ─── -->
		{:else if activeTab === "notifications"}
			<div class="settings-section">
				<h2 class="settings-section-title">Notifications</h2>
				<p class="settings-section-sub">
					Control what emails and alerts you receive.
				</p>

				<div class="notif-list">
					{#each [["jobComplete", "Job complete", "Get notified when a cut job finishes."], ["jobFailed", "Job failed", "Get notified when a cut job fails or has errors."], ["usageWarning", "Usage warning", "Alert when you're approaching your tier limit."], ["changelog", "Changelog", "Notify me about new features and updates."], ["newsletter", "Newsletter", "Occasional tips, tutorials, and news."]] as const as [key, label, desc]}
						<div class="notif-row">
							<div>
								<div class="notif-label">{label}</div>
								<div class="notif-desc">{desc}</div>
							</div>
							<button
								class="toggle"
								class:on={notifs[key]}
								role="switch"
								aria-checked={notifs[key]}
								aria-label={label}
								onclick={() =>
									(notifs = {
										...notifs,
										[key]: !notifs[key],
									})}
							>
								<span class="toggle__thumb" aria-hidden="true"
								></span>
							</button>
						</div>
					{/each}
				</div>

				<div class="form-actions">
					<Button
						variant="primary"
						size="sm"
						onclick={() =>
							toastStore.success(
								"Notification preferences saved",
							)}
					>
						Save preferences
					</Button>
				</div>
			</div>

			<!-- ─── Danger Zone ─── -->
		{:else if activeTab === "danger"}
			<div class="settings-section">
				<h2 class="settings-section-title danger-title">Danger Zone</h2>
				<p class="settings-section-sub">
					These actions are permanent and cannot be undone.
				</p>

				<div class="danger-card">
					<div>
						<div class="danger-card__title">
							Clear all job history
						</div>
						<p class="danger-card__desc">
							Permanently delete all cut jobs. Patterns in the
							library are not affected.
						</p>
					</div>
					<Button
						variant="danger"
						size="sm"
						onclick={() =>
							toastStore.warning(
								"Not implemented",
								"This would clear all job history.",
							)}
					>
						Clear history
					</Button>
				</div>

				<div class="danger-card">
					<div>
						<div class="danger-card__title">
							Cancel subscription
						</div>
						<p class="danger-card__desc">
							Your plan will revert to Free at the end of the
							billing period.
						</p>
					</div>
					<Button
						variant="danger"
						size="sm"
						onclick={() =>
							toastStore.info(
								"No active subscription",
								"You are on the Free plan.",
							)}
					>
						Cancel plan
					</Button>
				</div>

				<div class="danger-card danger-card--severe">
					<div>
						<div class="danger-card__title">Delete account</div>
						<p class="danger-card__desc">
							Permanently delete your account, all jobs, and all
							data. This cannot be undone.
						</p>
					</div>
					<Button
						variant="danger"
						size="sm"
						onclick={() =>
							toastStore.error(
								"Not implemented",
								"Contact support to delete your account.",
							)}
					>
						Delete account
					</Button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.settings-page {
		display: grid;
		grid-template-columns: 200px 1fr;
		height: 100%;
		overflow: hidden;
	}

	/* ─── Nav ────── */
	.settings-nav {
		background: var(--bg-surface);
		border-right: 1px solid var(--border-subtle);
		padding: 16px 10px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
	}

	.settings-nav-item {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 8px 10px;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		color: var(--text-tertiary);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		transition: all 0.12s;
		width: 100%;
	}

	.settings-nav-item:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}
	.settings-nav-item.active {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}
	.settings-nav-item.danger {
		color: var(--color-danger);
	}
	.settings-nav-item.danger:hover,
	.settings-nav-item.danger.active {
		background: rgba(255, 77, 109, 0.08);
		color: var(--color-danger);
	}

	/* ─── Content ────── */
	.settings-content {
		overflow-y: auto;
		padding: 28px;
	}

	.settings-section {
		max-width: 560px;
	}
	.settings-section-title {
		font-size: 1.125rem;
		margin-bottom: 4px;
	}
	.settings-section-sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: 24px;
	}

	.settings-divider {
		max-width: 560px;
		height: 1px;
		background: var(--border-subtle);
		margin: 28px 0;
	}

	/* Forms */
	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		margin-bottom: 20px;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.form-field--full {
		grid-column: 1 / -1;
	}

	.form-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.form-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 4px;
	}

	.form-input,
	.form-select {
		padding: 8px 11px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
		width: 100%;
	}

	.form-input:focus,
	.form-select:focus {
		border-color: var(--color-brand-dim);
	}

	.form-select {
		cursor: pointer;
	}

	.slider-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.form-slider {
		flex: 1;
		-webkit-appearance: none;
		height: 4px;
		background: var(--bg-surface-3);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.form-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-brand-dim);
		cursor: pointer;
		border: 2px solid var(--bg-surface);
	}

	.slider-val {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
		min-width: 32px;
		text-align: right;
	}

	.form-actions {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 20px;
	}

	/* Appearance */
	.appearance-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
	}

	.theme-options {
		display: flex;
		gap: 8px;
	}

	.theme-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		background: var(--bg-surface);
		border: 1.5px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.75rem;
		font-family: var(--font-body);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
		font-weight: 500;
	}

	.theme-option:hover {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}
	.theme-option.active {
		border-color: var(--color-brand-dim);
		color: var(--text-primary);
	}

	.theme-option__preview {
		width: 52px;
		height: 34px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
	}

	.theme-option__preview--dark {
		background: #0e1118;
	}
	.theme-option__preview--light {
		background: #f8fafc;
	}

	/* Billing */
	.billing-current {
		margin-bottom: 20px;
	}

	.billing-plan {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.billing-plan__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.billing-plan__name {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 2px;
	}
	.billing-plan__desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.usage-row {
		display: flex;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	.usage-label {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}
	.usage-val {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--text-primary);
	}

	.usage-bar-track {
		height: 4px;
		background: var(--bg-surface-3);
		border-radius: 2px;
		overflow: hidden;
		margin-bottom: 6px;
	}

	.usage-bar-fill {
		height: 100%;
		background: var(--color-brand-dim);
		border-radius: 2px;
		transition: width 0.4s var(--ease-smooth);
	}

	.usage-reset {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.upgrade-callout {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		background: rgba(0, 112, 255, 0.06);
		border: 1px solid rgba(0, 112, 255, 0.2);
		border-radius: var(--radius-lg);
		margin-bottom: 24px;
	}

	.upgrade-callout__icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}
	.upgrade-callout__title {
		font-size: 0.9375rem;
		font-weight: 600;
		margin-bottom: 2px;
	}
	.upgrade-callout__sub {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.billing-empty {
		font-size: 0.875rem;
		color: var(--text-tertiary);
		padding: 20px 0;
	}

	/* Notifications */
	.notif-list {
		display: flex;
		flex-direction: column;
		gap: 0;
		margin-bottom: 20px;
	}

	.notif-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 0;
		border-bottom: 1px solid var(--border-subtle);
	}

	.notif-row:last-child {
		border-bottom: none;
	}

	.notif-label {
		font-size: 0.875rem;
		font-weight: 500;
		margin-bottom: 2px;
	}
	.notif-desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	/* Toggle switch */
	.toggle {
		width: 36px;
		height: 20px;
		border-radius: 10px;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		cursor: pointer;
		position: relative;
		transition:
			background 0.2s,
			border-color 0.2s;
		flex-shrink: 0;
	}

	.toggle.on {
		background: var(--color-brand-dim);
		border-color: var(--color-brand-dim);
	}

	.toggle__thumb {
		position: absolute;
		top: 1px;
		left: 1px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.2s var(--ease-smooth);
		display: block;
	}

	.toggle.on .toggle__thumb {
		transform: translateX(16px);
	}

	/* Danger zone */
	.danger-title {
		color: var(--color-danger);
	}

	.danger-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		margin-bottom: 10px;
	}

	.danger-card--severe {
		border-color: rgba(255, 77, 109, 0.3);
		background: rgba(255, 77, 109, 0.04);
	}

	.danger-card__title {
		font-size: 0.9375rem;
		font-weight: 600;
		margin-bottom: 3px;
	}
	.danger-card__desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		max-width: 360px;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.settings-page {
			grid-template-columns: 1fr;
		}
		.settings-nav {
			display: none;
		}
		.form-grid {
			grid-template-columns: 1fr;
		}
		.appearance-row {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
