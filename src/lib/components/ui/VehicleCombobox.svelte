<script lang="ts">
	// Searchable combobox for vehicle make/model fields.
	// - Filters options as the user types (case-insensitive substring match)
	// - Shows "Add …" at the bottom when the typed value doesn't match any existing option
	// - On blur or Enter: snaps to the existing option's exact casing, or title-cases a new entry
	// - Keyboard: ↑↓ to navigate, Enter to select, Escape to close

	interface Props {
		value:        string;
		id?:          string;
		placeholder?: string;
		options:      string[];   // all known values for this field (unique, sorted)
		error?:       boolean;
		// When provided, the combobox acts as a multi-picker: fires oncommit with the
		// selected value then clears itself, rather than setting value persistently.
		oncommit?:    (val: string) => void;
	}
	let { value = $bindable(""), id, placeholder = "", options, error = false, oncommit }: Props = $props();

	let inputEl = $state<HTMLInputElement | null>(null);
	let open      = $state(false);
	let hiIdx     = $state(-1);   // index in rendered list (filtered options + optional add-row)

	// Stable ID for the listbox element (required by aria-controls on the combobox input).
	const listId = `vcb-${Math.random().toString(36).slice(2)}`;

	// ─── Derived list ─────────────────────────────────────────────────────────
	const filtered = $derived(
		value.trim()
			? options.filter(o => o.toLowerCase().includes(value.trim().toLowerCase()))
			: [...options],
	);

	// Show "Add" only when typed value has no case-insensitive exact match.
	const showAdd = $derived(
		value.trim().length > 0 &&
		!options.some(o => o.toLowerCase() === value.trim().toLowerCase()),
	);

	const listLen = $derived(filtered.length + (showAdd ? 1 : 0));

	// ─── Normalization ────────────────────────────────────────────────────────
	// Capitalize the first letter of each space-separated word; preserve the rest
	// so acronyms (GMC, BMW) entered in caps stay correct.
	function titleCase(s: string): string {
		return s.trim().split(" ").map(w => w ? w[0].toUpperCase() + w.slice(1) : "").join(" ");
	}

	// On commit (blur / Enter without an explicit selection): if the typed value
	// matches an existing option case-insensitively, snap to that option's exact
	// casing so the existingVehicle dupe-check always resolves correctly.
	// For genuinely new values, apply title-case normalization.
	function normalize() {
		if (oncommit) {
			value = "";  // multi-picker mode: clear without committing on blur
		} else {
			const match = options.find(o => o.toLowerCase() === value.trim().toLowerCase());
			if (match)            { value = match; }
			else if (value.trim()) { value = titleCase(value); }
		}
	}

	// ─── Interactions ─────────────────────────────────────────────────────────
	function selectOption(option: string) {
		if (oncommit) { oncommit(option); value = ""; }
		else            { value = option; }
		open  = false;
		hiIdx = -1;
	}

	function commitAdd() {
		const normalized = titleCase(value.trim());
		if (oncommit) { oncommit(normalized); value = ""; }
		else            { value = normalized; }
		open  = false;
		hiIdx = -1;
	}

	function onInput() {
		open  = true;
		hiIdx = -1;
	}

	function onFocus() {
		open = true;
	}

	// Blur: don't close if focus moved into the dropdown (mousedown sets capture
	// before blur fires; preventDefault on mousedown prevents blur entirely for
	// option clicks, so this guard handles keyboard-driven focus shifts).
	function onBlur(e: FocusEvent) {
		const rel = e.relatedTarget as HTMLElement | null;
		if (rel?.closest?.("[data-vcb-dropdown]")) return;
		open = false;
		normalize();
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) {
			if (e.key === "ArrowDown" || e.key === "Enter") {
				open = true;
				e.preventDefault();
			}
			return;
		}
		switch (e.key) {
			case "ArrowDown":
				hiIdx = Math.min(hiIdx + 1, listLen - 1);
				e.preventDefault();
				break;
			case "ArrowUp":
				hiIdx = Math.max(hiIdx - 1, -1);
				e.preventDefault();
				break;
			case "Enter":
				if (hiIdx >= 0 && hiIdx < filtered.length) {
					selectOption(filtered[hiIdx]);
				} else if (hiIdx === filtered.length && showAdd) {
					commitAdd();
				} else if (filtered.length === 1) {
					selectOption(filtered[0]);
				} else if (showAdd) {
					commitAdd();
				}
				e.preventDefault();
				break;
			case "Escape":
				open  = false;
				hiIdx = -1;
				normalize();
				e.preventDefault();
				break;
			case "Tab":
				open  = false;
				normalize();
				break;
		}
	}
