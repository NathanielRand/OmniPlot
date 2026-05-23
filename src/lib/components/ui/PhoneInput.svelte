<script lang="ts">
	interface Props {
		value?:    string;  // E.164 output, e.g. "+15551234567"
		id?:       string;
		required?: boolean;
		class?:    string;
	}

	let { value = $bindable(""), id, required, class: cls = "" }: Props = $props();

	type Country = {
		code:        string;
		dial:        string;
		flag:        string;
		maxDigits:   number;
		placeholder: string;
		format:      (d: string) => string;
	};

	// NANP (North American Numbering Plan): (XXX) XXX-XXXX
	function nanp(d: string): string {
		const s = d.slice(0, 10);
		if (s.length <= 3) return s;
		if (s.length <= 6) return `(${s.slice(0, 3)}) ${s.slice(3)}`;
		return `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}`;
	}

	// Generic: groups of 3–3–4
	function generic(d: string): string {
		const s = d.slice(0, 11);
		if (s.length <= 3) return s;
		if (s.length <= 6) return `${s.slice(0, 3)} ${s.slice(3)}`;
		if (s.length <= 10) return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}`;
		return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 10)} ${s.slice(10)}`;
	}

	// UK: XXXX XXXXXX or XXXXX XXXXXX
	function uk(d: string): string {
		const s = d.slice(0, 11);
		if (s.length <= 4) return s;
		if (s.length <= 7) return `${s.slice(0, 4)} ${s.slice(4)}`;
		return `${s.slice(0, 5)} ${s.slice(5)}`;
	}

	const COUNTRIES: Country[] = [
		{ code: "US", dial: "1",  flag: "🇺🇸", maxDigits: 10, placeholder: "(555) 000-0000", format: nanp    },
		{ code: "CA", dial: "1",  flag: "🇨🇦", maxDigits: 10, placeholder: "(555) 000-0000", format: nanp    },
		{ code: "GB", dial: "44", flag: "🇬🇧", maxDigits: 11, placeholder: "07911 123456",   format: uk      },
		{ code: "AU", dial: "61", flag: "🇦🇺", maxDigits: 10, placeholder: "412 345 678",    format: generic },
		{ code: "MX", dial: "52", flag: "🇲🇽", maxDigits: 10, placeholder: "555 123 4567",   format: generic },
		{ code: "DE", dial: "49", flag: "🇩🇪", maxDigits: 11, placeholder: "151 234 56789",  format: generic },
		{ code: "FR", dial: "33", flag: "🇫🇷", maxDigits: 10, placeholder: "612 345 678",    format: generic },
		{ code: "BR", dial: "55", flag: "🇧🇷", maxDigits: 11, placeholder: "11 91234 5678",  format: generic },
		{ code: "IN", dial: "91", flag: "🇮🇳", maxDigits: 10, placeholder: "98765 43210",    format: generic },
		{ code: "JP", dial: "81", flag: "🇯🇵", maxDigits: 10, placeholder: "90 1234 5678",   format: generic },
		{ code: "KR", dial: "82", flag: "🇰🇷", maxDigits: 10, placeholder: "10 1234 5678",   format: generic },
		{ code: "NL", dial: "31", flag: "🇳🇱", maxDigits: 10, placeholder: "612 345 678",    format: generic },
		{ code: "ES", dial: "34", flag: "🇪🇸", maxDigits: 9,  placeholder: "612 345 678",    format: generic },
		{ code: "IT", dial: "39", flag: "🇮🇹", maxDigits: 10, placeholder: "312 345 678",    format: generic },
	];

	let selected  = $state<Country>(COUNTRIES[0]);
	let displayed = $state("");  // formatted local number shown in input

	function syncValue() {
		const digits = displayed.replace(/\D/g, "");
		value = digits ? `+${selected.dial}${digits}` : "";
	}

	function handleInput(e: Event) {
		const raw    = (e.currentTarget as HTMLInputElement).value;
		let digits   = raw.replace(/\D/g, "").slice(0, selected.maxDigits);
		displayed    = selected.format(digits);
		syncValue();
	}

	function handleCountryChange(e: Event) {
		const code = (e.currentTarget as HTMLSelectElement).value;
		selected   = COUNTRIES.find(c => c.code === code) ?? COUNTRIES[0];
		// Reformat existing digits with new country's formatter
		const digits = displayed.replace(/\D/g, "").slice(0, selected.maxDigits);
		displayed    = digits ? selected.format(digits) : "";
		syncValue();
	}
</script>

<div class="phone-wrap {cls}">
	<select
		class="phone-country"
		value={selected.code}
		onchange={handleCountryChange}
		aria-label="Country code"
		title="Select country"
	>
		{#each COUNTRIES as c (c.code)}
			<option value={c.code}>{c.flag} +{c.dial}</option>
		{/each}
	</select>

	<input
		{id}
		type="tel"
		inputmode="tel"
		class="phone-input"
		value={displayed}
		oninput={handleInput}
		placeholder={selected.placeholder}
		{required}
		autocomplete="tel-national"
	/>
</div>

<style>
	.phone-wrap {
		display: flex;
		gap: 6px;
	}

	.phone-country {
		flex-shrink: 0;
		width: 96px;
		padding: 9px 8px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		cursor: pointer;
		outline: none;
		appearance: auto;
		transition: border-color 0.12s;
	}
	.phone-country:focus { border-color: var(--color-brand-dim); }

	.phone-input {
		flex: 1;
		min-width: 0;
		padding: 9px 12px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.9375rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
	}
	.phone-input:focus { border-color: var(--color-brand-dim); }
	.phone-input::placeholder { color: var(--text-tertiary); }
</style>
