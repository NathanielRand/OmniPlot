import { describe, it, expect } from "vitest";
import { dedupeDiscovered, type DedupableDevice } from "./plotter-detect";

const CH340 = { vendorId: 0x1a86, productId: 0x7523 };
const usb = (x: Partial<DedupableDevice> = {}): DedupableDevice => ({ source: "usb", ...x });
const agent = (x: Partial<DedupableDevice> = {}): DedupableDevice => ({ source: "agent", portPath: "COM7", ...CH340, ...x });

describe("dedupeDiscovered", () => {
	it("folds a USB Direct card without a VID into the one that has it", () => {
		const out = dedupeDiscovered([usb(CH340), usb()]);
		expect(out).toHaveLength(1);
		expect(out[0].vendorId).toBe(CH340.vendorId);
	});

	it("shows the Cut Agent card when the same cutter is also a USB Direct card", () => {
		const out = dedupeDiscovered([agent({ manufacturer: "wch.cn" }), usb(CH340), usb()]);
		expect(out).toHaveLength(1);
		expect(out[0].source).toBe("agent");
	});

	it("keeps a connected state when the connected card is folded away", () => {
		const out = dedupeDiscovered([agent(), usb({ ...CH340, status: "connected" })]);
		expect(out).toHaveLength(1);
		expect(out[0].status).toBe("connected");
	});

	it("never folds identical cutters into each other", () => {
		const out = dedupeDiscovered([agent({ portPath: "COM7" }), agent({ portPath: "COM9" }), usb(CH340), usb(CH340)]);
		expect(out).toHaveLength(4);
	});

	it("does not fold a no-VID card when several USB cards have VIDs", () => {
		const out = dedupeDiscovered([usb(CH340), usb({ vendorId: 0x0403, productId: 0x6001 }), usb()]);
		expect(out).toHaveLength(3);
	});
});
