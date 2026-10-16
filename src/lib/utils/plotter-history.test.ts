import { describe, it, expect } from "vitest";
import {
	emptyHistory,
	recordConnect,
	recordDisconnect,
	forgetEntry,
	pickAutoTarget,
	findLiveFor,
	findEntryFor,
	sanitizeHistory,
	mergeDuplicateEntries,
	retryDelayMs,
	HISTORY_LIMIT,
	historyKey,
	type LiveDevice,
} from "./plotter-history";

const CH340 = { vendorId: 0x1a86, productId: 0x7523 };
const FTDI = { vendorId: 0x0403, productId: 0x6001 };

function usb(extra: Partial<LiveDevice> = {}): LiveDevice {
	return { source: "usb", ...CH340, ...extra };
}

describe("recordConnect", () => {
	it("adds an entry and makes it the auto target", () => {
		const s = recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "VEVOR 28\"", ...CH340 }, 1000);
		expect(s.entries).toHaveLength(1);
		expect(s.autoTargetKey).toBe(s.entries[0].key);
		expect(s.entries[0].connectCount).toBe(1);
	});

	it("updates the same plotter instead of duplicating it, keeping its label", () => {
		let s = recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "A", label: "Bay 1", ...CH340 }, 1000);
		s = recordConnect(s, { connection: "usb-serial", presetName: "A", ...CH340 }, 2000);
		expect(s.entries).toHaveLength(1);
		expect(s.entries[0].label).toBe("Bay 1");
		expect(s.entries[0].connectCount).toBe(2);
		expect(s.entries[0].lastConnectedAt).toBe(2000);
	});

	it("follows a Cut Agent plotter whose COM port was renumbered", () => {
		let s = recordConnect(emptyHistory(), { connection: "cut-agent", presetName: "A", serialPort: "COM7", ...CH340 }, 1000);
		s = recordConnect(s, { connection: "cut-agent", presetName: "A", serialPort: "COM8", ...CH340 }, 2000);
		expect(s.entries).toHaveLength(1);
		expect(s.entries[0].serialPort).toBe("COM8");
		expect(s.autoTargetKey).toBe(s.entries[0].key);
	});

	it("marks the previous auto target as switched and orders most recent first", () => {
		let s = recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "A", ...CH340 }, 1000);
		s = recordConnect(s, { connection: "usb-serial", presetName: "B", ...FTDI }, 2000);
		expect(s.entries.map((e) => e.presetName)).toEqual(["B", "A"]);
		expect(s.entries[1].lastEndReason).toBe("switched");
		expect(s.autoTargetKey).toBe(s.entries[0].key);
	});

	it("caps history length", () => {
		let s = emptyHistory();
		for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
			s = recordConnect(s, { connection: "network", presetName: "N", ipAddress: `10.0.0.${i}`, port: 9100 }, i);
		}
		expect(s.entries).toHaveLength(HISTORY_LIMIT);
		expect(s.entries[0].ipAddress).toBe(`10.0.0.${HISTORY_LIMIT + 4}`);
	});
});

describe("recordDisconnect — manual choice always wins", () => {
	it("a user disconnect clears the auto target", () => {
		let s = recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "A", ...CH340 }, 1000);
		s = recordDisconnect(s, s.autoTargetKey, "user", 2000);
		expect(s.autoTargetKey).toBeNull();
		expect(pickAutoTarget(s, [usb()])).toBeNull();
	});

	it("a lost connection keeps the auto target so it reconnects when back", () => {
		let s = recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "A", ...CH340 }, 1000);
		s = recordDisconnect(s, s.autoTargetKey, "lost", 2000);
		expect(s.autoTargetKey).not.toBeNull();
		expect(pickAutoTarget(s, [])).toBeNull();          // unplugged → wait
		expect(pickAutoTarget(s, [usb()])?.device).toBeTruthy(); // plugged back in → go
	});
});

describe("pickAutoTarget", () => {
	it("does nothing when auto-reconnect is off", () => {
		const s = { ...recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "A", ...CH340 }, 1), autoReconnect: false };
		expect(pickAutoTarget(s, [usb()])).toBeNull();
	});

	it("never connects a different device, even if it's the only one present", () => {
		const s = recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "A", ...CH340 }, 1);
		expect(pickAutoTarget(s, [usb(FTDI)])).toBeNull();
	});

	it("resumes a saved USB Direct plotter through the Cut Agent (the required route)", () => {
		const s = recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "A", ...CH340 }, 1);
		const agent: LiveDevice = { source: "agent", portPath: "COM7", ...CH340 };
		expect(pickAutoTarget(s, [agent])?.device).toBe(agent);
	});

	it("never guesses between two identical cutters on the agent", () => {
		const s = recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "A", ...CH340 }, 1);
		expect(pickAutoTarget(s, [{ source: "agent", portPath: "COM7", ...CH340 }, { source: "agent", portPath: "COM9", ...CH340 }])).toBeNull();
	});

	it("resumes network plotters immediately (they can't be probed)", () => {
		const s = recordConnect(emptyHistory(), { connection: "network", presetName: "A", ipAddress: "10.0.0.5", port: 9100 }, 1);
		expect(pickAutoTarget(s, [])).toMatchObject({ device: null });
	});
});

