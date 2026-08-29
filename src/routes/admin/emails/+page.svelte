<script lang="ts">
	import { onMount } from 'svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { auth } from '$lib/firebase/client';
	import { toastStore, userStore } from '$lib/stores';

	type EmailType = 'welcome' | 'upgrade' | 'receipt' | 'cancellation' | 'refund' | 'monthly_report';
	type SendStatus = 'idle' | 'sending' | 'sent' | 'error';

	interface EmailTemplate {
		type:        EmailType;
		label:       string;
		description: string;
		trigger:     string;
	}

	const TEMPLATES: EmailTemplate[] = [
		{
			type:        'welcome',
			label:       'Welcome',
			description: 'Sent to new users immediately after they create an account.',
			trigger:     'New user sign-up',
		},
		{
			type:        'upgrade',
			label:       'Upgrade Confirmation',
			description: 'Confirms a successful plan upgrade with plan details and next renewal date.',
			trigger:     'checkout.session.completed (subscription)',
		},
		{
			type:        'receipt',
			label:       'Payment Receipt',
			description: 'Sent for recurring billing renewals with payment amount and invoice PDF link.',
			trigger:     'invoice.payment_succeeded (renewal)',
		},
		{
			type:        'cancellation',
			label:       'Cancellation',
			description: 'Notifies the user their subscription is set to cancel, with access-until date.',
			trigger:     'User cancels subscription',
		},
		{
			type:        'refund',
			label:       'Refund Confirmed',
			description: 'Confirms a refund has been issued and states expected arrival window.',
			trigger:     'charge.refunded',
		},
		{
			type:        'monthly_report',
			label:       'Monthly Usage Report',
			description: 'Sent on the 1st of each month showing cuts and patterns from the prior month.',
			trigger:     'Vercel Cron — 09:00 on 1st of month',
		},
	];

	let testEmail    = $state('');
	let sendStatus   = $state<Record<EmailType, SendStatus>>({
		welcome:         'idle',
		upgrade:         'idle',
		receipt:         'idle',
		cancellation:    'idle',
		refund:          'idle',
		monthly_report:  'idle',
	});
	let lastSentAt   = $state<Record<EmailType, Date | null>>({
		welcome:         null,
		upgrade:         null,
		receipt:         null,
		cancellation:    null,
		refund:          null,
		monthly_report:  null,
	});

	onMount(() => {
		// Pre-fill with admin's own email
		const user = auth.currentUser;
		if (user?.email) testEmail = user.email;
	});

	async function authHeader(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	async function sendTest(type: EmailType) {
		if (!testEmail.trim()) {
			toastStore.error('Enter a recipient email first', '');
			return;
		}

		sendStatus[type] = 'sending';
		try {
			const res = await fetch('/api/admin/emails', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', ...await authHeader() },
				body:    JSON.stringify({ type, to: testEmail.trim() }),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error ?? `HTTP ${res.status}`);
			}

			sendStatus[type]  = 'sent';
			lastSentAt[type]  = new Date();
			toastStore.success('Test email sent', `${TEMPLATES.find(t => t.type === type)?.label} → ${testEmail}`);

			// Reset to idle after 4 s
			setTimeout(() => { sendStatus[type] = 'idle'; }, 4000);
		} catch (err) {
			sendStatus[type] = 'error';
			toastStore.error('Send failed', err instanceof Error ? err.message : '');
			setTimeout(() => { sendStatus[type] = 'idle'; }, 4000);
		}
	}

	function fmtTime(d: Date | null) {
		if (!d) return '';
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	// Icon paths for each type
	const TYPE_ICONS: Record<EmailType, string> = {
		welcome:         'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
		upgrade:         'M5 3l14 9-14 9V3z',
		receipt:         'M4 2h16a1 1 0 011 1v18l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 011-1zM8 9h8M8 13h6',
		cancellation:    'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
		refund:          'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6',
		monthly_report:  'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
	};
</script>

<svelte:head><title>Email Templates — OmniPlot Admin</title></svelte:head>

<div class="page">
	<div class="page__header">
		<div>
			<h1 class="page__title">Email Templates</h1>
			<p class="page__sub">Manage and test transactional emails sent via Resend.</p>
		</div>
		<Badge variant="success" size="sm">Resend</Badge>
	</div>

	<!-- Config strip -->
	<div class="config-strip">
		<div class="config-item">
			<span class="config-label">From</span>
			<span class="config-val">OmniPlot &lt;noreply@omniplot.app&gt;</span>
		</div>
		<div class="config-sep"></div>
		<div class="config-item">
			<span class="config-label">Monthly cron</span>
			<span class="config-val">0 9 1 * * (1st of month, 09:00 UTC)</span>
		</div>
		<div class="config-sep"></div>
		<div class="config-item">
			<span class="config-label">Provider</span>
			<span class="config-val">api.resend.com</span>
		</div>
	</div>

	<!-- Test send address -->
	<div class="send-bar">
		<label class="send-bar__label" for="test-email">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
			Test recipient
		</label>
		<input
			id="test-email"
			type="email"
			class="send-bar__input"
			placeholder="you@example.com"
			bind:value={testEmail}
		/>
		<span class="send-bar__hint">Test sends use sample data — no real user data is used.</span>
	</div>

	<!-- Template cards -->
	<div class="templates">
		{#each TEMPLATES as tpl (tpl.type)}
			{@const status = sendStatus[tpl.type]}
			{@const lastAt = lastSentAt[tpl.type]}

			<div class="tpl-card" class:tpl-card--sent={status === 'sent'}>
				<div class="tpl-card__left">
					<div class="tpl-icon">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d={TYPE_ICONS[tpl.type]} />
						</svg>
					</div>
					<div class="tpl-info">
						<div class="tpl-name">{tpl.label}</div>
						<div class="tpl-desc">{tpl.description}</div>
						<div class="tpl-trigger">
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
							{tpl.trigger}
						</div>
					</div>
				</div>

				<div class="tpl-card__right">
					{#if lastAt && status !== 'error'}
						<span class="tpl-sent-at">Sent at {fmtTime(lastAt)}</span>
					{/if}

					<button
						class="send-btn"
						class:send-btn--sending={status === 'sending'}
						class:send-btn--sent={status === 'sent'}
						class:send-btn--error={status === 'error'}
						onclick={() => sendTest(tpl.type)}
						disabled={status === 'sending'}
						aria-label="Send test {tpl.label} email"
					>
						{#if status === 'sending'}
							<span class="btn-spinner" aria-hidden="true"></span>
							Sending…
						{:else if status === 'sent'}
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
							Sent
						{:else if status === 'error'}
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
							Failed
						{:else}
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
							Send test
						{/if}
					</button>
				</div>
			</div>
		{/each}
	</div>

	<!-- Notes -->
	<div class="notes">
		<div class="note">
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
			Test sends use placeholder data (name: Alex Johnson, amount: $79, plan: Pro). No Firestore reads are performed.
		</div>
		<div class="note">
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
			Emails will not send if <code>RESEND_API_KEY</code> is not configured in the environment.
		</div>
		<div class="note">
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
			The monthly report cron runs at <code>0 9 1 * *</code> (09:00 UTC on the 1st). Trigger it manually via the Vercel dashboard or <code>CRON_SECRET</code>.
		</div>
	</div>
</div>

<style>
	.page { padding: 28px; max-width: 860px; }

	.page__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 24px;
	}
	.page__title { font-size: 1.375rem; font-weight: 700; margin-bottom: 4px; }
	.page__sub   { font-size: 0.875rem; color: var(--text-secondary); margin: 0; }

	/* Config strip */
	.config-strip {
		display: flex;
		align-items: center;
		gap: 0;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 12px 20px;
		margin-bottom: 24px;
		flex-wrap: wrap;
		gap: 12px;
	}
	.config-item  { display: flex; flex-direction: column; gap: 2px; }
	.config-label { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
	.config-val   { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-primary); }
	.config-sep   { width: 1px; height: 32px; background: var(--border-subtle); flex-shrink: 0; }

	/* Send bar */
	.send-bar {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 24px;
		flex-wrap: wrap;
	}
	.send-bar__label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.send-bar__input {
		flex: 0 0 280px;
		padding: 7px 12px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-surface-2);
		color: var(--text-primary);
		font-size: 0.875rem;
		font-family: var(--font-body);
		outline: none;
		transition: border-color 0.15s;
	}
	.send-bar__input:focus { border-color: var(--color-brand-dim); }
	.send-bar__hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	/* Template cards */
	.templates {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 24px;
	}

	.tpl-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 20px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		transition: border-color 0.15s;
	}
	.tpl-card--sent { border-color: color-mix(in srgb, var(--color-success) 30%, transparent); }

	.tpl-card__left {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		flex: 1;
		min-width: 0;
	}

	.tpl-icon {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-brand);
		margin-top: 1px;
	}

	.tpl-info  { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
	.tpl-name  { font-size: 0.9375rem; font-weight: 600; color: var(--text-primary); }
	.tpl-desc  { font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5; }
	.tpl-trigger {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		border-radius: 4px;
		padding: 2px 7px;
		width: fit-content;
		margin-top: 2px;
	}

	.tpl-card__right {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}

	.tpl-sent-at {
		font-size: 0.75rem;
		color: var(--color-success);
		white-space: nowrap;
	}

	/* Send button */
	.send-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-3);
		color: var(--text-primary);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s;
	}
	.send-btn:hover:not(:disabled) {
		border-color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.06);
		color: var(--color-brand);
	}
	.send-btn:disabled { opacity: 0.6; cursor: not-allowed; }
	.send-btn--sent  { border-color: color-mix(in srgb, var(--color-success) 40%, transparent); color: var(--color-success); }
	.send-btn--error { border-color: color-mix(in srgb, var(--color-danger)  40%, transparent); color: var(--color-danger); }

	.btn-spinner {
		display: block;
		width: 11px; height: 11px;
		border: 1.5px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		opacity: 0.7;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	/* Notes */
	.notes {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		line-height: 1.5;
	}
	.note svg { flex-shrink: 0; margin-top: 2px; }
	.note code {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		border-radius: 4px;
		padding: 1px 5px;
		color: var(--text-secondary);
	}
</style>
