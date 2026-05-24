<svelte:head>
	<title>OmniPlot Cut Agent — Cut from any browser, any OS</title>
	<meta name="description" content="The OmniPlot Cut Agent is a tiny background daemon that sends HPGL jobs to your cutter from any browser — including Firefox, Safari, and iOS. Download free." />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://omniplot.app/agent" />
	<meta property="og:title" content="OmniPlot Cut Agent — Cut from any browser, any OS" />
	<meta property="og:description" content="A lightweight background daemon that bridges any browser to your USB or serial cutter — no Chrome required." />
	<meta property="og:image" content="https://omniplot.app/og-image.png" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image" content="https://omniplot.app/og-image.png" />
</svelte:head>

<script lang="ts">
	import { onMount } from "svelte";

	type Platform = "windows" | "mac-arm" | "mac-intel" | "linux" | "unknown";

	const AGENT_VERSION = "1.0.0";
	const BASE = `https://omniplot.app/downloads/agent/v${AGENT_VERSION}`;

	const downloads: Record<Exclude<Platform, "unknown">, { label: string; file: string; badge: string }> = {
		"windows":   { label: "Windows",       file: `omniplot-agent-windows-amd64.exe`, badge: "x64" },
		"mac-arm":   { label: "macOS (Apple Silicon)", file: `omniplot-agent-darwin-arm64`,        badge: "M1 · M2 · M3" },
		"mac-intel": { label: "macOS (Intel)", file: `omniplot-agent-darwin-amd64`,       badge: "Intel" },
		"linux":     { label: "Linux",         file: `omniplot-agent-linux-amd64`,        badge: "x64" },
	};

	let detected: Platform = $state("unknown");

	onMount(() => {
		const ua = navigator.userAgent;
		const platform = (navigator as any).userAgentData?.platform ?? navigator.platform ?? "";
		if (/Win/.test(platform) || /Windows/.test(ua)) {
			detected = "windows";
		} else if (/Mac/.test(platform) || /Mac/.test(ua)) {
			// Rough M-chip detection: 72 hardware concurrency or ARM arch
			const arm = (navigator as any).userAgentData?.architecture === "arm" ||
				(navigator.hardwareConcurrency >= 8 && /Mac OS X 1[1-9]/.test(ua));
			detected = arm ? "mac-arm" : "mac-intel";
		} else if (/Linux/.test(platform) || /Linux/.test(ua)) {
			detected = "linux";
		}
	});

	const platformOrder: Exclude<Platform, "unknown">[] = ["windows", "mac-arm", "mac-intel", "linux"];
</script>

