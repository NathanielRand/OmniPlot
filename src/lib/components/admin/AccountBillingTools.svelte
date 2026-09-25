<script lang="ts" module>
	export interface CreditSummary {
		subscription: { id: string; planLabel: string; monthValueCents: number; currency: string; monthly: boolean; cancelAtPeriodEnd: boolean } | null;
		pending: { id: string; label: string }[];
		history: {
			id: string; label: string; valueCents: number; currency: string; months: number | null; reason: string; note: string;
			ticketId: string | null; adminName: string; status: "applied" | "used" | "reversed"; createdAt: number;
		}[];
	}

	export function fmtMoney(cents: number, currency = "usd"): string {
		return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
	}
</script>

<script lang="ts">
	import { untrack } from "svelte";
	import { auth } from "$lib/firebase/client";
	import { confirmStore, toastStore } from "$lib/stores";

	// Admin-only account billing repair: re-sync the subscription onto the
	// account, spot/refund duplicate charges, and grant/remove free-month
	// coupons (discounts on their next invoice — no money moves).
	interface Props {
		uid: string;
		/** When shown on a ticket, credits are linked to it (one per ticket). */
		ticketId?: string | null;
		/** Loaded credit summary, exposed so the ticket composer can label its credit trigger. */
		summary?: CreditSummary | null;
		/** Called after anything that changes the account (resync), so the host can reload. */
		onchange?: () => void;
	}
	let { uid, ticketId = null, summary = $bindable(null), onchange }: Props = $props();

	interface Charge {
		id: string; amount: number; amountRefunded: number; currency: string; status: string;
		description: string | null; created: number; possibleDuplicate: boolean;
	}

	const REASONS = [
		{ value: "service_issue", label: "Service issue (our fault)" },
		{ value: "billing_error", label: "Billing error" },
		{ value: "goodwill",      label: "Goodwill" },
		{ value: "other",         label: "Other" },
	];

	let charges = $state<Charge[]>([]);
	let busy = $state<string | null>(null);
	let resyncNote = $state<string | null>(null);

	let formOpen = $state(false);
	let mode = $state<"months" | "amount">("months");
	let months = $state(1);
	let dollars = $state("");
	let reason = $state("service_issue");
	let note = $state("");
	// On a ticket the reply itself tells them — don't double up by default.
	let notify = $state(untrack(() => !ticketId));

	const sub = $derived(summary?.subscription ?? null);
	const canGrant = $derived(!!sub && !sub.cancelAtPeriodEnd);
	// What the coupon will read as on their invoice.
	const creditPreview = $derived(
		!sub ? null
		: mode === "months" ? `${months} month${months === 1 ? "" : "s"} on us`
		: Number(dollars) > 0 ? `${fmtMoney(Math.round(Number(dollars) * 100), sub.currency)} off` : null,
	);
	const STATUS_TEXT = { applied: "waiting for next invoice", used: "used", reversed: "removed" } as const;

	async function api(path: string, init?: { method?: string; body?: object }) {
		const token = await auth.currentUser?.getIdToken();
		const res = await fetch(path, {
			method: init?.method ?? "GET",
			headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: init?.body ? JSON.stringify(init.body) : undefined,
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? "Request failed");
		return data;
	}

	async function load() {
		const [s, c] = await Promise.allSettled([
			api(`/api/admin/billing/credits?uid=${encodeURIComponent(uid)}`),
			api(`/api/admin/billing/repair?uid=${encodeURIComponent(uid)}`),
		]);
		if (s.status === "fulfilled") summary = s.value;
		if (c.status === "fulfilled") charges = c.value.charges;
	}

	$effect(() => {
		uid;
		load();
	});

	async function resync() {
		busy = "resync";
		try {
			const r = await api("/api/admin/billing/repair", { method: "POST", body: { uid } });
			resyncNote = r.note;
			toastStore.success("Billing re-synced", r.note);
			await load();
			onchange?.();
		} catch (err) {
			toastStore.error("Resync failed", err instanceof Error ? err.message : "");
		} finally {
			busy = null;
		}
	}

	async function refund(c: Charge) {
		const remaining = c.amount - c.amountRefunded;
		const ok = await confirmStore.ask({
			title: `Refund ${fmtMoney(remaining, c.currency)}?`,
			message: "Refunds go back to the original payment method and usually take 5–10 business days to appear.",
			confirmLabel: "Refund",
			variant: "danger",
			details: [{ label: "Charge", value: c.id }, { label: "Date", value: new Date(c.created).toLocaleString() }],
		});
		if (!ok) return;
		busy = c.id;
		try {
			await api("/api/admin/billing/refund", { method: "POST", body: { chargeId: c.id } });
			toastStore.success("Refund issued", "The ledger updates when Stripe confirms it.");
			charges = charges.map((x) => (x.id === c.id ? { ...x, amountRefunded: x.amount, status: "refunded", possibleDuplicate: false } : x));
		} catch (err) {
			toastStore.error("Refund failed", err instanceof Error ? err.message : "");
		} finally {
			busy = null;
		}
	}

	async function grant(e: SubmitEvent) {
		e.preventDefault();
		if (!creditPreview) return;
		const ok = await confirmStore.ask({
			title: `Apply "${creditPreview}"?`,
			message: "Adds a single-use coupon to their subscription — it discounts their next invoice(s). No money is sent or charged.",
			confirmLabel: "Apply",
			variant: "primary",
		});
		if (!ok) return;
		busy = "grant";
		try {
			const r = await api("/api/admin/billing/credits", {
				method: "POST",
				body: {
					uid,
					...(mode === "months" ? { months } : { amountCents: Math.round(Number(dollars) * 100) }),
					reason, note, ticketId, notify,
				},
			});
			summary = r.summary;
			toastStore.success("Applied", `${r.credit.label}${notify ? " · customer emailed" : ""}`);
			formOpen = false;
			note = "";
			dollars = "";
		} catch (err) {
			toastStore.error("Couldn't apply", err instanceof Error ? err.message : "");
		} finally {
			busy = null;
		}
	}

	async function reverse(id: string, label: string) {
		const ok = await confirmStore.ask({
			title: `Remove "${label}"?`,
			message: "Takes the coupon off their subscription before their next invoice uses it.",
			confirmLabel: "Remove",
			variant: "danger",
		});
		if (!ok) return;
		busy = id;
		try {
			summary = (await api("/api/admin/billing/credits", { method: "POST", body: { action: "reverse", creditId: id } })).summary;
			toastStore.success("Free month removed");
		} catch (err) {
			toastStore.error("Couldn't remove", err instanceof Error ? err.message : "");
		} finally {
			busy = null;
		}
	}
</script>

<div class="abt">
	<!-- Fix: re-apply their Stripe subscription to the account -->
	<div class="abt__row">
		<button class="abt__btn" onclick={resync} disabled={busy !== null}>
			{busy === "resync" ? "Re-syncing…" : "Resync billing from Stripe"}
		</button>
	</div>
	{#if resyncNote}<p class="abt__note">{resyncNote}</p>{/if}

	<!-- Free months (coupons) -->
	<div class="abt__block">
		<div class="abt__head">
			<span class="abt__label">Free months</span>
			{#if summary?.pending.length}<span class="abt__value">{summary.pending.length} waiting</span>{/if}
		</div>
		{#if !summary}
			<p class="abt__hint">Loading…</p>
		{:else if !sub}
			<p class="abt__hint">No active subscription — free months discount a subscription's next invoice. For free accounts, set their plan instead.</p>
		{:else}
			<p class="abt__hint">
				{sub.planLabel} · 1 month ≈ {fmtMoney(sub.monthValueCents, sub.currency)}
				{#if !sub.monthly}· yearly plan, so a month is taken off as a fixed amount{/if}
			</p>
			{#if sub.cancelAtPeriodEnd}
				<p class="abt__hint abt__hint--warn">Set to cancel at period end — there's no next invoice to discount.</p>
			{/if}
		{/if}

		{#if canGrant && !formOpen}
			<button class="abt__btn abt__btn--primary" onclick={() => (formOpen = true)}>Give free month</button>
		{:else if canGrant}
			<form class="abt__form" onsubmit={grant}>
				<div class="abt__seg" role="group" aria-label="Type">
					<button type="button" class:on={mode === "months"} onclick={() => (mode = "months")}>Free months</button>
					<button type="button" class:on={mode === "amount"} onclick={() => (mode = "amount")}>Amount off</button>
				</div>
				{#if mode === "months"}
					<label class="abt__field">Months
						<input type="number" min="1" max="12" bind:value={months} />
					</label>
				{:else}
					<label class="abt__field">Amount off next invoice ($)
						<input type="number" min="0.01" step="0.01" placeholder="10.00" bind:value={dollars} />
					</label>
				{/if}
				<label class="abt__field">Reason
					<select bind:value={reason}>{#each REASONS as r}<option value={r.value}>{r.label}</option>{/each}</select>
				</label>
				<label class="abt__field">Internal note
					<input type="text" maxlength="500" placeholder="e.g. Sep 2026 billing outage" bind:value={note} />
				</label>
				<label class="abt__check"><input type="checkbox" bind:checked={notify} /> Email the customer</label>
				<div class="abt__actions">
					<button type="button" class="abt__btn" onclick={() => (formOpen = false)}>Cancel</button>
					<button type="submit" class="abt__btn abt__btn--primary" disabled={!creditPreview || busy !== null}>
						{busy === "grant" ? "Applying…" : `Apply ${creditPreview ?? ""}`}
					</button>
				</div>
			</form>
		{/if}

		{#if summary?.history.length}
			<ul class="abt__list">
				{#each summary.history as h}
					<li class:reversed={h.status === "reversed"}>
						<span class="abt__line">
							<strong>{h.label}</strong> · {STATUS_TEXT[h.status]}
						</span>
						<span class="abt__sub">{new Date(h.createdAt).toLocaleDateString()} · {h.adminName} · {REASONS.find((r) => r.value === h.reason)?.label ?? h.reason}{h.note ? ` · ${h.note}` : ""}</span>
						{#if h.status === "applied"}
							<button class="abt__link" disabled={busy !== null} onclick={() => reverse(h.id, h.label)}>Remove</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Charges -->
	<div class="abt__block">
		<div class="abt__head">
			<span class="abt__label">Recent charges</span>
			{#if charges.some((c) => c.possibleDuplicate)}<span class="abt__dup">possible duplicate</span>{/if}
		</div>
		{#if charges.length === 0}
			<p class="abt__hint">No charges in the ledger for this account.</p>
		{:else}
			<ul class="abt__list">
				{#each charges as c}
					<li class:dup={c.possibleDuplicate}>
						<span class="abt__line">
							<strong>{fmtMoney(c.amount, c.currency)}</strong> · {c.status}
							{#if c.amountRefunded > 0 && c.amountRefunded < c.amount} · {fmtMoney(c.amountRefunded, c.currency)} refunded{/if}
							{#if c.possibleDuplicate}<em>duplicate?</em>{/if}
						</span>
						<span class="abt__sub">{new Date(c.created).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{c.description ? ` · ${c.description}` : ""}</span>
						{#if c.status === "succeeded" && c.amountRefunded < c.amount}
							<button class="abt__link" class:abt__link--danger={c.possibleDuplicate} disabled={busy !== null} onclick={() => refund(c)}>
								{busy === c.id ? "Refunding…" : "Refund"}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.abt { display: flex; flex-direction: column; gap: 14px; font-size: 0.8125rem; }
	.abt__row { display: flex; gap: 8px; flex-wrap: wrap; }
	.abt__note { margin: -6px 0 0; font-size: 0.75rem; color: var(--text-secondary); }

	.abt__block { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }
	.abt__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
	.abt__label { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.abt__value { font-family: var(--font-mono); font-weight: 600; color: var(--text-success); }
	.abt__hint { margin: 0; font-size: 0.75rem; color: var(--text-tertiary); }
	.abt__hint--warn { color: var(--text-warning); }
	.abt__dup {
		font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
		padding: 1px 6px; border-radius: 99px; background: var(--color-warning); color: #000;
	}

	.abt__btn {
		padding: 6px 12px; border-radius: var(--radius-md); border: 1px solid var(--border-default);
		background: transparent; color: var(--text-secondary); font-size: 0.8125rem; font-weight: 500;
		font-family: var(--font-body); cursor: pointer; align-self: flex-start;
	}
	.abt__btn:hover:not(:disabled) { background: var(--interactive-hover); color: var(--text-primary); }
	.abt__btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.abt__btn--primary { background: var(--color-brand-dim); border-color: transparent; color: #fff; }
	.abt__btn--primary:hover:not(:disabled) { background: var(--color-brand-dim); color: #fff; opacity: 0.85; }

	.abt__form { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-surface); }
	.abt__seg { display: flex; gap: 2px; padding: 2px; border-radius: var(--radius-sm); background: var(--bg-surface-2); border: 1px solid var(--border-default); }
	.abt__seg button {
		flex: 1; padding: 4px 8px; border: none; border-radius: 4px; background: transparent; cursor: pointer;
		font-size: 0.75rem; font-family: var(--font-body); color: var(--text-secondary);
	}
	.abt__seg button.on { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
	.abt__seg button:disabled { opacity: 0.4; cursor: not-allowed; }
	.abt__field { display: flex; flex-direction: column; gap: 3px; font-size: 0.75rem; color: var(--text-tertiary); }
	.abt__field input, .abt__field select {
		padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-default);
		background: var(--bg-surface); color: var(--text-primary); font-size: 0.8125rem; font-family: var(--font-body);
	}
	.abt__check { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-secondary); }
	.abt__actions { display: flex; justify-content: flex-end; gap: 6px; }

	.abt__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.abt__list li { display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; align-items: center; }
	.abt__list li.reversed { opacity: 0.55; }
	.abt__list li.dup .abt__line strong { color: var(--text-warning); }
	.abt__line { color: var(--text-primary); overflow-wrap: anywhere; }
	.abt__line em { margin-left: 4px; font-style: normal; font-size: 0.6875rem; color: var(--text-warning); }
	.abt__sub { grid-column: 1; font-size: 0.6875rem; color: var(--text-tertiary); overflow-wrap: anywhere; }
	.abt__link { grid-column: 2; grid-row: 1 / span 2; border: none; background: none; cursor: pointer; font-size: 0.75rem; font-family: var(--font-body); color: var(--text-brand); padding: 0; }
	.abt__link:disabled { opacity: 0.5; cursor: not-allowed; }
	.abt__link--danger { color: var(--text-danger); font-weight: 600; }
</style>
