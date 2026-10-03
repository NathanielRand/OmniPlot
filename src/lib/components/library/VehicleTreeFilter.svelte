<script lang="ts">
	import { monogram, type MakeNode, type YearOption } from "$lib/utils/vehicleCatalog";

	// Sidebar make → model → trim tree. The active branch expands in place, so
	// it always mirrors the page's breadcrumb and one click jumps anywhere.
	export interface TreePath { make?: string; model?: string; trim?: string }

	interface Props {
		tree: MakeNode[];
		path: TreePath;
		total: number;
		logoFor: (makeLabel: string) => string | undefined;
		onselect: (p: TreePath) => void;
		trimBase: string;
		/** The open model's generations (admin-set year groups) and the one filtering the page, if any. */
		gens?: YearOption[];
		activeYear?: string;
		onyear?: (key: string) => void;
	}
	let { tree, path, total, logoFor, onselect, trimBase, gens = [], activeYear = "All", onyear }: Props = $props();

	const isTrim = (k: string) => path.trim === (k === "" ? trimBase : k);
</script>

<nav class="vt" aria-label="Browse by make, model and trim">
	<button class="vt__row vt__row--all" class:vt__row--on={!path.make} aria-current={!path.make ? "true" : undefined} onclick={() => onselect({})}>
		<span class="vt__label">All makes</span>
		<span class="vt__count">{total}</span>
	</button>

	<ul class="vt__list">
		{#each tree as m (m.key)}
			{@const openMake = path.make === m.key}
			<li>
				<button
					class="vt__row"
					class:vt__row--on={openMake && !path.model}
					class:vt__row--open={openMake}
					aria-expanded={openMake}
					aria-current={openMake && !path.model ? "true" : undefined}
					onclick={() => onselect({ make: m.key })}
				>
					<span class="vt__logo" aria-hidden="true">
						{#if logoFor(m.label)}<img src={logoFor(m.label)} alt="" loading="lazy" />{:else}<span>{monogram(m.label)}</span>{/if}
					</span>
					<span class="vt__label">{m.label}</span>
					<span class="vt__count">{m.count}</span>
				</button>

				{#if openMake}
					<ul class="vt__list vt__list--nested">
						{#each m.models as o (o.key)}
							{@const openModel = path.model === o.key}
							<li>
								<button
									class="vt__row vt__row--sm"
									class:vt__row--on={openModel && path.trim === undefined}
									class:vt__row--open={openModel}
									aria-expanded={o.trims.length > 1 ? openModel : undefined}
									aria-current={openModel && path.trim === undefined ? "true" : undefined}
									onclick={() => onselect({ make: m.key, model: o.key })}
								>
									<span class="vt__label">{o.label}</span>
									<span class="vt__count">{o.count}</span>
								</button>

								{#if openModel && gens.length && o.trims.length <= 1}
										<ul class="vt__list vt__list--nested" aria-label="Generations">
											{#each gens as g (g.key)}
												<li>
													<button
														class="vt__row vt__row--sm vt__row--gen"
														class:vt__row--on={activeYear === g.key}
														aria-pressed={activeYear === g.key}
														onclick={() => onyear?.(g.key)}
													>
														<span class="vt__label">{g.label}</span>
														<span class="vt__span">{g.from === g.to ? g.from : `${g.from}–${g.to}`}</span>
													</button>
												</li>
											{/each}
										</ul>
								{/if}

								{#if openModel && o.trims.length > 1}
									<ul class="vt__list vt__list--nested">
										{#each o.trims as t (t.key)}
											<li>
												<button
													class="vt__row vt__row--sm vt__row--trim"
													class:vt__row--on={isTrim(t.key)}
													aria-current={isTrim(t.key) ? "true" : undefined}
													onclick={() => onselect({ make: m.key, model: o.key, trim: t.key === "" ? trimBase : t.key })}
												>
													<span class="vt__label">{t.label}</span>
													<span class="vt__count">{t.count}</span>
												</button>
												{#if isTrim(t.key) && gens.length}
													<ul class="vt__list vt__list--nested" aria-label="Generations">
														{#each gens as g (g.key)}
															<li>
																<button class="vt__row vt__row--sm vt__row--gen" class:vt__row--on={activeYear === g.key} aria-pressed={activeYear === g.key} onclick={() => onyear?.(g.key)}>
																	<span class="vt__label">{g.label}</span>
																	<span class="vt__span">{g.from === g.to ? g.from : `${g.from}–${g.to}`}</span>
																</button>
															</li>
														{/each}
													</ul>
												{/if}
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
</nav>

<style>
	.vt { display: flex; flex-direction: column; gap: 2px; }
	.vt__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
	.vt__list--nested {
		margin: 2px 0 4px 15px;
		padding-left: 8px;
		border-left: 1px solid var(--border-subtle);
	}

	.vt__row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
		text-align: left;
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.vt__row:hover { background: var(--bg-surface-2); color: var(--text-primary); }
	.vt__row:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
	.vt__row--open { color: var(--text-primary); }
	.vt__row--on {
		background: color-mix(in srgb, var(--color-brand-dim) 14%, transparent);
		border-color: color-mix(in srgb, var(--color-brand-dim) 40%, transparent);
		color: var(--text-primary);
	}
	.vt__row--sm { padding: 5px 8px; font-size: 0.78125rem; font-weight: 450; }
	.vt__row--all { margin-bottom: 4px; }

	.vt__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.vt__count {
		flex: none;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-tertiary);
	}
	.vt__row--on .vt__count, .vt__row--on .vt__span { color: var(--color-brand-dim); }
	.vt__span { flex: none; margin-left: 12px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); }
	.vt__row--gen .vt__label { font-weight: 600; }

	.vt__logo {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		overflow: hidden;
		padding: 2px;
	}
	.vt__logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
	.vt__logo span { font-family: var(--font-mono); font-size: 0.5625rem; font-weight: 600; color: var(--text-secondary); }
</style>
