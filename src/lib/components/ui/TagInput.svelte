<script lang="ts">
	// Badge / tag creator: type a value, press Enter or comma (or just click
	// away) and it becomes a badge. Unlike the single-value combobox, text is
	// never thrown away on blur. Suggestions are optional and match existing
	// catalog values, so "crew cab" snaps to "Crew Cab" instead of forking it.
	interface Props {
		values: string[];
		id?: string;
		placeholder?: string;
		suggestions?: string[];
		error?: boolean;
		/** Label for screen readers on each remove button, e.g. "trim". */
		noun?: string;
		/** Optional parser/normaliser; return null to reject the value (e.g. a bad year). */
		normalize?: (raw: string) => string | null;
		/** Called with a message when a value is rejected, so the form can show it. */
		onreject?: (msg: string) => void;
		invalidMessage?: string;
	}
	let {
		values = $bindable([]),
		id,
		placeholder = "",
		suggestions = [],
		error = false,
		noun = "item",
		normalize,
		onreject,
		invalidMessage = "That value isn't valid.",
	}: Props = $props();

	let text = $state("");
	let open = $state(false);
	let hi = $state(-1);
	const listId = `ti-${Math.random().toString(36).slice(2)}`;

	const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
	// Capitalise each word's first letter; leave the rest so GMC / XLT stay intact.
	const titleCase = (s: string) => s.trim().replace(/\s+/g, " ").split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : "")).join(" ");

	const matches = $derived(
		suggestions
			.filter((s) => !values.some((v) => same(v, s)))
			.filter((s) => !text.trim() || s.toLowerCase().includes(text.trim().toLowerCase())),
	);

	function commit(raw = text): boolean {
		const t = raw.trim();
		if (!t) return false;
		let snapped: string;
		if (normalize) {
			const n = normalize(t);
			if (n === null) { onreject?.(invalidMessage); return false; }
			snapped = n;
		} else {
			snapped = suggestions.find((s) => same(s, t)) ?? titleCase(t);
		}
		if (values.some((v) => same(v, snapped))) { text = ""; return false; }
		values = [...values, snapped];
		text = "";
		hi = -1;
		return true;
	}

	function commitMany(raw: string) {
		for (const part of raw.split(",")) commit(part);
	}

	function remove(v: string) {
		values = values.filter((x) => x !== v);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" || e.key === ",") {
			// Never let Enter submit the surrounding form from a tag field.
			if (open && hi >= 0 && hi < matches.length) commit(matches[hi]);
			else commit();
			e.preventDefault();
		} else if (e.key === "Tab") {
			if (text.trim()) commit();
		} else if (e.key === "Backspace" && !text && values.length) {
			values = values.slice(0, -1);
		} else if (e.key === "ArrowDown") {
			open = true;
			hi = Math.min(hi + 1, matches.length - 1);
			e.preventDefault();
		} else if (e.key === "ArrowUp") {
			hi = Math.max(hi - 1, -1);
			e.preventDefault();
		} else if (e.key === "Escape") {
			open = false;
			hi = -1;
		}
	}

	function onInput() {
		open = true;
		hi = -1;
		// Typing or pasting a comma creates badges straight away.
		if (text.includes(",")) {
			const parts = text.split(",");
			const rest = parts.pop() ?? "";
			parts.forEach((p) => commit(p));
			text = rest.trimStart();
		}
	}

	function onPaste(e: ClipboardEvent) {
		const pasted = e.clipboardData?.getData("text") ?? "";
		if (/[,\n]/.test(pasted)) {
			e.preventDefault();
			commitMany(pasted.replace(/\n/g, ","));
		}
	}

	function onBlur(e: FocusEvent) {
		const rel = e.relatedTarget as HTMLElement | null;
		if (rel?.closest?.("[data-ti-list]")) return;
		open = false;
		commit();
	}
</script>

<div class="ti" class:ti--error={error}>
	{#each values as v (v)}
		<span class="ti__chip">
			<span>{v}</span>
			<button type="button" class="ti__x" aria-label="Remove {noun} {v}" onclick={() => remove(v)}>×</button>
		</span>
	{/each}
	<div class="ti__field">
		<input
			{id}
			class="ti__input"
			type="text"
			autocomplete="off"
			spellcheck="false"
			placeholder={values.length ? "Add another…" : placeholder}
			bind:value={text}
			oninput={onInput}
			onkeydown={onKeydown}
			onpaste={onPaste}
			onfocus={() => (open = true)}
			onblur={onBlur}
			role="combobox"
			aria-expanded={open && matches.length > 0}
			aria-controls={listId}
			aria-autocomplete="list"
		/>
		{#if open && matches.length}
			<div id={listId} class="ti__list" data-ti-list role="listbox" tabindex="-1">
				{#each matches as s, i (s)}
					<button
						type="button"
						class="ti__opt"
						class:ti__opt--hi={hi === i}
						role="option"
						aria-selected={hi === i}
						onmousedown={(e) => { e.preventDefault(); commit(s); }}
						onmousemove={() => (hi = i)}
					>{s}</button>
				{/each}
			</div>
		{/if}
	</div>
	{#if text.trim()}
		<button type="button" class="ti__add" onmousedown={(e) => { e.preventDefault(); commit(); }} aria-label="Add {noun} {titleCase(text)}">
			+ Add “{titleCase(text)}”
		</button>
	{/if}
</div>

<style>
	.ti {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-height: 48px;
		padding: 6px 8px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		transition: border-color 0.12s, box-shadow 0.12s;
	}
	.ti:focus-within {
		border-color: var(--color-brand);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-brand) 20%, transparent);
	}
	.ti--error { border-color: var(--color-danger, #f44); }

	.ti__chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px 4px 10px;
		background: color-mix(in srgb, var(--color-brand) 12%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, var(--color-brand) 28%, transparent);
		border-radius: 5px;
		font-size: 0.875rem;
		color: var(--text-primary);
		white-space: nowrap;
	}
	.ti__x {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1px 3px;
		background: none;
		border: none;
		border-radius: 3px;
		font-size: 0.875rem;
		line-height: 1;
		color: var(--text-tertiary);
		cursor: pointer;
	}
	.ti__x:hover { background: color-mix(in srgb, var(--color-danger, #f44) 15%, transparent); color: var(--color-danger, #f44); }

	.ti__field { position: relative; flex: 1; min-width: 140px; }
	.ti__input {
		width: 100%;
		padding: 4px 6px;
		background: transparent;
		border: none;
		outline: none;
		font: inherit;
		font-size: 0.9375rem;
		color: var(--text-primary);
	}
	.ti__input::placeholder { color: var(--text-tertiary); }

	.ti__add {
		flex: none;
		padding: 4px 10px;
		background: color-mix(in srgb, var(--color-brand) 10%, var(--bg-surface-2));
		border: 1px dashed color-mix(in srgb, var(--color-brand) 40%, transparent);
		border-radius: 5px;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-brand);
		cursor: pointer;
	}

	.ti__list {
		position: absolute;
		z-index: 30;
		top: calc(100% + 6px);
		left: -8px;
		min-width: 220px;
		max-height: 220px;
		overflow-y: auto;
		padding: 4px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		box-shadow: 0 12px 28px -12px rgba(0, 0, 0, 0.45);
	}
	.ti__opt {
		display: block;
		width: 100%;
		padding: 7px 10px;
		text-align: left;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: 0.875rem;
		color: var(--text-primary);
		cursor: pointer;
	}
	.ti__opt--hi, .ti__opt:hover { background: var(--bg-surface-2); }
</style>
