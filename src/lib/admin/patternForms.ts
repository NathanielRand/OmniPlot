// Pure form helpers for Admin → Patterns: blank/edit forms for catalog subjects
// and patterns, their validation, and the before/after lists the confirm
// dialogs show. No stores, no Firestore.

import type { Pattern, PatternCategory, PatternCoverage, PatternZone, ProjectType, VehicleEntry } from "$lib/types";
import type { PatternStatus } from "$lib/stores/patternStore.svelte";
import { sizeError } from "$lib/utils/patternSize";
import { makeKey, trimKey } from "$lib/utils/vehicleCatalog";
import { demandModelKey } from "$lib/utils/demand";

export const PROJECT_TYPES: { value: ProjectType; label: string; icon: string }[] = [
	{ value: "vehicle",     label: "Vehicle",     icon: "M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v5M14 17a3 3 0 100 6 3 3 0 000-6zM8 17a3 3 0 100 6 3 3 0 000-6z" },
	{ value: "residential", label: "Residential", icon: "M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z" },
	{ value: "commercial",  label: "Commercial",  icon: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" },
	{ value: "custom",      label: "Custom",      icon: "M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" },
];
export const projectTypeMeta = (t: ProjectType | undefined) =>
	PROJECT_TYPES.find((p) => p.value === (t ?? "vehicle")) ?? PROJECT_TYPES[0];

export function subjectName(v: Pick<VehicleEntry, "projectType" | "propertyLabel" | "model" | "address" | "year" | "make" | "trim">): string {
	if ((v.projectType ?? "vehicle") !== "vehicle") return v.propertyLabel || v.model || v.address || "Untitled";
	return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
}

// ─── Confirm-dialog change lists ──────────────
export type Change = { label: string; value: string };
const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));
export function diff(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): Change[] {
	return Object.keys(labels)
		.filter((k) => show(before[k]) !== show(after[k]))
		.map((k) => ({ label: labels[k], value: `${show(before[k])} → ${show(after[k])}` }));
}

// ─── Subjects ─────────────────────────────────
export const blankSubject = () => ({
	projectType: "vehicle" as ProjectType,
	year: new Date().getFullYear(), make: "", model: "", trim: "",
	bodyStyle: "sedan" as NonNullable<VehicleEntry["bodyStyle"]>,
	address: "", propertyLabel: "",
	status: "draft" as PatternStatus,
	tags: "", popular: false,
});
export type SubjectForm = ReturnType<typeof blankSubject>;

