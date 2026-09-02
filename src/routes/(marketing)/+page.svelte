<script lang="ts">
	import Button from "$lib/components/ui/Button.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import { uiStore } from "$lib/stores";
	import { FEATURES } from "$lib/config";

	const LOGOS = [
		"Roland",
		"Graphtec",
		"Mimaki",
		"USCutter",
		"Summa",
		"VEVOR",
		"Silhouette",
	];

	const TESTIMONIALS = [
		{
			name: "Marcus T.",
			shop: "Tampa Bay Wraps",
			tier: "Pro",
			text: "I ditched YINK the day I tried OmniPlot. The browser-based workflow means my guys can pull it up on any tablet at the bay. Game changer.",
		},
		{
			name: "Sarah K.",
			shop: "ClearShield PDX",
			tier: "Lite",
			text: "We do full PPF and window tint from the same browser tab. Switching between pattern modes is instant — I can't imagine going back to two separate tools.",
		},
		{
			name: "James R.",
			shop: "ProGuard Miami",
			tier: "Pro",
			text: "We run three Roland cutters and a Graphtec. Works flawlessly with all of them from the same job. No more per-machine software licenses.",
		},
	];

	const VS_TABLE = [
		["Feature", "OmniPlot", "YINK V6", "DigitCut"],
		["Web-based (no install)", "✓", "✗", "✗"],
		["Any device / tablet", "✓", "✗", "✗"],
		["Any plotter brand", "✓", "Partial", "Partial"],
		["PPF + window tint patterns", "✓", "✗", "✗"],
		["Auto-nesting", "✓", "✓", "✓"],
		["Free tier", "✓", "✗", "✗"],
		["Starting price", "$0", "$49/mo", "$39/mo"],
		["SVG / DXF export", "✓", "Paid add-on", "✗"],
		["Mobile responsive", "✓", "✗", "✗"],
	];
</script>

<svelte:head>
	<title>OmniPlot — Professional PPF & Window Tint Cutting Software. No Install Required.</title>
	<meta name="description" content="Web-based PPF & window tint cutting software. Works with any plotter. Unlimited patterns for PPF and tint. No download, no install, any device." />

	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://omniplot.app/" />
	<meta property="og:title" content="OmniPlot — PPF & Window Tint Cutting Software" />
	<meta property="og:description" content="Web-based cutting software for any plotter. Unlimited patterns for PPF and window tint. No download required." />
	<meta property="og:image" content="https://omniplot.app/og-image.png" />

	<!-- Twitter Card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="OmniPlot — PPF & Window Tint Cutting Software" />
	<meta name="twitter:description" content="Web-based cutting software for any plotter. Unlimited patterns for PPF and window tint. No download required." />
	<meta name="twitter:image" content="https://omniplot.app/og-image.png" />
</svelte:head>

