<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Badge from '$lib/components/ui/Badge.svelte';
	import TicketThread from '$lib/components/support/TicketThread.svelte';
	import AccountBillingTools, { fmtMoney, type CreditSummary } from '$lib/components/admin/AccountBillingTools.svelte';
	import { auth } from '$lib/firebase/client';
	import { confirmStore, supportStore, toastStore } from '$lib/stores';
	import { sortCanned, type CannedResponse } from '$lib/support/responses';
	import {
		PRIORITY_LABEL,
		STATUS_LABEL_ADMIN,
		STATUS_VARIANT,
		TOPIC_LABEL,
		ticketRef,
		timeAgo,
		isForeign,
		translatableParts,
		type Ticket,
		type TicketPriority,
		type TicketStatus,
	} from '$lib/support/tickets';

	interface Context {
		link: { status: 'linked' | 'match' | 'none'; method: 'session' | 'manual' | null; uid: string | null };
		account: {
			uid: string; displayName: string; email: string; tier: string; createdAt: number | null;
			subscriptionStatus: string | null; cancelAtPeriodEnd: boolean; pausedCollection: boolean;
			currentPeriodEnd: number | null; stripeCustomerId: string | null; cutCount: number; lastCutAt: number | null;
			shop: { name: string; plan: string | null; role: string | null; status: string | null } | null;
		} | null;
		related: { id: string; subject: string; status: TicketStatus; createdAt: number; duplicateOf: string | null }[];
		reports: { id: string; title: string; type: string; status: string; createdAt: number }[];
		errors: { id: string; route: string; message: string; count: number; lastSeenAt: number }[];
	}

	const STATUSES: TicketStatus[] = ['new', 'in_progress', 'awaiting_customer', 'resolved', 'closed'];
	const PRIORITIES: TicketPriority[] = ['normal', 'high', 'urgent'];

	// What each outcome looks like on the send button — the trigger is visible
	// before it fires.
	const SEND_LABEL: Record<TicketStatus, string> = {
		new:               'Send',
		in_progress:       'Send · keep in progress',
		awaiting_customer: 'Send · await customer',
		resolved:          'Send & resolve',
		closed:            'Send & close',
	};

	let ticket = $state<Ticket | null>(null);
	let context = $state<Context | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let mode = $state<'reply' | 'note'>('reply');
	let body = $state('');
	let canned = $state<CannedResponse | null>(null);
	let sendStatus = $state<TicketStatus>('awaiting_customer');
	let busy = $state(false);
	let tagInput = $state('');
	// Free-month trigger (a template's offerCredit) — the coupon is attached before the reply sends.
	let applyCredit = $state(false);
	let creditSummary = $state<CreditSummary | null>(null);
	const creditLabel = $derived.by(() => {
		const months = canned?.offerCredit?.months ?? 1;
		const sub = creditSummary?.subscription;
		if (creditSummary && !sub) return 'No active subscription for a free month';
		if (sub?.cancelAtPeriodEnd) return 'Subscription set to cancel — no next invoice';
		return `Apply "${months} month${months === 1 ? '' : 's'} on us" coupon${sub ? ` (≈${fmtMoney(sub.monthValueCents * months, sub.currency)})` : ''} before sending`;
	});
	const canCredit = $derived(!!context?.account && !!creditSummary?.subscription && !creditSummary.subscription.cancelAtPeriodEnd);
	const PLAN_LABEL: Record<string, string> = { free: 'Free', lite: 'Lite', pro: 'Pro' };

	const cannedList = $derived(ticket ? sortCanned(ticket.topic, ticket.tags) : []);
	const suggestedIds = $derived(
		new Set(ticket ? cannedList.filter((c) => c.topics.includes(ticket!.topic) || c.tags?.some((t) => ticket!.tags.includes(t))).map((c) => c.id) : []),
	);

	async function api(method: string, payload?: object) {
		const token = await auth.currentUser?.getIdToken();
		const res = await fetch(`/api/admin/support/${page.params.id}`, {
			method,
			headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: payload ? JSON.stringify(payload) : undefined,
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? 'Request failed');
		return data;
	}

	async function load() {
		loading = true;
		error = null;
		try {
			const data = await api('GET');
			ticket = data.ticket;
			context = data.context;
			supportStore.refreshAdmin();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load ticket.';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		page.params.id;
		load();
	});

	// The text last generated from a template — when the admin hasn't edited
	// it, toggling the free-month box regenerates it so the reply never
	// promises a credit that won't be applied (or leaves one out that will).
	let generatedBody = '';

	function renderCanned(c: CannedResponse, freeMonth: boolean): string {
		// Prefer the live account tier (it may have just been fixed by a resync).
		const tier = context?.account?.tier ?? ticket?.tier ?? undefined;
		return c.body(ticket?.name?.trim().split(' ')[0] || 'there', { planName: tier ? PLAN_LABEL[tier] : undefined, freeMonth });
	}

	function pickCanned(c: CannedResponse) {
		mode = 'reply';
		canned = c;
		sendStatus = c.setStatus;
		applyCredit = !!c.offerCredit && canCredit;
		body = generatedBody = renderCanned(c, applyCredit);
	}

	function onCreditToggle() {
		if (canned && body === generatedBody) body = generatedBody = renderCanned(canned, applyCredit);
	}

	function clearCanned() {
		canned = null;
		applyCredit = false;
		sendStatus = 'awaiting_customer';
	}

	async function act(payload: object, success: string) {
		busy = true;
		try {
			const data = await api('POST', payload);
			ticket = data.ticket;
			toastStore.success(success);
			supportStore.refreshAdmin();
			return true;
		} catch (err) {
			toastStore.error('Failed', err instanceof Error ? err.message : '');
			return false;
		} finally {
			busy = false;
		}
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!body.trim()) return;
		const ok =
			mode === 'note'
				? await act({ action: 'note', body }, 'Note added')
				: await act(
						{
							action: 'reply', body, status: sendStatus, cannedId: canned?.id,
							credit: applyCredit ? { months: canned?.offerCredit?.months ?? 1 } : undefined,
						},
						applyCredit ? `Credit applied · reply sent to ${ticket?.email}` : `Reply sent to ${ticket?.email}`,
					);
		if (ok) {
			body = '';
			clearCanned();
		}
	}

	async function setStatus(next: TicketStatus) {
		if (!ticket || next === ticket.status) return;
		const emailed = next === 'resolved' || next === 'closed';
		await act({ action: 'status', status: next }, `Marked ${STATUS_LABEL_ADMIN[next].toLowerCase()}${emailed ? ' · customer emailed' : ''}`);
	}

	async function setPriority(p: TicketPriority) {
		await act({ action: 'triage', priority: p }, `Priority set to ${PRIORITY_LABEL[p].toLowerCase()}`);
	}

	async function addTag(e: SubmitEvent) {
		e.preventDefault();
		const tag = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
		if (!tag || !ticket || ticket.tags.includes(tag)) return;
		if (await act({ action: 'triage', tags: [...ticket.tags, tag] }, 'Tag added')) tagInput = '';
	}

	async function removeTag(tag: string) {
		if (!ticket) return;
		await act({ action: 'triage', tags: ticket.tags.filter((t) => t !== tag) }, 'Tag removed');
	}

	// Only an account that's actually linked (or an email match about to be)
	// gets the "open account" deep link — never a guess.
	const accountHref = $derived(context?.link.uid ? `/admin/users?uid=${encodeURIComponent(context.link.uid)}` : null);

	async function linkAccount() {
		const a = context?.account;
		const ok = await confirmStore.ask({
			title: 'Link this ticket to the account?',
			message: 'This older ticket was filed without being signed in. It will be attached to the account that uses the same email.',
			confirmLabel: 'Link account',
			variant: 'primary',
			details: a ? [{ label: 'Account', value: `${a.displayName || '—'} · ${a.email}` }] : undefined,
		});
		if (!ok) return;
		if (await act({ action: 'link' }, 'Ticket linked to account')) await load();
	}

	// ─── Translation (staff only) ─────────────────
	// Cached on the ticket; "Translate" only sends parts not translated yet.
	let showEnglish = $state(true);
	let translating = $state(false);
	let translateStatus = $state('');
	const untranslated = $derived(ticket ? translatableParts(ticket).filter((p) => !ticket!.translations?.[p.id]) : []);
	const hasForeign = $derived(!!ticket && Object.values(ticket.translations ?? {}).some((t) => isForeign(t)));
	const foreignLanguage = $derived(ticket ? Object.values(ticket.translations ?? {}).find((t) => isForeign(t))?.language ?? null : null);
	const subjectEnglish = $derived(ticket && isForeign(ticket.translations?.subject) ? ticket.translations.subject.english : null);

	// Runs in this browser (free, open-source model — nothing leaves the
	// page), then the result is saved on the ticket for next time.
	async function translate() {
		if (!ticket || translating) return;
		translating = true;
		translateStatus = 'Preparing…';
		try {
			const { translateParts } = await import('$lib/support/translator');
			const translations = await translateParts(untranslated, (p) => {
				translateStatus = p.phase === 'loading'
					? `Downloading translator… ${p.percent}%`
					: `Translating ${p.done + 1} of ${p.total}…`;
			});
			const data = await api('POST', { action: 'translate', translations });
			ticket = data.ticket;
			showEnglish = true;
			const foreign = Object.values(translations).filter((t) => isForeign(t));
			if (foreign.length) toastStore.success('Translated to English', `${foreign.length} from ${foreign[0].language}`);
			else toastStore.info('Nothing to translate', 'Everything here is English (or too short to tell).');
		} catch (err) {
			toastStore.error('Translation failed', err instanceof Error ? err.message : 'Could not load the translator.');
		} finally {
			translating = false;
			translateStatus = '';
		}
	}

	// ─── Duplicate ────────────────────────────────
	// A duplicate is resolved and locked (server-enforced): only internal notes
	// and "unmark" remain, so the same issue can't be resolved twice.
	const locked = $derived(!!ticket?.duplicateOf);
	let dupOpen = $state(false);
	let dupTarget = $state<string | null>(null);
	let dupNotify = $state(true);
	// Candidates: the requester's other tickets. Picking one that is itself a
	// duplicate is fine — the server follows it to the original.
	const dupCandidates = $derived(context?.related ?? []);
	const originalOfThis = $derived(ticket?.duplicateOf ? context?.related.find((r) => r.id === ticket!.duplicateOf) ?? null : null);

	$effect(() => {
		if (locked && mode === 'reply') mode = 'note';
	});

	function openDuplicate() {
		dupTarget = dupCandidates.find((r) => !r.duplicateOf)?.id ?? dupCandidates[0]?.id ?? null;
		dupNotify = true;
		dupOpen = true;
	}

	async function markDuplicate() {
		const target = dupCandidates.find((r) => r.id === dupTarget);
		if (!ticket || !target) return;
		const ok = await confirmStore.ask({
			title: 'Mark as duplicate?',
			message: 'This ticket will be resolved and locked — no more replies, status changes or credits here. The conversation continues on the original.',
			confirmLabel: 'Mark duplicate',
			variant: 'primary',
			details: [
				{ label: 'Duplicate', value: `${ticketRef(ticket.id)} · ${ticket.subject}` },
				{ label: 'Original', value: `${ticketRef(target.id)} · ${target.subject}` },
				{ label: 'Customer', value: dupNotify ? `Emailed at ${ticket.email}` : 'Not emailed' },
			],
		});
		if (!ok) return;
		if (await act({ action: 'duplicate', originalId: target.id, notify: dupNotify }, `Marked duplicate of ${ticketRef(target.id)}`)) {
			dupOpen = false;
			body = '';
			clearCanned();
			await load();
		}
	}

	async function unmarkDuplicate() {
		const ok = await confirmStore.ask({
			title: 'Unmark duplicate?',
			message: 'The ticket is unlocked and reopened as In progress, and the customer sees it reopened. Only do this if it was marked by mistake.',
			confirmLabel: 'Unmark & reopen',
			variant: 'danger',
		});
		if (!ok) return;
		if (await act({ action: 'unduplicate' }, 'Duplicate mark removed · ticket reopened')) await load();
	}

	async function remove() {
		const ok = await confirmStore.ask({
			title: 'Delete this ticket?',
			message: 'The whole conversation is permanently removed. Prefer "Closed" unless this is spam.',
			confirmLabel: 'Delete',
			variant: 'danger',
		});
		if (!ok) return;
		try {
			await api('DELETE');
			supportStore.refreshAdmin();
			goto('/admin/support');
		} catch (err) {
			toastStore.error('Delete failed', err instanceof Error ? err.message : '');
		}
	}

	function fmtDate(ms: number | null) {
		return ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
	}
