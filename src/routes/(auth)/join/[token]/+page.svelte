<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import Button from "$lib/components/ui/Button.svelte";
	import PhoneInput from "$lib/components/ui/PhoneInput.svelte";
	import { toastStore, userStore } from "$lib/stores";
	import {
		signInWithGoogle,
		sendMagicLink,
		sendPhoneOTP,
		createRecaptchaVerifier,
		PENDING_INVITE_KEY,
	} from "$lib/firebase/auth";
	import { getShopInvite, acceptShopInvite } from "$lib/firebase/firestore";
	import type { ShopInvite } from "$lib/types";
	import type { ConfirmationResult, RecaptchaVerifier } from "firebase/auth";

	const token = $derived(page.params.token ?? "");

	type Stage = "loading" | "invalid" | "confirm" | "auth" | "joining" | "done";
	let stage         = $state<Stage>("loading");
	let invite        = $state<ShopInvite | null>(null);
	let alreadyMember = $state(false);
	let loading       = $state(false);
	let _inviteHandled = false;

	// Auth sub-state
	type AuthTab = "link" | "phone";
	let authTab            = $state<AuthTab>("link");
	let email              = $state("");
	let linkSent           = $state(false);
	let phone              = $state("");
	let otp                = $state("");
	let otpSent            = $state(false);
	let confirmationResult = $state<ConfirmationResult | null>(null);
	let recaptchaEl        = $state<HTMLElement | null>(null);
	let recaptchaVerifier  = $state<RecaptchaVerifier | null>(null);

	const ROLE_LABELS: Record<string, string> = {
		owner:   "Owner",
		manager: "Manager",
		tech:    "Technician",
	};

	onMount(async () => {
		const inv = await getShopInvite(token).catch(() => null);
		if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) {
			stage = "invalid";
			return;
		}
		invite = inv;
		// Stash token so the verify page can auto-accept after a magic link
		localStorage.setItem(PENDING_INVITE_KEY, token);

		// Auth state may still be loading on first mount — let the $effect below handle it
		if (!userStore.loading) {
			resolveStage();
		}
	});

	// Fires once auth state settles or changes
	$effect(() => {
		if (!invite) return;
		if (userStore.loading) return;
		if (stage === "joining" || stage === "done" || stage === "invalid") return;
		resolveStage();
	});

	// After Google/phone sign-in completes while already on this page, auto-accept
	$effect(() => {
		if (stage !== "auth") return;
		if (!userStore.isAuth || !userStore.user || !invite) return;
		if (_inviteHandled) return;
		_inviteHandled = true;
		doAccept();
	});

	function resolveStage() {
		if (!invite) return;
		if (userStore.isAuth && userStore.user) {
			alreadyMember = userStore.user.shopId === invite.shopId;
			stage = "confirm";
		} else {
			stage = "auth";
		}
	}

	async function doAccept() {
		if (!invite || !userStore.user) return;
		stage = "joining";
		try {
			await acceptShopInvite(
				invite.id,
				userStore.user.uid,
				userStore.user.displayName || userStore.user.email,
				userStore.user.email,
			);
			localStorage.removeItem(PENDING_INVITE_KEY);
			stage = "done";
			toastStore.success("Welcome to the team!", `You've joined ${invite.shopName}.`);
			setTimeout(() => goto("/studio", { replaceState: true }), 900);
		} catch (err) {
			_inviteHandled = false;
			toastStore.error("Couldn't join", err instanceof Error ? err.message : "Please try again.");
			stage = "confirm";
		}
	}

	// ─── Auth handlers ────────────────────────────
	async function handleGoogle() {
		loading = true;
		try {
			await signInWithGoogle();
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Google sign-in failed.";
			if (!msg.includes("popup-closed")) toastStore.error("Google sign-in failed", msg);
		} finally {
			loading = false;
		}
	}

	async function handleSendLink(e: Event) {
		e.preventDefault();
		if (!email) return;
		loading = true;
		try {
			await sendMagicLink(email);
			linkSent = true;
		} catch (err: unknown) {
			toastStore.error("Couldn't send link", err instanceof Error ? err.message : "");
		} finally {
			loading = false;
		}
	}

	function resetRecaptcha() {
		try { recaptchaVerifier?.clear(); } catch {}
		recaptchaVerifier = null;
		if (recaptchaEl) recaptchaEl.innerHTML = "";
	}

	async function handleSendOTP(e: Event) {
		e.preventDefault();
		if (!phone || !recaptchaEl) return;
		loading = true;
		try {
			resetRecaptcha();
			recaptchaVerifier  = createRecaptchaVerifier(recaptchaEl);
			confirmationResult = await sendPhoneOTP(phone, recaptchaVerifier);
			otpSent = true;
		} catch (err: unknown) {
			resetRecaptcha();
			const code = (err as { code?: string }).code ?? "";
			console.error("[phone-otp]", code, err);
			const hint =
				code === "auth/operation-not-allowed" ? "Phone sign-in is not enabled — check Firebase Console → Authentication → Sign-in method." :
				code === "auth/invalid-app-credential" ? "reCAPTCHA failed — add localhost to Firebase Console → Authentication → Settings → Authorized domains." :
				code === "auth/too-many-requests" ? "Too many attempts. Try again later." : "";
			toastStore.error("Couldn't send code", hint || (err instanceof Error ? err.message : ""));
		} finally {
			loading = false;
		}
	}

	async function handleVerifyOTP(e: Event) {
		e.preventDefault();
		if (!otp || !confirmationResult) return;
		loading = true;
		try {
			await confirmationResult.confirm(otp);
		} catch {
			toastStore.error("Invalid code", "Please check the code and try again.");
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head><title>Join {invite?.shopName ?? "a shop"} — OmniPlot</title></svelte:head>

<div class="join-form">

	<!-- ── Loading ─────────────────────────────── -->
	{#if stage === "loading"}
		<div class="center-col">
			<span class="spinner" aria-label="Loading invite…"></span>
			<p class="sub">Loading invite…</p>
		</div>

	<!-- ── Invalid ─────────────────────────────── -->
	{:else if stage === "invalid"}
		<div class="center-col">
			<svg class="icon-warn" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
			</svg>
			<h1 class="title">Invite not valid</h1>
			<p class="sub">This invite link has expired, already been used, or doesn't exist.</p>
			<a href="/login" class="btn-ghost">Back to sign in</a>
		</div>

	<!-- ── Done ────────────────────────────────── -->
	{:else if stage === "done"}
		<div class="center-col">
			<svg class="icon-ok" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
			</svg>
			<p class="sub">You're in! Heading to your workspace…</p>
		</div>

	<!-- ── Joining ──────────────────────────────── -->
	{:else if stage === "joining"}
		<div class="center-col">
			<span class="spinner" aria-label="Joining…"></span>
			<p class="sub">Joining {invite?.shopName}…</p>
		</div>

	<!-- ── Confirm (already signed in) ─────────── -->
	{:else if stage === "confirm" && invite}
		<div class="shop-card">
			<div class="shop-icon" aria-hidden="true">
				{invite.shopName.charAt(0).toUpperCase()}
			</div>
			<div class="shop-info">
				<span class="shop-name">{invite.shopName}</span>
				<span class="role-badge">{ROLE_LABELS[invite.role] ?? invite.role}</span>
			</div>
		</div>

		{#if alreadyMember}
			<h1 class="title">You're already on this team</h1>
			<p class="sub">You're already a member of {invite.shopName}.</p>
			<Button variant="primary" size="lg" onclick={() => goto("/studio", { replaceState: true })} class="full-btn">
				Go to studio
			</Button>
		{:else}
			<h1 class="title">You've been invited</h1>
			<p class="sub">
				Join <strong>{invite.shopName}</strong> as a <strong>{ROLE_LABELS[invite.role] ?? invite.role}</strong>.
				You'll share the team's plan and pattern library.
			</p>
			<Button variant="primary" size="lg" onclick={doAccept} loading={loading} class="full-btn">
				Accept &amp; join {invite.shopName}
			</Button>
			<a href="/studio" class="btn-ghost">No thanks, go to my account</a>
		{/if}

	<!-- ── Auth (sign in to accept) ─────────────── -->
	{:else if stage === "auth" && invite}
		<div class="shop-card">
			<div class="shop-icon" aria-hidden="true">
				{invite.shopName.charAt(0).toUpperCase()}
			</div>
			<div class="shop-info">
				<span class="shop-name">{invite.shopName}</span>
				<span class="role-badge">{ROLE_LABELS[invite.role] ?? invite.role}</span>
			</div>
		</div>

		<h1 class="title">You've been invited</h1>
		<p class="sub">Sign in or create a free account to join <strong>{invite.shopName}</strong>.</p>

		<button class="oauth-btn" onclick={handleGoogle} disabled={loading} type="button">
			<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
				<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
				<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
				<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
				<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
			</svg>
			Continue with Google
		</button>

		<div class="divider" aria-hidden="true"><span>or</span></div>

		<div class="tabs" role="tablist">
			<button role="tab" class="tab" class:active={authTab === "link"}  onclick={() => authTab = "link"}  aria-selected={authTab === "link"}>Email link</button>
			<button role="tab" class="tab" class:active={authTab === "phone"} onclick={() => authTab = "phone"} aria-selected={authTab === "phone"}>Phone</button>
		</div>

		{#if authTab === "link"}
			{#if linkSent}
				<div class="sent-msg">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
					<div>
						<strong>Check your inbox</strong>
						<span>We sent a sign-in link to <em>{email}</em>. Click it to finish and you'll be joined automatically.</span>
					</div>
				</div>
				<button class="resend-btn" onclick={() => { linkSent = false; email = ""; }}>Use a different email</button>
			{:else}
				<form onsubmit={handleSendLink}>
					<div class="field">
						<label for="email" class="field-label">Email address</label>
						<input id="email" type="email" class="field-input" placeholder="you@shop.com" bind:value={email} autocomplete="email" required />
					</div>
					<Button variant="primary" size="lg" type="submit" {loading} class="full-btn">Send sign-in link</Button>
				</form>
			{/if}
		{/if}

		{#if authTab === "phone"}
			{#if !otpSent}
				<form onsubmit={handleSendOTP}>
					<div class="field">
						<label for="phone" class="field-label">Phone number</label>
						<PhoneInput id="phone" bind:value={phone} required />
					</div>
					<Button variant="primary" size="lg" type="submit" {loading} class="full-btn">Send code</Button>
				</form>
			{:else}
				<form onsubmit={handleVerifyOTP}>
					<div class="field">
						<label for="otp" class="field-label">Verification code</label>
						<p class="field-hint top">Sent to {phone}</p>
						<input id="otp" type="text" inputmode="numeric" class="field-input otp-input" placeholder="000000" maxlength="6" bind:value={otp} autocomplete="one-time-code" required />
					</div>
					<Button variant="primary" size="lg" type="submit" {loading} class="full-btn">Verify &amp; join</Button>
					<button class="resend-btn" type="button" onclick={() => { otpSent = false; otp = ""; confirmationResult = null; }}>Use a different number</button>
				</form>
			{/if}
			<div bind:this={recaptchaEl} aria-hidden="true"></div>
		{/if}

		<p class="auth-switch">
			Already have an account? <a href="/login" class="auth-switch-link">Sign in →</a>
		</p>
	{/if}

</div>

<style>
	.join-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.center-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 8px 0;
		text-align: center;
	}

	.spinner {
		display: block;
		width: 32px;
		height: 32px;
		border: 2px solid var(--border-default);
		border-top-color: var(--color-brand);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.icon-ok  { color: var(--color-success); }
	.icon-warn { color: var(--color-warning); }

	.title {
		font-size: 1.375rem;
		letter-spacing: -0.02em;
		margin: 0;
	}
	.sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0;
		line-height: 1.5;
	}
	.sub strong { color: var(--text-primary); font-weight: 600; }

	/* Shop identity card */
	.shop-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
	}
	.shop-icon {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		background: var(--color-brand-dim);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.125rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.shop-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.shop-name {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.role-badge {
		display: inline-block;
		font-size: 0.75rem;
		font-weight: 500;
		padding: 2px 7px;
		border-radius: 999px;
		background: rgba(var(--color-brand-rgb, 99, 102, 241), 0.12);
		color: var(--color-brand);
		width: fit-content;
	}

	/* Auth form elements (mirrors login/signup pages) */
	.oauth-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		width: 100%;
		padding: 10px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.9375rem;
		font-weight: 500;
		font-family: var(--font-body);
		color: var(--text-primary);
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
	}
	.oauth-btn:hover:not(:disabled) { background: var(--bg-surface-3); border-color: var(--border-strong); }
	.oauth-btn:disabled { opacity: 0.6; cursor: not-allowed; }

	.divider {
		display: flex;
		align-items: center;
		gap: 12px;
		color: var(--text-tertiary);
		font-size: 0.8125rem;
	}
	.divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--border-subtle); }

	.tabs {
		display: flex;
		gap: 2px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 3px;
	}
	.tab {
		flex: 1;
		padding: 7px 12px;
		border: none;
		border-radius: calc(var(--radius-md) - 2px);
		background: transparent;
		font-size: 0.875rem;
		font-weight: 500;
		font-family: var(--font-body);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
	}
	.tab.active { background: var(--bg-surface); color: var(--text-primary); }
	.tab:hover:not(.active) { color: var(--text-secondary); }

	.field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
	.field-label { font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); }
	.field-hint { font-size: 0.8125rem; color: var(--text-tertiary); margin: 0; }
	.field-hint.top { margin-bottom: 4px; }

	.field-input {
		width: 100%;
		padding: 9px 12px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.9375rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
	}
	.field-input:focus { border-color: var(--color-brand-dim); }
	.field-input::placeholder { color: var(--text-tertiary); }
	.otp-input { letter-spacing: 0.25em; font-size: 1.125rem; text-align: center; }

	.sent-msg {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 14px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
	}
	.sent-msg svg { flex-shrink: 0; margin-top: 2px; color: var(--color-brand); }
	.sent-msg div { display: flex; flex-direction: column; gap: 2px; font-size: 0.875rem; }
	.sent-msg strong { color: var(--text-primary); }
	.sent-msg em { color: var(--text-primary); font-style: normal; font-weight: 500; }

	.resend-btn {
		background: none;
		border: none;
		font-size: 0.8125rem;
		color: var(--text-brand);
		cursor: pointer;
		padding: 0;
		font-family: var(--font-body);
		text-align: left;
	}
	.resend-btn:hover { text-decoration: underline; }

	:global(.full-btn) { width: 100% !important; justify-content: center; }

	.btn-ghost {
		display: block;
		text-align: center;
		font-size: 0.875rem;
		color: var(--text-secondary);
		text-decoration: none;
		padding: 2px 0;
	}
	.btn-ghost:hover { color: var(--text-primary); }

	.auth-switch { text-align: center; font-size: 0.875rem; color: var(--text-secondary); margin: 0; }
	.auth-switch-link { color: var(--text-brand); text-decoration: none; font-weight: 500; }
	.auth-switch-link:hover { text-decoration: underline; }
</style>
