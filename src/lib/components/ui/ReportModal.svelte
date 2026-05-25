<script lang="ts">
	import { uiStore, toastStore } from '$lib/stores';
	import { auth } from '$lib/firebase/client';
	import Button from '$lib/components/ui/Button.svelte';

	type ReportType     = 'bug' | 'feature' | 'other';
	type Severity       = 'low' | 'medium' | 'high' | 'critical';

	let type        = $state<ReportType>('bug');
	let severity    = $state<Severity>('medium');
	let title       = $state('');
	let description = $state('');
	let submitting  = $state(false);
	let submitted   = $state(false);

	$effect(() => {
		// Reset when modal opens
		if (uiStore.reportModalOpen) {
			type = 'bug'; severity = 'medium';
			title = ''; description = '';
			submitted = false; submitting = false;
		}
	});

	function closeOnBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) uiStore.closeReport();
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!title.trim() || !description.trim() || submitting) return;
		submitting = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/reports', {
				method:  'POST',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({
					type,
					severity: type === 'bug' ? severity : null,
					title,
					description,
					url:       window.location.href,
					userAgent: navigator.userAgent,
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Submission failed');
			submitted = true;
		} catch (err) {
			toastStore.error('Could not submit report', err instanceof Error ? err.message : '');
			submitting = false;
		}
	}

	const TYPES: { id: ReportType; label: string; icon: string }[] = [
		{ id: 'bug',     label: 'Bug',            icon: 'M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8zM9.1 9a2.9 2.9 0 015.8 0' },
		{ id: 'feature', label: 'Feature request', icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' },
		{ id: 'other',   label: 'Other',            icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8v4M12 16h.01' },
	];

	const SEVERITIES: { id: Severity; label: string; color: string }[] = [
		{ id: 'low',      label: 'Low',      color: 'var(--color-success)' },
		{ id: 'medium',   label: 'Medium',   color: 'var(--color-warning)' },
		{ id: 'high',     label: 'High',     color: '#f97316' },
		{ id: 'critical', label: 'Critical', color: 'var(--color-danger)' },
	];
</script>

{#if uiStore.reportModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="backdrop animate-fade-in" onclick={closeOnBackdrop} role="dialog" aria-modal="true" aria-label="Report an issue">
		<div class="modal animate-scale-in">
			<button class="modal__close" onclick={uiStore.closeReport} aria-label="Close">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>

			{#if submitted}
				<!-- Success state -->
				<div class="success">
					<div class="success__icon" aria-hidden="true">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
					</div>
					<h2 class="success__title">Report submitted</h2>
					<p class="success__sub">Thanks for the feedback. We'll look into it and follow up if needed.</p>
					<Button variant="primary" size="sm" onclick={uiStore.closeReport}>Done</Button>
				</div>
			{:else}
				<div class="modal__header">
					<h2 class="modal__title">Report an issue</h2>
					<p class="modal__sub">Help us improve OmniPlot. All feedback goes directly to the team.</p>
				</div>

				<form onsubmit={handleSubmit}>
					<!-- Type selector -->
					<div class="field">
						<div class="type-pills" role="group" aria-label="Report type">
							{#each TYPES as t}
								<button
									type="button"
									class="type-pill"
									class:type-pill--active={type === t.id}
									onclick={() => (type = t.id)}
								>
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d={t.icon}/></svg>
									{t.label}
								</button>
							{/each}
						</div>
					</div>

					<!-- Severity (bugs only) -->
					{#if type === 'bug'}
						<div class="field">
							<label class="field__label">Severity</label>
							<div class="severity-pills" role="group" aria-label="Bug severity">
								{#each SEVERITIES as s}
									<button
										type="button"
										class="severity-pill"
										class:severity-pill--active={severity === s.id}
										style:--sev-color={s.color}
										onclick={() => (severity = s.id)}
									>
										{s.label}
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Title -->
					<div class="field">
						<label for="report-title" class="field__label">
							{type === 'bug' ? 'What went wrong?' : type === 'feature' ? "What would you like?" : 'Summary'}
						</label>
						<input
							id="report-title"
							class="field__input"
							type="text"
							placeholder={type === 'bug' ? 'Short description of the issue…' : type === 'feature' ? 'Short description of the feature…' : 'Brief summary…'}
							bind:value={title}
							maxlength={120}
							required
						/>
					</div>

					<!-- Description -->
					<div class="field">
						<label for="report-desc" class="field__label">
							{type === 'bug' ? 'Steps to reproduce' : 'Details'}
						</label>
						<textarea
							id="report-desc"
							class="field__textarea"
							placeholder={type === 'bug'
								? '1. Go to…\n2. Click on…\n3. See error'
								: 'Describe the feature or issue in detail…'}
							bind:value={description}
							rows="5"
							required
						></textarea>
					</div>

					<p class="modal__meta">
						<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
						We automatically attach your current page URL and browser info to help debug.
					</p>

					<div class="modal__actions">
						<Button variant="ghost" size="sm" type="button" onclick={uiStore.closeReport}>Cancel</Button>
						<Button
							variant="primary"
							size="sm"
							type="submit"
							loading={submitting}
							disabled={!title.trim() || !description.trim()}
						>
							Submit report
						</Button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.6);
		backdrop-filter: blur(6px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}

	.modal {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-2xl);
		padding: 28px;
		width: 100%;
		max-width: 480px;
		position: relative;
		max-height: 90vh;
		overflow-y: auto;
	}

	.modal__close {
		position: absolute;
		top: 14px; right: 14px;
		width: 28px; height: 28px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		display: flex; align-items: center; justify-content: center;
		cursor: pointer;
		transition: background 0.12s;
	}
	.modal__close:hover { background: var(--bg-surface-3); color: var(--text-primary); }

	.modal__header { margin-bottom: 20px; }
	.modal__title { font-size: 1rem; font-weight: 600; margin-bottom: 4px; }
	.modal__sub { font-size: 0.8125rem; color: var(--text-secondary); margin: 0; }

	/* Type pills */
	.type-pills {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.type-pill {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		cursor: pointer;
		transition: all 0.12s;
	}
	.type-pill:hover { border-color: var(--border-strong); color: var(--text-primary); }
	.type-pill--active {
		border-color: var(--color-brand-dim);
		background: rgba(0,112,255,0.08);
		color: var(--text-primary);
	}

	/* Severity pills */
	.severity-pills {
		display: flex;
		gap: 6px;
	}

	.severity-pill {
		padding: 4px 10px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-tertiary);
		font-size: 0.75rem;
		font-weight: 500;
		font-family: var(--font-body);
		cursor: pointer;
		transition: all 0.12s;
	}
	.severity-pill:hover { color: var(--sev-color); border-color: var(--sev-color); }
	.severity-pill--active {
		color: var(--sev-color);
		border-color: var(--sev-color);
		background: color-mix(in srgb, var(--sev-color) 10%, transparent);
	}

	/* Fields */
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 16px;
	}

	.field__label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.field__input,
	.field__textarea {
		padding: 8px 11px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
		resize: vertical;
		width: 100%;
	}
	.field__input:focus,
	.field__textarea:focus { border-color: var(--color-brand-dim); }
	.field__textarea { min-height: 110px; }

	.modal__meta {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin: 0 0 18px;
	}
	.modal__meta svg { flex-shrink: 0; }

	.modal__actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	/* Success state */
	.success {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 12px 0;
		gap: 10px;
	}
	.success__icon {
		width: 48px; height: 48px;
		border-radius: 50%;
		background: rgba(34, 197, 94, 0.12);
		border: 1px solid rgba(34, 197, 94, 0.3);
		display: flex; align-items: center; justify-content: center;
		color: var(--color-success);
	}
	.success__title { font-size: 1rem; font-weight: 600; margin: 4px 0 0; }
	.success__sub { font-size: 0.875rem; color: var(--text-secondary); margin: 0 0 8px; }
</style>