</script>

<svelte:head><title>{ticket ? `${ticketRef(ticket.id)} ${ticket.subject}` : 'Ticket'} — OmniPlot Admin</title></svelte:head>

<div class="page">
	<a class="back" href="/admin/support">← Support inbox</a>

	{#if loading && !ticket}
		<div class="state"><span class="spinner" aria-label="Loading…"></span></div>
	{:else if error || !ticket}
		<div class="state">{error ?? 'Ticket not found.'}</div>
	{:else}
		<div class="head">
			<div class="head__main">
				<h1 class="head__title">{showEnglish && subjectEnglish ? subjectEnglish : ticket.subject}</h1>
				{#if showEnglish && subjectEnglish}<p class="head__orig" title="Original subject">{ticket.subject}</p>{/if}
				<p class="head__meta">
					{ticketRef(ticket.id)} · {TOPIC_LABEL[ticket.topic] ?? ticket.topic} · opened {timeAgo(ticket.createdAt)}
				</p>
			</div>
			<div class="head__badges">
				{#if locked}<Badge variant="default" size="md">Duplicate</Badge>{/if}
				<Badge variant={STATUS_VARIANT[ticket.status]} size="md">{STATUS_LABEL_ADMIN[ticket.status]}</Badge>
			</div>
		</div>

		{#if locked && ticket.duplicateOf}
			<div class="dup-banner" role="status">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
				<div class="dup-banner__body">
					<strong>Duplicate of <a href="/admin/support/{ticket.duplicateOf}">{ticketRef(ticket.duplicateOf)}{originalOfThis ? ` · ${originalOfThis.subject}` : ''}</a></strong>
					<span>Resolved and locked — replies, status changes and credits are disabled here. Internal notes still work.</span>
				</div>
				<div class="dup-banner__actions">
					<a class="btn btn--primary btn--sm" href="/admin/support/{ticket.duplicateOf}">Open original →</a>
					<button class="btn btn--ghost btn--sm" onclick={unmarkDuplicate} disabled={busy}>Unmark</button>
				</div>
			</div>
		{/if}

		<div class="layout">
			<div class="main">
				<!-- Status + priority -->
				<div class="controls">
					<div class="seg" role="group" aria-label="Status">
						{#each STATUSES as s}
							<button class="seg__btn" class:seg__btn--on={ticket.status === s} disabled={busy || locked} onclick={() => setStatus(s)}>
								{STATUS_LABEL_ADMIN[s]}
							</button>
						{/each}
					</div>
					<label class="prio">
						Priority
						<select value={ticket.priority} disabled={busy || locked} onchange={(e) => setPriority(e.currentTarget.value as TicketPriority)}>
							{#each PRIORITIES as p}<option value={p}>{PRIORITY_LABEL[p]}</option>{/each}
						</select>
					</label>
					{#if !locked}
						<button class="btn btn--ghost btn--sm" onclick={openDuplicate} disabled={busy || dupCandidates.length === 0}
							title={dupCandidates.length === 0 ? 'This requester has no other tickets' : 'Resolve this ticket as a duplicate of another one'}>
							Mark duplicate…
						</button>
					{/if}
				</div>

				{#if dupOpen && !locked}
					<div class="card dup-picker">
						<h2 class="card__title">Mark as duplicate of…</h2>
						<p class="muted">Pick the ticket the conversation should continue on. This one will be resolved and locked.</p>
						<div class="dup-list" role="radiogroup" aria-label="Original ticket">
							{#each dupCandidates as r (r.id)}
								<label class="dup-option" class:dup-option--on={dupTarget === r.id}>
									<input type="radio" name="dup-target" value={r.id} bind:group={dupTarget} />
									<span class="dup-option__main">
										<span class="dup-option__subject">{ticketRef(r.id)} · {r.subject}</span>
										<span class="dup-option__meta">
											{STATUS_LABEL_ADMIN[r.status]} · {fmtDate(r.createdAt)}
											{#if r.duplicateOf} · itself a duplicate of {ticketRef(r.duplicateOf)} — its original is used{/if}
										</span>
									</span>
								</label>
							{/each}
						</div>
						<div class="dup-picker__foot">
							<label class="dup-notify"><input type="checkbox" bind:checked={dupNotify} /> Email the customer where to continue</label>
							<div class="dup-picker__btns">
								<button class="btn btn--ghost" onclick={() => (dupOpen = false)} disabled={busy}>Cancel</button>
								<button class="btn btn--primary" onclick={markDuplicate} disabled={busy || !dupTarget}>{busy ? 'Saving…' : 'Mark duplicate & resolve'}</button>
							</div>
						</div>
					</div>
				{/if}

				<div class="card">
					<div class="thread-bar">
						{#if hasForeign}
							<span class="thread-bar__lang">
								{showEnglish ? `Showing English · translated from ${foreignLanguage}` : `Original · ${foreignLanguage}`}
							</span>
							<button class="btn btn--ghost btn--sm" onclick={() => (showEnglish = !showEnglish)}>
								{showEnglish ? 'Show original' : 'Show English'}
							</button>
						{/if}
						{#if untranslated.length}
							<button class="btn btn--ghost btn--sm" onclick={translate} disabled={translating}
								title="Translate what the customer wrote into English. Runs in your browser (free, open-source model); the first use downloads it once. The customer never sees this.">
								{#if translating}
									{translateStatus || 'Translating…'}
								{:else}
									{Object.keys(ticket.translations ?? {}).length ? `Translate ${untranslated.length} new` : 'Translate to English'}
								{/if}
							</button>
						{/if}
					</div>
					<TicketThread {ticket} viewer="admin" {showEnglish} />
				</div>

				<!-- Composer -->
				<form class="card composer" class:composer--note={mode === 'note'} onsubmit={submit}>
					<div class="composer__tabs" role="tablist">
						<button type="button" role="tab" class="tab" class:tab--on={mode === 'reply'} aria-selected={mode === 'reply'} disabled={locked} title={locked ? 'Locked — reply on the original ticket' : undefined} onclick={() => (mode = 'reply')}>
							Reply to {ticket.name?.split(' ')[0] || 'customer'}
						</button>
						<button type="button" role="tab" class="tab" class:tab--on={mode === 'note'} aria-selected={mode === 'note'} onclick={() => { mode = 'note'; clearCanned(); }}>
							Internal note
						</button>
					</div>

					{#if mode === 'reply'}
						<div class="canned" aria-label="Prefilled responses">
							{#each cannedList as c}
								<button
									type="button"
									class="chip"
									class:chip--suggested={suggestedIds.has(c.id)}
									class:chip--on={canned?.id === c.id}
									class:chip--pinned={c.pinned}
									title="Sets status to {STATUS_LABEL_ADMIN[c.setStatus]}{c.addTags?.length ? ` · tags ${c.addTags.join(', ')}` : ''}"
									onclick={() => pickCanned(c)}
								>{#if c.pinned}<span aria-hidden="true">★ </span>{/if}{c.label}</button>
							{/each}
						</div>
					{/if}

					<textarea
						class="composer__input"
						rows="8"
						maxlength="5000"
						placeholder={mode === 'note' ? 'Only staff can see this…' : 'Pick a response above or write your own…'}
						bind:value={body}
					></textarea>

					<div class="composer__foot">
						{#if mode === 'reply'}
							<div class="trigger">
								<label>
									After sending
									<select bind:value={sendStatus}>
										{#each STATUSES.filter((s) => s !== 'new') as s}<option value={s}>{STATUS_LABEL_ADMIN[s]}</option>{/each}
									</select>
								</label>
								{#if canned?.addTags?.length}
									<span class="trigger__tags">+ {canned.addTags.join(', ')}</span>
								{/if}
								{#if canned?.offerCredit}
									<label class="trigger__credit" class:trigger__credit--off={!canCredit}>
										<input type="checkbox" bind:checked={applyCredit} disabled={!canCredit} onchange={onCreditToggle} />
										{context?.account ? creditLabel : 'No account to credit'}
									</label>
								{/if}
								<span class="trigger__hint">Emails {ticket.email}</span>
							</div>
						{:else}
							<span class="trigger__hint">Not sent to the customer.</span>
						{/if}
						<button type="submit" class="btn btn--primary" disabled={busy || !body.trim()}>
							{busy ? 'Saving…' : mode === 'note' ? 'Add note' : SEND_LABEL[sendStatus]}
						</button>
					</div>
				</form>
			</div>

			<aside class="side">
				<section class="card">
					<h2 class="card__title">Requester</h2>
					<dl class="dl">
						<dt>Name</dt>
						<dd>
							{#if accountHref && context?.link.status === 'linked'}
								<a href={accountHref}>{ticket.name || context?.account?.displayName || '—'}</a>
							{:else}
								{ticket.name || '—'}
							{/if}
						</dd>
						<dt>Email</dt>
						<dd>
							{#if accountHref && context?.link.status === 'linked'}
								<a href={accountHref}>{ticket.email}</a>
							{:else}
								{ticket.email}
							{/if}
						</dd>
						<dt>Account</dt>
						<dd>
							{#if !context}
								—
							{:else if context.link.status === 'linked'}
								<span class="link-ok">{context.link.method === 'manual' ? 'Linked by staff' : 'Filed while signed in'}</span>
							{:else if context.link.status === 'match'}
								<span class="warn">Not linked · matching email</span>
							{:else}
								<span class="muted-inline">Guest — no account with this email</span>
							{/if}
						</dd>
						<dt>Plan at filing</dt><dd>{ticket.tier ?? 'guest'}{ticket.shopPlan ? ` · shop ${ticket.shopPlan}` : ''}</dd>
						{#if ticket.pageUrl}<dt>From page</dt><dd class="truncate" title={ticket.pageUrl}>{ticket.pageUrl}</dd>{/if}
					</dl>
					{#if context?.link.status === 'match'}
						<button class="link-btn" onclick={linkAccount} disabled={busy}>Link to account</button>
					{/if}
					{#if accountHref}
						<div class="links"><a href={accountHref}>Open account →</a></div>
					{/if}
				</section>

				<section class="card">
					<h2 class="card__title">Account</h2>
					{#if !context}
						<p class="muted">Context unavailable.</p>
					{:else if !context.account}
						<p class="muted">No OmniPlot account for this email — likely a guest or pre-signup question.</p>
					{:else}
						{@const a = context.account}
						<dl class="dl">
							<dt>Tier</dt><dd><Badge variant={a.tier === 'pro' ? 'pro' : a.tier === 'lite' ? 'lite' : 'free'}>{a.tier}</Badge></dd>
							<dt>Subscription</dt>
							<dd>
								{a.subscriptionStatus ?? 'none'}
								{#if a.pausedCollection}<span class="warn"> · paused</span>{/if}
								{#if a.cancelAtPeriodEnd}<span class="warn"> · cancels {fmtDate(a.currentPeriodEnd)}</span>{/if}
							</dd>
							{#if a.currentPeriodEnd && !a.cancelAtPeriodEnd}<dt>Renews</dt><dd>{fmtDate(a.currentPeriodEnd)}</dd>{/if}
							{#if a.shop}<dt>Shop</dt><dd>{a.shop.name} · {a.shop.plan ?? '—'}{a.shop.role ? ` · ${a.shop.role}` : ''}</dd>{/if}
							<dt>Cuts</dt><dd>{a.cutCount}{a.lastCutAt ? ` · last ${timeAgo(a.lastCutAt)}` : ''}</dd>
							<dt>Joined</dt><dd>{fmtDate(a.createdAt)}</dd>
							{#if a.stripeCustomerId}<dt>Stripe</dt><dd class="mono">{a.stripeCustomerId}</dd>{/if}
						</dl>
						<div class="links">
							{#if accountHref}<a href={accountHref}>Open account</a>{/if}
							<a href="/admin/billing">Billing</a>
						</div>
					{/if}
				</section>

				{#if context?.account && !locked}
					<section class="card">
						<h2 class="card__title">Billing tools</h2>
						<AccountBillingTools uid={context.account.uid} ticketId={ticket.id} bind:summary={creditSummary} onchange={load} />
					</section>
				{/if}

				<section class="card">
					<h2 class="card__title">Tags</h2>
					<div class="tags">
						{#each ticket.tags as tag}
							<span class="tag">{tag}{#if !locked}<button type="button" aria-label="Remove {tag}" onclick={() => removeTag(tag)}>×</button>{/if}</span>
						{:else}
							<span class="muted">No tags</span>
						{/each}
					</div>
					{#if !locked}
						<form class="tag-form" onsubmit={addTag}>
							<input placeholder="Add tag" bind:value={tagInput} maxlength="40" />
						</form>
					{/if}
				</section>

				{#if context?.related.length}
					<section class="card">
						<h2 class="card__title">Other tickets ({context.related.length})</h2>
						<ul class="mini">
							{#each context.related as r}
								<li>
									<a href="/admin/support/{r.id}">{r.subject}</a>
									<span>
										{ticketRef(r.id)} · {STATUS_LABEL_ADMIN[r.status]} · {fmtDate(r.createdAt)}
										{#if r.duplicateOf === ticket.id} · duplicate of this{:else if r.duplicateOf} · duplicate{/if}
									</span>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if ticket.duplicates.length}
					<section class="card">
						<h2 class="card__title">Merged duplicates ({ticket.duplicates.length})</h2>
						<ul class="mini">
							{#each ticket.duplicates as d}
								{@const r = context?.related.find((x) => x.id === d)}
								<li><a href="/admin/support/{d}">{ticketRef(d)}{r ? ` · ${r.subject}` : ''}</a><span>Resolved as a duplicate of this ticket</span></li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if context?.reports.length}
					<section class="card">
						<h2 class="card__title">Their reports</h2>
						<ul class="mini">
							{#each context.reports as r}
								<li><a href="/admin/reports">{r.title}</a><span>{r.type} · {r.status} · {fmtDate(r.createdAt)}</span></li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if context?.errors.length}
					<section class="card">
						<h2 class="card__title">Recent server errors</h2>
						<ul class="mini">
							{#each context.errors as er}
								<li><a href="/admin/errors" class="mono">{er.route}</a><span>{er.message} · ×{er.count} · {timeAgo(er.lastSeenAt)}</span></li>
							{/each}
						</ul>
					</section>
				{/if}

				<button class="delete" onclick={remove}>Delete ticket</button>
			</aside>
		</div>
	{/if}
</div>

<style>
	.page { padding: 28px; max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
	.back { font-size: 0.8125rem; color: var(--text-tertiary); text-decoration: none; align-self: flex-start; }
	.back:hover { color: var(--text-primary); }

	.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
	.head__main { min-width: 0; }
	.head__title { margin: 0; font-size: 1.375rem; font-weight: 700; overflow-wrap: anywhere; }
	.head__meta { margin: 4px 0 0; font-size: 0.8125rem; color: var(--text-tertiary); }

	.head__badges { display: flex; gap: 6px; flex-shrink: 0; }
	.head__orig { margin: 2px 0 0; font-size: 0.8125rem; color: var(--text-tertiary); font-style: italic; overflow-wrap: anywhere; }

	.thread-bar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
	.thread-bar:empty { display: none; }
	.thread-bar__lang { margin-right: auto; font-size: 0.75rem; color: var(--text-tertiary); }

	.dup-banner {
		display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 14px;
		border-radius: var(--radius-lg); border: 1px solid var(--border-strong); background: var(--bg-surface-3);
		color: var(--text-secondary); font-size: 0.8125rem;
	}
	.dup-banner svg { flex-shrink: 0; color: var(--text-tertiary); }
	.dup-banner__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 200px; }
	.dup-banner__body strong { color: var(--text-primary); font-weight: 600; }
	.dup-banner__body a { color: var(--text-brand); text-decoration: none; }
	.dup-banner__body a:hover { text-decoration: underline; }
	.dup-banner__actions { display: flex; gap: 6px; }

	.dup-picker { display: flex; flex-direction: column; gap: 10px; }
	.dup-list { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; }
	.dup-option {
		display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; cursor: pointer;
		border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-surface);
	}
	.dup-option--on { border-color: var(--color-brand-dim); background: var(--color-brand-muted); }
	.dup-option input { margin-top: 3px; }
	.dup-option__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.dup-option__subject { font-size: 0.8125rem; color: var(--text-primary); overflow-wrap: anywhere; }
	.dup-option__meta { font-size: 0.6875rem; color: var(--text-tertiary); }
	.dup-picker__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
	.dup-picker__btns { display: flex; gap: 8px; }
	.dup-notify { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-secondary); }

	.btn--sm { padding: 5px 10px; font-size: 0.75rem; text-decoration: none; display: inline-flex; align-items: center; }
	.btn--ghost { background: transparent; border: 1px solid var(--border-strong); color: var(--text-secondary); }
	.btn--ghost:hover:not(:disabled) { color: var(--text-primary); background: var(--interactive-hover); }
	.tab:disabled { opacity: 0.45; cursor: not-allowed; }

	.layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
	.main, .side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

	.card {
		background: var(--bg-surface-2); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg); padding: 16px;
	}
	.card__title {
		margin: 0 0 10px; font-size: 0.6875rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary);
	}

	.controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
	.seg {
		display: flex; flex-wrap: wrap; gap: 2px; padding: 3px;
		background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md);
	}
	.seg__btn {
		padding: 5px 10px; border-radius: 5px; border: none; background: transparent;
		color: var(--text-secondary); font-size: 0.75rem; font-weight: 500; font-family: var(--font-body); cursor: pointer;
	}
	.seg__btn:hover:not(:disabled) { color: var(--text-primary); }
	.seg__btn--on { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
	.prio { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; color: var(--text-tertiary); }

	select {
		padding: 5px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-default);
		background: var(--bg-surface); color: var(--text-primary); font-size: 0.8125rem; font-family: var(--font-body);
	}

	.composer { display: flex; flex-direction: column; gap: 12px; }
	.composer--note { border-style: dashed; border-color: color-mix(in srgb, var(--color-warning) 45%, transparent); }
	.composer__tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border-subtle); }
	.tab {
		padding: 6px 12px 8px; border: none; background: none; cursor: pointer;
		font-size: 0.8125rem; font-weight: 600; font-family: var(--font-body); color: var(--text-tertiary);
		border-bottom: 2px solid transparent; margin-bottom: -1px;
	}
	.tab--on { color: var(--text-primary); border-bottom-color: var(--color-brand); }

	.canned { display: flex; flex-wrap: wrap; gap: 6px; }
	.chip {
		padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border-default); background: transparent;
		color: var(--text-tertiary); font-size: 0.75rem; font-weight: 500; font-family: var(--font-body); cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
	}
	.chip--suggested { color: var(--text-secondary); border-color: var(--border-strong); }
	.chip:hover { border-color: var(--color-brand-dim); color: var(--text-primary); }
	.chip--pinned { color: var(--text-primary); border-color: var(--border-brand); }
	.chip--on { border-color: var(--color-brand-dim); background: var(--color-brand-muted); color: var(--text-brand); }

	.composer__input {
		width: 100%; box-sizing: border-box; padding: 10px 12px; min-height: 160px; resize: vertical;
		background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md);
		font: inherit; font-size: 0.875rem; line-height: 1.6; color: var(--text-primary);
	}
	.composer__input:focus { outline: none; border-color: var(--color-brand-dim); }

	.composer__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
	.trigger { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.75rem; color: var(--text-tertiary); }
	.trigger label { display: flex; align-items: center; gap: 6px; }
	.trigger__tags { font-family: var(--font-mono); color: var(--text-secondary); }
	.trigger__hint { font-size: 0.75rem; color: var(--text-tertiary); }
	.trigger__credit {
		display: flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-success) 10%, transparent); color: var(--text-success); font-weight: 600;
	}
	.trigger__credit--off { background: var(--bg-surface-3); color: var(--text-tertiary); }

	.btn { padding: 8px 16px; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; font-family: var(--font-body); cursor: pointer; }
	.btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.btn--primary { background: var(--color-brand-dim); color: #fff; border: none; }
	.btn--primary:hover:not(:disabled) { opacity: 0.85; }

	.dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 0.8125rem; }
	.dl dt { color: var(--text-tertiary); }
	.dl dd { margin: 0; color: var(--text-primary); min-width: 0; overflow-wrap: anywhere; }
	.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mono { font-family: var(--font-mono); font-size: 0.75rem; }
	.warn { color: var(--text-warning); }
	.link-ok { color: var(--text-success); }
	.muted-inline { color: var(--text-tertiary); }
	.dl dd a { color: var(--text-brand); text-decoration: none; }
	.dl dd a:hover { text-decoration: underline; }
	.link-btn {
		margin-top: 12px; padding: 6px 12px; border-radius: var(--radius-md);
		border: 1px solid var(--color-brand-dim); background: var(--color-brand-muted); color: var(--text-brand);
		font-size: 0.8125rem; font-weight: 600; font-family: var(--font-body); cursor: pointer;
	}
	.link-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.muted { margin: 0; font-size: 0.8125rem; color: var(--text-tertiary); }

	.links { display: flex; gap: 12px; margin-top: 12px; font-size: 0.8125rem; }
	.links a { color: var(--text-brand); text-decoration: none; }
	.links a:hover { text-decoration: underline; }

	.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
	.tag {
		display: inline-flex; align-items: center; gap: 4px;
		font-family: var(--font-mono); font-size: 0.6875rem; padding: 2px 4px 2px 8px; border-radius: 99px;
		background: var(--bg-surface-3); border: 1px solid var(--border-default); color: var(--text-secondary);
	}
	.tag button { border: none; background: none; color: var(--text-tertiary); cursor: pointer; padding: 0 4px; font-size: 0.8125rem; line-height: 1; }
	.tag button:hover { color: var(--text-danger); }
	.tag-form input {
		width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: var(--radius-sm);
		border: 1px solid var(--border-default); background: var(--bg-surface); color: var(--text-primary);
		font-size: 0.8125rem; font-family: var(--font-body);
	}

	.mini { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.mini li { display: flex; flex-direction: column; gap: 1px; font-size: 0.8125rem; min-width: 0; }
	.mini a { color: var(--text-primary); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mini a:hover { color: var(--text-brand); }
	.mini span { font-size: 0.6875rem; color: var(--text-tertiary); overflow-wrap: anywhere; }

	.delete {
		align-self: flex-start; padding: 6px 0; border: none; background: none; cursor: pointer;
		font-size: 0.75rem; font-family: var(--font-body); color: var(--text-tertiary);
	}
	.delete:hover { color: var(--text-danger); }

	.state { padding: 48px 16px; text-align: center; color: var(--text-tertiary); }
	.spinner {
		display: inline-block; width: 24px; height: 24px;
		border: 2px solid var(--border-default); border-top-color: var(--color-brand);
		border-radius: 50%; animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	@media (max-width: 1024px) {
		.layout { grid-template-columns: 1fr; }
	}
	@media (max-width: 768px) {
		.page { padding: 20px 16px; }
		.head { flex-direction: column; }
	}
</style>
