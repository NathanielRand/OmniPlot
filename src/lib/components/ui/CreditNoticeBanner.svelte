<script lang="ts">
	import { auth } from "$lib/firebase/client";
	import { userStore } from "$lib/stores";

	// "A free month was applied" — shown the next time the customer is in the
	// app after support grants one, until they dismiss it. Dismissal is saved
	// server-side so it doesn't reappear on another device.
	interface Notice { id: string; label: string; months: number | null }

	let notices = $state<Notice[]>([]);
	const notice = $derived(notices[0] ?? null);

	async function authHeaders(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken().catch(() => null);
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	$effect(() => {
		if (!userStore.user?.uid) return;
		authHeaders()
			.then((headers) => fetch("/api/billing/credit?notices=1", { headers }))
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => { if (data) notices = data.notices ?? []; })
			.catch(() => {});
	});

	async function dismiss(id: string) {
		notices = notices.filter((n) => n.id !== id);
		try {
			await fetch("/api/billing/credit", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...(await authHeaders()) },
				body: JSON.stringify({ action: "dismiss", id }),
			});
		} catch { /* it'll just show again next visit */ }
	}

	function title(n: Notice): string {
		if (!n.months) return `${n.label} — applied to your subscription`;
		return n.months === 1 ? "Your next month is on us" : `Your next ${n.months} months are on us`;
	}
</script>

{#if notice}
	<div class="credit-notice" role="status" aria-live="polite">
		<div class="credit-notice__icon" aria-hidden="true">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
			</svg>
		</div>
		<div class="credit-notice__copy">
			<p class="credit-notice__title">{title(notice)}</p>
			<p class="credit-notice__sub">
				"{notice.label}" has been applied and comes off your next invoice automatically.
				<a href="/settings?tab=billing" onclick={() => dismiss(notice.id)}>View billing</a>
			</p>
		</div>
		<button class="credit-notice__close" onclick={() => dismiss(notice.id)} aria-label="Dismiss">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
		</button>
	</div>
{/if}

<style>
	.credit-notice {
		position: fixed;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 9997;
		width: min(520px, calc(100vw - 32px));
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 12px 12px 14px;
		border-radius: var(--radius-xl);
		background: var(--bg-surface-2);
		border: 1px solid color-mix(in srgb, var(--color-success) 40%, var(--border-default));
		box-shadow: var(--shadow-lg);
		animation: drop-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.credit-notice__icon {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-success);
		background: color-mix(in srgb, var(--color-success) 12%, transparent);
	}
	.credit-notice__icon svg { width: 16px; height: 16px; }

	.credit-notice__copy { flex: 1; min-width: 0; }
	.credit-notice__title { margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--text-primary); }
	.credit-notice__sub { margin: 2px 0 0; font-size: 0.8125rem; line-height: 1.45; color: var(--text-secondary); }
	.credit-notice__sub a { color: var(--text-brand); font-weight: 600; white-space: nowrap; }

	.credit-notice__close {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-tertiary);
		cursor: pointer;
	}
	.credit-notice__close svg { width: 11px; height: 11px; }
	.credit-notice__close:hover { background: var(--interactive-hover); color: var(--text-primary); }

	@keyframes drop-in {
		from { transform: translate(-50%, -12px); opacity: 0; }
		to   { transform: translate(-50%, 0);     opacity: 1; }
	}
</style>