describe("findLiveFor", () => {
	it("prefers the exact port, and refuses to guess between identical twins", () => {
		const s = recordConnect(emptyHistory(), { connection: "cut-agent", presetName: "A", serialPort: "COM7", ...CH340 }, 1);
		const e = s.entries[0];
		const com7 = { source: "agent" as const, portPath: "COM7", ...CH340 };
		const com9 = { source: "agent" as const, portPath: "COM9", ...CH340 };
		const com10 = { source: "agent" as const, portPath: "COM10", ...CH340 };
		expect(findLiveFor(e, [com9, com7])).toBe(com7);
		expect(findLiveFor(e, [com9])).toBe(com9);          // renumbered, unambiguous
		expect(findLiveFor(e, [com9, com10])).toBeNull();   // two identical cutters
	});

	it("maps a live device back to its history entry", () => {
		const s = recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "VEVOR", label: "Bay 2", ...CH340 }, 1);
		expect(findEntryFor(s, usb())?.label).toBe("Bay 2");
		expect(findEntryFor(s, usb(FTDI))).toBeNull();
	});
});

describe("forget / sanitize / retry", () => {
	it("forgetting the auto target clears it", () => {
		const s = recordConnect(emptyHistory(), { connection: "usb-serial", presetName: "A", ...CH340 }, 1);
		expect(forgetEntry(s, s.entries[0].key).autoTargetKey).toBeNull();
	});

	it("drops malformed persisted data and dangling targets", () => {
		const s = sanitizeHistory({
			entries: [{ connection: "usb-serial", presetName: "A", ...CH340, lastConnectedAt: 5 }, { connection: "bogus" }, null, "x"],
			autoTargetKey: "usb:NOPE",
			autoReconnect: false,
		});
		expect(s.entries).toHaveLength(1);
		expect(s.autoTargetKey).toBeNull();
		expect(s.autoReconnect).toBe(false);
		expect(sanitizeHistory("garbage")).toEqual(emptyHistory());
	});

	it("retries fast at first then eases off", () => {
		expect(retryDelayMs(0)).toBe(3_000);
		expect(retryDelayMs(1)).toBeGreaterThan(retryDelayMs(0));
		expect(retryDelayMs(99)).toBe(30_000);
	});
});

describe("mergeDuplicateEntries", () => {
	const base = { presetName: "A", firstConnectedAt: 1, connectCount: 1 };
	function state(entries: any[], autoTargetKey: string | null = null) {
		return { version: 1 as const, entries: entries.map((e) => ({ ...base, key: historyKey(e), ...e })), autoTargetKey, autoReconnect: true };
	}

	it("folds an agent record missing its VID into the one that has it (same port)", () => {
		const s = mergeDuplicateEntries(state([
			{ connection: "cut-agent", serialPort: "COM7", lastConnectedAt: 5 },
			{ connection: "cut-agent", serialPort: "COM7", ...CH340, lastConnectedAt: 3 },
		]));
		expect(s.entries).toHaveLength(1);
		expect(s.entries[0].vendorId).toBe(CH340.vendorId);
		expect(s.entries[0].connectCount).toBe(2);
		expect(s.entries[0].lastConnectedAt).toBe(5);
	});

	it("folds a USB Direct record into the single Cut Agent record of the same hardware", () => {
		const s = mergeDuplicateEntries(state([
			{ connection: "usb-serial", ...CH340, label: "Bay 1", lastConnectedAt: 9 },
			{ connection: "cut-agent", serialPort: "COM7", ...CH340, lastConnectedAt: 4 },
		]));
		expect(s.entries).toHaveLength(1);
		expect(s.entries[0].connection).toBe("cut-agent");
		expect(s.entries[0].label).toBe("Bay 1");
	});

	it("never merges identical cutters on different ports", () => {
		const s = mergeDuplicateEntries(state([
			{ connection: "cut-agent", serialPort: "COM7", ...CH340, lastConnectedAt: 4 },
			{ connection: "cut-agent", serialPort: "COM9", ...CH340, lastConnectedAt: 5 },
			{ connection: "usb-serial", ...CH340, lastConnectedAt: 6 },
		]));
		expect(s.entries).toHaveLength(3);
	});

	it("keeps the auto target pointing at the surviving entry", () => {
		const input = state([
			{ connection: "cut-agent", serialPort: "COM7", lastConnectedAt: 5 },
			{ connection: "cut-agent", serialPort: "COM7", ...CH340, lastConnectedAt: 3 },
		], "agent:????:????@COM7");
		const s = mergeDuplicateEntries(input);
		expect(s.autoTargetKey).toBe(s.entries[0].key);
	});

	it("leaves network plotters alone", () => {
		const s = mergeDuplicateEntries(state([
			{ connection: "network", ipAddress: "10.0.0.5", lastConnectedAt: 1 },
			{ connection: "network", ipAddress: "10.0.0.6", lastConnectedAt: 2 },
		]));
		expect(s.entries).toHaveLength(2);
	});
});
