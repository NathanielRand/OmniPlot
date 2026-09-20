<script lang="ts">
	import { page } from "$app/stores";
	import Button from "$lib/components/ui/Button.svelte";
	import Logo from "$lib/components/ui/Logo.svelte";
	import { uiStore, toastStore } from "$lib/stores";

	type Tone = "neutral" | "warning" | "danger";
	interface ErrorInfo {
		title: string;
		desc: string;
		icon: string;
		tone: Tone;
	}

	const ICONS = {
		compass:
			"M12 22a10 10 0 100-20 10 10 0 000 20z M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z",
		lock: "M6 11V7a6 6 0 0112 0v4 M5 11h14v9a2 2 0 01-2 2H7a2 2 0 01-2-2v-9z",
		clock: "M12 22a10 10 0 100-20 10 10 0 000 20z M12 6v6l4 2",
		triangle:
			"M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01",
		circle: "M12 22a10 10 0 100-20 10 10 0 000 20z M12 8v4 M12 16h.01",
	};

	// Messages SvelteKit fills in by default when a route throws error(status)
	// with no message — treat these as "no real detail", not worth surfacing.
	const GENERIC_MESSAGES = new Set([
		"Not Found",
		"Forbidden",
		"Unauthorized",
		"Bad Request",
		"Internal Error",
		"An unexpected error occurred.",
	]);

	const info = $derived.by((): ErrorInfo => {
		const status = $page.status;
		const msg = $page.error?.message;
		const custom = msg && !GENERIC_MESSAGES.has(msg) ? msg : undefined;

		switch (status) {
			case 404:
				return {
					title: "Page not found",
					desc: custom ?? "The page you're looking for doesn't exist or has been moved.",
					icon: ICONS.compass,
					tone: "neutral",
				};
			case 401:
				return {
					title: "Sign-in required",
					desc: custom ?? "You need to sign in to view this page.",
					icon: ICONS.lock,
					tone: "warning",
				};
			case 403:
				return {
					title: "Access denied",
					desc: custom ?? "You don't have permission to view this page.",
					icon: ICONS.lock,
					tone: "warning",
				};
			case 429:
				return {
					title: "Too many requests",
					desc: custom ?? "You're sending requests a bit too fast — wait a moment and try again.",
					icon: ICONS.clock,
					tone: "warning",
				};
			case 503:
				return {
					title: "Service temporarily unavailable",
					desc: custom ?? "OmniPlot is undergoing maintenance. Please check back shortly.",
					icon: ICONS.triangle,
					tone: "danger",
				};
			default:
				if (status >= 500) {
					return {
						title: "Something went wrong",
						desc: custom ?? "An unexpected error occurred on our end. Please try again.",
						icon: ICONS.triangle,
						tone: "danger",
					};
				}
				return {
					title: "Unexpected error",
					desc: custom ?? "An unexpected error occurred. Please try again.",
					icon: ICONS.circle,
					tone: "danger",
				};
		}
	});

	function reportIssue() {
		uiStore.openReport({
			type: "bug",
			title: `Error ${$page.status} on ${location.pathname}`,
			description: `What were you doing when this happened?\n\n—\nStatus: ${$page.status}\nMessage: ${$page.error?.message ?? "—"}\nURL: ${location.href}`,
		});
	}

	async function copyDetails() {
		const details = [
			`Status: ${$page.status}`,
			`Message: ${$page.error?.message ?? "—"}`,
			`URL: ${location.href}`,
			`Time: ${new Date().toISOString()}`,
		].join("\n");
		try {
			await navigator.clipboard.writeText(details);
			toastStore.success("Copied", "Error details copied to clipboard.");
		} catch {
			toastStore.error("Couldn't copy", "Your browser blocked clipboard access.");
		}
	}
</script>

<svelte:head>
	<title>{$page.status} — OmniPlot</title>
</svelte:head>

<div class="error-page">
	<svg class="error-page__path" viewBox="0 0 600 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
		<path
			d="M-40 260 L80 260 L130 160 L260 160 L310 40 L440 40 L480 -20"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			class="marching-ants"
		/>
	</svg>

	<div class="error-card animate-slide-up">
		<Logo size={24} class="error-card__logo" />

		<div class="error-icon error-icon--{info.tone}" aria-hidden="true">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d={info.icon} />
			</svg>
		</div>

		<div class="error-status">Error {$page.status}</div>
		<h1 class="error-title">{info.title}</h1>
		<p class="error-desc">{info.desc}</p>

		<div class="error-actions">
			{#if $page.status === 401}
				<Button variant="primary" size="sm" href="/login">Sign in</Button>
				<Button variant="ghost" size="sm" href="/">Go home</Button>
			{:else}
				<Button variant="primary" size="sm" href="/">Go home</Button>
				<Button variant="ghost" size="sm" onclick={() => history.back()}>Go back</Button>
			{/if}
		</div>

		{#if info.tone === "danger"}
			<div class="error-meta">
				<button type="button" class="error-meta__link" onclick={reportIssue}>Report this issue</button>
				<span class="error-meta__sep" aria-hidden="true">·</span>
				<button type="button" class="error-meta__link" onclick={copyDetails}>Copy details</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.error-page {
		position: relative;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: var(--bg-base);
		background-image:
			linear-gradient(var(--canvas-grid) 1px, transparent 1px),
			linear-gradient(90deg, var(--canvas-grid) 1px, transparent 1px);
		background-size: 32px 32px;
		overflow: hidden;
	}

	.error-page__path {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		color: var(--cut-path-primary);
		opacity: 0.2;
		pointer-events: none;
	}

	.error-card {
		position: relative;
		text-align: center;
		max-width: 420px;
		width: 100%;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-lg);
		padding: 36px 32px 32px;
	}

	.error-card :global(.error-card__logo) {
		justify-content: center;
		margin-bottom: 20px;
	}

	.error-icon {
		width: 48px;
		height: 48px;
		margin: 0 auto 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
	}
	.error-icon--neutral {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		color: var(--text-tertiary);
	}
	.error-icon--warning {
		background: color-mix(in srgb, var(--color-warning) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
		color: var(--text-warning);
	}
	.error-icon--danger {
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
		color: var(--text-danger);
	}

	.error-status {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		margin-bottom: 8px;
	}

	.error-title {
		font-size: 1.375rem;
		font-weight: 700;
		margin-bottom: 8px;
		color: var(--text-primary);
	}

	.error-desc {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin-bottom: 26px;
	}

	.error-actions {
		display: flex;
		gap: 8px;
		justify-content: center;
	}

	.error-meta {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		margin-top: 18px;
		padding-top: 18px;
		border-top: 1px solid var(--border-subtle);
	}

	.error-meta__link {
		background: none;
		border: none;
		padding: 0;
		font-family: var(--font-body);
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: color 0.12s;
	}
	.error-meta__link:hover {
		color: var(--text-brand);
	}
	.error-meta__sep {
		color: var(--text-disabled);
		font-size: 0.75rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.error-page__path :global(.marching-ants) {
			animation: none;
		}
	}
</style>
