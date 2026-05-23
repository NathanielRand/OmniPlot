<script lang="ts">
	import { goto } from "$app/navigation";
	import Button from "$lib/components/ui/Button.svelte";
	import PhoneInput from "$lib/components/ui/PhoneInput.svelte";
	import { toastStore, userStore } from "$lib/stores";
	import {
		signInWithGoogle,
		sendMagicLink,
		sendPhoneOTP,
		createRecaptchaVerifier,
	} from "$lib/firebase/auth";
	import type { ConfirmationResult, RecaptchaVerifier } from "firebase/auth";

	// ─── UI state ─────────────────────────────
	type Tab = "link" | "phone";
	let tab        = $state<Tab>("link");
	let loading    = $state(false);

	// Show a banner when redirected here after a session kick
	const kicked = $derived(
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).get("reason") === "kicked",
	);

	// Magic link
	let email      = $state("");
	let linkSent   = $state(false);

	// Phone
	let phone               = $state("");   // E.164 from PhoneInput
	let otp                 = $state("");
	let otpSent             = $state(false);
	let confirmationResult  = $state<ConfirmationResult | null>(null);
	let recaptchaEl         = $state<HTMLElement | null>(null);
	let recaptchaVerifier   = $state<RecaptchaVerifier | null>(null);

	// Redirect once signed in
	$effect(() => {
		if (userStore.isAuth) goto("/studio", { replaceState: true });
	});

	// ─── Google ───────────────────────────────
	async function handleGoogle() {
		loading = true;
		try {
			await signInWithGoogle();
			// redirect handled by $effect above
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Google sign-in failed.";
			if (!msg.includes("popup-closed")) toastStore.error("Google sign-in failed", msg);
		} finally {
			loading = false;
		}
	}

	// ─── Magic link ───────────────────────────
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

	// ─── Phone: send OTP ──────────────────────
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

	// ─── Phone: verify OTP ────────────────────
	async function handleVerifyOTP(e: Event) {
		e.preventDefault();
		if (!otp || !confirmationResult) return;
		loading = true;
		try {
			await confirmationResult.confirm(otp);
			// redirect handled by $effect above
		} catch {
			toastStore.error("Invalid code", "Please check the code and try again.");
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head><title>Sign In — OmniPlot</title></svelte:head>

<div class="auth-form">
	{#if kicked}
		<div class="kicked-banner" role="alert">
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
			You were signed out because your account was opened on another device.
		</div>
	{/if}
	<h1 class="auth-title">Welcome back</h1>
	<p class="auth-sub">Sign in to your OmniPlot account.</p>

	<!-- Google -->
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

	<!-- Tabs -->
	<div class="tabs" role="tablist">
		<button role="tab" class="tab" class:active={tab === "link"}  onclick={() => tab = "link"}  aria-selected={tab === "link"}>
			Email link
		</button>
		<button role="tab" class="tab" class:active={tab === "phone"} onclick={() => tab = "phone"} aria-selected={tab === "phone"}>
			Phone
		</button>
	</div>

	<!-- Magic link panel -->
	{#if tab === "link"}
		{#if linkSent}
			<div class="sent-msg">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
				<div>
					<strong>Check your inbox</strong>
					<span>We sent a sign-in link to <em>{email}</em>.</span>
				</div>
			</div>
			<button class="resend-btn" onclick={() => { linkSent = false; email = ""; }}>
				Use a different email
			</button>
		{:else}
			<form onsubmit={handleSendLink}>
				<div class="field">
					<label for="email" class="field-label">Email address</label>
					<input
						id="email"
						type="email"
						class="field-input"
						placeholder="you@shop.com"
						bind:value={email}
						autocomplete="email"
						required
					/>
				</div>
				<Button variant="primary" size="lg" type="submit" {loading} class="submit-btn">
					Send sign-in link
				</Button>
			</form>
		{/if}
	{/if}

	<!-- Phone panel -->
	{#if tab === "phone"}
		{#if !otpSent}
			<form onsubmit={handleSendOTP}>
				<div class="field">
					<label for="phone" class="field-label">Phone number</label>
					<PhoneInput id="phone" bind:value={phone} required />
				</div>
				<Button variant="primary" size="lg" type="submit" {loading} class="submit-btn">
					Send code
				</Button>
			</form>
		{:else}
			<form onsubmit={handleVerifyOTP}>
				<div class="field">
					<label for="otp" class="field-label">Verification code</label>
					<p class="field-hint top">Sent to {phone}</p>
					<input
						id="otp"
						type="text"
						inputmode="numeric"
						class="field-input otp-input"
						placeholder="000000"
						maxlength="6"
						bind:value={otp}
						autocomplete="one-time-code"
						required
					/>
				</div>
				<Button variant="primary" size="lg" type="submit" {loading} class="submit-btn">
					Verify & sign in
				</Button>
				<button class="resend-btn" type="button" onclick={() => { otpSent = false; otp = ""; confirmationResult = null; }}>
					Use a different number
				</button>
			</form>
		{/if}

		<!-- Invisible reCAPTCHA mount point -->
		<div bind:this={recaptchaEl} aria-hidden="true"></div>
	{/if}

	<p class="auth-switch">
		Don't have an account? <a href="/signup" class="auth-switch-link">Sign up free →</a>
	</p>
</div>

<style>
	.auth-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.auth-title {
		font-size: 1.5rem;
		letter-spacing: -0.02em;
		margin: 0 0 4px;
	}
	.auth-sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0 0 4px;
	}

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
	.divider::before, .divider::after {
		content: "";
		flex: 1;
		height: 1px;
		background: var(--border-subtle);
	}

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

	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-bottom: 12px;
	}
	.field-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.field-hint {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		margin: 0;
	}
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

	:global(.submit-btn) { width: 100% !important; justify-content: center; }

	.auth-switch {
		text-align: center;
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0;
	}
	.auth-switch-link {
		color: var(--text-brand);
		text-decoration: none;
		font-weight: 500;
	}
	.auth-switch-link:hover { text-decoration: underline; }

	.kicked-banner {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 11px 14px;
		background: rgba(255, 181, 71, 0.08);
		border: 1px solid rgba(255, 181, 71, 0.3);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-warning);
		line-height: 1.4;
	}
	.kicked-banner svg { flex-shrink: 0; margin-top: 1px; }
</style>