<!-- ─── Hero ─── -->
<section class="hero">
	<div class="hero__inner">
		<Badge variant="brand" class="hero-badge">
			Now in public beta · Free to try
		</Badge>

		<h1 class="hero__headline">
			PPF & window tint software<br />
			<span class="hero__headline-accent"
				>that lives in your browser.</span
			>
		</h1>

		<p class="hero__sub">
			Professional PPF and window tint cutting — no install, no drivers,
			any device. Works with every plotter that speaks HPGL.
		</p>

		<div class="hero__ctas">
			<Button variant="primary" size="lg" href="/signup">
				Start cutting free
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" /></svg
				>
			</Button>
			<Button variant="secondary" size="lg" href="/studio">
				Try the demo
			</Button>
		</div>

		<div class="hero__proof">
			<span class="hero__proof-item">✓ No credit card required</span>
			<span class="hero__proof-sep" aria-hidden="true">·</span>
			<span class="hero__proof-item">✓ Works with any plotter</span>
			<span class="hero__proof-sep" aria-hidden="true">·</span>
			<span class="hero__proof-item">✓ Unlimited PPF & tint patterns</span>
		</div>
	</div>

	<!-- App preview -->
	<div class="hero__preview" aria-hidden="true">
		<div class="preview-window">
			<div class="preview-titlebar">
				<div class="preview-dot" style="background:#ff5f57"></div>
				<div class="preview-dot" style="background:#febc2e"></div>
				<div class="preview-dot" style="background:#28c840"></div>
				<span class="preview-url">omniplot.app/studio</span>
			</div>
			<div class="preview-body">
				<!-- Mini canvas mock -->
				<div class="preview-canvas">
					<svg width="100%" height="100%" viewBox="0 0 400 220">
						<!-- Grid -->
						<defs>
							<pattern
								id="grid"
								width="20"
								height="20"
								patternUnits="userSpaceOnUse"
							>
								<path
									d="M 20 0 L 0 0 0 20"
									fill="none"
									stroke="rgba(255,255,255,0.04)"
									stroke-width="1"
								/>
							</pattern>
						</defs>
						<rect width="400" height="220" fill="url(#grid)" />
						<!-- Sheet outline -->
						<rect
							x="20"
							y="20"
							width="360"
							height="180"
							fill="rgba(255,255,255,0.02)"
							stroke="rgba(255,255,255,0.12)"
							stroke-width="1"
							stroke-dasharray="6 3"
						/>
						<!-- Hood (61"×50") -->
						<g transform="translate(28,28) scale(1.45,1.15)">
							<path
								d="M8,5 Q50,2 92,5 L95,95 Q50,98 5,95 Z"
								fill="rgba(0,229,255,0.07)"
								stroke="#00E5FF"
								stroke-width="1.2"
								vector-effect="non-scaling-stroke"
							/>
						</g>
						<text x="101" y="88" text-anchor="middle" fill="rgba(0,229,255,0.45)" font-size="7" font-family="monospace">HOOD</text>
						<!-- Front Bumper (68"×12") -->
						<g transform="translate(28,148) scale(1.45,0.30)">
							<path
								d="M4,15 Q8,4 92,4 Q96,15 96,85 Q92,96 8,96 Q4,85 4,15 Z"
								fill="rgba(0,214,143,0.07)"
								stroke="#00D68F"
								stroke-width="1.2"
								vector-effect="non-scaling-stroke"
							/>
						</g>
						<text x="101" y="166" text-anchor="middle" fill="rgba(0,214,143,0.45)" font-size="7" font-family="monospace">BUMPER</text>
						<!-- Fender Left (28"×22") -->
						<g transform="translate(178,28) scale(0.72,0.58)">
							<path
								d="M5,12 Q10,4 40,2 L95,4 L96,88 Q70,96 5,82 Z"
								fill="rgba(167,139,250,0.07)"
								stroke="#A78BFA"
								stroke-width="1.2"
								vector-effect="non-scaling-stroke"
							/>
						</g>
						<text x="214" y="60" text-anchor="middle" fill="rgba(167,139,250,0.45)" font-size="7" font-family="monospace">FDR L</text>
						<!-- Fender Right (28"×22") -->
						<g transform="translate(178,90) scale(0.72,0.58)">
							<path
								d="M4,4 L60,2 Q90,4 95,12 L95,82 Q30,96 4,88 Z"
								fill="rgba(129,140,248,0.07)"
								stroke="#818CF8"
								stroke-width="1.2"
								vector-effect="non-scaling-stroke"
							/>
						</g>
						<text x="214" y="122" text-anchor="middle" fill="rgba(129,140,248,0.45)" font-size="7" font-family="monospace">FDR R</text>
						<!-- Headlight Left (24"×8") -->
						<g transform="translate(178,152) scale(0.90,0.24)">
							<path
								d="M4,18 Q8,4 88,5 Q96,18 96,82 Q88,96 8,95 Q4,82 4,18 Z"
								fill="rgba(252,211,77,0.07)"
								stroke="#FCD34D"
								stroke-width="1.2"
								vector-effect="non-scaling-stroke"
							/>
						</g>
						<text x="223" y="167" text-anchor="middle" fill="rgba(252,211,77,0.45)" font-size="7" font-family="monospace">HDLT L</text>
						<!-- Mirror Left (10"×6") -->
						<g transform="translate(254,28) scale(0.38,0.22)">
							<path
								d="M4,18 Q12,4 72,4 Q92,12 95,55 L90,92 Q65,98 4,88 Z"
								fill="rgba(244,114,182,0.07)"
								stroke="#F472B6"
								stroke-width="1.2"
								vector-effect="non-scaling-stroke"
							/>
						</g>
						<text x="273" y="42" text-anchor="middle" fill="rgba(244,114,182,0.45)" font-size="7" font-family="monospace">MRR L</text>
						<!-- Rocker Panel (74"×8") -->
						<g transform="translate(254,55) scale(1.0,0.16)">
							<path
								d="M2,8 Q6,2 94,2 Q98,8 98,92 Q94,98 6,98 Q2,92 2,8 Z"
								fill="rgba(52,211,153,0.07)"
								stroke="#34D399"
								stroke-width="1.2"
								vector-effect="non-scaling-stroke"
							/>
						</g>
						<text x="304" y="66" text-anchor="middle" fill="rgba(52,211,153,0.45)" font-size="7" font-family="monospace">ROCKER</text>
						<!-- Efficiency bar -->
						<rect
							x="20"
							y="205"
							width="360"
							height="4"
							rx="2"
							fill="rgba(255,255,255,0.06)"
						/>
						<rect
							x="20"
							y="205"
							width="297"
							height="4"
							rx="2"
							fill="url(#effgrad)"
						/>
						<defs>
							<linearGradient
								id="effgrad"
								x1="0"
								y1="0"
								x2="1"
								y2="0"
							>
								<stop offset="0%" stop-color="#00D68F" />
								<stop offset="100%" stop-color="#00E5FF" />
							</linearGradient>
						</defs>
					</svg>
				</div>
				<div class="preview-status">
					<span class="preview-status-item">
						<span class="preview-dot-status"></span>
						Plotter ready
					</span>
					<span class="preview-status-item">82.5% efficient</span>
					<span class="preview-status-item"
						>7 patterns · 9m 45s est.</span
					>
				</div>
			</div>
		</div>
	</div>
