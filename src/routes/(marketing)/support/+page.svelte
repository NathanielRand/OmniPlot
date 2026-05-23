<script lang="ts">
	const TOPICS = [
		{ value: "account",   label: "Account & Login" },
		{ value: "billing",   label: "Billing & Subscription" },
		{ value: "patterns",  label: "Patterns & Library" },
		{ value: "technical", label: "Technical Issue" },
		{ value: "feature",   label: "Feature Request" },
		{ value: "other",     label: "Other" },
	];

	let topic     = $state("technical");
	let name      = $state("");
	let email     = $state("");
	let message   = $state("");
	let submitting = $state(false);
	let submitted  = $state(false);
	let error      = $state<string | null>(null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		submitting = true;
		try {
			const res = await fetch("/api/support", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ topic, name, email, message }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Submission failed");
			submitted = true;
		} catch (err) {
			error = err instanceof Error ? err.message : "Something went wrong. Please try again.";
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Support — OmniPlot</title>
	<meta name="description" content="Get help with OmniPlot. Contact our support team or browse frequently asked questions." />
</svelte:head>

<div class="support-page">

	<!-- Header -->
	<div class="support-header">
		<p class="support-eyebrow">Support</p>
		<h1 class="support-title">How can we help?</h1>
		<p class="support-sub">Browse self-serve resources below or send us a message — we typically respond within one business day.</p>
	</div>

	<!-- Self-serve shortcuts -->
	<div class="support-shortcuts">
		<a href="/faq" class="shortcut-card">
			<div class="shortcut-card__icon" aria-hidden="true">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>
				</svg>
			</div>
			<div class="shortcut-card__body">
				<p class="shortcut-card__title">FAQ</p>
				<p class="shortcut-card__desc">Quick answers to common questions about accounts, billing, patterns, and plotters.</p>
			</div>
			<svg class="shortcut-card__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M5 12h14M12 5l7 7-7 7"/>
			</svg>
		</a>

		<a href="/changelog" class="shortcut-card">
			<div class="shortcut-card__icon" aria-hidden="true">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
					<path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>
				</svg>
			</div>
			<div class="shortcut-card__body">
				<p class="shortcut-card__title">Changelog</p>
				<p class="shortcut-card__desc">See what's new — recent pattern additions, feature releases, and bug fixes.</p>
			</div>
			<svg class="shortcut-card__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M5 12h14M12 5l7 7-7 7"/>
			</svg>
		</a>

		<a href="/pricing" class="shortcut-card">
			<div class="shortcut-card__icon" aria-hidden="true">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
					<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
				</svg>
			</div>
			<div class="shortcut-card__body">
				<p class="shortcut-card__title">Plans & Pricing</p>
				<p class="shortcut-card__desc">Compare Free, Lite, Pro, and Shop plans — cut limits, seats, and export formats.</p>
			</div>
			<svg class="shortcut-card__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M5 12h14M12 5l7 7-7 7"/>
			</svg>
		</a>
	</div>

	<!-- Contact form -->
	<div class="support-form-wrap">
		<div class="support-form-header">
			<h2 class="support-form-title">Send a message</h2>
			<p class="support-form-sub">Can't find your answer above? We'll get back to you within one business day.</p>
		</div>

		{#if submitted}
			<div class="support-success">
				<div class="support-success__icon" aria-hidden="true">
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
					</svg>
				</div>
				<h3 class="support-success__title">Message received</h3>
				<p class="support-success__body">Thanks for reaching out. We'll reply to <strong>{email}</strong> within one business day.</p>
				<button class="support-success__reset" onclick={() => { submitted = false; message = ""; }}>
					Send another message
				</button>
			</div>
		{:else}
			<form class="support-form" onsubmit={submit} novalidate>
				<!-- Topic -->
				<div class="form-field">
					<label class="form-label" for="topic">Topic</label>
					<div class="form-select-wrap">
						<select id="topic" class="form-select" bind:value={topic} required>
							{#each TOPICS as t}
								<option value={t.value}>{t.label}</option>
							{/each}
						</select>
						<svg class="form-select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
							<path d="M6 9l6 6 6-6"/>
						</svg>
					</div>
				</div>

				<!-- Name + Email -->
				<div class="form-row">
					<div class="form-field">
						<label class="form-label" for="name">Name <span class="form-optional">(optional)</span></label>
						<input
							id="name"
							class="form-input"
							type="text"
							placeholder="Your name"
							autocomplete="name"
							bind:value={name}
						/>
					</div>
					<div class="form-field">
						<label class="form-label" for="email">Email <span class="form-required" aria-hidden="true">*</span></label>
						<input
							id="email"
							class="form-input"
							type="email"
							placeholder="you@example.com"
							autocomplete="email"
							required
							bind:value={email}
						/>
					</div>
				</div>

				<!-- Message -->
				<div class="form-field">
					<label class="form-label" for="message">
						Message <span class="form-required" aria-hidden="true">*</span>
					</label>
					<textarea
						id="message"
						class="form-textarea"
						placeholder="Describe what you're experiencing or what you need help with…"
						rows="6"
						required
						bind:value={message}
					></textarea>
				</div>

				{#if error}
					<p class="form-error" role="alert">{error}</p>
				{/if}

				<div class="form-actions">
					<button class="form-submit" type="submit" disabled={submitting || !email || !message}>
						{#if submitting}
							<svg class="form-submit__spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
								<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
							</svg>
							Sending…
						{:else}
							Send message
						{/if}
					</button>
					<p class="form-privacy">
						Your message is stored securely and only used to respond to your request.
						See our <a href="/privacy">Privacy Policy</a>.
					</p>
				</div>
			</form>
		{/if}
	</div>

</div>

<style>
	.support-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 64px 24px 96px;
	}

	/* ── Header ───────────────────────────────── */
	.support-header {
		text-align: center;
		margin-bottom: 48px;
	}
	.support-eyebrow {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-brand);
		margin: 0 0 12px;
	}
	.support-title {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		margin: 0 0 12px;
	}
	.support-sub {
		font-size: 1rem;
		color: var(--text-secondary);
		line-height: 1.65;
		max-width: 480px;
		margin: 0 auto;
	}

	/* ── Shortcuts ────────────────────────────── */
	.support-shortcuts {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-bottom: 56px;
	}
	.shortcut-card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 20px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		text-decoration: none;
		color: inherit;
		transition: border-color 0.12s, box-shadow 0.12s;
		position: relative;
	}
	.shortcut-card:hover {
		border-color: var(--color-brand-dim);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-brand) 8%, transparent);
	}
	.shortcut-card__icon {
		width: 38px;
		height: 38px;
		border-radius: var(--radius-md);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-brand);
		flex-shrink: 0;
	}
	.shortcut-card__body {
		flex: 1;
	}
	.shortcut-card__title {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 4px;
	}
	.shortcut-card__desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.5;
		margin: 0;
	}
	.shortcut-card__arrow {
		color: var(--text-tertiary);
		align-self: flex-end;
		transition: transform 0.12s, color 0.12s;
	}
	.shortcut-card:hover .shortcut-card__arrow {
		transform: translateX(2px);
		color: var(--color-brand);
	}

	/* ── Form section ─────────────────────────── */
	.support-form-wrap {
		border-top: 1px solid var(--border-subtle);
		padding-top: 48px;
	}
	.support-form-header {
		margin-bottom: 32px;
	}
	.support-form-title {
		font-size: 1.25rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0 0 6px;
	}
	.support-form-sub {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		margin: 0;
	}

	/* ── Form fields ──────────────────────────── */
	.support-form {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.form-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.form-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
	}
	.form-optional {
		font-weight: 400;
		color: var(--text-tertiary);
	}
	.form-required {
		color: var(--color-danger, #ef4444);
		margin-left: 1px;
	}
	.form-input,
	.form-select,
	.form-textarea {
		width: 100%;
		padding: 10px 14px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.9375rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s, box-shadow 0.12s;
		box-sizing: border-box;
	}
	.form-input:focus,
	.form-select:focus,
	.form-textarea:focus {
		border-color: var(--color-brand-dim);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-brand) 10%, transparent);
	}
	.form-input::placeholder,
	.form-textarea::placeholder {
		color: var(--text-tertiary);
	}
	.form-select-wrap {
		position: relative;
	}
	.form-select {
		appearance: none;
		padding-right: 36px;
		cursor: pointer;
	}
	.form-select-caret {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-tertiary);
		pointer-events: none;
	}
	.form-textarea {
		resize: vertical;
		min-height: 140px;
		line-height: 1.6;
	}

	/* ── Error ────────────────────────────────── */
	.form-error {
		font-size: 0.875rem;
		color: var(--color-danger, #ef4444);
		margin: 0;
		padding: 12px 14px;
		background: color-mix(in srgb, var(--color-danger, #ef4444) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-danger, #ef4444) 25%, transparent);
		border-radius: var(--radius-md);
	}

	/* ── Submit ───────────────────────────────── */
	.form-actions {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.form-submit {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 11px 24px;
		background: var(--color-brand-dim);
		color: #fff;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.12s;
		align-self: flex-start;
	}
	.form-submit:hover:not(:disabled) { opacity: 0.85; }
	.form-submit:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	@keyframes spin {
		from { transform: rotate(0deg); }
		to   { transform: rotate(360deg); }
	}
	.form-submit__spinner {
		animation: spin 0.9s linear infinite;
	}
	.form-privacy {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		margin: 0;
	}
	.form-privacy a {
		color: var(--text-brand);
		text-decoration: none;
	}
	.form-privacy a:hover { text-decoration: underline; }

	/* ── Success ──────────────────────────────── */
	.support-success {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 48px 24px;
		gap: 12px;
	}
	.support-success__icon {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--color-brand) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-brand) 25%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-brand);
		margin-bottom: 4px;
	}
	.support-success__title {
		font-size: 1.25rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0;
	}
	.support-success__body {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin: 0;
		max-width: 380px;
	}
	.support-success__body strong {
		color: var(--text-primary);
	}
	.support-success__reset {
		margin-top: 8px;
		background: none;
		border: none;
		font-size: 0.875rem;
		color: var(--text-brand);
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* ── Responsive ───────────────────────────── */
	@media (max-width: 600px) {
		.support-shortcuts {
			grid-template-columns: 1fr;
		}
		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
