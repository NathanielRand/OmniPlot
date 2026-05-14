<script lang="ts">
	interface Props {
		size?: number;
		showWordmark?: boolean;
		class?: string;
	}

	let { size = 32, showWordmark = true, class: cls = "" }: Props = $props();
</script>

<a href="/" class="logo-link {cls}" aria-label="OmniPlot home">
	<svg
		width={size}
		height={size}
		viewBox="0 0 40 40"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		aria-hidden="true"
	>
		<path
			d="M20 2 L38 20 L20 38 L2 20 Z"
			fill="url(#logo-g1)"
			opacity="0.15"
		/>
		<path
			d="M20 6 L34 20 L20 34 L6 20 Z"
			fill="none"
			stroke="url(#logo-g1)"
			stroke-width="1.5"
		/>
		<path
			d="M12 20 L20 10 L28 20"
			fill="none"
			stroke="url(#logo-g2)"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
		<circle cx="20" cy="10" r="1.5" fill="url(#logo-g2)" />
		<path
			d="M14 22 L20 30 L26 22"
			fill="none"
			stroke="url(#logo-g1)"
			stroke-width="1"
			stroke-linecap="round"
			opacity="0.5"
		/>
		<defs>
			<linearGradient
				id="logo-g1"
				x1="2"
				y1="2"
				x2="38"
				y2="38"
				gradientUnits="userSpaceOnUse"
			>
				<stop offset="0%" stop-color="#0070FF" />
				<stop offset="100%" stop-color="#00E5FF" />
			</linearGradient>
			<linearGradient
				id="logo-g2"
				x1="12"
				y1="10"
				x2="28"
				y2="20"
				gradientUnits="userSpaceOnUse"
			>
				<stop offset="0%" stop-color="#00E5FF" />
				<stop offset="100%" stop-color="#0070FF" />
			</linearGradient>
		</defs>
	</svg>

	{#if showWordmark}
		<span class="wordmark">OmniPlot</span>
	{/if}
</a>

<style>
	.logo-link {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		text-decoration: none;
		user-select: none;
	}

	.wordmark {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.0625rem;
		letter-spacing: -0.03em;
		color: var(--text-primary);
		transition: color 0.15s;
	}

	.logo-link:hover .wordmark {
		color: var(--text-brand);
	}
</style>
