// ─────────────────────────────────────────────
// Admin → Patterns: shared state and actions.
//
// One place for the review queue, change requests, users and every catalog
// mutation, so the three screens (Review, Catalog, Requests) stay thin. Every
// write is awaited and reports its own failure — none of it relies on the
// store's fire-and-forget sync. Publishing, revoking and deleting go through
// one atomic batch (commitCatalogChange), so a failure leaves nothing half
// applied, and a submitter's copy never claims "approved" for patterns that
// were never published.
// ─────────────────────────────────────────────

import { patternStore, MIRROR_PAIRS, zoneLabel as storeZoneLabel } from "$lib/stores/patternStore.svelte";
import {
	getReviewQueue, getAdjustmentRequests, resolveAdjustmentRequest, adminUpdateUserPattern, deleteUserPattern,
	commitCatalogChange, setVehicleDoc, updateVehicleDoc, setPatternDoc, updatePatternDoc, setDemandStatus,
} from "$lib/firebase/firestore";
import { toastStore, confirmStore } from "$lib/stores";
import { auth } from "$lib/firebase/client";
import { formatMeasure, uid } from "$lib/utils";
import { sizeError } from "$lib/utils/patternSize";
import { planVehicles, type VehiclePlanInput } from "./vehiclePlan";
import { planPublish, planRevoke, linkedPatterns, ownersToReset, RESET_TO_PRIVATE } from "$lib/utils/publishPlan";
import {
	diff, subjectName, subjectFromForm, subjectFormError, subjectRow, SUBJECT_LABELS,
	patternFormError, PATTERN_LABELS, projectTypeMeta, type SubjectForm, type PatternForm,
} from "./patternForms";
import type {
	Pattern, PatternAdjustmentRequest, PatternCategory, PatternCoverage, PatternZone,
	RequestStatus, UserPattern, VehicleEntry,
} from "$lib/types";

export type AdminUserLite = { uid: string; displayName: string; email: string; tier: string };

export interface SubmissionEdits {
	name: string;
	widthInches: number;
	heightInches: number;
	coverage: PatternCoverage;
	notes: string;
	make: string;
	models: string[];
	years: string[];
	trims: string[];
}

const today = () => new Date().toISOString().split("T")[0];

