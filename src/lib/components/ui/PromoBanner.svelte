<script lang="ts">
	import { onMount } from 'svelte';
	import { userStore } from '$lib/stores';

	interface Banner {
		code:        string;
		message:     string;
		cta:         string;
		ctaHref:     string;
		accentColor: string;
		expiresAt:   number | null;
	}

	let banner    = $state<Banner | null>(null);
	let dismissed = $state(false);
	let loaded    = $state(false);

	const DISMISS_KEY = (code: string) => `omniplot_banner_dismissed_${code}`;

	const COLOR_MAP: Record<string, { bg: string; text: string; border: string; pill: string; cta: string }> = {
		brand:   { bg: '#0070ff', text: '#ffffff', border: 'rgba(255,255,255,0.18)', pill: 'rgba(255,255,255,0.18)', cta: 'rgba(255,255,255,0.15)' },
		success: { bg: '#00a86b', text: '#ffffff', border: 'rgba(255,255,255,0.18)', pill: 'rgba(255,255,255,0.18)', cta: 'rgba(255,255,255,0.15)' },
		warning: { bg: '#d97706', text: '#ffffff', border: 'rgba(255,255,255,0.18)', pill: 'rgba(255,255,255,0.18)', cta: 'rgba(255,255,255,0.15)' },
		danger:  { bg: '#dc2626', text: '#ffffff', border: 'rgba(255,255,255,0.18)', pill: 'rgba(255,255,255,0.18)', cta: 'rgba(255,255,255,0.15)' },
	};

	function colors(accent: string) {
		return COLOR_MAP[accent] ?? COLOR_MAP['brand'];
	}

	function dismiss() {
		if (banner) localStorage.setItem(DISMISS_KEY(banner.code), '1');
		dismissed = true;
	}

	function copyCode() {
		if (!banner) return;
		navigator.clipboard.writeText(banner.code).catch(() => {});
		codeCopied = true;
		setTimeout(() => { codeCopied = false; }, 2000);
	}

	let codeCopied = $state(false);

	onMount(async () => {
		try {
			const res = await fetch('/api/promo-banner');
			if (res.ok) {
				const data = await res.json();
				if (data.banner) {
					const key = DISMISS_KEY(data.banner.code);
					if (!localStorage.getItem(key)) {
						banner = data.banner;
					}
				}
			}
		} catch { /* non-fatal */ } finally {
			loaded = true;
		}
	});

	// Hide once user is confirmed authenticated
	const visible = $derived(
		loaded &&
		banner !== null &&
		!dismissed &&
		!userStore.user &&
		!userStore.loading
	);
</script>

{#if visible && banner}
	{@const c = colors(banner.accentColor)}
	<div
		class="promo-banner"
		style:background={c.bg}
		style:border-bottom="1px solid {c.border}"
		role="banner"
		aria-label="Promotional offer"
	>
		<div class="promo-banner__inner">
			<!-- Message -->
			<p class="promo-banner__message" style:color={c.text}>
				{banner.message}
			</p>

			<!-- Code pill -->
			<button
				class="promo-banner__code"
				style:background={c.pill}
				style:color={c.text}
				onclick={copyCode}
				aria-label="Copy code {banner.code}"
				title={codeCopied ? 'Copied!' : 'Click to copy'}
			>
				{#if codeCopied}
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
					Copied!
				{:else}
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
					{banner.code}
				{/if}
			</button>

			<!-- CTA -->
			<a
				href={banner.ctaHref}
				class="promo-banner__cta"
				style:background={c.cta}
				style:color={c.text}
			>
				{banner.cta}
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
			</a>
		</div>

		<!-- Dismiss -->
		<button
			class="promo-banner__dismiss"
			style:color={c.text}
			onclick={dismiss}
			aria-label="Dismiss promotion"
		>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
		</button>
	</div>
{/if}

<style>
	.promo-banner {
		position: relative;
		width: 100%;
		z-index: 100;
	}

	.promo-banner__inner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 9px 48px 9px 16px;
		flex-wrap: wrap;
	}

	.promo-banner__message {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1.4;
		opacity: 0.97;
	}

	.promo-banner__code {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 10px;
		border-radius: 99px;
		border: none;
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		cursor: pointer;
		white-space: nowrap;
		transition: opacity 0.15s;
	}
	.promo-banner__code:hover { opacity: 0.85; }

	.promo-banner__cta {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 14px;
		border-radius: 6px;
		font-size: 0.8125rem;
		font-weight: 700;
		text-decoration: none;
		white-space: nowrap;
		transition: opacity 0.15s;
	}
	.promo-banner__cta:hover { opacity: 0.85; }

	.promo-banner__dismiss {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		cursor: pointer;
		opacity: 0.7;
		padding: 4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		transition: opacity 0.15s;
	}
	.promo-banner__dismiss:hover { opacity: 1; }

	@media (max-width: 640px) {
		.promo-banner__inner {
			gap: 8px;
			justify-content: flex-start;
			padding-right: 40px;
		}
		.promo-banner__message { font-size: 0.8125rem; }
	}
</style>
