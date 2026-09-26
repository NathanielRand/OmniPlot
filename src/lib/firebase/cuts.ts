// ─────────────────────────────────────────────
// OmniPlot — CUT RECORDING (client)
// ─────────────────────────────────────────────
// Thin wrapper over POST /api/cuts. The server writes the job, the usage
// counters and the admin totals together; the user-doc and jobs listeners
// pick the changes up, so there's nothing to update locally.

import { auth } from "$lib/firebase/client";
import type { CanvasItem, CutSource, MaterialSheet, PlotterConfig } from "$lib/types";
import { getVehicleName } from "$lib/stores/patternStore.svelte";

export class CutLimitError extends Error {}

export interface CutSummary {
	source: CutSource;
	name: string;
	items: CanvasItem[];
	plotter: PlotterConfig;
	sheet: MaterialSheet;
	metrics: { materialEfficiency: number; estimatedCutSeconds: number; sheetArea: number; usedArea: number };
}

function payload(s: CutSummary) {
	const vehicleIds = [...new Set(s.items.map((i) => i.pattern.vehicleId).filter(Boolean))];
	return {
		source: s.source,
		name: s.name,
		subject: vehicleIds.length
			? getVehicleName(vehicleIds[0]) + (vehicleIds.length > 1 ? ` +${vehicleIds.length - 1} more` : "")
			: "",
		vehicleIds,
		patternIds: [...new Set(s.items.map((i) => i.patternId).filter(Boolean))],
		itemCount: s.items.length,
		plotter: {
			name: s.plotter.name,
			connection: s.plotter.connection,
			protocol: s.plotter.protocol,
			cuttingSpeed: s.plotter.cuttingSpeed,
			bladeForce: s.plotter.bladeForce,
			passes: s.plotter.passes,
		},
		sheet: { name: s.sheet.name, widthInches: s.sheet.widthInches },
		metrics: s.metrics,
	};
}

async function post(body: object): Promise<Record<string, unknown>> {
	const token = await auth.currentUser?.getIdToken();
	if (!token) throw new Error("Not signed in");
	const res = await fetch("/api/cuts", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
		body: JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (res.status === 403 && data.code === "limit") throw new CutLimitError(data.error ?? "Cut limit reached.");
	if (!res.ok) throw new Error(data.error ?? `Cut recording failed (${res.status})`);
	return data;
}

/** Opens a job before a live send. Throws CutLimitError when the allowance
 *  is used up (checked on the server, so it can't be bypassed). */
export async function startCutJob(s: CutSummary): Promise<string> {
	return (await post({ action: "start", job: payload(s) })).jobId as string;
}

export async function finishCutJob(jobId: string, status: "complete" | "error" | "cancelled", patternsCompleted: number): Promise<void> {
	await post({ action: "finish", jobId, status, patternsCompleted });
}

/** A cut that completes in one step (PLT download, Export → HPGL). */
export async function recordCutJob(s: CutSummary): Promise<string> {
	return (await post({ action: "record", job: payload(s) })).jobId as string;
}