</script>

<div class="vcb">
	<div class="vcb__wrap">
		<input
			bind:this={inputEl}
			{id}
			class="vcb__input"
			class:vcb__input--error={error}
			type="text"
			autocomplete="off"
			autocorrect="off"
			spellcheck="false"
			{placeholder}
			bind:value
			oninput={onInput}
			onfocus={onFocus}
			onblur={onBlur}
			onkeydown={onKeydown}
			role="combobox"
			aria-expanded={open}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-haspopup="listbox"
		/>
		{#if value && !open}
			<span class="vcb__clear-hint" aria-hidden="true">
				<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
			</span>
		{/if}
	</div>

	{#if open && listLen > 0}
		<div id={listId} class="vcb__dropdown" data-vcb-dropdown role="listbox" tabindex="-1">
			{#each filtered as option, i}
				<button
					type="button"
					class="vcb__option"
					class:vcb__option--hi={hiIdx === i}
					role="option"
					aria-selected={value.toLowerCase() === option.toLowerCase()}
					onmousedown={(e) => { e.preventDefault(); selectOption(option); }}
					onmousemove={() => (hiIdx = i)}
				>
					<span class="vcb__option-text">{option}</span>
				</button>
			{/each}

			{#if showAdd}
				<div class="vcb__divider" aria-hidden="true"></div>
				<button
					type="button"
					class="vcb__option vcb__option--add"
					class:vcb__option--hi={hiIdx === filtered.length}
					role="option"
					aria-selected={false}
					onmousedown={(e) => { e.preventDefault(); commitAdd(); }}
					onmousemove={() => (hiIdx = filtered.length)}
				>
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
					<span>Add "<strong>{titleCase(value.trim())}</strong>"</span>
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.vcb {
		position: relative;
		width: 100%;
	}

	.vcb__wrap {
		position: relative;
	}

	.vcb__input {
		width: 100%;
		box-sizing: border-box;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 0.875rem;
		font-family: var(--font-body);
		padding: 10px 12px;
		transition: border-color 0.12s;
	}
	.vcb__input:focus {
		outline: none;
		border-color: var(--color-brand);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-brand) 20%, transparent);
	}
	.vcb__input--error {
		border-color: var(--color-danger, #f44);
	}

	.vcb__clear-hint {
		position: absolute;
		right: 9px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-tertiary);
		pointer-events: none;
		display: flex;
	}

	/* ─── Dropdown ─── */
	.vcb__dropdown {
		position: absolute;
		top: calc(100% + 3px);
		left: 0;
		right: 0;
		z-index: 200;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
		overflow-y: auto;
		max-height: 240px;
		padding: 3px;
	}

	.vcb__option {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		padding: 7px 10px;
		font-size: 0.8125rem;
		font-family: var(--font-body);
		color: var(--text-secondary);
		background: transparent;
		border: none;
		border-radius: calc(var(--radius-md) - 2px);
		cursor: pointer;
		text-align: left;
		transition: background 0.08s, color 0.08s;
	}
	.vcb__option--hi,
	.vcb__option:hover {
		background: var(--bg-surface-2);
		color: var(--text-primary);
	}
	.vcb__option-text {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.vcb__divider {
		height: 1px;
		background: var(--border-subtle, var(--border-default));
		margin: 3px 6px;
		opacity: 0.6;
	}

	.vcb__option--add {
		color: var(--color-brand);
	}
	.vcb__option--add:hover,
	.vcb__option--add.vcb__option--hi {
		background: color-mix(in srgb, var(--color-brand) 10%, var(--bg-surface-2));
		color: var(--color-brand);
	}
	.vcb__option--add svg {
		flex-shrink: 0;
	}
</style>
