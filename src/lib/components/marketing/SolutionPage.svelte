<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { SOLUTIONS_NAV } from "$lib/config";

	interface UseCase {
		title: string;
		desc: string;
	}

	interface CaseStudy {
		company: string;
		summary: string;
		challenge: string;
		solution: string;
		outcome: string;
	}

	interface Step {
		title: string;
		desc: string;
	}

	let {
		slug,
		eyebrow,
		title,
		sub,
		useCases,
		steps,
		caseStudy,
	}: {
		slug: string;
		eyebrow: string;
		title: string;
		sub: string;
		useCases: UseCase[];
		steps: Step[];
		caseStudy: CaseStudy;
	} = $props();
</script>

<div class="solution-page">
	<div class="solution-hero">
		<Badge variant="default">{eyebrow}</Badge>
		<h1 class="solution-title">{title}</h1>
		<p class="solution-sub">{sub}</p>
		<div class="solution-hero__actions">
			<Button variant="primary" size="lg" href="/signup">Start free</Button>
			<Button variant="secondary" size="lg" href="/features">See all features</Button>
		</div>
	</div>

	<section class="solution-section">
		<h2 class="solution-section__title">What you can cut</h2>
		<div class="usecase-grid">
			{#each useCases as u}
				<div class="usecase-card">
					<h3 class="usecase-card__title">{u.title}</h3>
					<p class="usecase-card__desc">{u.desc}</p>
				</div>
			{/each}
		</div>
	</section>

	<section class="solution-section">
		<h2 class="solution-section__title">How it works</h2>
		<div class="steps-list">
			{#each steps as s, i}
				<div class="step-row">
					<div class="step-row__num">{i + 1}</div>
					<div>
						<h3 class="step-row__title">{s.title}</h3>
						<p class="step-row__desc">{s.desc}</p>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<section class="solution-section solution-section--case">
		<h2 class="solution-section__title">Case study: {caseStudy.company}</h2>
		<p class="case-summary">{caseStudy.summary}</p>
		<div class="case-grid">
			<div class="case-col">
				<h3 class="case-col__label">Challenge</h3>
				<p>{caseStudy.challenge}</p>
			</div>
			<div class="case-col">
				<h3 class="case-col__label">Solution</h3>
				<p>{caseStudy.solution}</p>
			</div>
			<div class="case-col">
				<h3 class="case-col__label">Outcome</h3>
				<p>{caseStudy.outcome}</p>
			</div>
		</div>
	</section>

	<section class="solution-cross">
		<h2 class="solution-section__title">Explore other project types</h2>
		<div class="solution-cross__grid">
			{#each SOLUTIONS_NAV as sol}
				{#if sol.href !== `/solutions/${slug}`}
					<a href={sol.href} class="solution-cross__card">{sol.label} →</a>
				{/if}
			{/each}
		</div>
	</section>
</div>

<style>
	.solution-page {
		max-width: 880px;
		margin: 0 auto;
		padding: 64px 24px 96px;
	}

	.solution-hero {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		margin-bottom: 72px;
	}

	.solution-title {
		font-size: 2.5rem;
		font-weight: 700;
		line-height: 1.15;
		max-width: 640px;
	}

	.solution-sub {
		color: var(--text-muted);
		max-width: 560px;
		font-size: 1.05rem;
		line-height: 1.6;
	}

	.solution-hero__actions {
		display: flex;
		gap: 12px;
		margin-top: 8px;
	}

	.solution-section {
		margin-bottom: 72px;
	}

	.solution-section__title {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 24px;
		text-align: center;
	}

	.usecase-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
	}

	.usecase-card {
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl, 16px);
		padding: 20px;
	}

	.usecase-card__title {
		font-weight: 700;
		margin-bottom: 8px;
	}

	.usecase-card__desc {
		color: var(--text-muted);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.steps-list {
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 640px;
		margin: 0 auto;
	}

	.step-row {
		display: grid;
		grid-template-columns: 40px 1fr;
		gap: 16px;
	}

	.step-row__num {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--bg-subtle, rgba(0, 229, 255, 0.08));
		color: var(--color-brand);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
	}

	.step-row__title {
		font-weight: 700;
		margin-bottom: 4px;
	}

	.step-row__desc {
		color: var(--text-muted);
		line-height: 1.5;
	}

	.solution-section--case {
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl, 16px);
		padding: 40px;
	}

	.case-summary {
		text-align: center;
		color: var(--text-muted);
		max-width: 640px;
		margin: 0 auto 32px;
		line-height: 1.6;
	}

	.case-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 24px;
	}

	.case-col__label {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-brand);
		margin-bottom: 8px;
	}

	.case-col p {
		color: var(--text-muted);
		font-size: 0.9rem;
		line-height: 1.55;
	}

	.solution-cross {
		text-align: center;
	}

	.solution-cross__grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		max-width: 640px;
		margin: 0 auto;
	}

	.solution-cross__card {
		padding: 16px;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg, 12px);
		font-weight: 600;
		text-decoration: none;
		color: var(--text-primary, inherit);
		transition: border-color 0.2s;
	}

	.solution-cross__card:hover {
		border-color: var(--color-brand);
	}

	@media (max-width: 640px) {
		.usecase-grid,
		.case-grid,
		.solution-cross__grid {
			grid-template-columns: 1fr;
		}
		.solution-hero__actions {
			flex-direction: column;
			width: 100%;
		}
	}
</style>