export const parseTags = (s: string) => [...new Set(s.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];

export function formFromSubject(v: VehicleEntry): SubjectForm {
	return {
		projectType: v.projectType ?? "vehicle",
		year: v.year ?? new Date().getFullYear(),
		make: v.make ?? "", model: v.model ?? "", trim: v.trim ?? "",
		bodyStyle: v.bodyStyle ?? "sedan",
		address: v.address ?? "", propertyLabel: v.propertyLabel ?? "",
		status: v.status, tags: (v.tags ?? []).join(", "), popular: !!v.popular,
	};
}

/** The subject fields a form produces, shaped for the catalog. */
export function subjectFromForm(f: SubjectForm): Omit<VehicleEntry, "id" | "updatedAt"> {
	const isVehicle = f.projectType === "vehicle";
	return {
		projectType: f.projectType,
		make: isVehicle ? f.make.trim() : undefined,
		model: isVehicle ? f.model.trim() : (f.model.trim() || undefined),
		trim: isVehicle ? f.trim.trim() || undefined : undefined,
		year: isVehicle ? Number(f.year) : undefined,
		bodyStyle: isVehicle ? f.bodyStyle : undefined,
		address: isVehicle ? undefined : f.address.trim() || undefined,
		propertyLabel: isVehicle ? undefined : f.propertyLabel.trim() || undefined,
		status: f.status,
		tags: parseTags(f.tags),
		popular: f.popular,
	};
}

export function subjectFormError(f: SubjectForm): string | null {
	if (f.projectType === "vehicle") {
		if (!f.make.trim() || !f.model.trim()) return "Make and model are required.";
		if (!Number(f.year)) return "Enter a year.";
	} else if (!f.propertyLabel.trim() && !f.model.trim()) {
		return f.projectType === "custom" ? "Enter a project name." : "Enter a property label.";
	}
	return null;
}

/**
 * The catalog entry this form would duplicate, if any. Matched by the keys the
 * library groups by, so "GR-86" and "gr86", or "Chevy" and "Chevrolet", are the same.
 */
export function subjectDuplicate(f: SubjectForm, existing: VehicleEntry[], selfId?: string): VehicleEntry | null {
	if (f.projectType === "vehicle") {
		const mk = makeKey(f.make), dk = demandModelKey(f.make, f.model), tk = trimKey(f.trim), year = Number(f.year);
		if (!mk || !dk || !year) return null;
		return existing.find((v) =>
			v.id !== selfId && (v.projectType ?? "vehicle") === "vehicle" && v.year === year
			&& makeKey(v.make) === mk && demandModelKey(v.make, v.model) === dk && trimKey(v.trim) === tk,
		) ?? null;
	}
	const label = (f.propertyLabel || f.model).trim().toLowerCase();
	if (!label) return null;
	return existing.find((v) =>
		v.id !== selfId && (v.projectType ?? "vehicle") === f.projectType
		&& (v.propertyLabel ?? v.model ?? "").trim().toLowerCase() === label,
	) ?? null;
}

export const SUBJECT_LABELS: Record<string, string> = {
	projectType: "Type", year: "Year", make: "Make", model: "Model", trim: "Trim", bodyStyle: "Body style",
	propertyLabel: "Label", address: "Address", status: "Status", tags: "Tags", popular: "Popular",
};
export const subjectRow = (v: Partial<VehicleEntry>) => ({
	...v, projectType: v.projectType ?? "vehicle", tags: (v.tags ?? []).join(", "), popular: v.popular ? "Yes" : "No",
});

// ─── Patterns ─────────────────────────────────
export const blankPattern = (zone: PatternZone = "custom") => ({
	zone, customZoneLabel: "", name: "", coverage: "full" as PatternCoverage,
	widthInches: 24, heightInches: 16, svgPath: "", svgUrl: "", revision: "", notes: "", isPublished: false,
});
export type PatternForm = ReturnType<typeof blankPattern>;

export function formFromPattern(p: Pattern): PatternForm {
	return {
		zone: p.zone, customZoneLabel: p.customZoneLabel ?? "", name: p.name, coverage: p.coverage,
		widthInches: p.widthInches, heightInches: p.heightInches, svgPath: p.svgPath, svgUrl: p.svgUrl ?? "",
		revision: p.revision ?? "", notes: p.notes ?? "", isPublished: p.isPublished,
	};
}

export function patternFormError(p: Pick<PatternForm, "name" | "zone" | "customZoneLabel" | "widthInches" | "heightInches" | "svgPath">): string | null {
	if (!p.name.trim()) return "Give the pattern a name.";
	if (p.zone === "custom" && !p.customZoneLabel.trim()) return "Name the custom zone.";
	// No placeholder shape — a pattern without a real outline would cut garbage.
	if (!p.svgPath.trim()) return "Paste the pattern's SVG path.";
	// PRECISION: W × H must have exactly the outline's proportions.
	return sizeError({ widthInches: Number(p.widthInches), heightInches: Number(p.heightInches) }, p.svgPath.trim());
}

export const PATTERN_LABELS: Record<string, string> = {
	name: "Name", zone: "Zone", customZoneLabel: "Custom zone name", coverage: "Coverage",
	widthInches: "Width (in)", heightInches: "Height (in)", svgUrl: "SVG URL",
	revision: "Revision", notes: "Notes", isPublished: "Published",
};

export type { PatternCategory };