<div class="agent-page">

	<!-- ── Hero ───────────────────────────────── -->
	<section class="agent-hero">
		<div class="agent-hero__inner">
			<p class="eyebrow">OmniPlot Cut Agent v{AGENT_VERSION}</p>
			<h1 class="agent-hero__title">Cut from any browser.<br>Any OS. Any cutter.</h1>
			<p class="agent-hero__sub">
				A 9 MB background daemon that sits between OmniPlot and your vinyl cutter —
				so Firefox, Safari, and every other browser can send jobs over USB or serial,
				no Chrome required. Free, forever.
			</p>
			<div class="agent-hero__actions">
				{#if detected !== "unknown"}
					{@const d = downloads[detected]}
					<a href="{BASE}/{d.file}" class="cta-btn cta-btn--primary" download>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
						Download for {d.label}
					</a>
				{:else}
					<a href="#downloads" class="cta-btn cta-btn--primary">Choose your platform</a>
				{/if}
				<a href="/studio" class="cta-btn cta-btn--secondary">Open studio</a>
			</div>
			<p class="agent-hero__meta">
				Free &amp; open-source &nbsp;·&nbsp; No install &nbsp;·&nbsp; Runs on <code>localhost:7878</code>
			</p>
		</div>

		<!-- Terminal preview -->
		<div class="agent-hero__terminal" aria-hidden="true">
			<div class="terminal">
				<div class="terminal__bar">
					<span class="terminal__dot terminal__dot--red"></span>
					<span class="terminal__dot terminal__dot--yellow"></span>
					<span class="terminal__dot terminal__dot--green"></span>
					<span class="terminal__title">omniplot-agent</span>
				</div>
				<pre class="terminal__body"><span class="t-dim">$</span> <span class="t-cmd">./omniplot-agent</span>
<span class="t-json">{'{"agent":"omniplot-cut-agent","version":"' + AGENT_VERSION + '","port":7878,"pid":12034}'}</span>
<span class="t-info">OmniPlot Cut Agent v{AGENT_VERSION} listening on http://127.0.0.1:7878</span>
<span class="t-dim">—</span> <span class="t-ok">✓</span> <span class="t-muted">Waiting for jobs…</span></pre>
			</div>
		</div>
	</section>

	<!-- ── Connection methods ─────────────────── -->
	<section class="methods-section">
		<div class="section-inner">
			<p class="eyebrow">How OmniPlot connects to your cutter</p>
			<h2 class="section-title">Four ways to cut. One studio.</h2>
			<p class="section-sub">
				OmniPlot isn't locked to any single output path. Every shop is different — pick the method
				that fits your setup, and switch any time in Plotter Settings.
			</p>

			<div class="methods-grid">

				<!-- Cut Agent (featured) -->
				<div class="method-card method-card--featured">
					<div class="method-card__header">
						<div class="method-card__icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 8l2 2-2 2M11 10h4"/></svg>
						</div>
						<div>
							<p class="method-card__tag">Recommended</p>
							<h3 class="method-card__name">Cut Agent</h3>
						</div>
					</div>
					<p class="method-card__desc">
						Run our lightweight daemon once. OmniPlot sends jobs to it over localhost HTTP —
						works in every browser including Firefox and Safari, on Mac, Windows, and Linux.
					</p>
					<ul class="method-card__pros">
						<li>Works in any browser</li>
						<li>Auto-detects your cutter port</li>
						<li>Lists all available serial ports</li>
						<li>Survives browser restarts</li>
						<li>Supports all baud rates</li>
					</ul>
					<p class="method-card__req">Requires: one download per machine</p>
				</div>

				<!-- USB-Serial -->
				<div class="method-card">
					<div class="method-card__header">
						<div class="method-card__icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6a3 3 0 100-6 3 3 0 000 6zM6 18a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>
						</div>
						<div>
							<h3 class="method-card__name">USB-Serial</h3>
							<p class="method-card__sub">Web Serial API</p>
						</div>
					</div>
					<p class="method-card__desc">
						Chrome and Edge have direct USB-serial access via the Web Serial API. Connect your
						cutter, click "Connect port," and cut — zero installs, zero agents.
					</p>
					<ul class="method-card__pros">
						<li>Zero install required</li>
						<li>Port remembered per-session</li>
						<li>Instant — no daemon startup</li>
					</ul>
					<p class="method-card__req">Requires: Chrome or Edge only</p>
				</div>

				<!-- Network TCP -->
				<div class="method-card">
					<div class="method-card__header">
						<div class="method-card__icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 000 20M2 12h20"/></svg>
						</div>
						<div>
							<h3 class="method-card__name">Network</h3>
							<p class="method-card__sub">TCP / JetDirect</p>
						</div>
					</div>
					<p class="method-card__desc">
						Network-connected plotters (HP JetDirect on port 9100, Graphtec network models)
						receive HPGL over TCP — routed through our server-side proxy.
					</p>
					<ul class="method-card__pros">
						<li>Works with ethernet plotters</li>
						<li>Any browser, any OS</li>
						<li>No USB cable needed</li>
					</ul>
					<p class="method-card__req">Requires: plotter on same network</p>
				</div>

				<!-- Download PLT -->
				<div class="method-card">
					<div class="method-card__header">
						<div class="method-card__icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
						</div>
						<div>
							<h3 class="method-card__name">Download PLT</h3>
							<p class="method-card__sub">Manual HPGL file</p>
						</div>
					</div>
					<p class="method-card__desc">
						Export a standard <code>.plt</code> HPGL file and open it in your cutter's
						software — Graphtec Pro Studio, Roland VersaWorks, CutStudio, or any compatible tool.
					</p>
					<ul class="method-card__pros">
						<li>Works with any existing software</li>
						<li>No connectivity required</li>
						<li>Transfer via USB drive</li>
					</ul>
					<p class="method-card__req">Requires: cutter software on hand</p>
				</div>

			</div>
		</div>
	</section>

	<!-- ── How it works ───────────────────────── -->
	<section class="how-section">
		<div class="section-inner">
			<p class="eyebrow">Getting started</p>
			<h2 class="section-title">Up and cutting in under a minute.</h2>

			<div class="steps">
				<div class="step">
					<div class="step__num">1</div>
					<div class="step__body">
						<h3 class="step__title">Download the agent</h3>
						<p class="step__desc">Pick your platform below. No installer — just a single binary, about 9 MB.</p>
					</div>
				</div>
				<div class="step__connector" aria-hidden="true"></div>
				<div class="step">
					<div class="step__num">2</div>
					<div class="step__body">
						<h3 class="step__title">Run it once</h3>
						<p class="step__desc">Double-click or run <code>./omniplot-agent</code> in a terminal. It listens on <code>localhost:7878</code>.</p>
					</div>
				</div>
				<div class="step__connector" aria-hidden="true"></div>
				<div class="step">
					<div class="step__num">3</div>
					<div class="step__body">
						<h3 class="step__title">Select "Cut Agent" in OmniPlot</h3>
						<p class="step__desc">In the studio, open Plotter Settings → Connection → Cut Agent. OmniPlot will detect it automatically.</p>
					</div>
				</div>
				<div class="step__connector" aria-hidden="true"></div>
				<div class="step">
					<div class="step__num">4</div>
					<div class="step__body">
						<h3 class="step__title">Cut</h3>
						<p class="step__desc">Hit the Cut button. Your job goes browser → agent → cutter. Done.</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- ── Downloads ──────────────────────────── -->
	<section class="downloads-section" id="downloads">
		<div class="section-inner">
			<p class="eyebrow">Download</p>
			<h2 class="section-title">v{AGENT_VERSION} — all platforms</h2>
			<p class="section-sub">Single binary. No installer. No runtime. No admin rights required on Mac or Linux.</p>

			<div class="download-grid">
				{#each platformOrder as pid}
					{@const d = downloads[pid]}
					<a
						href="{BASE}/{d.file}"
						class="download-card"
						class:download-card--detected={detected === pid}
						download
					>
						<div class="download-card__icon">
							{#if pid === "windows"}
								<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>
							{:else if pid === "mac-arm" || pid === "mac-intel"}
								<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>
							{:else}
								<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778.828 1.288 1.459 1.425.901.196 2.209-.373 3.277-1.229 1.124-.resolved 1.95-2.171 2.245-3.404.005-.02.012-.04.012-.06.16-1.099-.483-2.26-1.52-2.843zm.005 1.09c.033.014.065.032.096.054.88.516 1.454 1.437 1.46 2.487-.001.084-.016.165-.031.245-.126.724-.55 1.336-1.104 1.773-.35.28-.738.485-1.151.617-.055.018-.11.031-.167.044.015.06.03.12.044.182.054.26.071.53.05.803-.02.26-.08.524-.186.785-.19.474-.548.867-.97 1.126-.233.144-.49.25-.762.316a3.1 3.1 0 01-.44.062c-.038.004-.076.006-.112.006-.257 0-.517-.058-.773-.165-.42-.174-.793-.47-1.07-.834a3.45 3.45 0 01-.543-1.173c-.11-.433-.132-.88-.069-1.32l.003-.02c.125-.757.497-1.408 1.024-1.845.34-.28.738-.474 1.165-.573.223-.052.453-.079.683-.079.24 0 .479.028.714.082.14.033.28.077.417.132.046-.297.128-.573.251-.826z"/></svg>
							{/if}
						</div>
						<div class="download-card__info">
							<span class="download-card__name">{d.label}</span>
							<span class="download-card__meta">
								v{AGENT_VERSION} &nbsp;·&nbsp; {d.badge}
								{#if detected === pid}<span class="download-card__yours">Your device</span>{/if}
							</span>
							<span class="download-card__file">{d.file}</span>
						</div>
						<div class="download-card__arrow">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
						</div>
					</a>
				{/each}
			</div>

			<p class="download-note">
				On Mac, after downloading: right-click → Open → Open (bypasses Gatekeeper on unsigned binary).
				On Linux, run <code>chmod +x omniplot-agent-linux-amd64</code> first.
			</p>
		</div>
	</section>

	<!-- ── Stats / trust ──────────────────────── -->
	<section class="trust-section">
		<div class="section-inner trust-section__inner">
			<div class="trust-stat">
				<span class="trust-stat__num">~9 MB</span>
				<span class="trust-stat__label">Binary size — no runtime, no frameworks</span>
			</div>
			<div class="trust-divider" aria-hidden="true"></div>
			<div class="trust-stat">
				<span class="trust-stat__num">localhost only</span>
				<span class="trust-stat__label">Never phones home. No telemetry.</span>
			</div>
			<div class="trust-divider" aria-hidden="true"></div>
			<div class="trust-stat">
				<span class="trust-stat__num">Any plotter</span>
				<span class="trust-stat__label">Roland, Graphtec, Summa, USCutter, VEVOR…</span>
			</div>
			<div class="trust-divider" aria-hidden="true"></div>
			<div class="trust-stat">
				<span class="trust-stat__num">Free</span>
				<span class="trust-stat__label">No license key. Bundled with every plan.</span>
			</div>
		</div>
	</section>

	<!-- ── CTA ────────────────────────────────── -->
	<section class="agent-cta">
		<h2 class="agent-cta__title">Ready to cut?</h2>
		<p class="agent-cta__sub">Download the agent, open the studio, and send your first job in under a minute.</p>
		<div class="agent-cta__btns">
			{#if detected !== "unknown"}
				{@const d = downloads[detected]}
				<a href="{BASE}/{d.file}" class="cta-btn cta-btn--primary" download>Download for {d.label}</a>
			{:else}
				<a href="#downloads" class="cta-btn cta-btn--primary">Download</a>
			{/if}
			<a href="/studio" class="cta-btn cta-btn--secondary">Open studio</a>
		</div>
		<p class="agent-cta__note">
			Already cutting? <a href="/studio" class="agent-cta__link">Go to studio →</a>
		</p>
	</section>

</div>

<style>
	.agent-page {
		padding-bottom: 80px;
	}

	/* ── Shared ────────────────────────────────── */
	.eyebrow {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-brand);
		margin-bottom: 14px;
	}
	.section-inner {
		max-width: 1100px;
		margin: 0 auto;
		padding: 0 24px;
	}
	.section-title {
		font-size: clamp(1.5rem, 3vw, 2.25rem);
		font-weight: 700;
		letter-spacing: -0.025em;
		line-height: 1.2;
		margin: 0 0 16px;
	}
	.section-sub {
		font-size: 1rem;
		color: var(--text-secondary);
		line-height: 1.7;
		max-width: 640px;
		margin: 0 0 48px;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.875em;
		background: var(--bg-surface-3);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		color: var(--text-primary);
	}

	/* ── CTA buttons ───────────────────────────── */
	.cta-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 11px 24px;
		border-radius: var(--radius-md);
		font-size: 0.9375rem;
		font-weight: 600;
		text-decoration: none;
		transition: opacity 0.12s;
	}
	.cta-btn:hover { opacity: 0.85; }
	.cta-btn--primary {
		background: var(--color-brand-dim);
		color: #fff;
	}
	.cta-btn--secondary {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		color: var(--text-primary);
	}

	/* ── Hero ──────────────────────────────────── */
	.agent-hero {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 64px;
		align-items: center;
		max-width: 1100px;
		margin: 0 auto;
		padding: 80px 24px 72px;
	}
	.agent-hero__title {
		font-size: clamp(2rem, 4.5vw, 3.25rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.1;
		margin: 0 0 20px;
	}
	.agent-hero__sub {
		font-size: 1.0625rem;
		color: var(--text-secondary);
		line-height: 1.65;
		margin: 0 0 28px;
		max-width: 480px;
	}
	.agent-hero__actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.agent-hero__meta {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		margin: 0;
	}

	/* Terminal */
	.agent-hero__terminal {
		display: flex;
		justify-content: center;
	}
	.terminal {
		width: 100%;
		max-width: 440px;
		background: #0d1117;
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: var(--radius-xl);
		overflow: hidden;
		box-shadow: 0 24px 64px rgba(0,0,0,0.35);
	}
	.terminal__bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 12px 16px;
		background: rgba(255,255,255,0.04);
		border-bottom: 1px solid rgba(255,255,255,0.07);
	}
	.terminal__dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
	}
	.terminal__dot--red    { background: #ff5f57; }
	.terminal__dot--yellow { background: #ffbd2e; }
	.terminal__dot--green  { background: #28c840; }
	.terminal__title {
		margin-left: 8px;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: rgba(255,255,255,0.4);
	}
	.terminal__body {
		padding: 20px 20px 24px;
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.8;
		white-space: pre-wrap;
		word-break: break-all;
		color: rgba(255,255,255,0.85);
	}
	.t-dim    { color: rgba(255,255,255,0.3); }
	.t-cmd    { color: #79c0ff; }
	.t-json   { color: #a5d6ff; }
	.t-info   { color: rgba(255,255,255,0.55); }
	.t-ok     { color: #3fb950; }
	.t-muted  { color: rgba(255,255,255,0.3); }

	/* ── Methods section ───────────────────────── */
	.methods-section {
		padding: 80px 0;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-surface);
	}
	.methods-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 16px;
	}
	.method-card {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		padding: 24px 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.method-card--featured {
		border-color: var(--color-brand-dim);
		background: color-mix(in srgb, var(--color-brand-dim) 6%, var(--bg-surface-2));
		box-shadow: 0 0 0 1px var(--color-brand-dim);
	}
	.method-card__header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.method-card__icon {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-md);
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-brand);
		flex-shrink: 0;
	}
	.method-card--featured .method-card__icon {
		background: color-mix(in srgb, var(--color-brand-dim) 15%, var(--bg-surface-3));
		border-color: var(--color-brand-dim);
	}
	.method-card__tag {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-brand-dim);
		margin: 0 0 2px;
	}
	.method-card__name {
		font-size: 1rem;
		font-weight: 700;
		margin: 0;
		line-height: 1.2;
	}
	.method-card__sub {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin: 0;
	}
	.method-card__desc {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin: 0;
		flex: 1;
	}
	.method-card__pros {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.method-card__pros li {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		padding-left: 18px;
		position: relative;
	}
	.method-card__pros li::before {
		content: "✓";
		position: absolute;
		left: 0;
		color: var(--color-brand);
		font-weight: 700;
		font-size: 0.75rem;
	}
	.method-card__req {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin: 0;
		padding-top: 8px;
		border-top: 1px solid var(--border-subtle);
	}

	/* ── How it works ──────────────────────────── */
	.how-section {
		padding: 80px 0;
		border-top: 1px solid var(--border-subtle);
	}
	.steps {
		display: flex;
		align-items: flex-start;
		gap: 0;
		margin-top: 48px;
	}
	.step {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.step__num {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--color-brand-dim);
		color: #fff;
		font-size: 1rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.step__body {}
	.step__title {
		font-size: 0.9375rem;
		font-weight: 600;
		margin: 0 0 6px;
	}
	.step__desc {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin: 0;
	}
	.step__connector {
		width: 48px;
		height: 1px;
		background: var(--border-default);
		margin-top: 19px;
		flex-shrink: 0;
	}

	/* ── Downloads ─────────────────────────────── */
	.downloads-section {
		padding: 80px 0;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-surface);
	}
	.download-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
		margin-bottom: 24px;
	}
	.download-card {
		display: flex;
		align-items: center;
		gap: 16px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 18px 20px;
		text-decoration: none;
		color: var(--text-primary);
		transition: border-color 0.12s, background 0.12s;
	}
	.download-card:hover {
		border-color: var(--color-brand-dim);
		background: color-mix(in srgb, var(--color-brand-dim) 4%, var(--bg-surface-2));
	}
	.download-card--detected {
		border-color: var(--color-brand-dim);
		box-shadow: 0 0 0 1px var(--color-brand-dim);
	}
	.download-card__icon {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-md);
		background: var(--bg-surface-3);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		flex-shrink: 0;
	}
	.download-card--detected .download-card__icon {
		color: var(--color-brand-dim);
	}
	.download-card__info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.download-card__name {
		font-size: 0.9375rem;
		font-weight: 600;
	}
	.download-card__meta {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.download-card__yours {
		background: var(--color-brand-dim);
		color: #fff;
		font-size: 0.6875rem;
		font-weight: 600;
		padding: 1px 7px;
		border-radius: 99px;
		letter-spacing: 0.04em;
	}
	.download-card__file {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.download-card__arrow {
		color: var(--text-tertiary);
		flex-shrink: 0;
		transition: color 0.12s;
	}
	.download-card:hover .download-card__arrow { color: var(--color-brand-dim); }
	.download-note {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		line-height: 1.6;
		margin: 0;
	}

	/* ── Trust stats ───────────────────────────── */
	.trust-section {
		padding: 56px 0;
		border-top: 1px solid var(--border-subtle);
	}
	.trust-section__inner {
		display: flex;
		align-items: center;
		gap: 0;
	}
	.trust-stat {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		text-align: center;
		padding: 0 24px;
	}
	.trust-stat__num {
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		color: var(--text-primary);
	}
	.trust-stat__label {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		line-height: 1.4;
	}
	.trust-divider {
		width: 1px;
		height: 48px;
		background: var(--border-default);
		flex-shrink: 0;
	}

	/* ── CTA ───────────────────────────────────── */
	.agent-cta {
		max-width: 560px;
		margin: 0 auto;
		padding: 80px 24px;
		text-align: center;
		border-top: 1px solid var(--border-subtle);
	}
	.agent-cta__title {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 700;
		letter-spacing: -0.025em;
		margin: 0 0 12px;
	}
	.agent-cta__sub {
		font-size: 1rem;
		color: var(--text-secondary);
		margin: 0 0 28px;
	}
	.agent-cta__btns {
		display: flex;
		gap: 10px;
		justify-content: center;
		flex-wrap: wrap;
		margin-bottom: 20px;
	}
	.agent-cta__note {
		font-size: 0.875rem;
		color: var(--text-tertiary);
		margin: 0;
	}
	.agent-cta__link {
		color: var(--text-brand);
		text-decoration: none;
	}
	.agent-cta__link:hover { text-decoration: underline; }

	/* ── Responsive ────────────────────────────── */
	@media (max-width: 960px) {
		.agent-hero {
			grid-template-columns: 1fr;
			gap: 40px;
		}
		.methods-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.steps {
			flex-direction: column;
			gap: 24px;
		}
		.step__connector {
			width: 1px;
			height: 20px;
			margin: 0 0 0 19px;
		}
		.trust-section__inner {
			flex-wrap: wrap;
			gap: 32px;
		}
		.trust-divider { display: none; }
		.trust-stat { min-width: 40%; }
	}
	@media (max-width: 600px) {
		.methods-grid {
			grid-template-columns: 1fr;
		}
		.download-grid {
			grid-template-columns: 1fr;
		}
		.agent-hero__actions {
			flex-direction: column;
		}
	}
</style>
