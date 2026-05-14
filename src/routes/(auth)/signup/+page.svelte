<script lang="ts">
	import Button from "$lib/components/ui/Button.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import { toastStore } from "$lib/stores";
	import { page } from "$app/state";

	let name = $state("");
	let email = $state("");
	let password = $state("");
	let showPass = $state(false);
	let loading = $state(false);
	let agreed = $state(false);

	// pre-fill plan from query param
	const plan = $derived(page.url.searchParams.get("plan") ?? "free");
	const billing = $derived(page.url.searchParams.get("billing") ?? "monthly");

	const PLAN_LABELS: Record<string, string> = {
		free: "Free",
		lite: "Lite — $29/mo",
		pro: "Pro — 14-day free trial",
	};

	async function handleSignup(e: Event) {
		e.preventDefault();
		if (!agreed) {
			toastStore.warning(
				"Terms required",
				"Please agree to the terms of service.",
			);
			return;
		}
		loading = true;
		await new Promise((r) => setTimeout(r, 1100));
		loading = false;
		toastStore.success("Account created!", "Welcome to OmniPlot.");
	}

	async function googleSignup() {
		loading = true;
		await new Promise((r) => setTimeout(r, 800));
		loading = false;
		toastStore.success("Signed up with Google", "Welcome to OmniPlot!");
	}
</script>

<svelte:head><title>Sign Up — OmniPlot</title></svelte:head>

<div class="auth-form">
	<div class="auth-form__head">
		<h1 class="auth-title">Create your account</h1>
		{#if plan !== "free"}
			<Badge variant={plan === "pro" ? "pro" : "lite"}>
				{PLAN_LABELS[plan] ?? plan}
			</Badge>
		{/if}
	</div>
	<p class="auth-sub">Start cutting for free. No credit card required.</p>

	<button class="oauth-btn" onclick={googleSignup} type="button">
		<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
			<path
				fill="#4285F4"
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
			/>
			<path
				fill="#34A853"
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
			/>
			<path
				fill="#FBBC05"
				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
			/>
			<path
				fill="#EA4335"
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
			/>
		</svg>
		Continue with Google
	</button>

	<div class="divider" aria-hidden="true"><span>or</span></div>

	<form onsubmit={handleSignup}>
		<div class="fields">
			<div class="field">
				<label for="name" class="field-label">Your name</label>
				<input
					id="name"
					type="text"
					class="field-input"
					placeholder="Jane Smith"
					bind:value={name}
					autocomplete="name"
					required
				/>
			</div>

			<div class="field">
				<label for="email" class="field-label">Work email</label>
				<input
					id="email"
					type="email"
					class="field-input"
					placeholder="jane@yourshop.com"
					bind:value={email}
					autocomplete="email"
					required
				/>
			</div>

			<div class="field">
				<label for="password" class="field-label">Password</label>
				<div class="field-input-wrap">
					<input
						id="password"
						type={showPass ? "text" : "password"}
						class="field-input"
						placeholder="Min 8 characters"
						bind:value={password}
						autocomplete="new-password"
						minlength="8"
						required
					/>
					<button
						type="button"
						class="show-pass"
						onclick={() => (showPass = !showPass)}
						aria-label={showPass
							? "Hide password"
							: "Show password"}
					>
						{#if showPass}
							<svg
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
								><path
									d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"
								/></svg
							>
						{:else}
							<svg
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
								><path
									d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
								/><circle cx="12" cy="12" r="3" /></svg
							>
						{/if}
					</button>
				</div>
				<!-- Password strength -->
				{#if password.length > 0}
					<div class="pass-strength">
						<div
							class="pass-bar"
							style="background: {password.length >= 8
								? password.length >= 12
									? 'var(--color-success)'
									: 'var(--color-warning)'
								: 'var(--color-danger)'}"
						></div>
						<div
							class="pass-bar"
							style="background: {password.length >= 8
								? password.length >= 12
									? 'var(--color-success)'
									: 'var(--color-warning)'
								: 'var(--bg-surface-3)'}"
						></div>
						<div
							class="pass-bar"
							style="background: {password.length >= 12
								? 'var(--color-success)'
								: 'var(--bg-surface-3)'}"
						></div>
						<span class="pass-label">
							{password.length >= 12
								? "Strong"
								: password.length >= 8
									? "Good"
									: "Weak"}
						</span>
					</div>
				{/if}
			</div>
		</div>

		<label class="terms-row">
			<input type="checkbox" class="terms-check" bind:checked={agreed} />
			<span class="terms-text">
				I agree to the <a href="/terms" class="field-link"
					>Terms of Service</a
				>
				and <a href="/privacy" class="field-link">Privacy Policy</a>.
			</span>
		</label>

		<Button
			variant="primary"
			size="lg"
			type="submit"
			{loading}
			class="submit-btn"
		>
			{plan === "pro" ? "Start free trial" : "Create free account"}
		</Button>
	</form>

	<p class="auth-switch">
		Already have an account? <a href="/login" class="auth-switch-link"
			>Sign in →</a
		>
	</p>
</div>

<style>
	.auth-form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.auth-form__head {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.auth-title {
		font-size: 1.5rem;
		letter-spacing: -0.02em;
		margin: 0;
	}
	.auth-sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0;
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
		transition:
			background 0.12s,
			border-color 0.12s;
	}
	.oauth-btn:hover {
		background: var(--bg-surface-3);
		border-color: var(--border-strong);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: 12px;
		color: var(--text-tertiary);
		font-size: 0.8125rem;
	}
	.divider::before,
	.divider::after {
		content: "";
		flex: 1;
		height: 1px;
		background: var(--border-subtle);
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.field-input-wrap {
		position: relative;
	}

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
	.field-input:focus {
		border-color: var(--color-brand-dim);
	}
	.field-input::placeholder {
		color: var(--text-tertiary);
	}

	.show-pass {
		position: absolute;
		right: 10px;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		display: flex;
		align-items: center;
		transition: color 0.12s;
	}
	.show-pass:hover {
		color: var(--text-primary);
	}

	.pass-strength {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 4px;
	}

	.pass-bar {
		height: 3px;
		flex: 1;
		border-radius: 2px;
		transition: background 0.2s;
	}

	.pass-label {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		margin-left: 4px;
		white-space: nowrap;
	}

	.terms-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		cursor: pointer;
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.terms-check {
		accent-color: var(--color-brand-dim);
		margin-top: 2px;
		flex-shrink: 0;
	}
	.terms-text {
		line-height: 1.5;
	}

	.field-link {
		color: var(--text-brand);
		text-decoration: none;
	}
	.field-link:hover {
		text-decoration: underline;
	}

	:global(.submit-btn) {
		width: 100% !important;
		justify-content: center;
	}

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
	.auth-switch-link:hover {
		text-decoration: underline;
	}
</style>
