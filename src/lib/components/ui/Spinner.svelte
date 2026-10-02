<script lang="ts">
	// Inline "working" indicator for buttons: inherits the button's text colour, so it
	// works on any variant. Pair it with `disabled` so the form can't be sent twice.
	let { size = 13 }: { size?: number } = $props();
</script>

<span class="spin" style="--s:{size}px" role="presentation" aria-hidden="true"></span>

<style>
	.spin {
		display: inline-block;
		flex-shrink: 0;
		width: var(--s);
		height: var(--s);
		margin-right: 0.5em;
		vertical-align: -0.15em;
		border: 1.5px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.75s linear infinite;
		opacity: 0.75;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2s; } }
</style>
