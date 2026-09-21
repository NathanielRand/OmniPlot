// ─── Shared tooltip display state ──────────────────────────────
// A single floating tooltip is rendered by TooltipHost.svelte (mounted once
// in the root layout) and driven by whichever element currently owns it via
// the `tooltip` action. Centralizing this avoids one absolutely-positioned
// tooltip node per trigger and keeps clamping/flipping logic in one place.

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipShowParams {
	text: string;
	rect: DOMRect;
	side: TooltipSide;
	/** Identifies the trigger so a stale hide() from an unmounting node can't clobber a newer show(). */
	owner: unknown;
}

function createTooltipStore() {
	let text = $state("");
	let rect = $state<DOMRect | null>(null);
	let side = $state<TooltipSide>("top");
	let visible = $state(false);
	let owner: unknown = null;

	function show(params: TooltipShowParams) {
		text = params.text;
		rect = params.rect;
		side = params.side;
		owner = params.owner;
		visible = true;
	}

	/** Hides the tooltip; if `forOwner` is given, only hides when that owner still holds it. */
	function hide(forOwner?: unknown) {
		if (forOwner !== undefined && owner !== forOwner) return;
		visible = false;
	}

	return {
		get text() {
			return text;
		},
		get rect() {
			return rect;
		},
		get side() {
			return side;
		},
		get visible() {
			return visible;
		},
		show,
		hide,
	};
}

export const tooltipStore = createTooltipStore();