function createAdminPatterns() {
	let submissions = $state<UserPattern[]>([]);
	let adjustments = $state<PatternAdjustmentRequest[]>([]);
	let usersById = $state<Record<string, AdminUserLite>>({});
	let queueLoading = $state(false);
	let queueError = $state(false);
	let adjustmentsLoading = $state(false);
	let filterUser = $state<string | null>(null);
	let seeding = $state(false);
	let busy = $state<string | null>(null);

	// ─── Loading ────────────────────────────────
	async function loadQueue() {
		queueLoading = true;
		queueError = false;
		try {
			submissions = await getReviewQueue();
		} catch (err) {
			console.error("[admin/patterns] loadQueue", err);
			queueError = true;
			toastStore.error("Load failed", "Could not fetch submissions.");
		} finally { queueLoading = false; }
	}

	async function loadAdjustments() {
		adjustmentsLoading = true;
		try {
			adjustments = await getAdjustmentRequests();
		} catch (err) {
			console.error("[admin/patterns] loadAdjustments", err);
			toastStore.error("Load failed", "Could not fetch change requests.");
		} finally { adjustmentsLoading = false; }
	}

	async function loadUsers() {
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch("/api/admin/users", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
			if (!res.ok) throw new Error();
			const data = await res.json();
			usersById = Object.fromEntries((data.users as AdminUserLite[]).map((u) => [u.uid, u]));
		} catch { toastStore.error("Load failed", "Could not fetch users."); }
	}

	const loadAll = () => Promise.all([loadQueue(), loadAdjustments(), loadUsers()]);

	// ─── People ─────────────────────────────────
	function userLabel(u: string): string {
		const x = usersById[u];
		return x?.displayName || x?.email || `${u.slice(0, 10)}…`;
	}
	const matchesUser = (u: string | undefined) => !filterUser || u === filterUser;

	// ─── Catalog helpers ────────────────────────
	const allCatalogPatterns = (): Pattern[] => patternStore.vehicles.flatMap((v) => patternStore.getPatterns(v.id));
	const zoneLabel = (category: PatternCategory, zone: PatternZone, customLabel?: string, type?: VehicleEntry["projectType"]) =>
		storeZoneLabel(zone, category, type, customLabel);

	// Until the catalog is in Firestore the app runs on the built-in seed, and
	// the first write would make Firestore the source with only that one doc in
	// it. So the first edit copies the whole catalog in (create-only), then
	// applies the change. Asked once; false if cancelled or it can't sync.
	async function waitForFirestoreCatalog(timeoutMs = 10_000): Promise<boolean> {
		const start = Date.now();
		while (patternStore.usingSeed && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 150));
		return !patternStore.usingSeed;
	}

	async function ensureCatalog(): Promise<boolean> {
		if (!patternStore.usingSeed) return true;
		if (patternStore.catalogError) {
			toastStore.error("Catalog unavailable", "Couldn't reach the catalog in Firestore — refresh and try again.");
			return false;
		}
		const subjects = patternStore.vehicles.length;
		const patterns = allCatalogPatterns().length;
		const ok = await confirmStore.ask({
			title: "Move the catalog into Firestore first?",
			message: "The catalog is still the built-in copy that ships with the app. Editing it copies every subject and pattern into Firestore once, then saves your change. Nothing customers see changes except your edit.",
			details: [
				{ label: "Subjects copied", value: String(subjects) },
				{ label: "Patterns copied", value: String(patterns) },
			],
			confirmLabel: "Copy catalog & continue",
		});
		if (!ok) return false;
		seeding = true;
		try {
			if (!(await patternStore.seedFirestore())) return false;
			if (!(await waitForFirestoreCatalog())) {
				toastStore.error("Still syncing", "The catalog was copied but hasn't loaded back yet — try your change again in a moment.");
				return false;
			}
			return true;
		} finally { seeding = false; }
	}

	/** Run `fn` as a named, awaited action: one at a time, failures reported with the cause. */
	async function run(name: string, failTitle: string, fn: () => Promise<void>): Promise<boolean> {
		if (busy) return false;
		busy = name;
		try {
			await fn();
			return true;
		} catch (err) {
			console.error(`[admin/patterns] ${name}`, err);
			toastStore.error(failTitle, err instanceof Error && err.message ? err.message : "Please try again.");
			return false;
		} finally { busy = null; }
	}

	const patchLocal = (id: string, patch: Partial<UserPattern>) => {
		submissions = submissions.map((s) => (s.id === id ? { ...s, ...patch } : s));
	};

	// ─── Submissions ────────────────────────────
	/** The plan for approving — recomputed live while the admin edits, and again on commit. */
	function planFor(sub: UserPattern, edits: SubmissionEdits) {
		return planPublish({
			sub: { ...sub, ...edits, notes: edits.notes || undefined },
			vehicles: patternStore.vehicles,
			patterns: allCatalogPatterns(),
			mirrorOf: (z) => MIRROR_PAIRS[z],
			newId: uid,
		});
	}

	async function approve(sub: UserPattern, edits: SubmissionEdits, publishHidden: boolean, repair = false): Promise<boolean> {
		// PRECISION: never publish a pattern whose size doesn't match its outline.
		const sizeErr = sizeError(edits, sub.svgPath);
		if (sizeErr) { toastStore.error("Can't publish", sizeErr); return false; }
		const plan = planFor(sub, edits);
		if (plan.error) { toastStore.error("Can't publish", plan.error); return false; }

		const newSubjects = plan.targets.filter((t) => t.isNew);
		const hidden = plan.targets.filter((t) => t.hidden);
		const ok = await confirmStore.ask({
			title: repair
				? `Publish the rest of "${edits.name.trim() || sub.name}"?`
				: `Publish "${edits.name.trim() || sub.name}" to the public library?`,
			message: repair
				? "This was approved before every model, year and trim was published. What's already live stays as it is; this adds the missing ones and links them all to the submission."
				: "Customers can cut it right away. The submitter's copy is locked as approved, and linked to what's published so you can revoke it later.",
			details: [
				{ label: "Submitted by", value: userLabel(sub.ownerId) },
				{ label: "Size", value: `${formatMeasure(edits.widthInches)}" × ${formatMeasure(edits.heightInches)}"` },
				{ label: "Subjects", value: `${plan.targets.length} (${newSubjects.length} new, ${plan.targets.length - newSubjects.length} existing)` },
				{ label: "Patterns created", value: String(plan.patterns.length) },
				...(plan.alreadyPublished ? [{ label: "Already published", value: String(plan.alreadyPublished) }] : []),
				...(plan.pairedZones.length ? [{ label: "Left/right pair", value: "published once — customers get both sides with “Add both sides”" }] : []),
				...(hidden.length
					? [{ label: publishHidden ? "Also publishing" : "Not visible yet", value: `${hidden.length} existing subject${hidden.length === 1 ? " is" : "s are"} not published${publishHidden ? " — they will be" : " — customers won't see this pattern until they are"}` }]
					: []),
				...plan.warnings.map((w) => ({ label: "Note", value: w })),
			],
			confirmLabel: "Approve & publish",
		});
		if (!ok || !(await ensureCatalog())) return false;

		return run("approve", "Approve failed", async () => {
			await commitPlan(sub, plan, publishHidden);
			toastStore.success(repair ? "Published" : "Approved", `${plan.patterns.length} pattern${plan.patterns.length === 1 ? "" : "s"} published.`);
		});
	}

	/** Write a publish plan atomically and mark the submitter's copy approved. */
	async function commitPlan(sub: UserPattern, plan: ReturnType<typeof planPublish>, publishHidden: boolean) {
		const day = today();
		const newSubjects = plan.targets.filter((t) => t.isNew);
		const hidden = plan.targets.filter((t) => t.hidden);
		const publishing = publishHidden ? hidden.map((t) => ({ ...t.subject, status: "published" as const, updatedAt: day })) : [];
		const publishedIds = new Set(publishing.map((v) => v.id));
		const userPatch = { isPublished: true, status: "approved" as const, submitToCommunity: true, vehicleId: plan.targets[0].subject.id, rejectionReason: undefined };
		await commitCatalogChange({
			subjects: [...newSubjects.map((t) => t.subject), ...publishing],
			touchSubjectIds: plan.targets.filter((t) => !t.isNew && !publishedIds.has(t.subject.id)).map((t) => t.subject.id),
			patterns: plan.patterns,
			patternUpdates: plan.adopt.map((id) => ({ id, patch: { sourcePatternId: sub.id } })),
			userPatterns: [{ id: sub.id, patch: userPatch }],
		});
		patchLocal(sub.id, userPatch);
	}

	// ─── Repair older approvals ─────────────────
	// Approvals made before every model/year/trim was published left the
	// community copy partial (e.g. only 2014 of 2014-2018). Find them all and
	// publish what's missing. Plans are built one after another against a
	// running picture of the catalog, so two submissions needing the same new
	// subject share it instead of creating it twice.
	const editsOf = (s: UserPattern): SubmissionEdits => ({
		name: s.name, widthInches: s.widthInches, heightInches: s.heightInches, coverage: s.coverage,
		notes: s.notes ?? "", make: s.make, models: s.models, years: s.years, trims: s.trims ?? [],
	});

	function repairPlans() {
		let vehicles = [...patternStore.vehicles];
		let patterns = allCatalogPatterns();
		const out: { sub: UserPattern; plan: ReturnType<typeof planPublish> }[] = [];
		for (const sub of submissions) {
			if (!(sub.status === "approved" || sub.isPublished)) continue;
			const e = editsOf(sub);
			const plan = planPublish({
				sub: { ...sub, ...e, notes: e.notes || undefined }, vehicles, patterns,
				mirrorOf: (z) => MIRROR_PAIRS[z], newId: uid,
			});
			if (plan.error || !plan.patterns.length) continue;
			out.push({ sub, plan });
			const day = today();
			vehicles = [
				...vehicles.map((v) => (plan.targets.some((t) => t.hidden && t.subject.id === v.id) ? { ...v, status: "published" as const, updatedAt: day } : v)),
				...plan.targets.filter((t) => t.isNew).map((t) => t.subject),
			];
			patterns = [...patterns.map((p) => (plan.adopt.includes(p.id) ? { ...p, sourcePatternId: sub.id } : p)), ...plan.patterns];
		}
		return out;
	}
	const repairCount = () => repairPlans().length;

	async function repairAll(): Promise<boolean> {
		const todo = repairPlans();
		if (!todo.length) { toastStore.info("Nothing to repair", "Every approval is fully published."); return false; }
		const patterns = todo.reduce((n, x) => n + x.plan.patterns.length, 0);
		const subjects = todo.reduce((n, x) => n + x.plan.targets.filter((t) => t.isNew).length, 0);
		const ok = await confirmStore.ask({
			title: `Finish publishing ${todo.length} older approval${todo.length === 1 ? "" : "s"}?`,
			message: "These were approved before every model, year and trim was published, so the community copy is partial. What's live stays as it is; this adds the missing ones and links everything to its submission. Each submission is saved as one all-or-nothing change.",
			details: [
				{ label: "Submissions", value: String(todo.length) },
				{ label: "Patterns added", value: String(patterns) },
				{ label: "New subjects (years/models/trims)", value: String(subjects) },
			],
			confirmLabel: "Publish the missing ones",
		});
		if (!ok || !(await ensureCatalog())) return false;
		return run("repair", "Repair stopped", async () => {
			let done = 0;
			try {
				for (const { sub, plan } of todo) {
					await commitPlan(sub, plan, true);
					done++;
				}
			} catch (err) {
				throw new Error(`${done} of ${todo.length} finished before an error: ${err instanceof Error ? err.message : "unknown"}. Run it again to continue.`);
			}
			toastStore.success("Repaired", `${patterns} pattern${patterns === 1 ? "" : "s"} published across ${todo.length} submission${todo.length === 1 ? "" : "s"}.`);
		});
	}

	async function reject(sub: UserPattern, reason: string): Promise<boolean> {
		const r = reason.trim();
		const ok = await confirmStore.ask({
			title: `Don't approve "${sub.name}"?`,
			message: r
				? "It goes back to the submitter as a private pattern, with your reason shown on it."
				: "It goes back to the submitter as a private pattern. No reason was given — they'll only see \"Not approved\".",
			details: r ? [{ label: "Reason shown to them", value: r }] : undefined,
			variant: "danger",
			confirmLabel: "Don't approve",
		});
		if (!ok) return false;
		return run("reject", "Reject failed", async () => {
			const patch = { status: "rejected" as const, submitToCommunity: false, rejectionReason: r || undefined };
			await adminUpdateUserPattern(sub.id, patch);
			patchLocal(sub.id, patch);
			toastStore.info("Not approved", "Returned to the submitter as private.");
		});
	}

	/** Put a decided submission back in the queue. */
	async function reopen(sub: UserPattern): Promise<boolean> {
		return run("reopen", "Couldn't reopen", async () => {
			const patch = { status: "pending" as const, submitToCommunity: true, rejectionReason: undefined };
			await adminUpdateUserPattern(sub.id, patch);
			patchLocal(sub.id, patch);
			toastStore.success("Back in the queue", sub.name);
		});
	}

	/** Take an approved submission back out of the public library. */
	async function revoke(sub: UserPattern): Promise<boolean> {
		const all = allCatalogPatterns();
		const plan = planRevoke(sub, all);
		const subjects = plan.subjectIds.map((id) => patternStore.vehicles.find((v) => v.id === id)).filter(Boolean) as VehicleEntry[];
		const emptied = subjects.filter((v) => patternStore.getPatterns(v.id).every((p) => plan.deleteIds.includes(p.id)));
		const ok = await confirmStore.ask({
			title: `Remove "${sub.name}" from the public library?`,
			message: plan.deleteIds.length
				? "Customers lose access to it immediately. The submitter's copy goes back to private — they keep it and can resubmit."
				: "No published copy was found in the catalog (it may already have been removed). The submitter's copy will just be returned to private.",
			details: [
				{ label: "Catalog patterns removed", value: String(plan.deleteIds.length) },
				...(emptied.length ? [{ label: "Subjects left empty", value: `${emptied.length} — delete them from Catalog if unwanted` }] : []),
			],
			variant: "danger",
			confirmLabel: "Remove from library",
		});
		if (!ok || !(await ensureCatalog())) return false;
		return run("revoke", "Revoke failed", async () => {
			await commitCatalogChange({ deletePatternIds: plan.deleteIds, userPatterns: [{ id: sub.id, patch: { ...RESET_TO_PRIVATE } }] });
			patchLocal(sub.id, { ...RESET_TO_PRIVATE });
			toastStore.success("Removed from the library", sub.name);
		});
	}

	async function saveSubmissionEdit(
		sub: UserPattern,
		form: { name: string; widthInches: number; heightInches: number; coverage: PatternCoverage; notes: string; adminNotes: string },
	): Promise<boolean> {
		const sizeErr = sizeError(form, sub.svgPath);
		if (sizeErr) { toastStore.error("Can't save", sizeErr); return false; }
		return run("save-submission", "Save failed", async () => {
			const patch: Partial<UserPattern> = {
				name: form.name.trim() || sub.name,
				svgPath: sub.svgPath,
				widthInches: form.widthInches,
				heightInches: form.heightInches,
				coverage: form.coverage,
				notes: form.notes.trim() || undefined,
				adminNotes: form.adminNotes.trim() || undefined,
			};
			await adminUpdateUserPattern(sub.id, patch);
			patchLocal(sub.id, patch);
			toastStore.success("Saved", "Submission updated.");
		});
	}

	async function deleteSubmission(sub: UserPattern): Promise<boolean> {
		const linked = sub.isPublished ? linkedPatterns(sub, allCatalogPatterns()).length : 0;
		const ok = await confirmStore.ask({
			title: `Delete "${sub.name}" for good?`,
			message: sub.isPublished
				? "This removes the submitter's copy. The published community version stays in the catalog unless you revoke it first."
				: "This removes the submitter's pattern. They can't get it back.",
			details: [
				{ label: "Submitted by", value: userLabel(sub.ownerId) },
				...(linked ? [{ label: "Published copies kept", value: String(linked) }] : []),
			],
			variant: "danger",
			confirmLabel: "Delete submission",
		});
		if (!ok) return false;
		return run("delete-submission", "Delete failed", async () => {
			await deleteUserPattern(sub.id);
			submissions = submissions.filter((s) => s.id !== sub.id);
			toastStore.success("Deleted", sub.name);
		});
	}

	// ─── Change requests ────────────────────────
	async function resolveChange(adj: PatternAdjustmentRequest, status: "approved" | "rejected", reply: string): Promise<boolean> {
		return run("resolve", "Couldn't resolve", async () => {
			await resolveAdjustmentRequest(adj.id, status, reply.trim() || undefined);
			adjustments = adjustments.map((a) => (a.id === adj.id ? { ...a, status, adminResponse: reply.trim() || undefined } : a));
			toastStore.success(status === "approved" ? "Marked done" : "Declined", "Change request resolved.");
		});
	}

	// ─── Catalog: subjects ──────────────────────
	async function saveSubject(form: SubjectForm, target: VehicleEntry | null): Promise<VehicleEntry | null> {
		const err = subjectFormError(form);
		if (err) { toastStore.error(target ? "Can't save" : "Can't add subject", err); return null; }
		const patch = subjectFromForm(form);

		if (!target) {
			const ok = await confirmStore.ask({
				title: `Add "${subjectName({ ...patch })}" to the catalog?`,
				message: patch.status === "published" ? "It's published, so customers will see it in the library right away — once it has a published pattern." : undefined,
				details: [
					{ label: "Type", value: projectTypeMeta(patch.projectType).label },
					{ label: "Status", value: patch.status },
					...(patch.tags.length ? [{ label: "Tags", value: patch.tags.join(", ") }] : []),
				],
				confirmLabel: "Add subject",
			});
			if (!ok || !(await ensureCatalog())) return null;
			let created: VehicleEntry | null = null;
			await run("add-subject", "Couldn't add subject", async () => {
				const v: VehicleEntry = { ...patch, id: uid("v_"), updatedAt: today() };
				await setVehicleDoc(v);
				created = v;
				toastStore.success("Subject added", subjectName(v));
			});
			return created;
		}

		const changes = diff(subjectRow(target), subjectRow(patch), SUBJECT_LABELS);
		if (!changes.length) { toastStore.info("No changes", "Nothing to save."); return target; }
		const unpublishing = target.status === "published" && patch.status !== "published";
		const ok = await confirmStore.ask({
			title: `Save changes to ${subjectName(target)}?`,
			message: unpublishing ? "This takes it out of the public library — customers won't see it until it's published again." : undefined,
			details: changes,
			variant: unpublishing ? "danger" : "primary",
			confirmLabel: "Save changes",
		});
		if (!ok || !(await ensureCatalog())) return null;
		let saved: VehicleEntry | null = null;
		await run("save-subject", "Couldn't save subject", async () => {
			await updateVehicleDoc(target.id, { ...patch, updatedAt: today() });
			saved = { ...target, ...patch };
			toastStore.success("Subject saved", subjectName(saved));
		});
		return saved;
	}

	/** What bulk-adding would do — recomputed live while the admin types. */
	const planBulk = (input: VehiclePlanInput) => planVehicles(input, patternStore.vehicles, uid, today());

	/**
	 * Add many vehicles at once (a make's models × a span of years × trims), as
	 * one all-or-nothing write. Published ones show to customers as "coming soon"
	 * until their first pattern goes live.
	 */
	async function addVehicles(input: VehiclePlanInput): Promise<VehicleEntry[] | null> {
		const plan = planBulk(input);
		if (plan.error) { toastStore.error("Can't add vehicles", plan.error); return null; }
		if (!plan.create.length) { toastStore.info("Nothing new", "Every one of those is already in the catalog."); return null; }
		const models = new Set(plan.create.map((v) => v.model)).size;
		const ok = await confirmStore.ask({
			title: `Add ${plan.create.length} vehicle${plan.create.length === 1 ? "" : "s"} to the catalog?`,
			message: input.status === "published"
				? "They're published, so customers see them as \"Coming soon\" until you add a pattern — and can vote for them."
				: "They're saved as " + input.status + " — customers won't see them until they're published.",
			details: [
				{ label: "Make", value: plan.create[0].make ?? input.make },
				{ label: "Models", value: String(models) },
				{ label: "Subjects created", value: String(plan.create.length) },
				...(plan.skipped ? [{ label: "Already in the catalog", value: String(plan.skipped) }] : []),
			],
			confirmLabel: "Add vehicles",
		});
		if (!ok || !(await ensureCatalog())) return null;
		let created: VehicleEntry[] | null = null;
		await run("add-vehicles", "Couldn't add vehicles", async () => {
			await commitCatalogChange({ subjects: plan.create });
			created = plan.create;
			toastStore.success("Vehicles added", `${plan.create.length} subject${plan.create.length === 1 ? "" : "s"} created.`);
		});
		return created;
	}

	async function deleteSubject(v: VehicleEntry): Promise<boolean> {
		const pats = patternStore.getPatterns(v.id);
		const resets = ownersToReset(pats, allCatalogPatterns().filter((p) => p.vehicleId !== v.id), submissions);
		const ok = await confirmStore.ask({
			title: `Delete ${subjectName(v)}?`,
			message: "This can't be undone. The subject and all of its patterns are removed from the catalog and the customer library.",
			details: [
				{ label: "Patterns deleted", value: String(pats.length) },
				{ label: "Published patterns", value: String(pats.filter((p) => p.isPublished).length) },
				...(resets.length ? [{ label: "Submitters' copies returned to private", value: String(resets.length) }] : []),
			],
			variant: "danger",
			confirmLabel: "Delete subject",
		});
		if (!ok || !(await ensureCatalog())) return false;
		return run("delete-subject", "Couldn't delete subject", async () => {
			await commitCatalogChange({
				deletePatternIds: pats.map((p) => p.id),
				deleteSubjectIds: [v.id],
				userPatterns: resets.map((s) => ({ id: s.id, patch: { ...RESET_TO_PRIVATE } })),
			});
			for (const s of resets) patchLocal(s.id, { ...RESET_TO_PRIVATE });
			toastStore.success("Subject deleted", subjectName(v));
		});
	}

	// ─── Catalog: patterns ──────────────────────
	async function savePattern(
		subject: VehicleEntry, category: PatternCategory, form: PatternForm, target: Pattern | null,
	): Promise<boolean> {
		const err = patternFormError(form);
		if (err) { toastStore.error(target ? "Can't save" : "Can't add pattern", err); return false; }
		const common = {
			zone: form.zone,
			customZoneLabel: form.zone === "custom" ? form.customZoneLabel.trim() || undefined : undefined,
			name: form.name.trim(),
			coverage: form.coverage,
			svgPath: form.svgPath.trim(),
			svgUrl: form.svgUrl.trim() || undefined,
			widthInches: Number(form.widthInches),
			heightInches: Number(form.heightInches),
			notes: form.notes.trim() || undefined,
			isPublished: form.isPublished,
		};

		if (!target) {
			const ok = await confirmStore.ask({
				title: `Add "${common.name}" to ${subjectName(subject)}?`,
				message: common.isPublished
					? "It's set to publish immediately — customers will be able to cut it right away."
					: "It's saved as a draft; customers won't see it until it's published.",
				details: [
					{ label: "Category", value: category },
					{ label: "Zone", value: zoneLabel(category, common.zone, common.customZoneLabel, subject.projectType) },
					{ label: "Size", value: `${formatMeasure(common.widthInches)}" × ${formatMeasure(common.heightInches)}"` },
					{ label: "Coverage", value: common.coverage },
				],
				confirmLabel: "Add pattern",
			});
			if (!ok || !(await ensureCatalog())) return false;
			return run("add-pattern", "Couldn't add pattern", async () => {
				const now = new Date();
				const p: Pattern = {
					...common, id: uid("pat_"), vehicleId: subject.id, category, projectType: subject.projectType ?? "vehicle",
					revision: form.revision.trim() || now.toISOString().slice(0, 7), createdAt: now, updatedAt: now,
				};
				await setPatternDoc(p);
				await updateVehicleDoc(subject.id, { updatedAt: today() });
				toastStore.success("Pattern added", p.name);
			});
		}

		const patch: Partial<Pattern> = { ...common, revision: form.revision.trim() || target.revision };
		const row = (p: Partial<Pattern>) => ({ ...p, svgPath: undefined, isPublished: p.isPublished ? "Yes" : "No" });
		const changes = diff(row(target), row({ ...target, ...patch }), PATTERN_LABELS);
		if (patch.svgPath !== target.svgPath) {
			changes.push({ label: "Outline", value: `replaced (${target.svgPath.length.toLocaleString()} → ${patch.svgPath!.length.toLocaleString()} chars)` });
		}
		if (!changes.length) { toastStore.info("No changes", "Nothing to save."); return true; }
		const ok = await confirmStore.ask({
			title: `Save changes to "${target.name}"?`,
			message: target.isPublished || patch.isPublished ? "This pattern is (or will be) live — customers cut from it, so double-check sizes and the outline." : undefined,
			details: changes,
			confirmLabel: "Save changes",
		});
		if (!ok || !(await ensureCatalog())) return false;
		return run("save-pattern", "Couldn't save pattern", async () => {
			await updatePatternDoc(target.id, patch);
			toastStore.success("Pattern saved", patch.name ?? target.name);
		});
	}

	async function togglePublished(p: Pattern): Promise<boolean> {
		const next = !p.isPublished;
		// A submitter's copy only says "In community" while something is published.
		const stillLive = allCatalogPatterns().filter((x) => x.id !== p.id && x.isPublished);
		const resets = next ? [] : ownersToReset([p], stillLive, submissions);
		const ok = await confirmStore.ask({
			title: `${next ? "Publish" : "Unpublish"} "${p.name}"?`,
			message: next
				? "Customers will see it in the library and be able to cut it."
				: "It disappears from the customer library until it's published again.",
			details: resets.length ? [{ label: "Submitter's copy", value: "returned to private" }] : undefined,
			variant: next ? "primary" : "danger",
			confirmLabel: next ? "Publish" : "Unpublish",
		});
		if (!ok || !(await ensureCatalog())) return false;
		return run("toggle-publish", "Couldn't update pattern", async () => {
			await commitCatalogChange({
				patternUpdates: [{ id: p.id, patch: { isPublished: next } }],
				userPatterns: resets.map((s) => ({ id: s.id, patch: { ...RESET_TO_PRIVATE } })),
			});
			for (const s of resets) patchLocal(s.id, { ...RESET_TO_PRIVATE });
			toastStore.success(next ? "Published" : "Unpublished", p.name);
		});
	}

	async function deletePattern(p: Pattern): Promise<boolean> {
		const remaining = allCatalogPatterns().filter((x) => x.id !== p.id);
		const resets = ownersToReset([p], remaining, submissions);
		const ok = await confirmStore.ask({
			title: `Delete "${p.name}"?`,
			message: p.isPublished
				? "This can't be undone. It's published — customers lose access to it immediately."
				: "This can't be undone.",
			details: [
				{ label: "Size", value: `${formatMeasure(p.widthInches)}" × ${formatMeasure(p.heightInches)}"` },
				...(resets.length ? [{ label: "Submitter's copy", value: "returned to private" }] : []),
			],
			variant: "danger",
			confirmLabel: "Delete pattern",
		});
		if (!ok || !(await ensureCatalog())) return false;
		return run("delete-pattern", "Couldn't delete pattern", async () => {
			await commitCatalogChange({
				deletePatternIds: [p.id],
				userPatterns: resets.map((s) => ({ id: s.id, patch: { ...RESET_TO_PRIVATE } })),
			});
			for (const s of resets) patchLocal(s.id, { ...RESET_TO_PRIVATE });
			toastStore.success("Pattern deleted", p.name);
		});
	}

	// ─── Pattern requests ───────────────────────
	async function setRequestStatus(id: string, status: RequestStatus): Promise<boolean> {
		return run("request-status", "Couldn't update request", async () => {
			await setDemandStatus(id, status);
		});
	}

	return {
		get submissions() { return submissions; },
		get adjustments() { return adjustments; },
		get usersById() { return usersById; },
		get queueLoading() { return queueLoading; },
		get queueError() { return queueError; },
		get adjustmentsLoading() { return adjustmentsLoading; },
		get filterUser() { return filterUser; },
		set filterUser(v: string | null) { filterUser = v; },
		get seeding() { return seeding; },
		get busy() { return busy; },
		loadQueue, loadAdjustments, loadUsers, loadAll,
		userLabel, matchesUser,
		allCatalogPatterns, zoneLabel, ensureCatalog,
		planFor, approve, repairCount, repairAll, reject, reopen, revoke, saveSubmissionEdit, deleteSubmission,
		resolveChange,
		saveSubject, planBulk, addVehicles, deleteSubject, savePattern, togglePublished, deletePattern,
		setRequestStatus,
	};
}

export const adminPatterns = createAdminPatterns();
