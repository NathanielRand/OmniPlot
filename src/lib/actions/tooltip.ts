import { tooltipStore, type TooltipSide } from "$lib/stores/tooltipStore.svelte";

export interface TooltipOptions {
	text: string;
	/** Preferred side to show on; flips automatically if there's no room. Default "top". */
	side?: TooltipSide;
	disabled?: boolean;
}

export type TooltipParam = string | TooltipOptions | null | undefined | false;

function normalize(param: TooltipParam): TooltipOptions | null {
	if (!param) return null;
	if (typeof param === "string") return param.trim() ? { text: param } : null;
	return param.text?.trim() ? param : null;
}

const SHOW_DELAY = 350;
const HIDE_DELAY = 60;
const TOUCH_AUTOHIDE = 1600;

/**
 * Svelte action that shows a styled, viewport-clamped tooltip on hover/focus
 * (and a brief tap-peek on touch) via the shared TooltipHost.
 *
 * Usage: <button use:tooltip={"Zoom in"}> or use:tooltip={{ text, side: "left" }}
 *
 * If the node has no visible text and no aria-label of its own, the tooltip
 * text is applied as an aria-label so icon-only controls stay accessible.
 */
export function tooltip(node: HTMLElement, param: TooltipParam) {
	let opts = normalize(param);
	let showTimer: ReturnType<typeof setTimeout> | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	let touchTimer: ReturnType<typeof setTimeout> | undefined;

	function syncAccessibleName() {
		if (!opts) return;
		const hasVisibleText = (node.textContent ?? "").trim().length > 0;
		if (!hasVisibleText && !node.hasAttribute("aria-label") && !node.hasAttribute("aria-labelledby")) {
			node.setAttribute("aria-label", opts.text);
		}
	}

	function reveal() {
		if (!opts || opts.disabled) return;
		clearTimeout(hideTimer);
		const rect = node.getBoundingClientRect();
		tooltipStore.show({ text: opts.text, rect, side: opts.side ?? "top", owner: node });
	}

	function onEnter() {
		if (!opts || opts.disabled) return;
		clearTimeout(hideTimer);
		clearTimeout(showTimer);
		showTimer = setTimeout(reveal, SHOW_DELAY);
	}

	function onLeave() {
		clearTimeout(showTimer);
		hideTimer = setTimeout(() => tooltipStore.hide(node), HIDE_DELAY);
	}

	function onFocus() {
		if (!opts || opts.disabled) return;
		clearTimeout(hideTimer);
		reveal();
	}

	function onBlur() {
		clearTimeout(showTimer);
		tooltipStore.hide(node);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") tooltipStore.hide(node);
	}

	function onTouchStart() {
		if (!opts || opts.disabled) return;
		reveal();
		clearTimeout(touchTimer);
		touchTimer = setTimeout(() => tooltipStore.hide(node), TOUCH_AUTOHIDE);
	}

	node.addEventListener("mouseenter", onEnter);
	node.addEventListener("mouseleave", onLeave);
	node.addEventListener("focus", onFocus);
	node.addEventListener("blur", onBlur);
	node.addEventListener("keydown", onKeydown);
	node.addEventListener("touchstart", onTouchStart, { passive: true });

	syncAccessibleName();

	return {
		update(newParam: TooltipParam) {
			opts = normalize(newParam);
			syncAccessibleName();
			if (!opts) tooltipStore.hide(node);
		},
		destroy() {
			clearTimeout(showTimer);
			clearTimeout(hideTimer);
			clearTimeout(touchTimer);
			node.removeEventListener("mouseenter", onEnter);
			node.removeEventListener("mouseleave", onLeave);
			node.removeEventListener("focus", onFocus);
			node.removeEventListener("blur", onBlur);
			node.removeEventListener("keydown", onKeydown);
			node.removeEventListener("touchstart", onTouchStart);
			tooltipStore.hide(node);
		},
	};
}