</section>

<!-- ─── Plotter logos ─── -->
<section class="logos-bar" aria-label="Compatible plotters">
	<p class="logos-bar__label">Works with every major plotter brand</p>
	<div class="logos-bar__list">
		{#each LOGOS as logo}
			<div class="logos-bar__item">{logo}</div>
		{/each}
	</div>
</section>

<!-- ─── Features ─── -->
<section class="features" id="features">
	<div class="section-inner">
		<div class="section-header">
			<Badge variant="default">Features</Badge>
			<h2 class="section-title">
				Everything you need.<br />Nothing you don't.
			</h2>
			<p class="section-sub">
				OmniPlot is built by installers for installers — PPF shops, tint
				studios, and everyone in between. Every feature solves a real shop
				problem.
			</p>
		</div>

		<div class="features-grid">
			{#each FEATURES as feat}
				<div class="feature-card">
					<div class="feature-card__icon" aria-hidden="true">
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d={feat.icon} />
						</svg>
					</div>
					<h3 class="feature-card__title">{feat.title}</h3>
					<p class="feature-card__desc">{feat.desc}</p>
				</div>
			{/each}
		</div>
		<div class="features-cta">
			<a href="/features" class="features-cta__link">See all features in depth →</a>
		</div>
	</div>
</section>

<!-- ─── How it works ─── -->
<section class="how-it-works">
	<div class="section-inner">
		<div class="section-header">
			<Badge variant="default">Workflow</Badge>
			<h2 class="section-title">Cut in three steps.</h2>
		</div>

		<div class="steps">
			{#each [["1", "Pick your vehicle", "Search unlimited patterns by vehicle, residential, commerical, or custom. Select the zones you need — PPF panels or window tint zones."], ["2", "Arrange & optimize", "Drag patterns onto your material sheet. Hit auto-nest to maximize efficiency automatically."], ["3", "Send to plotter", "Export as HPGL (.plt) or connect directly via Web Serial. Job complete."]] as [num, title, desc]}
				<div class="step">
					<div class="step__num" aria-hidden="true">{num}</div>
					<div class="step__content">
						<h3 class="step__title">{title}</h3>
						<p class="step__desc">{desc}</p>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- ─── Comparison table ─── -->
<section class="comparison" id="vs-yink">
	<div class="section-inner">
		<div class="section-header">
			<Badge variant="default">Compare</Badge>
			<h2 class="section-title">How we stack up.</h2>
			<p class="section-sub">
				OmniPlot vs the legacy desktop alternatives.
			</p>
		</div>

		<div class="compare-table-wrap">
			<table class="compare-table" aria-label="OmniPlot vs competitors">
				<thead>
					<tr>
						{#each VS_TABLE[0] as col, i}
							<th class:th-highlight={i === 1}>{col}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each VS_TABLE.slice(1) as row}
						<tr>
							{#each row as cell, i}
								<td
									class:td-highlight={i === 1}
									class:td-check={cell === "✓"}
									class:td-cross={cell === "✗"}>{cell}</td
								>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</section>

<!-- ─── Testimonials ─── -->
<section class="testimonials">
	<div class="section-inner">
		<div class="section-header">
			<Badge variant="default">Testimonials</Badge>
			<h2 class="section-title">Loved by installers.</h2>
		</div>

		<div class="testimonials-grid">
			{#each TESTIMONIALS as t}
				<div class="testimonial-card">
					<div
						class="testimonial-card__stars"
						aria-label="5 stars"
						role="img"
					>
						★★★★★
					</div>
					<p class="testimonial-card__text">"{t.text}"</p>
					<div class="testimonial-card__author">
						<div
							class="testimonial-card__avatar"
							aria-hidden="true"
						>
							{t.name
								.split(" ")
								.map((n) => n[0])
								.join("")}
						</div>
						<div>
							<div class="testimonial-card__name">{t.name}</div>
							<div class="testimonial-card__shop">{t.shop}</div>
						</div>
						<Badge
							variant={t.tier === "Pro" ? "pro" : "lite"}
							class="ml-auto">{t.tier}</Badge
						>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- ─── Final CTA ─── -->
<section class="cta-section">
	<div class="cta-section__inner">
		<h2 class="cta-section__title">Ready to cut smarter?</h2>
		<p class="cta-section__sub">
			Start free. No credit card, no install, no catch.
		</p>
		<div class="cta-section__btns">
			<Button variant="primary" size="lg" href="/signup">
				Start cutting free
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" /></svg
				>
			</Button>
			<Button variant="ghost" size="lg" href="/pricing"
				>See pricing →</Button
			>
		</div>
	</div>
</section>

<style>
	/* ─── Hero ────── */
	.hero {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 48px;
		align-items: center;
		max-width: 1200px;
		margin: 0 auto;
		padding: 80px 24px 64px;
	}

	.hero__inner {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	:global(.hero-badge) {
		width: fit-content;
	}

	.hero__headline {
		font-size: clamp(2rem, 5vw, 3rem);
		line-height: 1.1;
		letter-spacing: -0.03em;
		color: var(--text-primary);
		margin: 0;
	}

	.hero__headline-accent {
		background: linear-gradient(
			90deg,
			var(--color-brand-dim),
			var(--color-brand)
		);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.hero__sub {
		font-size: 1.0625rem;
		color: var(--text-secondary);
		line-height: 1.65;
		max-width: 480px;
	}

	.hero__ctas {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}

	.hero__proof {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	.hero__proof-sep {
		opacity: 0.4;
	}

	/* Preview window */
	.hero__preview {
		position: relative;
	}

	.preview-window {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-2xl);
		overflow: hidden;
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
	}

	.preview-titlebar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 14px;
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
	}

	.preview-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.preview-url {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		margin-left: 8px;
	}

	.preview-body {
		padding: 0;
	}

	.preview-canvas {
		background: var(--canvas-bg);
		height: 220px;
		overflow: hidden;
	}

	.preview-status {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 8px 14px;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		color: var(--text-tertiary);
		border-top: 1px solid var(--border-subtle);
	}

	.preview-status-item {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.preview-dot-status {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--color-success);
		animation: pulse-dot 2s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	/* ─── Logos bar ────── */
	.logos-bar {
		background: var(--bg-surface);
		border-top: 1px solid var(--border-subtle);
		border-bottom: 1px solid var(--border-subtle);
		padding: 20px 24px;
		text-align: center;
	}

	.logos-bar__label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-bottom: 14px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-family: var(--font-mono);
	}

	.logos-bar__list {
		display: flex;
		justify-content: center;
		gap: 32px;
		flex-wrap: wrap;
	}

	.logos-bar__item {
		font-family: var(--font-display);
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--text-tertiary);
		opacity: 0.5;
		letter-spacing: -0.02em;
	}

	/* ─── Section defaults ────── */
	.section-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 80px 24px;
	}

	.section-header {
		text-align: center;
		margin-bottom: 48px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}

	.section-title {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		letter-spacing: -0.03em;
		line-height: 1.15;
	}

	.section-sub {
		font-size: 1rem;
		color: var(--text-secondary);
		max-width: 480px;
	}

	/* ─── Features grid ────── */
	.features {
		background: var(--bg-surface);
	}

	.features-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
	}

	.features-cta {
		text-align: center;
		margin-top: 32px;
	}

	.features-cta__link {
		color: var(--color-brand);
		font-weight: 600;
		text-decoration: none;
	}

	.features-cta__link:hover {
		text-decoration: underline;
	}

	.feature-card {
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		padding: 24px;
		transition:
			border-color 0.2s,
			transform 0.2s;
	}

	.feature-card:hover {
		border-color: var(--border-strong);
		transform: translateY(-2px);
	}

	.feature-card__icon {
		width: 40px;
		height: 40px;
		background: var(--bg-surface-2);
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-brand);
		margin-bottom: 14px;
	}

	.feature-card__title {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 8px;
	}
	.feature-card__desc {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	/* ─── How it works ────── */
	.steps {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 24px;
		position: relative;
	}

	.steps::before {
		content: "";
		position: absolute;
		top: 28px;
		left: calc(16.6% + 20px);
		right: calc(16.6% + 20px);
		height: 1px;
		background: linear-gradient(
			90deg,
			var(--color-brand-dim),
			var(--color-brand)
		);
		opacity: 0.3;
	}

	.step {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 14px;
	}

	.step__num {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: linear-gradient(
			135deg,
			var(--color-brand-dim),
			var(--color-brand)
		);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-size: 1.125rem;
		font-weight: 800;
		color: #000;
		flex-shrink: 0;
		position: relative;
		z-index: 1;
	}

	.step__title {
		font-size: 1rem;
		font-weight: 600;
	}
	.step__desc {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	/* ─── Comparison ────── */
	.comparison {
		background: var(--bg-surface);
	}

	.compare-table-wrap {
		overflow-x: auto;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
	}

	.compare-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
		min-width: 560px;
	}

	.compare-table thead {
		background: var(--bg-surface-2);
	}

	.compare-table th {
		padding: 14px 20px;
		text-align: left;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.th-highlight {
		background: rgba(0, 112, 255, 0.06);
		color: var(--text-primary);
	}

	.compare-table tbody tr {
		border-top: 1px solid var(--border-subtle);
	}
	.compare-table tbody tr:hover {
		background: var(--interactive-hover);
	}

	.compare-table td {
		padding: 12px 20px;
		color: var(--text-secondary);
	}

	.td-highlight {
		background: rgba(0, 112, 255, 0.03);
		color: var(--text-primary);
		font-weight: 500;
	}
	.td-check {
		color: var(--color-success);
		font-weight: 600;
	}
	.td-cross {
		color: var(--color-danger);
		opacity: 0.6;
	}

	/* ─── Testimonials ────── */
	.testimonials-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
	}

	.testimonial-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		transition: border-color 0.2s;
	}

	.testimonial-card:hover {
		border-color: var(--border-strong);
	}

	.testimonial-card__stars {
		color: #ffb547;
		font-size: 0.875rem;
		letter-spacing: 2px;
	}
	.testimonial-card__text {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.6;
		flex: 1;
		font-style: italic;
	}

	.testimonial-card__author {
		display: flex;
		align-items: center;
		gap: 10px;
		border-top: 1px solid var(--border-subtle);
		padding-top: 14px;
	}

	.testimonial-card__avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-brand-dim), #7b5ea7);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-size: 0.75rem;
		font-weight: 700;
		color: #fff;
		flex-shrink: 0;
	}

	.testimonial-card__name {
		font-size: 0.875rem;
		font-weight: 600;
	}
	.testimonial-card__shop {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	:global(.ml-auto) {
		margin-left: auto;
	}

	/* ─── CTA section ────── */
	.cta-section {
		background: linear-gradient(
			135deg,
			var(--bg-surface),
			rgba(0, 112, 255, 0.05)
		);
		border-top: 1px solid var(--border-subtle);
	}

	.cta-section__inner {
		max-width: 600px;
		margin: 0 auto;
		padding: 80px 24px;
		text-align: center;
	}

	.cta-section__title {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		letter-spacing: -0.03em;
		margin-bottom: 12px;
	}

	.cta-section__sub {
		font-size: 1rem;
		color: var(--text-secondary);
		margin-bottom: 28px;
	}

	.cta-section__btns {
		display: flex;
		gap: 10px;
		justify-content: center;
		flex-wrap: wrap;
	}

	/* ─── Responsive ────── */
	@media (max-width: 1024px) {
		.hero {
			grid-template-columns: 1fr;
		}
		.hero__preview {
			display: none;
		}
		.features-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.testimonials-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 768px) {
		.hero {
			padding: 48px 24px 40px;
		}
		.features-grid {
			grid-template-columns: 1fr;
		}
		.steps {
			grid-template-columns: 1fr;
		}
		.steps::before {
			display: none;
		}
		.testimonials-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
