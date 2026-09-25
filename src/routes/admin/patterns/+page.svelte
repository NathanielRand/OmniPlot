<script lang="ts">
	import { onMount } from "svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import {
		patternStore,
		PATTERN_CATEGORIES,
		zonesForCategory,
		zonesFor,
		zoneLabel as storeZoneLabel,
		categoryShortLabel,
		categoryLabel,
		categoryMeta,
		type VehicleEntry,
		type PatternStatus,
	} from "$lib/stores/patternStore.svelte";
	import {
		getSubmissions,
		adminUpdateUserPattern,
		deleteUserPattern,
		getAdjustmentRequests,
		resolveAdjustmentRequest,
	} from "$lib/firebase/firestore";
	import { toastStore, confirmStore } from "$lib/stores";
	import { auth } from "$lib/firebase/client";
	import { tooltip } from "$lib/actions/tooltip";
	import { fitPattern } from "$lib/actions/fitPattern";
	import PatternPreview from "$lib/components/ui/PatternPreview.svelte";
	import type { Pattern, PatternCategory, PatternCoverage, PatternZone, ProjectType, UserPattern, UserPatternStatus, PatternAdjustmentRequest } from "$lib/types";

	// ─── Project types ────────────────────────────
	const PROJECT_TYPES: { value: ProjectType; label: string; icon: string }[] = [
		{ value: "vehicle",     label: "Vehicle",     icon: "M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v5M14 17a3 3 0 100 6 3 3 0 000-6zM8 17a3 3 0 100 6 3 3 0 000-6z" },
		{ value: "residential", label: "Residential", icon: "M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z" },
		{ value: "commercial",  label: "Commercial",  icon: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" },
		{ value: "custom",      label: "Custom",      icon: "M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" },
	];
	const projectTypeMeta = (t: ProjectType | undefined) =>
		PROJECT_TYPES.find((p) => p.value === (t ?? "vehicle")) ?? PROJECT_TYPES[0];

	/** Human label for a zone, honouring the custom label a "custom" zone carries. */
	const zoneLabel = (category: PatternCategory, zone: PatternZone, customLabel?: string, projectType?: ProjectType) =>
		storeZoneLabel(zone, category, projectType, customLabel);

	const fmtDateTime = (d: Date | null | undefined) =>
		d && !isNaN(d.getTime()) ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";

	// ─── Users ────────────────────────────────────
	// Every section below keys its rows by uid; this resolves them to people.
	type AdminUserLite = { uid: string; displayName: string; email: string; tier: string };
	let usersById = $state<Record<string, AdminUserLite>>({});

	async function loadUsers() {
		try {
			const token = await auth.currentUser?.getIdToken();
			const res   = await fetch("/api/admin/users", {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (!res.ok) throw new Error();
			const data = await res.json();
			usersById = Object.fromEntries((data.users as AdminUserLite[]).map((u) => [u.uid, u]));
		} catch { toastStore.error("Load failed", "Could not fetch users."); }
	}

	// Narrows every section to one person's pattern activity.
	let filterUser = $state<string | null>(null);
	const matchesUser = (uid: string | undefined) => !filterUser || uid === filterUser;

	function userLabel(uid: string): string {
		const u = usersById[uid];
		return u?.displayName || u?.email || `${uid.slice(0, 10)}…`;
	}

	// ─── Catalog source ───────────────────────────
	// Until the catalog is in Firestore, the app runs on the built-in seed, and
	// the first write would make Firestore the source with only that one doc
	// in it. So the first edit copies the whole catalog in (create-only) and
	// only then applies the change. Asked once; returns false if cancelled.
	let seeding = $state(false);

	async function waitForFirestoreCatalog(timeoutMs = 10_000): Promise<boolean> {
		const start = Date.now();
		while (patternStore.usingSeed && Date.now() - start < timeoutMs) {
			await new Promise((r) => setTimeout(r, 150));
		}
		return !patternStore.usingSeed;
	}

	async function ensureCatalog(): Promise<boolean> {
		if (!patternStore.usingSeed) return true;
		if (patternStore.catalogError) {
			toastStore.error("Catalog unavailable", "Couldn't reach the catalog in Firestore — refresh and try again.");
			return false;
		}
		const subjects = patternStore.vehicles.length;
		const patterns = patternStore.vehicles.reduce((n, v) => n + patternStore.getPatterns(v.id).length, 0);
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
		} finally {
			seeding = false;
		}
	}

	// ─── Vehicles filter state ────────────────────
	let search         = $state("");
	let filterStatus   = $state<"all" | PatternStatus>("all");
	let filterCategory = $state<"both" | PatternCategory>("both");
	let filterProjectType = $state<"all" | ProjectType>("all");

	// Counts for the secondary filters, scoped to the chosen subject type.
	const subjectsOfType = $derived(
		patternStore.vehicles.filter((v) => filterProjectType === "all" || (v.projectType ?? "vehicle") === filterProjectType),
	);
	const categoryCounts = $derived(
		subjectsOfType.reduce((acc, v) => {
			for (const p of patternStore.getPatterns(v.id)) acc[p.category] = (acc[p.category] ?? 0) + 1;
			return acc;
		}, {} as Record<string, number>),
	);
	const statusCounts = $derived(
		subjectsOfType.reduce((acc, v) => { acc[v.status] = (acc[v.status] ?? 0) + 1; return acc; }, {} as Record<string, number>),
	);

	const projectTypeCounts = $derived(
		patternStore.vehicles.reduce((acc, v) => {
			const t = v.projectType ?? "vehicle";
			acc[t] = (acc[t] ?? 0) + 1;
			return acc;
		}, {} as Record<string, number>),
	);

	function subjectName(v: VehicleEntry): string {
		if ((v.projectType ?? "vehicle") !== "vehicle") {
			return v.propertyLabel || v.model || v.address || "Untitled";
		}
		return `${v.year} ${v.make} ${v.model}`;
	}

	const filteredVehicles = $derived(
		patternStore.vehicles
			.filter((v) => {
				const q = search.toLowerCase();
				const mq = !q ||
					`${v.make ?? ""} ${v.model ?? ""} ${v.year ?? ""} ${v.propertyLabel ?? ""} ${v.address ?? ""}`
						.toLowerCase().includes(q);
				const ms = filterStatus === "all" || v.status === filterStatus;
				const mu = !filterUser || subjectContributors(v.id, v.contributedBy).includes(filterUser);
				const mt = filterProjectType === "all" || (v.projectType ?? "vehicle") === filterProjectType;
				return mq && ms && mu && mt;
			})
			.map((v) => {
				const allPats = patternStore.getPatterns(v.id);
				const shown = filterCategory === "both" ? allPats : allPats.filter((p) => p.category === filterCategory);
				return {
					...v,
					patterns:  shown.length,
					published: shown.filter((p) => p.isPublished).length,
				};
			}),
	);

	const totals = $derived({
		vehicles: patternStore.vehicles.length,
		patterns: patternStore.vehicles.reduce((s, v) => s + patternStore.getPatterns(v.id).length, 0),
		published:patternStore.vehicles.reduce((s, v) => s + patternStore.getPatterns(v.id).filter((p) => p.isPublished).length, 0),
		drafts:       patternStore.vehicles.filter((v) => v.status === "draft" || v.status === "review").length,
	});

	// ─── Community Submissions ────────────────────
	let submissions        = $state<UserPattern[]>([]);
	let submissionsLoading = $state(false);
	let reviewTarget       = $state<UserPattern | null>(null);

	// Editable fields while reviewing
	let reviewEdits = $state({ name: "", widthInches: 0, heightInches: 0, notes: "" });
	// Shown to the submitter on their "Not approved" pattern.
	let rejectReason = $state("");
	let reviewWorking = $state(false);

	async function loadSubmissions() {
		submissionsLoading = true;
		try {
			submissions = await getSubmissions();
		} catch { toastStore.error("Load failed", "Could not fetch submissions."); }
		finally { submissionsLoading = false; }
	}

	function submissionSubjectLabel(sub: UserPattern): string {
		if ((sub.projectType ?? "vehicle") !== "vehicle") {
			return sub.propertyLabel || sub.patternName || sub.name;
		}
		return `${sub.years.join("/")} ${sub.make} ${sub.models.join(", ")}`;
	}

	function submissionZoneLabels(sub: UserPattern): string {
		return sub.zones.map((z, i) => zoneLabel(sub.category, z, sub.customZoneLabels?.[i], sub.projectType)).join(", ");
	}

	function openReview(sub: UserPattern) {
		reviewTarget = sub;
		reviewEdits = { name: sub.name, widthInches: sub.widthInches, heightInches: sub.heightInches, notes: sub.notes ?? "" };
		rejectReason = "";
	}

	async function approveSubmission() {
		if (!reviewTarget) return;
		const ok = await confirmStore.ask({
			title: `Publish "${reviewEdits.name.trim() || reviewTarget.name}" to the public library?`,
			message: "Customers will be able to cut it right away. The submitter's copy is locked as approved.",
			details: [
				{ label: "Subject", value: submissionSubjectLabel(reviewTarget) },
				{ label: "Size", value: `${reviewEdits.widthInches}" × ${reviewEdits.heightInches}"` },
				{ label: "Submitted by", value: userLabel(reviewTarget.ownerId) },
			],
			confirmLabel: "Approve & publish",
		});
		if (!ok || !(await ensureCatalog())) return;
		reviewWorking = true;
		try {
			const sub = { ...reviewTarget, ...reviewEdits };

			// Find or create the subject (vehicle or property/custom project)
			let vehicleId = sub.vehicleId;
			if (!vehicleId) {
				const projectType = sub.projectType ?? "vehicle";
				if (projectType === "vehicle") {
					// A submission can carry multiple models/years; the vehicle
					// catalog wants one of each, so use the first as representative.
					const subModel = sub.models[0] ?? "";
					const subYear  = Number(sub.years[0]) || new Date().getFullYear();
					const existing = patternStore.vehicles.find(
						(v) => (v.projectType ?? "vehicle") === "vehicle" &&
						       (v.make ?? "").toLowerCase() === sub.make.toLowerCase() &&
						       (v.model ?? "").toLowerCase() === subModel.toLowerCase() &&
						       v.year === subYear,
					);
					vehicleId = existing
						? existing.id
						: patternStore.addVehicle({
								projectType: "vehicle",
								make: sub.make, model: subModel, year: subYear,
								bodyStyle: sub.bodyStyle, status: "published",
								tags: [], updatedAt: new Date().toISOString().split("T")[0],
								contributedBy: sub.ownerId || undefined,
							}).id;
				} else {
					const label = sub.propertyLabel || sub.patternName || sub.name;
					const existing = patternStore.vehicles.find(
						(v) => (v.projectType ?? "vehicle") === projectType &&
						       (v.propertyLabel ?? "").toLowerCase() === label.toLowerCase(),
					);
					vehicleId = existing
						? existing.id
						: patternStore.addVehicle({
								projectType,
								propertyLabel: label,
								address: sub.address,
								status: "published",
								tags: [], updatedAt: new Date().toISOString().split("T")[0],
								contributedBy: sub.ownerId || undefined,
							}).id;
				}
			}

			// Publish to public patterns collection
			patternStore.addPattern({
				vehicleId,
				category:     sub.category,
				zone:         sub.zones[0],
				name:         reviewEdits.name.trim() || sub.name,
				coverage:     sub.coverage,
				svgPath:      sub.svgPath,
				widthInches:  reviewEdits.widthInches,
				heightInches: reviewEdits.heightInches,
				revision:     new Date().toISOString().slice(0, 7),
				notes:        reviewEdits.notes.trim() || undefined,
				isPublished:  true,
			});

			// Lock the user's copy
			// vehicleId ties the submitter to the subject for the Contributors column.
			await adminUpdateUserPattern(reviewTarget.id, { isPublished: true, status: "approved", vehicleId, rejectionReason: undefined });

			submissions = submissions.map((s) =>
				s.id === reviewTarget!.id ? { ...s, isPublished: true, status: "approved", vehicleId } : s,
			);
			toastStore.success("Approved", `${sub.name} is now in the public library.`);
			reviewTarget = null;
		} catch (err) {
			console.error(err);
			toastStore.error("Approve failed", "Could not approve submission.");
		} finally { reviewWorking = false; }
	}

	async function rejectSubmission() {
		if (!reviewTarget) return;
		const reason = rejectReason.trim();
		const ok = await confirmStore.ask({
			title: `Don't approve "${reviewTarget.name}"?`,
			message: reason
				? "It goes back to the submitter as a private pattern, with your reason shown on it."
				: "It goes back to the submitter as a private pattern. No reason was given — they'll only see \"Not approved\".",
			details: reason ? [{ label: "Reason shown to them", value: reason }] : undefined,
			variant: "danger",
			confirmLabel: "Don't approve",
		});
		if (!ok) return;
		reviewWorking = true;
		try {
			const patch = { status: "rejected" as const, submitToCommunity: false, rejectionReason: reason || undefined };
			await adminUpdateUserPattern(reviewTarget.id, patch);
			submissions = submissions.map((s) =>
				s.id === reviewTarget!.id ? { ...s, ...patch } : s,
			);
			toastStore.info("Rejected", "Submission returned to user as private.");
			reviewTarget = null;
		} catch { toastStore.error("Reject failed", "Could not reject submission."); }
		finally { reviewWorking = false; }
	}

	const pendingSubmissions = $derived(submissions.filter((s) => s.status === "pending"));
	const shownSubmissions   = $derived(submissions.filter((s) => matchesUser(s.ownerId)));

	// Community members behind a catalog subject: whoever's approved
	// submission created it, plus everyone whose approved pattern links to it.
	function subjectContributors(vehicleId: string, contributedBy?: string): string[] {
		const ids = new Set<string>();
		if (contributedBy) ids.add(contributedBy);
		for (const s of submissions) {
			if (s.status === "approved" && s.vehicleId === vehicleId && s.ownerId) ids.add(s.ownerId);
		}
		return [...ids];
	}

	// ─── Delete submission ────────────────────────
	let pendingDeleteSubId = $state<string | null>(null);
	let deleteSubWorking  = $state(false);

	async function confirmDeleteSubmission(id: string) {
		deleteSubWorking = true;
		try {
			await deleteUserPattern(id);
			submissions = submissions.filter((s) => s.id !== id);
			toastStore.success("Deleted", "Submission removed.");
		} catch { toastStore.error("Delete failed", "Could not delete submission."); }
		finally { deleteSubWorking = false; pendingDeleteSubId = null; }
	}

	// ─── Edit submission ─────────────────────────
	let editSubTarget  = $state<UserPattern | null>(null);
	let editSubForm    = $state({
		name: "", widthInches: 0, heightInches: 0,
		coverage: "full" as PatternCoverage,
		zones: [] as PatternZone[],
		notes: "", adminNotes: "",
		status: "pending" as UserPatternStatus,
		isPublished: false,
	});
	let editSubWorking = $state(false);

	function openEditSub(sub: UserPattern) {
		editSubTarget = sub;
		editSubForm = {
			name:         sub.name,
			widthInches:  sub.widthInches,
			heightInches: sub.heightInches,
			coverage:     sub.coverage,
			zones:        [...sub.zones],
			notes:        sub.notes ?? "",
			adminNotes:   sub.adminNotes ?? "",
			status:       sub.status,
			isPublished:  sub.isPublished,
		};
	}

	async function saveEditSub() {
		if (!editSubTarget) return;
		editSubWorking = true;
		try {
			const patch: Partial<UserPattern> = {
				name:         editSubForm.name.trim() || editSubTarget.name,
				widthInches:  editSubForm.widthInches,
				heightInches: editSubForm.heightInches,
				coverage:     editSubForm.coverage,
				zones:        editSubForm.zones,
				notes:        editSubForm.notes.trim() || undefined,
				adminNotes:   editSubForm.adminNotes.trim() || undefined,
				status:       editSubForm.status,
				isPublished:  editSubForm.isPublished,
			};
			await adminUpdateUserPattern(editSubTarget.id, patch);
			submissions = submissions.map((s) =>
				s.id === editSubTarget!.id ? { ...s, ...patch } : s,
			);
			toastStore.success("Saved", "Submission updated.");
			editSubTarget = null;
		} catch { toastStore.error("Save failed", "Could not update submission."); }
		finally { editSubWorking = false; }
	}

	// ─── Adjustment Requests ──────────────────────
	let adjustments        = $state<PatternAdjustmentRequest[]>([]);
	let adjustmentsLoading = $state(false);
	let resolveTarget      = $state<PatternAdjustmentRequest | null>(null);
	let resolveNotes       = $state("");
	let resolveWorking     = $state(false);

	async function loadAdjustments() {
		adjustmentsLoading = true;
		try {
			adjustments = await getAdjustmentRequests();
		} catch { toastStore.error("Load failed", "Could not fetch adjustment requests."); }
		finally { adjustmentsLoading = false; }
	}

	async function handleResolve(status: "approved" | "rejected") {
		if (!resolveTarget) return;
		resolveWorking = true;
		try {
			await resolveAdjustmentRequest(resolveTarget.id, status, resolveNotes.trim() || undefined);
			adjustments = adjustments.map((a) =>
				a.id === resolveTarget!.id ? { ...a, status, adminResponse: resolveNotes.trim() || undefined } : a,
			);
			toastStore.success(status === "approved" ? "Approved" : "Rejected", "Adjustment request resolved.");
			resolveTarget = null;
			resolveNotes = "";
		} catch { toastStore.error("Failed", "Could not resolve request."); }
		finally { resolveWorking = false; }
	}

	const pendingAdjustments = $derived(adjustments.filter((a) => a.status === "pending"));
	const shownAdjustments   = $derived(adjustments.filter((a) => matchesUser(a.requestedBy)));
	const submissionsById    = $derived(Object.fromEntries(submissions.map((s) => [s.id, s])));

	const shownRequests = $derived(patternStore.requests.filter((r) => matchesUser(r.requestedBy)));

	// Everyone with any pattern activity, for the user filter.
	const activeUsers = $derived.by(() => {
		const ids = new Set<string>();
		for (const s of submissions) if (s.ownerId) ids.add(s.ownerId);
		for (const a of adjustments) if (a.requestedBy) ids.add(a.requestedBy);
		for (const r of patternStore.requests) if (r.requestedBy) ids.add(r.requestedBy);
		for (const v of patternStore.vehicles) if (v.contributedBy) ids.add(v.contributedBy);
		return [...ids].sort((a, b) => userLabel(a).localeCompare(userLabel(b)));
	});

	// ─── Change confirmations ─────────────────────
	// Every catalog change is confirmed with exactly what will change.
	type Change = { label: string; value: string };
	const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));
	function diff(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): Change[] {
		return Object.keys(labels)
			.filter((k) => show(before[k]) !== show(after[k]))
			.map((k) => ({ label: labels[k], value: `${show(before[k])} → ${show(after[k])}` }));
	}

	// ─── Add subject ──────────────────────────────
	let showAddModal = $state(false);
	const blankSubject = () => ({
		projectType: "vehicle" as NonNullable<VehicleEntry["projectType"]>,
		year: new Date().getFullYear(), make: "", model: "",
		bodyStyle: "sedan" as NonNullable<VehicleEntry["bodyStyle"]>,
		address: "", propertyLabel: "",
		status: "draft" as PatternStatus,
		tags: "", popular: false,
	});
	let newVehicle = $state(blankSubject());

	const parseTags = (s: string) => [...new Set(s.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];

	/** The subject fields a form produces, shaped for the store. */
	function subjectFromForm(f: ReturnType<typeof blankSubject>): Omit<VehicleEntry, "id" | "updatedAt"> {
		const isVehicle = f.projectType === "vehicle";
		return {
			projectType: f.projectType,
			make: isVehicle ? f.make.trim() : undefined,
			model: isVehicle ? f.model.trim() : (f.model.trim() || undefined),
			year: isVehicle ? Number(f.year) : undefined,
			bodyStyle: isVehicle ? f.bodyStyle : undefined,
			address: isVehicle ? undefined : f.address.trim() || undefined,
			propertyLabel: isVehicle ? undefined : f.propertyLabel.trim() || undefined,
			status: f.status,
			tags: parseTags(f.tags),
			popular: f.popular,
		};
	}

	function subjectFormError(f: ReturnType<typeof blankSubject>): string | null {
		if (f.projectType === "vehicle") {
			if (!f.make.trim() || !f.model.trim()) return "Make and model are required.";
			if (!Number(f.year)) return "Enter a year.";
		} else if (!f.propertyLabel.trim() && !f.model.trim()) {
			return f.projectType === "custom" ? "Enter a project name." : "Enter a property label.";
		}
		return null;
	}

	const SUBJECT_LABELS: Record<string, string> = {
		projectType: "Type", year: "Year", make: "Make", model: "Model", bodyStyle: "Body style",
		propertyLabel: "Label", address: "Address", status: "Status", tags: "Tags", popular: "Popular",
	};
	const subjectRow = (v: Partial<VehicleEntry>) => ({ ...v, projectType: v.projectType ?? "vehicle", tags: (v.tags ?? []).join(", "), popular: v.popular ? "Yes" : "No" });

	async function handleAddVehicle() {
		const err = subjectFormError(newVehicle);
		if (err) { toastStore.error("Can't add subject", err); return; }
		const entry = subjectFromForm(newVehicle);
		const ok = await confirmStore.ask({
			title: `Add "${subjectName({ ...entry, id: "", updatedAt: "" })}" to the catalog?`,
			message: entry.status === "published" ? "It's published, so customers will see it in the library right away." : undefined,
			details: [
				{ label: "Type", value: projectTypeMeta(entry.projectType).label },
				{ label: "Status", value: entry.status },
				...(entry.tags.length ? [{ label: "Tags", value: entry.tags.join(", ") }] : []),
			],
			confirmLabel: "Add subject",
		});
		if (!ok || !(await ensureCatalog())) return;
		const v = patternStore.addVehicle({ ...entry, updatedAt: new Date().toISOString().split("T")[0] });
		toastStore.success("Subject added", subjectName(v));
		showAddModal = false;
		newVehicle = blankSubject();
	}

	// ─── Edit subject ─────────────────────────────
	let editVehicleTarget = $state<VehicleEntry | null>(null);
	let editVehicleForm = $state(blankSubject());

	function openEditVehicle(v: VehicleEntry) {
		editVehicleTarget = v;
		editVehicleForm = {
			projectType: v.projectType ?? "vehicle",
			year: v.year ?? new Date().getFullYear(),
			make: v.make ?? "",
			model: v.model ?? "",
			bodyStyle: v.bodyStyle ?? "sedan",
			address: v.address ?? "",
			propertyLabel: v.propertyLabel ?? "",
			status: v.status,
			tags: (v.tags ?? []).join(", "),
			popular: !!v.popular,
		};
	}

	async function saveEditVehicle() {
		const target = editVehicleTarget;
		if (!target) return;
		const err = subjectFormError(editVehicleForm);
		if (err) { toastStore.error("Can't save", err); return; }
		const patch = subjectFromForm(editVehicleForm);
		const changes = diff(subjectRow(target), subjectRow(patch), SUBJECT_LABELS);
		if (!changes.length) { toastStore.info("No changes", "Nothing to save."); editVehicleTarget = null; return; }
		const unpublishing = target.status === "published" && patch.status !== "published";
		const ok = await confirmStore.ask({
			title: `Save changes to ${subjectName(target)}?`,
			message: unpublishing ? "This takes it out of the public library — customers won't see it until it's published again." : undefined,
			details: changes,
			variant: unpublishing ? "danger" : "primary",
			confirmLabel: "Save changes",
		});
		if (!ok || !(await ensureCatalog())) return;
		patternStore.updateVehicle(target.id, { ...patch, updatedAt: new Date().toISOString().split("T")[0] });
		toastStore.success("Subject saved", subjectName({ ...target, ...patch }));
		editVehicleTarget = null;
	}

	// ─── Delete subject ───────────────────────────
	async function confirmDeleteVehicle(v: VehicleEntry) {
		const pats = patternStore.getPatterns(v.id);
		const linked = submissions.filter((s) => s.vehicleId === v.id).length;
		const ok = await confirmStore.ask({
			title: `Delete ${subjectName(v)}?`,
			message: "This can't be undone. The subject and all of its patterns are removed from the catalog and the customer library.",
			details: [
				{ label: "Patterns deleted", value: String(pats.length) },
				{ label: "Published patterns", value: String(pats.filter((p) => p.isPublished).length) },
				...(linked ? [{ label: "Community submissions linked", value: `${linked} (kept, unlinked)` }] : []),
			],
			variant: "danger",
			confirmLabel: "Delete subject",
		});
		if (!ok || !(await ensureCatalog())) return;
		patternStore.deleteVehicle(v.id);
		if (editingVehicle?.id === v.id) closeEditPanel();
		if (detail?.kind === "subject" && detail.id === v.id) closeDetail();
		toastStore.success("Subject deleted", subjectName(v));
	}

	// ─── Edit Patterns panel ──────────────────────
	let editingVehicle  = $state<VehicleEntry | null>(null);
	let editPanelTab    = $state<PatternCategory>("window-tint");
	let showAddPattern  = $state(false);
	let editPatternId   = $state<string | null>(null);

	const blankPattern = (zone: PatternZone = "custom") => ({
		zone, customZoneLabel: "", name: "", coverage: "full" as PatternCoverage,
		widthInches: 24, heightInches: 16, svgPath: "", svgUrl: "", notes: "", isPublished: false,
	});
	let newPattern = $state(blankPattern());
	let editPatch = $state({
		name: "", zone: "custom" as PatternZone, customZoneLabel: "", coverage: "full" as PatternCoverage,
		widthInches: 0, heightInches: 0, svgPath: "", svgUrl: "", revision: "", notes: "", isPublished: false,
	});

	function openEditPanel(v: VehicleEntry) {
		editingVehicle = v; editPanelTab = "window-tint";
		showAddPattern = false; editPatternId = null;
		newPattern = blankPattern(zonesFor("window-tint", v.projectType)[0]?.value ?? "custom");
	}
	function closeEditPanel() { editingVehicle = null; showAddPattern = false; editPatternId = null; }

	const panelPatterns = $derived(
		editingVehicle ? patternStore.getPatterns(editingVehicle.id, editPanelTab) : [],
	);
	const zoneOptions = $derived(zonesFor(editPanelTab, editingVehicle?.projectType));

	function patternFormError(p: { name: string; zone: PatternZone; customZoneLabel: string; widthInches: number; heightInches: number; svgPath: string }): string | null {
		if (!p.name.trim()) return "Give the pattern a name.";
		if (p.zone === "custom" && !p.customZoneLabel.trim()) return "Name the custom zone.";
		if (!(Number(p.widthInches) > 0) || !(Number(p.heightInches) > 0)) return "Width and height must be greater than 0.";
		// No placeholder shape — a pattern without a real outline would cut garbage.
		if (!p.svgPath.trim()) return "Paste the pattern's SVG path.";
		return null;
	}

	async function handleAddPattern() {
		const v = editingVehicle;
		if (!v) return;
		const err = patternFormError(newPattern);
		if (err) { toastStore.error("Can't add pattern", err); return; }
		const ok = await confirmStore.ask({
			title: `Add "${newPattern.name.trim()}" to ${subjectName(v)}?`,
			message: newPattern.isPublished ? "It's set to publish immediately — customers will be able to cut it right away." : "It's saved as a draft; customers won't see it until it's published.",
			details: [
				{ label: "Category", value: categoryLabel(editPanelTab) },
				{ label: "Zone", value: zoneLabel(editPanelTab, newPattern.zone, newPattern.customZoneLabel, v.projectType) },
				{ label: "Size", value: `${newPattern.widthInches}" × ${newPattern.heightInches}"` },
				{ label: "Coverage", value: newPattern.coverage },
			],
			confirmLabel: "Add pattern",
		});
		if (!ok || !(await ensureCatalog())) return;
		patternStore.addPattern({
			vehicleId: v.id, category: editPanelTab,
			projectType: v.projectType ?? "vehicle",
			zone: newPattern.zone,
			customZoneLabel: newPattern.zone === "custom" ? newPattern.customZoneLabel.trim() || undefined : undefined,
			name: newPattern.name.trim(),
			coverage: newPattern.coverage,
			svgPath: newPattern.svgPath.trim(),
			svgUrl: newPattern.svgUrl.trim() || undefined,
			widthInches: Number(newPattern.widthInches), heightInches: Number(newPattern.heightInches),
			revision: new Date().toISOString().slice(0, 7),
			notes: newPattern.notes.trim() || undefined,
			isPublished: newPattern.isPublished,
		});
		toastStore.success("Pattern added", newPattern.name.trim());
		newPattern = blankPattern(zoneOptions[0]?.value ?? "custom");
		showAddPattern = false;
	}

	function startEditPattern(id: string) {
		const p = panelPatterns.find((x) => x.id === id);
		if (!p) return;
		editPatternId = id;
		editPatch = {
			name: p.name, zone: p.zone, customZoneLabel: p.customZoneLabel ?? "", coverage: p.coverage,
			widthInches: p.widthInches, heightInches: p.heightInches, svgPath: p.svgPath, svgUrl: p.svgUrl ?? "",
			revision: p.revision ?? "", notes: p.notes ?? "", isPublished: p.isPublished,
		};
		showAddPattern = false;
	}

	const PATTERN_LABELS: Record<string, string> = {
		name: "Name", zone: "Zone", customZoneLabel: "Custom zone name", coverage: "Coverage",
		widthInches: "Width (in)", heightInches: "Height (in)", svgUrl: "SVG URL",
		revision: "Revision", notes: "Notes", isPublished: "Published",
	};

	async function saveEditPattern() {
		const id = editPatternId;
		const before = panelPatterns.find((x) => x.id === id);
		if (!id || !before) return;
		const err = patternFormError(editPatch);
		if (err) { toastStore.error("Can't save", err); return; }
		const patch: Partial<Pattern> = {
			name: editPatch.name.trim(),
			zone: editPatch.zone,
			customZoneLabel: editPatch.zone === "custom" ? editPatch.customZoneLabel.trim() || undefined : undefined,
			coverage: editPatch.coverage,
			widthInches: Number(editPatch.widthInches),
			heightInches: Number(editPatch.heightInches),
			svgPath: editPatch.svgPath.trim(),
			svgUrl: editPatch.svgUrl.trim() || undefined,
			revision: editPatch.revision.trim() || before.revision,
			notes: editPatch.notes.trim() || undefined,
			isPublished: editPatch.isPublished,
		};
		// The outline is summarised — a before/after of thousands of characters isn't readable.
		const row = (p: Partial<Pattern>) => ({ ...p, svgPath: undefined, isPublished: p.isPublished ? "Yes" : "No" });
		const changes = diff(row(before), row({ ...before, ...patch }), PATTERN_LABELS);
		if (patch.svgPath !== before.svgPath) {
			changes.push({ label: "Outline", value: `replaced (${before.svgPath.length.toLocaleString()} → ${patch.svgPath!.length.toLocaleString()} chars)` });
		}
		if (!changes.length) { toastStore.info("No changes", "Nothing to save."); editPatternId = null; return; }
		const liveChange = before.isPublished || patch.isPublished;
		const ok = await confirmStore.ask({
			title: `Save changes to "${before.name}"?`,
			message: liveChange ? "This pattern is (or will be) live — customers cut from it, so double-check sizes and the outline." : undefined,
			details: changes,
			confirmLabel: "Save changes",
		});
		if (!ok || !(await ensureCatalog())) return;
		patternStore.updatePattern(id, patch);
		toastStore.success("Pattern saved", patch.name ?? before.name);
		editPatternId = null;
	}

	async function togglePatternPublished(p: Pattern) {
		const next = !p.isPublished;
		const ok = await confirmStore.ask({
			title: `${next ? "Publish" : "Unpublish"} "${p.name}"?`,
			message: next
				? "Customers will see it in the library and be able to cut it."
				: "It disappears from the customer library until it's published again.",
			variant: next ? "primary" : "danger",
			confirmLabel: next ? "Publish" : "Unpublish",
		});
		if (!ok || !(await ensureCatalog())) return;
		patternStore.updatePattern(p.id, { isPublished: next });
		toastStore.success(next ? "Published" : "Unpublished", p.name);
	}

	async function confirmDeletePattern(p: Pattern) {
		const ok = await confirmStore.ask({
			title: `Delete "${p.name}"?`,
			message: p.isPublished
				? "This can't be undone. It's published — customers lose access to it immediately."
				: "This can't be undone.",
			details: [
				{ label: "Zone", value: zoneLabel(p.category, p.zone, p.customZoneLabel, p.projectType) },
				{ label: "Size", value: `${p.widthInches}" × ${p.heightInches}"` },
			],
			variant: "danger",
			confirmLabel: "Delete pattern",
		});
		if (!ok || !(await ensureCatalog())) return;
		patternStore.deletePattern(p.id);
		if (editPatternId === p.id) editPatternId = null;
		toastStore.success("Pattern deleted", p.name);
	}

	// ─── Details drawer ───────────────────────────
	// Every table row opens this. It stores only the kind + id and looks the
	// record up live, so edits made elsewhere on the page show immediately.
	type DetailRef = { kind: "submission" | "adjustment" | "subject" | "request"; id: string };
	let detail = $state<DetailRef | null>(null);
	let showSvgFor = $state<string | null>(null); // which pattern's raw path is expanded

	function openDetail(kind: DetailRef["kind"], id: string) {
		detail = { kind, id };
		showSvgFor = null;
	}
	function closeDetail() { detail = null; }

	// Row click — ignored when it came from a control inside the row.
	function rowOpen(e: MouseEvent, kind: DetailRef["kind"], id: string) {
		if ((e.target as HTMLElement).closest("button, a, input, select, textarea, .delete-confirm")) return;
		openDetail(kind, id);
	}
	function rowKey(e: KeyboardEvent, kind: DetailRef["kind"], id: string) {
		if (e.target !== e.currentTarget) return;
		if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(kind, id); }
	}

	const detailSubmission = $derived(detail?.kind === "submission" ? submissions.find((s) => s.id === detail!.id) ?? null : null);
	const detailAdjustment = $derived(detail?.kind === "adjustment" ? adjustments.find((a) => a.id === detail!.id) ?? null : null);
	const detailSubject    = $derived(detail?.kind === "subject" ? patternStore.vehicles.find((v) => v.id === detail!.id) ?? null : null);
	const detailRequest    = $derived(detail?.kind === "request" ? patternStore.requests.find((r) => r.id === detail!.id) ?? null : null);

	// Subject drawer: its catalog patterns grouped by category, plus any
	// community submissions linked to it.
	const detailSubjectPatterns = $derived.by(() => {
		if (!detailSubject) return [] as { category: PatternCategory; patterns: Pattern[] }[];
		const all = patternStore.getPatterns(detailSubject.id);
		return PATTERN_CATEGORIES
			.map((c) => ({ category: c.value, patterns: all.filter((p) => p.category === c.value) }))
			.filter((g) => g.patterns.length > 0);
	});
	const detailSubjectSubmissions = $derived(detailSubject ? submissions.filter((s) => s.vehicleId === detailSubject!.id) : []);

	// Adjustment requests filed against a submission.
	const adjustmentsFor = (patternId: string) => adjustments.filter((a) => a.patternId === patternId);

	// A pattern request may already be covered by a catalog subject.
	function requestMatches(r: { projectType?: ProjectType; make: string; model: string; year: number }) {
		if ((r.projectType ?? "vehicle") !== "vehicle") return [];
		const make = r.make.toLowerCase(), model = r.model.toLowerCase();
		return patternStore.vehicles.filter((v) =>
			(v.projectType ?? "vehicle") === "vehicle" &&
			(v.make ?? "").toLowerCase() === make &&
			(v.model ?? "").toLowerCase().includes(model) &&
			(!r.year || v.year === r.year));
	}

	async function copyText(text: string, what: string) {
		try { await navigator.clipboard.writeText(text); toastStore.success(`${what} copied`); }
		catch { toastStore.warning("Copy failed", "Select and copy manually"); }
	}

onMount(() => {
		loadSubmissions();
		loadAdjustments();
		loadUsers();
	});
</script>

<svelte:head><title>Patterns — Admin — OmniPlot</title></svelte:head>

{#snippet userCell(uid: string | undefined)}
	{#if uid}
		<div class="user-cell">
			<button
				class="user-cell__name"
				onclick={() => (filterUser = uid)}
				use:tooltip={"Show only this user's pattern activity"}
			>{userLabel(uid)}</button>
			{#if usersById[uid]?.displayName && usersById[uid]?.email}
				<div class="cell-meta">{usersById[uid].email}</div>
			{/if}
		</div>
	{:else}
		<span class="td-muted" use:tooltip={"Not recorded"}>—</span>
	{/if}
{/snippet}

<div class="patterns-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Patterns</h1>
			<p class="page-sub">Manage subject templates, community submissions, and adjustment requests.</p>
		</div>
		<div class="page-header__actions">
			<Button variant="primary" size="sm" onclick={() => (showAddModal = true)} disabled={seeding}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
				Add subject
			</Button>
		</div>
	</div>

	{#if patternStore.usingSeed && !patternStore.loading}
		<div class="catalog-banner" role="status">
			{#if patternStore.catalogError}
				<strong>Couldn't load the catalog from Firestore.</strong>
				You're seeing the built-in catalog instead, and changes can't be saved until it loads. Refresh to try again.
			{:else if seeding}
				<strong>Copying the catalog into Firestore…</strong>
			{:else}
				<strong>The catalog isn't in Firestore yet.</strong>
				What's below is the built-in catalog that ships with the app. Your first change copies it into Firestore
				(you'll be asked to confirm) — from then on everything here is saved to Firestore.
			{/if}
		</div>
	{/if}

	<!-- Summary cards -->
	<div class="summary-row">
		{#each [
			{ label: "Total subjects",  value: totals.vehicles },
			{ label: "Total patterns",  value: totals.patterns, sub: `${totals.published} published` },
			{ label: "Community queue",   value: pendingSubmissions.length, sub: pendingSubmissions.length ? "needs review" : "all clear", accent: pendingSubmissions.length > 0 },
			{ label: "Adj. requests",     value: pendingAdjustments.length, sub: pendingAdjustments.length ? "needs review" : "all clear", accent: pendingAdjustments.length > 0 },
		] as s}
			<div class="summary-card" class:summary-card--accent={s.accent}>
				<div class="summary-card__label">{s.label}</div>
				<div class="summary-card__value">{s.value}</div>
				{#if s.sub}<div class="summary-card__sub">{s.sub}</div>{/if}
			</div>
		{/each}
	</div>

	<!-- User filter -->
	<div class="user-filter">
		<label class="user-filter__label" for="pf-user">User</label>
		<select id="pf-user" class="form-input form-input--sm user-filter__select" bind:value={filterUser}>
			<option value={null}>All users ({activeUsers.length})</option>
			{#each activeUsers as uid (uid)}
				<option value={uid}>{userLabel(uid)}{usersById[uid]?.displayName && usersById[uid]?.email ? ` · ${usersById[uid].email}` : ""}</option>
			{/each}
		</select>
		{#if filterUser}
			<span class="user-filter__summary">
				{shownSubmissions.length} submissions · {shownAdjustments.length} adjustments · {shownRequests.length} requests · {filteredVehicles.length} subjects
			</span>
			<a class="action-btn" href="/admin/users?uid={filterUser}">Open account</a>
			<button class="action-btn" onclick={() => (filterUser = null)}>Clear</button>
		{/if}
	</div>

	<!-- ─── Community Submissions ─── -->
	<div class="section">
		<div class="section-header">
			<div class="section-header__left">
				<h2 class="section-title">Community Submissions</h2>
				{#if pendingSubmissions.length}
					<span class="badge-pending">{pendingSubmissions.length} pending</span>
				{/if}
			</div>
			<button class="refresh-btn" onclick={loadSubmissions} use:tooltip={"Refresh submissions"} aria-label="Refresh submissions">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
			</button>
		</div>

		<div class="table-wrap">
			<table class="data-table" aria-label="Community submissions">
				<thead>
					<tr>
						<th>Pattern</th>
						<th>Submitted by</th>
						<th>Vehicle</th>
						<th>Category</th>
						<th>Dimensions</th>
						<th>Submitted</th>
						<th>Status</th>
						<th class="th-actions"></th>
					</tr>
				</thead>
				<tbody>
					{#if submissionsLoading}
						<tr><td colspan="8" class="td-loading">
							<span class="ai-spinner" style="width:14px;height:14px" aria-hidden="true"></span>
							Loading…
						</td></tr>
					{:else if shownSubmissions.length === 0}
						<tr><td colspan="8" class="td-empty">{filterUser ? "No submissions from this user." : "No community submissions yet."}</td></tr>
					{:else}
						{#each shownSubmissions as sub (sub.id)}
							<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
							<tr class="row-clickable" class:row-resolved={sub.status !== "pending"} tabindex="0"
								onclick={(e) => rowOpen(e, "submission", sub.id)} onkeydown={(e) => rowKey(e, "submission", sub.id)}
								aria-label="View details for {sub.name}">
								<td>
									<div class="pattern-cell">
										<PatternPreview svgPath={sub.svgPath} widthInches={sub.widthInches} heightInches={sub.heightInches} size="thumb" />
										<div>
											<div class="cell-name">{sub.name}</div>
											<div class="cell-meta">{submissionZoneLabels(sub)}</div>
										</div>
									</div>
								</td>
								<td>{@render userCell(sub.ownerId)}</td>
								<td class="td-vehicle">{submissionSubjectLabel(sub)}</td>
								<td>
									<span class="cat-badge" style="--cat-accent: {categoryMeta(sub.category).accent}">
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={categoryMeta(sub.category).icon}/></svg>
										{categoryShortLabel(sub.category)}
									</span>
								</td>
								<td class="td-mono">{sub.widthInches}" × {sub.heightInches}"</td>
								<td class="td-date">{sub.createdAt.toLocaleDateString()}</td>
								<td>
									<Badge
										variant={sub.status === "approved" ? "success" : sub.status === "rejected" ? "danger" : "warning"}
										size="sm" dot={sub.status === "pending"}
									>{sub.status}</Badge>
								</td>
								<td class="td-actions">
									<div class="row-actions row-actions--always">
										{#if sub.status === "pending"}
											<button class="action-btn action-btn--primary" onclick={() => openReview(sub)}>Review</button>
										{/if}
										<button class="row-btn" use:tooltip={"Edit submission"} aria-label="Edit submission" onclick={() => openEditSub(sub)}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
										</button>
										{#if pendingDeleteSubId === sub.id}
											<div class="delete-confirm">
												<span class="delete-confirm__label">Delete?</span>
												<button
													class="delete-confirm__yes"
													disabled={deleteSubWorking}
													onclick={() => confirmDeleteSubmission(sub.id)}
													aria-label="Confirm delete"
												>Yes</button>
												<button
													class="delete-confirm__no"
													onclick={() => (pendingDeleteSubId = null)}
													aria-label="Cancel delete"
												>No</button>
											</div>
										{:else}
											<button
												class="row-btn row-btn--danger"
												onclick={() => (pendingDeleteSubId = sub.id)}
												use:tooltip={"Delete submission"}
												aria-label="Delete {sub.name}"
											><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>

	<!-- ─── Adjustment Requests ─── -->
	<div class="section">
		<div class="section-header">
			<div class="section-header__left">
				<h2 class="section-title">Adjustment Requests</h2>
				{#if pendingAdjustments.length}
					<span class="badge-pending">{pendingAdjustments.length} pending</span>
				{/if}
			</div>
			<button class="refresh-btn" onclick={loadAdjustments} use:tooltip={"Refresh"} aria-label="Refresh adjustment requests">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
			</button>
		</div>

		<div class="table-wrap">
			<table class="data-table" aria-label="Adjustment requests">
				<thead>
					<tr>
						<th>Pattern</th>
						<th>Requested by</th>
						<th>Notes</th>
						<th>Submitted</th>
						<th>Status</th>
						<th class="th-actions"></th>
					</tr>
				</thead>
				<tbody>
					{#if adjustmentsLoading}
						<tr><td colspan="6" class="td-loading">
							<span class="ai-spinner" style="width:14px;height:14px" aria-hidden="true"></span>
							Loading…
						</td></tr>
					{:else if shownAdjustments.length === 0}
						<tr><td colspan="6" class="td-empty">{filterUser ? "No adjustment requests from this user." : "No adjustment requests yet."}</td></tr>
					{:else}
						{#each shownAdjustments as adj (adj.id)}
							<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
							<tr class="row-clickable" class:row-resolved={adj.status !== "pending"} tabindex="0"
								onclick={(e) => rowOpen(e, "adjustment", adj.id)} onkeydown={(e) => rowKey(e, "adjustment", adj.id)}
								aria-label="View adjustment request details">
								<td>
									{#if submissionsById[adj.patternId]}
										<div class="cell-name">{submissionsById[adj.patternId].name}</div>
										<div class="cell-meta">{submissionSubjectLabel(submissionsById[adj.patternId])}</div>
									{:else}
										<span class="td-mono" style="font-size:0.75rem">{adj.patternId.slice(0, 12)}…</span>
									{/if}
								</td>
								<td>{@render userCell(adj.requestedBy)}</td>
								<td class="td-notes">{adj.notes}</td>
								<td class="td-date">{adj.createdAt.toLocaleDateString()}</td>
								<td>
									<Badge
										variant={adj.status === "approved" ? "success" : adj.status === "rejected" ? "danger" : "warning"}
										size="sm" dot={adj.status === "pending"}
									>{adj.status}</Badge>
								</td>
								<td class="td-actions">
									{#if adj.status === "pending"}
										<button class="action-btn" onclick={() => { resolveTarget = adj; resolveNotes = ""; }}>Resolve</button>
									{/if}
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>

	<!-- ─── Subjects ─── -->
	<div class="section">
		<div class="section-header">
			<div class="section-header__left">
				<h2 class="section-title">Subjects</h2>
				<span class="section-sub">{filteredVehicles.length} of {patternStore.vehicles.length}</span>
			</div>
			<div class="search-wrap">
				<svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
				<input type="search" class="search-input" placeholder="Search subjects…" bind:value={search} aria-label="Search subjects"/>
			</div>
		</div>

		<!-- Primary: subject type -->
		<div class="subj-tabs" role="tablist" aria-label="Subject type">
			<button class="subj-tab" class:subj-tab--active={filterProjectType === "all"} role="tab" aria-selected={filterProjectType === "all"} onclick={() => (filterProjectType = "all")}>
				All <span class="subj-tab__count">{patternStore.vehicles.length}</span>
			</button>
			{#each PROJECT_TYPES as t (t.value)}
				<button class="subj-tab" class:subj-tab--active={filterProjectType === t.value} role="tab" aria-selected={filterProjectType === t.value} onclick={() => (filterProjectType = t.value)}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={t.icon}/></svg>
					{t.label}
					<span class="subj-tab__count">{projectTypeCounts[t.value] ?? 0}</span>
				</button>
			{/each}
		</div>

		<!-- Secondary: category + status, counted within the chosen type -->
		<div class="subj-filters">
			<div class="subj-filters__group" role="group" aria-label="Pattern category">
				<span class="subj-filters__label">Category</span>
				<button class="chip" class:chip--active={filterCategory === "both"} aria-pressed={filterCategory === "both"} onclick={() => (filterCategory = "both")}>All</button>
				{#each PATTERN_CATEGORIES.filter((c) => (categoryCounts[c.value] ?? 0) > 0 || filterCategory === c.value) as c (c.value)}
					<button class="chip" class:chip--active={filterCategory === c.value} style="--cat-accent: {c.accent}" aria-pressed={filterCategory === c.value} onclick={() => (filterCategory = c.value)} use:tooltip={c.label}>
						<span class="chip__dot" aria-hidden="true"></span>{c.shortLabel}
						<span class="chip__count">{categoryCounts[c.value] ?? 0}</span>
					</button>
				{/each}
			</div>
			<div class="subj-filters__group" role="group" aria-label="Subject status">
				<span class="subj-filters__label">Status</span>
				{#each (["all", "published", "review", "draft"] as const) as t}
					<button class="chip" class:chip--active={filterStatus === t} aria-pressed={filterStatus === t} onclick={() => (filterStatus = t)}>
						{t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
						{#if t !== "all"}<span class="chip__count">{statusCounts[t] ?? 0}</span>{/if}
					</button>
				{/each}
			</div>
		</div>

		<div class="table-wrap">
			<table class="data-table" aria-label="Subjects">
				<thead>
					<tr>
						<th>Subject</th>
						<th>Contributors</th>
						<th>{filterCategory === "both" ? "Patterns" : `${categoryShortLabel(filterCategory)} patterns`}</th>
						<th>Coverage</th>
						<th>Status</th>
						<th>Updated</th>
						<th class="th-actions"></th>
					</tr>
				</thead>
				<tbody>
					{#each filteredVehicles as v (v.id)}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
						<tr class="row-clickable" tabindex="0"
							onclick={(e) => rowOpen(e, "subject", v.id)} onkeydown={(e) => rowKey(e, "subject", v.id)}
							aria-label="View details for {subjectName(v)}">
							<td>
								<div class="vehicle-cell">
									<div class="vehicle-icon" use:tooltip={projectTypeMeta(v.projectType).label}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={projectTypeMeta(v.projectType).icon}/></svg>
									</div>
									<div class="vehicle-name">{subjectName(v)}</div>
								</div>
							</td>
							<td>
								{#each subjectContributors(v.id, v.contributedBy) as uid (uid)}
									{@render userCell(uid)}
								{:else}
									<span class="td-muted" use:tooltip={"Added by an admin"}>Catalog</span>
								{/each}
							</td>
							<td class="td-mono">{v.published} / {v.patterns}</td>
							<td>
								<div class="coverage-bar" role="meter" aria-valuenow={v.published} aria-valuemax={v.patterns}>
									<div class="coverage-bar__fill" style="width: {v.patterns > 0 ? Math.round((v.published / v.patterns) * 100) : 0}%"></div>
								</div>
								<span class="coverage-pct">{v.patterns > 0 ? Math.round((v.published / v.patterns) * 100) : 0}%</span>
							</td>
							<td>
								<Badge variant={v.status === "published" ? "success" : v.status === "review" ? "warning" : "default"} size="sm" dot={v.status === "published"}>{v.status}</Badge>
							</td>
							<td class="td-date">{v.updatedAt}</td>
							<td class="td-actions">
								<div class="row-actions">
									<button class="row-btn" use:tooltip={"Edit patterns"} aria-label="Edit patterns" onclick={() => openEditPanel(v)}>
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
									</button>
									<button class="row-btn" use:tooltip={"Edit subject details"} aria-label="Edit subject details" onclick={() => openEditVehicle(v)}>
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
									</button>
										<button
											class="row-btn row-btn--danger"
											onclick={() => confirmDeleteVehicle(v)}
											use:tooltip={"Delete subject"}
											aria-label="Delete {subjectName(v)}"
										><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
								</div>
							</td>
						</tr>
					{/each}
					{#if filteredVehicles.length === 0}
						<tr><td colspan="7" class="td-empty">No subjects match your filters.</td></tr>
					{/if}
				</tbody>
			</table>
		</div>
	</div>

	<!-- ─── Pattern Requests ─── -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Pattern Requests</h2>
			<span class="section-sub">{patternStore.requests.filter((r) => r.status !== "done").length} pending</span>
		</div>
		<div class="table-wrap">
			<table class="data-table" aria-label="Pattern requests">
				<thead>
					<tr><th>Request</th><th>Requested by</th><th>Notes</th><th>Votes</th><th>Requested</th><th>Status</th><th class="th-actions"></th></tr>
				</thead>
				<tbody>
					{#each shownRequests as r (r.id)}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
						<tr class="row-clickable" class:row-done={r.status === "done"} tabindex="0"
							onclick={(e) => rowOpen(e, "request", r.id)} onkeydown={(e) => rowKey(e, "request", r.id)}
							aria-label="View request details for {r.vehicle}">
							<td class="td-vehicle">
								<span class="req-cell">
									<span class="req-cell__icon" use:tooltip={projectTypeMeta(r.projectType).label}>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={projectTypeMeta(r.projectType).icon}/></svg>
									</span>
									{r.vehicle}
								</span>
							</td>
							<td>{@render userCell(r.requestedBy)}</td>
							<td class="td-notes">{r.notes || "—"}</td>
							<td><div class="votes-cell"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z"/></svg>{r.votes}</div></td>
							<td class="td-date">{r.requestedAt}</td>
							<td><Badge variant={r.status === "in-progress" ? "brand" : r.status === "done" ? "success" : "default"} size="sm" dot={r.status === "in-progress"}>{r.status}</Badge></td>
							<td class="td-actions">{#if r.status !== "done"}<button class="action-btn" onclick={() => patternStore.advanceRequest(r.id)}>{r.status === "queued" ? "Start" : "Mark done"}</button>{/if}</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="td-empty">{filterUser ? "No pattern requests from this user." : "No pattern requests yet."}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>

<!-- ─── Details drawer (every table row opens this) ─── -->
{#if detail}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel-backdrop" onclick={closeDetail}></div>
	<div class="review-panel review-panel--wide" role="dialog" tabindex="-1" aria-label="Details">
		{#snippet closeBtn()}
			<button class="modal__close" onclick={closeDetail} aria-label="Close details">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>
		{/snippet}

		{#snippet svgPathBlock(key: string, path: string)}
			<div class="dv-raw">
				<button class="dv-link" onclick={() => (showSvgFor = showSvgFor === key ? null : key)}>
					{showSvgFor === key ? "Hide" : "Show"} SVG path ({path.length.toLocaleString()} chars)
				</button>
				<button class="dv-link" onclick={() => copyText(path, "SVG path")}>Copy</button>
				{#if showSvgFor === key}<pre class="dv-code">{path}</pre>{/if}
			</div>
		{/snippet}

		{#snippet submissionFields(sub: UserPattern)}
			<dl class="dv-grid">
				<dt>Submitted by</dt><dd>{@render userCell(sub.ownerId)} <a class="dv-link" href="/admin/users?uid={sub.ownerId}">Open account</a></dd>
				<dt>Project type</dt><dd>{projectTypeMeta(sub.projectType).label}</dd>
				{#if (sub.projectType ?? "vehicle") === "vehicle"}
					<dt>Make</dt><dd>{sub.make || "—"}</dd>
					<dt>Models</dt><dd>{sub.models.join(", ") || "—"}</dd>
					<dt>Years</dt><dd>{sub.years.join(", ") || "—"}</dd>
					<dt>Body style</dt><dd>{sub.bodyStyle}</dd>
				{:else}
					{#if sub.patternName}<dt>Project name</dt><dd>{sub.patternName}</dd>{/if}
					{#if sub.propertyLabel}<dt>Property</dt><dd>{sub.propertyLabel}</dd>{/if}
					{#if sub.address}<dt>Address</dt><dd>{sub.address}</dd>{/if}
				{/if}
				<dt>Category</dt><dd>{categoryLabel(sub.category)}</dd>
				<dt>Zones</dt><dd>{sub.zones.map((z, i) => zoneLabel(sub.category, z, sub.customZoneLabels?.[i], sub.projectType)).join(", ") || "—"}</dd>
				<dt>Coverage</dt><dd>{sub.coverage}</dd>
				<dt>Size</dt><dd class="dv-mono">{sub.widthInches}" × {sub.heightInches}"</dd>
				<dt>Status</dt><dd><Badge variant={sub.status === "approved" ? "success" : sub.status === "rejected" ? "danger" : sub.status === "pending" ? "warning" : "default"} size="sm">{sub.status}</Badge></dd>
				<dt>In public library</dt><dd>{sub.isPublished ? "Yes" : "No"}</dd>
				<dt>Submitted to community</dt><dd>{sub.submitToCommunity ? "Yes" : "No"}</dd>
				<dt>Linked subject</dt>
				<dd>
					{#if sub.vehicleId && patternStore.vehicles.some((v) => v.id === sub.vehicleId)}
						<button class="dv-link" onclick={() => openDetail("subject", sub.vehicleId!)}>{subjectName(patternStore.vehicles.find((v) => v.id === sub.vehicleId)!)}</button>
					{:else}{sub.vehicleId ?? "—"}{/if}
				</dd>
				<dt>Submitter notes</dt><dd class="dv-pre">{sub.notes || "—"}</dd>
				<dt>Admin notes <span class="dv-muted">(internal)</span></dt><dd class="dv-pre">{sub.adminNotes || "—"}</dd>
				{#if sub.status === "rejected"}<dt>Reason shown to submitter</dt><dd class="dv-pre">{sub.rejectionReason || "— (none given)"}</dd>{/if}
				<dt>Created</dt><dd>{fmtDateTime(sub.createdAt)}</dd>
				<dt>Updated</dt><dd>{fmtDateTime(sub.updatedAt)}</dd>
				<dt>ID</dt><dd class="dv-mono">{sub.id} <button class="dv-link" onclick={() => copyText(sub.id, "ID")}>Copy</button></dd>
			</dl>
		{/snippet}

		<!-- ── Community submission ── -->
		{#if detail.kind === "submission"}
			{#if detailSubmission}
				{@const sub = detailSubmission}
				<div class="review-panel__header">
					<div>
						<div class="review-panel__sub">Community submission · {categoryShortLabel(sub.category)}</div>
						<h2 class="review-panel__title">{sub.name}</h2>
						<div class="dv-subtitle">{submissionSubjectLabel(sub)}</div>
					</div>
					{@render closeBtn()}
				</div>
				<div class="review-panel__body">
					<PatternPreview svgPath={sub.svgPath} label="Outline of {sub.name}" widthInches={sub.widthInches} heightInches={sub.heightInches} />
					{@render svgPathBlock(sub.id, sub.svgPath)}
					{@render submissionFields(sub)}
					{#if adjustmentsFor(sub.id).length}
						<div class="dv-section">
							<h3 class="dv-h">Adjustment requests</h3>
							{#each adjustmentsFor(sub.id) as a (a.id)}
								<button class="dv-card" onclick={() => openDetail("adjustment", a.id)}>
									<span class="dv-card__main">{a.notes}</span>
									<Badge variant={a.status === "approved" ? "success" : a.status === "rejected" ? "danger" : "warning"} size="sm">{a.status}</Badge>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<div class="review-panel__footer">
					<button class="btn-ghost" onclick={() => { closeDetail(); openEditSub(sub); }}>Edit</button>
					{#if sub.status === "pending"}
						<button class="btn-approve" onclick={() => { closeDetail(); openReview(sub); }}>Review</button>
					{/if}
				</div>
			{:else}
				<div class="review-panel__header"><h2 class="review-panel__title">Submission not found</h2>{@render closeBtn()}</div>
			{/if}

		<!-- ── Adjustment request ── -->
		{:else if detail.kind === "adjustment"}
			{#if detailAdjustment}
				{@const adj = detailAdjustment}
				{@const target = submissionsById[adj.patternId]}
				<div class="review-panel__header">
					<div>
						<div class="review-panel__sub">Adjustment request · {adj.status}</div>
						<h2 class="review-panel__title">{target ? target.name : "Pattern change request"}</h2>
						{#if target}<div class="dv-subtitle">{submissionSubjectLabel(target)}</div>{/if}
					</div>
					{@render closeBtn()}
				</div>
				<div class="review-panel__body">
					<dl class="dv-grid">
						<dt>Requested by</dt><dd>{@render userCell(adj.requestedBy)} <a class="dv-link" href="/admin/users?uid={adj.requestedBy}">Open account</a></dd>
						<dt>What they want changed</dt><dd class="dv-pre">{adj.notes || "—"}</dd>
						<dt>Status</dt><dd><Badge variant={adj.status === "approved" ? "success" : adj.status === "rejected" ? "danger" : "warning"} size="sm">{adj.status}</Badge></dd>
						<dt>Admin response</dt><dd class="dv-pre">{adj.adminResponse || "—"}</dd>
						<dt>Submitted</dt><dd>{fmtDateTime(adj.createdAt)}</dd>
						<dt>ID</dt><dd class="dv-mono">{adj.id}</dd>
					</dl>
					<div class="dv-section">
						<h3 class="dv-h">Pattern it's about</h3>
						{#if target}
							<PatternPreview svgPath={target.svgPath} label="Outline of {target.name}" widthInches={target.widthInches} heightInches={target.heightInches} />
							{@render svgPathBlock(target.id, target.svgPath)}
							{@render submissionFields(target)}
						{:else}
							<p class="dv-muted">The pattern (<span class="dv-mono">{adj.patternId}</span>) isn't among the community submissions — it may have been deleted.</p>
						{/if}
					</div>
				</div>
				<div class="review-panel__footer">
					{#if target}<button class="btn-ghost" onclick={() => openDetail("submission", target.id)}>Open pattern</button>{/if}
					{#if adj.status === "pending"}
						<button class="btn-approve" onclick={() => { closeDetail(); resolveTarget = adj; resolveNotes = ""; }}>Resolve</button>
					{/if}
				</div>
			{:else}
				<div class="review-panel__header"><h2 class="review-panel__title">Request not found</h2>{@render closeBtn()}</div>
			{/if}

		<!-- ── Subject ── -->
		{:else if detail.kind === "subject"}
			{#if detailSubject}
				{@const v = detailSubject}
				{@const pats = patternStore.getPatterns(v.id)}
				<div class="review-panel__header">
					<div>
						<div class="review-panel__sub">{projectTypeMeta(v.projectType).label} subject · {pats.length} pattern{pats.length === 1 ? "" : "s"}</div>
						<h2 class="review-panel__title">{subjectName(v)}</h2>
					</div>
					{@render closeBtn()}
				</div>
				<div class="review-panel__body">
					<dl class="dv-grid">
						<dt>Project type</dt><dd>{projectTypeMeta(v.projectType).label}</dd>
						{#if (v.projectType ?? "vehicle") === "vehicle"}
							<dt>Year</dt><dd>{v.year ?? "—"}</dd>
							<dt>Make</dt><dd>{v.make || "—"}</dd>
							<dt>Model</dt><dd>{v.model || "—"}</dd>
							<dt>Body style</dt><dd>{v.bodyStyle ?? "—"}</dd>
						{:else}
							<dt>Label</dt><dd>{v.propertyLabel || "—"}</dd>
							<dt>Address</dt><dd>{v.address || "—"}</dd>
							{#if v.model}<dt>Notes / model</dt><dd>{v.model}</dd>{/if}
						{/if}
						<dt>Status</dt><dd><Badge variant={v.status === "published" ? "success" : v.status === "review" ? "warning" : "default"} size="sm">{v.status}</Badge></dd>
						<dt>Popular</dt><dd>{v.popular ? "Yes" : "No"}</dd>
						<dt>Tags</dt><dd>{v.tags.length ? v.tags.join(", ") : "—"}</dd>
						<dt>Contributors</dt>
						<dd>
							{#each subjectContributors(v.id, v.contributedBy) as uid (uid)}
								{@render userCell(uid)}
							{:else}<span class="dv-muted">Added by an admin</span>{/each}
						</dd>
						<dt>Updated</dt><dd>{v.updatedAt || "—"}</dd>
						<dt>Source</dt><dd>{patternStore.usingSeed ? "Built-in catalog (not in Firestore yet)" : "Firestore"}</dd>
						<dt>ID</dt><dd class="dv-mono">{v.id} <button class="dv-link" onclick={() => copyText(v.id, "ID")}>Copy</button></dd>
					</dl>

					{#each detailSubjectPatterns as group (group.category)}
						<div class="dv-section">
							<h3 class="dv-h">
								<span class="cat-badge" style="--cat-accent: {categoryMeta(group.category).accent}">
									<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={categoryMeta(group.category).icon}/></svg>
									{categoryLabel(group.category)}
								</span>
								<span class="dv-count">{group.patterns.length}</span>
							</h3>
							<div class="dv-patterns">
								{#each group.patterns as pat (pat.id)}
									<article class="dv-pattern">
										<PatternPreview svgPath={pat.svgPath} label="Outline of {pat.name}" widthInches={pat.widthInches} heightInches={pat.heightInches} />
										<div class="dv-pattern__head">
											<span class="dv-pattern__name">{pat.name}</span>
											<Badge variant={pat.isPublished ? "success" : "default"} size="sm">{pat.isPublished ? "Published" : "Draft"}</Badge>
										</div>
										<dl class="dv-grid dv-grid--tight">
											<dt>Zone</dt><dd>{zoneLabel(pat.category, pat.zone, pat.customZoneLabel, v.projectType)}</dd>
											<dt>Coverage</dt><dd>{pat.coverage}</dd>
											<dt>Revision</dt><dd class="dv-mono">{pat.revision || "—"}</dd>
											{#if pat.notes}<dt>Notes</dt><dd class="dv-pre">{pat.notes}</dd>{/if}
											{#if pat.svgUrl}<dt>SVG file</dt><dd><a class="dv-link" href={pat.svgUrl} target="_blank" rel="noopener noreferrer">Open ↗</a></dd>{/if}
											<dt>Created</dt><dd>{fmtDateTime(pat.createdAt)}</dd>
											<dt>Updated</dt><dd>{fmtDateTime(pat.updatedAt)}</dd>
											<dt>ID</dt><dd class="dv-mono">{pat.id}</dd>
										</dl>
										{@render svgPathBlock(pat.id, pat.svgPath)}
									</article>
								{/each}
							</div>
						</div>
					{:else}
						<p class="dv-muted">No patterns for this subject yet.</p>
					{/each}

					{#if detailSubjectSubmissions.length}
						<div class="dv-section">
							<h3 class="dv-h">Community submissions linked here</h3>
							{#each detailSubjectSubmissions as s (s.id)}
								<button class="dv-card" onclick={() => openDetail("submission", s.id)}>
									<PatternPreview svgPath={s.svgPath} widthInches={s.widthInches} heightInches={s.heightInches} size="thumb" />
									<span class="dv-card__main">{s.name} <span class="dv-muted">· {userLabel(s.ownerId)}</span></span>
									<Badge variant={s.status === "approved" ? "success" : s.status === "rejected" ? "danger" : "warning"} size="sm">{s.status}</Badge>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<div class="review-panel__footer">
					<button class="btn-ghost btn-ghost--danger" onclick={() => confirmDeleteVehicle(v)}>Delete</button>
					<button class="btn-ghost" onclick={() => { closeDetail(); openEditVehicle(v); }}>Edit details</button>
					<button class="btn-approve" onclick={() => { closeDetail(); openEditPanel(v); }}>Edit patterns</button>
				</div>
			{:else}
				<div class="review-panel__header"><h2 class="review-panel__title">Subject not found</h2>{@render closeBtn()}</div>
			{/if}

		<!-- ── Pattern request ── -->
		{:else if detail.kind === "request"}
			{#if detailRequest}
				{@const r = detailRequest}
				{@const matches = requestMatches(r)}
				<div class="review-panel__header">
					<div>
						<div class="review-panel__sub">Pattern request · {r.status}</div>
						<h2 class="review-panel__title">{r.vehicle}</h2>
					</div>
					{@render closeBtn()}
				</div>
				<div class="review-panel__body">
					<dl class="dv-grid">
						<dt>Requested by</dt>
						<dd>
							{#if r.requestedBy}{@render userCell(r.requestedBy)} <a class="dv-link" href="/admin/users?uid={r.requestedBy}">Open account</a>
							{:else}<span class="dv-muted">Not recorded (requested before tracking began)</span>{/if}
						</dd>
						<dt>Type</dt><dd>{projectTypeMeta(r.projectType).label}</dd>
						{#if (r.projectType ?? "vehicle") === "vehicle"}
							<dt>Year</dt><dd>{r.year || "—"}</dd>
							<dt>Make</dt><dd>{r.make || "—"}</dd>
							<dt>Model</dt><dd>{r.model || "—"}</dd>
						{:else}
							<dt>What they need</dt><dd>{r.model || "—"}</dd>
						{/if}
						<dt>Notes</dt><dd class="dv-pre">{r.notes || "—"}</dd>
						<dt>Votes</dt><dd class="dv-mono">{r.votes}</dd>
						<dt>Status</dt><dd><Badge variant={r.status === "in-progress" ? "brand" : r.status === "done" ? "success" : "default"} size="sm">{r.status}</Badge></dd>
						<dt>Requested</dt><dd>{r.requestedAt || "—"}</dd>
						<dt>ID</dt><dd class="dv-mono">{r.id}</dd>
					</dl>
					{#if (r.projectType ?? "vehicle") === "vehicle"}
					<div class="dv-section">
						<h3 class="dv-h">Already in the catalog?</h3>
						{#each matches as m (m.id)}
							<button class="dv-card" onclick={() => openDetail("subject", m.id)}>
								<span class="dv-card__main">{subjectName(m)}</span>
								<span class="dv-muted">{patternStore.getPatterns(m.id).length} patterns</span>
							</button>
						{:else}
							<p class="dv-muted">No matching subject yet — there are no patterns to preview until one is made.</p>
						{/each}
					</div>
					{/if}
				</div>
				{#if r.status !== "done"}
					<div class="review-panel__footer">
						<button class="btn-approve" onclick={() => patternStore.advanceRequest(r.id)}>{r.status === "queued" ? "Start" : "Mark done"}</button>
					</div>
				{/if}
			{:else}
				<div class="review-panel__header"><h2 class="review-panel__title">Request not found</h2>{@render closeBtn()}</div>
			{/if}
		{/if}
	</div>
{/if}

<!-- ─── Add Vehicle Modal ─── -->
{#if showAddModal}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (showAddModal = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal__header">
				<h2 class="modal__title">Add Subject</h2>
				<button class="modal__close" onclick={() => (showAddModal = false)} aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
			</div>
			<form class="modal__body" onsubmit={(e) => { e.preventDefault(); handleAddVehicle(); }}>
				<div class="form-group">
					<label class="form-label" for="av-project-type">Project Type</label>
					<select id="av-project-type" class="form-input" bind:value={newVehicle.projectType}>
						<option value="vehicle">Vehicle</option>
						<option value="residential">Residential</option>
						<option value="commercial">Commercial</option>
						<option value="custom">Custom</option>
					</select>
				</div>
				{#if newVehicle.projectType === "vehicle"}
				<div class="form-row">
					<div class="form-group"><label class="form-label" for="av-year">Year</label><input id="av-year" type="number" class="form-input" bind:value={newVehicle.year} min="1990" max="2030" required /></div>
					<div class="form-group" style="flex:2"><label class="form-label" for="av-make">Make</label><input id="av-make" type="text" class="form-input" bind:value={newVehicle.make} placeholder="e.g. Toyota" required /></div>
				</div>
				<div class="form-group"><label class="form-label" for="av-model">Model</label><input id="av-model" type="text" class="form-input" bind:value={newVehicle.model} placeholder="e.g. GR86" required /></div>
				<div class="form-row">
					<div class="form-group"><label class="form-label" for="av-body">Body Style</label><select id="av-body" class="form-input" bind:value={newVehicle.bodyStyle}>{#each ["sedan","coupe","suv","truck","hatchback","wagon","convertible"] as s}<option value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>{/each}</select></div>
					<div class="form-group"><label class="form-label" for="av-status">Status</label><select id="av-status" class="form-input" bind:value={newVehicle.status}><option value="draft">Draft</option><option value="review">Review</option><option value="published">Published</option></select></div>
				</div>
				{:else}
				<div class="form-group"><label class="form-label" for="av-label">{newVehicle.projectType === "custom" ? "Project Name" : "Property Label"}</label><input id="av-label" type="text" class="form-input" bind:value={newVehicle.propertyLabel} placeholder={newVehicle.projectType === "custom" ? "e.g. Apparel HTV Kit" : "e.g. Smith Residence"} required /></div>
				{#if newVehicle.projectType !== "custom"}
				<div class="form-group"><label class="form-label" for="av-address">Address</label><input id="av-address" type="text" class="form-input" bind:value={newVehicle.address} placeholder="e.g. 123 Main St" /></div>
				{/if}
				<div class="form-group"><label class="form-label" for="av-model2">Notes / Model</label><input id="av-model2" type="text" class="form-input" bind:value={newVehicle.model} placeholder="Optional detail" /></div>
				<div class="form-group"><label class="form-label" for="av-status2">Status</label><select id="av-status2" class="form-input" bind:value={newVehicle.status}><option value="draft">Draft</option><option value="review">Review</option><option value="published">Published</option></select></div>
				{/if}
				<div class="form-row">
					<div class="form-group" style="flex:2"><label class="form-label" for="av-tags">Tags <span class="form-label__opt">(comma-separated)</span></label><input id="av-tags" type="text" class="form-input" bind:value={newVehicle.tags} placeholder="e.g. truck, popular"/></div>
					<div class="form-group form-group--check"><label class="toggle-label"><input type="checkbox" bind:checked={newVehicle.popular}/>Popular</label></div>
				</div>
				<div class="modal__actions">
					<button type="button" class="btn-ghost" onclick={() => (showAddModal = false)}>Cancel</button>
					<button type="submit" class="btn-primary" disabled={seeding}>Add subject…</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ─── Edit Vehicle Modal ─── -->
{#if editVehicleTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (editVehicleTarget = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal__header">
				<h2 class="modal__title">Edit Subject</h2>
				<button class="modal__close" onclick={() => (editVehicleTarget = null)} aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
			</div>
			<form class="modal__body" onsubmit={(e) => { e.preventDefault(); saveEditVehicle(); }}>
				<div class="form-group">
					<label class="form-label" for="ev-project-type">Project Type</label>
					<select id="ev-project-type" class="form-input" bind:value={editVehicleForm.projectType}>
						<option value="vehicle">Vehicle</option>
						<option value="residential">Residential</option>
						<option value="commercial">Commercial</option>
						<option value="custom">Custom</option>
					</select>
				</div>
				{#if editVehicleForm.projectType === "vehicle"}
				<div class="form-row">
					<div class="form-group"><label class="form-label" for="ev-year">Year</label><input id="ev-year" type="number" class="form-input" bind:value={editVehicleForm.year} min="1990" max="2030" required /></div>
					<div class="form-group" style="flex:2"><label class="form-label" for="ev-make">Make</label><input id="ev-make" type="text" class="form-input" bind:value={editVehicleForm.make} placeholder="e.g. Toyota" required /></div>
				</div>
				<div class="form-group"><label class="form-label" for="ev-model">Model</label><input id="ev-model" type="text" class="form-input" bind:value={editVehicleForm.model} placeholder="e.g. GR86" required /></div>
				<div class="form-row">
					<div class="form-group"><label class="form-label" for="ev-body">Body Style</label><select id="ev-body" class="form-input" bind:value={editVehicleForm.bodyStyle}>{#each ["sedan","coupe","suv","truck","hatchback","wagon","convertible"] as s}<option value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>{/each}</select></div>
					<div class="form-group"><label class="form-label" for="ev-status">Status</label><select id="ev-status" class="form-input" bind:value={editVehicleForm.status}><option value="draft">Draft</option><option value="review">Review</option><option value="published">Published</option></select></div>
				</div>
				{:else}
				<div class="form-group"><label class="form-label" for="ev-label">{editVehicleForm.projectType === "custom" ? "Project Name" : "Property Label"}</label><input id="ev-label" type="text" class="form-input" bind:value={editVehicleForm.propertyLabel} placeholder={editVehicleForm.projectType === "custom" ? "e.g. Apparel HTV Kit" : "e.g. Smith Residence"} required /></div>
				{#if editVehicleForm.projectType !== "custom"}
				<div class="form-group"><label class="form-label" for="ev-address">Address</label><input id="ev-address" type="text" class="form-input" bind:value={editVehicleForm.address} placeholder="e.g. 123 Main St" /></div>
				{/if}
				<div class="form-group"><label class="form-label" for="ev-model2">Notes / Model</label><input id="ev-model2" type="text" class="form-input" bind:value={editVehicleForm.model} placeholder="Optional detail" /></div>
				<div class="form-group"><label class="form-label" for="ev-status2">Status</label><select id="ev-status2" class="form-input" bind:value={editVehicleForm.status}><option value="draft">Draft</option><option value="review">Review</option><option value="published">Published</option></select></div>
				{/if}
				<div class="form-row">
					<div class="form-group" style="flex:2"><label class="form-label" for="ev-tags">Tags <span class="form-label__opt">(comma-separated)</span></label><input id="ev-tags" type="text" class="form-input" bind:value={editVehicleForm.tags} placeholder="e.g. truck, popular"/></div>
					<div class="form-group form-group--check"><label class="toggle-label"><input type="checkbox" bind:checked={editVehicleForm.popular}/>Popular</label></div>
				</div>
				<div class="modal__actions">
					<button type="button" class="btn-ghost" onclick={() => (editVehicleTarget = null)}>Cancel</button>
					<button type="submit" class="btn-primary" disabled={seeding}>Save changes…</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ─── Community Submission Review Panel ─── -->
{#if reviewTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel-backdrop" onclick={() => (reviewTarget = null)}></div>
	<div class="review-panel" role="dialog" tabindex="-1" aria-label="Review submission">
		<div class="review-panel__header">
			<div>
				<div class="review-panel__sub">Community submission · {reviewTarget.status}</div>
				<h2 class="review-panel__title">{submissionSubjectLabel(reviewTarget)}</h2>
			</div>
			<button class="modal__close" onclick={() => (reviewTarget = null)} aria-label="Close">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>
		</div>

		<div class="review-panel__body">
			<!-- SVG Preview -->
			<div class="review-preview">
				<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-label="Pattern preview">
					<path d={reviewTarget.svgPath} use:fitPattern={{ w: reviewEdits.widthInches, h: reviewEdits.heightInches, d: reviewTarget.svgPath }} fill="none" stroke="var(--color-brand)" stroke-width="1.5"/>
				</svg>
			</div>

			<!-- Read-only meta -->
			<div class="review-meta">
				<div class="review-meta__row">
					<span class="review-meta__label">Submitted by</span>
					<span class="review-meta__val">{@render userCell(reviewTarget.ownerId)}</span>
				</div>
				<div class="review-meta__row">
					<span class="review-meta__label">Category</span>
					<span class="review-meta__val">{categoryLabel(reviewTarget.category)}</span>
				</div>
				<div class="review-meta__row">
					<span class="review-meta__label">Zone</span>
					<span class="review-meta__val">{submissionZoneLabels(reviewTarget)}</span>
				</div>
				<div class="review-meta__row">
					<span class="review-meta__label">Coverage</span>
					<span class="review-meta__val">{reviewTarget.coverage}</span>
				</div>
				{#if reviewTarget.notes}
					<div class="review-meta__row">
						<span class="review-meta__label">Submitter notes</span>
						<span class="review-meta__val review-meta__val--notes">{reviewTarget.notes}</span>
					</div>
				{/if}
			</div>

			<!-- Editable fields before publishing -->
			<div class="review-edits">
				<div class="review-edits__title">Edit before publishing</div>

				<div class="form-group">
					<label class="form-label" for="re-name">Pattern Name</label>
					<input id="re-name" type="text" class="form-input form-input--sm" bind:value={reviewEdits.name}/>
				</div>

				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="re-w">Width (in)</label>
						<input id="re-w" type="number" class="form-input form-input--sm" bind:value={reviewEdits.widthInches} min="0.1" step="0.1"/>
					</div>
					<div class="form-group">
						<label class="form-label" for="re-h">Height (in)</label>
						<input id="re-h" type="number" class="form-input form-input--sm" bind:value={reviewEdits.heightInches} min="0.1" step="0.1"/>
					</div>
				</div>

				<div class="form-group">
					<label class="form-label" for="re-notes">Notes <span class="form-label__opt">(published with pattern)</span></label>
					<textarea id="re-notes" class="form-input form-input--sm" style="resize:vertical;min-height:64px" bind:value={reviewEdits.notes}></textarea>
				</div>

				<div class="form-group">
					<label class="form-label" for="re-reason">If not approving: reason <span class="form-label__opt">(shown to the submitter)</span></label>
					<textarea id="re-reason" class="form-input form-input--sm" style="resize:vertical;min-height:56px" bind:value={rejectReason} placeholder="e.g. Outline doesn't match the listed size — re-measure the rear edge and resubmit."></textarea>
				</div>
			</div>
		</div>

		<div class="review-panel__footer">
			<button class="btn-reject" disabled={reviewWorking} onclick={rejectSubmission}>
				{reviewWorking ? "Working…" : "Reject"}
			</button>
			<button class="btn-approve" disabled={reviewWorking || seeding} onclick={approveSubmission}>
				{reviewWorking ? "Working…" : "Approve & Publish"}
			</button>
		</div>
	</div>
{/if}

<!-- ─── Edit Submission Panel ─── -->
{#if editSubTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel-backdrop" onclick={() => (editSubTarget = null)}></div>
	<div class="review-panel" role="dialog" tabindex="-1" aria-label="Edit submission">
		<div class="review-panel__header">
			<div>
				<div class="review-panel__sub">Edit community submission · {editSubTarget.status} · by {userLabel(editSubTarget.ownerId)}</div>
				<h2 class="review-panel__title">{submissionSubjectLabel(editSubTarget)}</h2>
			</div>
			<button class="modal__close" onclick={() => (editSubTarget = null)} aria-label="Close">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>
		</div>

		<div class="review-panel__body">
			<div class="review-preview">
				<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-label="Pattern preview">
					<path d={editSubTarget.svgPath} use:fitPattern={{ w: editSubForm.widthInches, h: editSubForm.heightInches, d: editSubTarget.svgPath }} fill="none" stroke="var(--color-brand)" stroke-width="1.5"/>
				</svg>
			</div>

			<div class="review-edits">
				<div class="review-edits__title">Pattern details</div>

				<div class="form-group">
					<label class="form-label" for="es-name">Pattern Name</label>
					<input id="es-name" type="text" class="form-input form-input--sm" bind:value={editSubForm.name}/>
				</div>

				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="es-w">Width (in)</label>
						<input id="es-w" type="number" class="form-input form-input--sm" bind:value={editSubForm.widthInches} min="0.1" step="0.1"/>
					</div>
					<div class="form-group">
						<label class="form-label" for="es-h">Height (in)</label>
						<input id="es-h" type="number" class="form-input form-input--sm" bind:value={editSubForm.heightInches} min="0.1" step="0.1"/>
					</div>
				</div>

				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="es-coverage">Coverage</label>
						<select id="es-coverage" class="form-input form-input--sm" bind:value={editSubForm.coverage}>
							<option value="full">Full</option>
							<option value="partial">Partial</option>
							<option value="edge-only">Edge only</option>
						</select>
					</div>
					<div class="form-group">
						<label class="form-label" for="es-zone">Primary Zone</label>
						<select id="es-zone" class="form-input form-input--sm"
							value={editSubForm.zones[0] ?? ""}
							onchange={(e) => { editSubForm.zones = [e.currentTarget.value as PatternZone]; }}
						>
							{#each zonesForCategory(editSubTarget.category) as z}
								<option value={z.value}>{z.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="form-group">
					<label class="form-label" for="es-notes">User notes</label>
					<textarea id="es-notes" class="form-input form-input--sm" style="resize:vertical;min-height:56px" bind:value={editSubForm.notes}></textarea>
				</div>

				<div class="form-group">
					<label class="form-label" for="es-admin-notes">Admin notes <span class="form-label__opt">(internal)</span></label>
					<textarea id="es-admin-notes" class="form-input form-input--sm" style="resize:vertical;min-height:56px" bind:value={editSubForm.adminNotes}></textarea>
				</div>
			</div>

			<div class="review-edits">
				<div class="review-edits__title">Status &amp; visibility</div>

				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="es-status">Status</label>
						<select id="es-status" class="form-input form-input--sm" bind:value={editSubForm.status}>
							<option value="pending">Pending</option>
							<option value="approved">Approved</option>
							<option value="rejected">Rejected</option>
							<option value="private">Private</option>
						</select>
					</div>
					<div class="form-group" style="justify-content:flex-end;padding-bottom:2px">
						<label class="form-label" for="es-published">Published</label>
						<label class="toggle-label" style="margin-top:4px">
							<input id="es-published" type="checkbox" bind:checked={editSubForm.isPublished}/>
							{editSubForm.isPublished ? "Visible in library" : "Hidden from library"}
						</label>
					</div>
				</div>
			</div>
		</div>

		<div class="review-panel__footer">
			<button class="btn-ghost" onclick={() => (editSubTarget = null)}>Cancel</button>
			<button class="btn-approve" disabled={editSubWorking} onclick={saveEditSub}>
				{editSubWorking ? "Saving…" : "Save Changes"}
			</button>
		</div>
	</div>
{/if}

<!-- ─── Resolve Adjustment Request Modal ─── -->
{#if resolveTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (resolveTarget = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal__header">
				<div>
					<h2 class="modal__title">Resolve Adjustment Request</h2>
					<p style="font-size:0.8125rem;color:var(--text-tertiary);margin-top:3px">{submissionsById[resolveTarget.patternId]?.name ?? `Pattern ID: ${resolveTarget.patternId.slice(0, 16)}…`}</p>
				</div>
				<button class="modal__close" onclick={() => (resolveTarget = null)} aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
			</div>
			<div class="modal__body">
				<div class="adj-request-notes">
					<div class="form-label" style="margin-bottom:4px">User's request</div>
					<p class="adj-request-notes__text">{resolveTarget.notes}</p>
				</div>
				<div class="form-group">
					<label class="form-label" for="adj-response">Admin response <span class="form-label__opt">(optional — sent back to user)</span></label>
					<textarea id="adj-response" class="form-input" style="resize:vertical;min-height:72px" bind:value={resolveNotes} placeholder="e.g. Dimensions updated to 62.5&quot; × 48&quot; — verified and republished."></textarea>
				</div>
				<div class="modal__actions">
					<button class="btn-ghost" onclick={() => (resolveTarget = null)}>Cancel</button>
					<button class="btn-reject-sm" disabled={resolveWorking} onclick={() => handleResolve("rejected")}>{resolveWorking ? "…" : "Reject"}</button>
					<button class="btn-primary" disabled={resolveWorking} onclick={() => handleResolve("approved")}>{resolveWorking ? "…" : "Approve"}</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Edit Patterns Panel ─── -->
{#if editingVehicle}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel-backdrop" onclick={closeEditPanel}></div>
	<div class="edit-panel" role="dialog" tabindex="-1" aria-label="Edit patterns">
		<div class="edit-panel__header">
			<div>
				<div class="edit-panel__sub">Editing patterns</div>
				<h2 class="edit-panel__title">{subjectName(editingVehicle)}</h2>
			</div>
			<button class="modal__close" onclick={closeEditPanel} aria-label="Close panel"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
		</div>

		<div class="edit-panel__tabs">
			{#each PATTERN_CATEGORIES as c}
				<button
					class="ep-tab"
					class:active={editPanelTab === c.value}
					style="--cat-accent: {c.accent}"
					onclick={() => { editPanelTab = c.value; showAddPattern = false; editPatternId = null; newPattern = blankPattern(zonesFor(c.value, editingVehicle?.projectType)[0]?.value ?? "custom"); }}
				>
					<span class="ep-tab__icon" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d={c.icon}/></svg></span>
					{c.shortLabel}<span class="ep-tab__count">{patternStore.getPatterns(editingVehicle.id, c.value).length}</span>
				</button>
			{/each}
		</div>

		<div class="edit-panel__list">
			{#if panelPatterns.length === 0}
				<div class="ep-empty">No {categoryLabel(editPanelTab)} patterns yet.</div>
			{/if}
			{#each panelPatterns as pat (pat.id)}
				{#if editPatternId === pat.id}
					<div class="pattern-row pattern-row--editing">
						<div class="pattern-edit-form">
							<div class="ep-edit-preview">
								<PatternPreview svgPath={editPatch.svgPath} widthInches={Number(editPatch.widthInches)} heightInches={Number(editPatch.heightInches)} label="Preview of {editPatch.name || 'pattern'}" />
							</div>
							<div class="form-group"><label class="form-label" for="ep-name-{pat.id}">Name</label><input id="ep-name-{pat.id}" type="text" class="form-input form-input--sm" bind:value={editPatch.name}/></div>
							<div class="form-row">
								<div class="form-group" style="flex:2"><label class="form-label" for="ep-zone-{pat.id}">Zone</label><select id="ep-zone-{pat.id}" class="form-input form-input--sm" bind:value={editPatch.zone}>{#each zoneOptions as z}<option value={z.value}>{z.label}</option>{/each}</select></div>
								<div class="form-group"><label class="form-label" for="ep-cov-{pat.id}">Coverage</label><select id="ep-cov-{pat.id}" class="form-input form-input--sm" bind:value={editPatch.coverage}><option value="full">Full</option><option value="partial">Partial</option><option value="edge-only">Edge only</option></select></div>
							</div>
							{#if editPatch.zone === "custom"}
								<div class="form-group"><label class="form-label" for="ep-czone-{pat.id}">Custom zone name</label><input id="ep-czone-{pat.id}" type="text" class="form-input form-input--sm" bind:value={editPatch.customZoneLabel}/></div>
							{/if}
							<div class="form-row">
								<div class="form-group"><label class="form-label" for="ep-w-{pat.id}">Width (in)</label><input id="ep-w-{pat.id}" type="number" class="form-input form-input--sm" bind:value={editPatch.widthInches} min="0.1" step="0.1"/></div>
								<div class="form-group"><label class="form-label" for="ep-h-{pat.id}">Height (in)</label><input id="ep-h-{pat.id}" type="number" class="form-input form-input--sm" bind:value={editPatch.heightInches} min="0.1" step="0.1"/></div>
								<div class="form-group"><label class="form-label" for="ep-rev-{pat.id}">Revision</label><input id="ep-rev-{pat.id}" type="text" class="form-input form-input--sm" bind:value={editPatch.revision} placeholder="YYYY-MM"/></div>
							</div>
							<div class="form-group"><label class="form-label" for="ep-svg-{pat.id}">SVG path</label><textarea id="ep-svg-{pat.id}" class="form-input form-input--sm ep-svg-input" rows="3" spellcheck="false" bind:value={editPatch.svgPath}></textarea></div>
							<div class="form-group"><label class="form-label" for="ep-svgurl-{pat.id}">SVG URL <span class="form-label__opt">(optional)</span></label><input id="ep-svgurl-{pat.id}" type="text" class="form-input form-input--sm" bind:value={editPatch.svgUrl}/></div>
							<div class="form-group"><label class="form-label" for="ep-notes-{pat.id}">Notes</label><input id="ep-notes-{pat.id}" type="text" class="form-input form-input--sm" bind:value={editPatch.notes}/></div>
							<div class="pattern-edit-form__footer">
								<label class="toggle-label"><input type="checkbox" bind:checked={editPatch.isPublished}/>Published</label>
								<div class="ep-row-actions">
									<button class="btn-ghost btn-ghost--sm" onclick={() => (editPatternId = null)}>Cancel</button>
									<button class="btn-primary btn-primary--sm" disabled={seeding} onclick={saveEditPattern}>Save…</button>
								</div>
							</div>
						</div>
					</div>
				{:else}
					<div class="pattern-row">
						<div class="pattern-row__preview">
							<svg width="32" height="28" viewBox="0 0 100 100" fill="none" aria-hidden="true">
								<path d={pat.svgPath} use:fitPattern={{ w: pat.widthInches, h: pat.heightInches, d: pat.svgPath }} fill="{categoryMeta(editPanelTab).accent}22" stroke={categoryMeta(editPanelTab).accent} stroke-width="3" stroke-linecap="round"/>
							</svg>
							{#if pat.svgUrl}<span class="pattern-row__svg-link" use:tooltip={"Full SVG in Cloud Storage"}>SVG↗</span>{/if}
						</div>
						<div class="pattern-row__info">
							<div class="pattern-row__name">{pat.name}</div>
							<div class="pattern-row__meta">{pat.widthInches}" × {pat.heightInches}" · {zoneLabel(pat.category, pat.zone, pat.customZoneLabel, editingVehicle.projectType)}{pat.isPublished ? "" : " · draft"}</div>
						</div>
						<div class="ep-row-right">
							<button class="ep-toggle" class:ep-toggle--on={pat.isPublished} onclick={() => togglePatternPublished(pat)} use:tooltip={pat.isPublished ? "Unpublish" : "Publish"} aria-label={pat.isPublished ? "Unpublish" : "Publish"}>
								<span class="ep-toggle__dot"></span>
							</button>
							<button class="row-btn" onclick={() => startEditPattern(pat.id)} use:tooltip={"Edit pattern"} aria-label="Edit {pat.name}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
								<button
									class="row-btn row-btn--danger"
									onclick={() => confirmDeletePattern(pat)}
									use:tooltip={"Delete pattern"}
									aria-label="Delete {pat.name}"
								><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
						</div>
					</div>
				{/if}
			{/each}
		</div>

		<div class="edit-panel__footer">
			{#if !showAddPattern}
				<button class="ep-add-btn" onclick={() => { showAddPattern = true; editPatternId = null; }}>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
					Add pattern zone
				</button>
			{:else}
				<div class="ep-add-form">
					<div class="ep-add-form__title">New {categoryLabel(editPanelTab)} Pattern</div>
					<div class="form-row">
						<div class="form-group" style="flex:2"><label class="form-label" for="np-zone">Zone</label><select id="np-zone" class="form-input form-input--sm" bind:value={newPattern.zone}>{#each zoneOptions as z}<option value={z.value}>{z.label}</option>{/each}</select></div>
						<div class="form-group"><label class="form-label" for="np-coverage">Coverage</label><select id="np-coverage" class="form-input form-input--sm" bind:value={newPattern.coverage}><option value="full">Full</option><option value="partial">Partial</option><option value="edge-only">Edge only</option></select></div>
					</div>
					{#if newPattern.zone === "custom"}
						<div class="form-group"><label class="form-label" for="np-custom-zone">Custom Zone Name</label><input id="np-custom-zone" type="text" class="form-input form-input--sm" bind:value={newPattern.customZoneLabel} placeholder="e.g. Sunroof Trim, Rocker Panel Insert" required/></div>
					{/if}
					<div class="form-group"><label class="form-label" for="np-name">Pattern Name</label><input id="np-name" type="text" class="form-input form-input--sm" bind:value={newPattern.name} placeholder="e.g. Front Driver Window" required/></div>
					<div class="form-row">
						<div class="form-group"><label class="form-label" for="np-width">Width (in)</label><input id="np-width" type="number" class="form-input form-input--sm" bind:value={newPattern.widthInches} min="0.5" step="0.5"/></div>
						<div class="form-group"><label class="form-label" for="np-height">Height (in)</label><input id="np-height" type="number" class="form-input form-input--sm" bind:value={newPattern.heightInches} min="0.5" step="0.5"/></div>
					</div>
					<div class="form-group"><label class="form-label" for="np-svg">SVG path</label><textarea id="np-svg" class="form-input form-input--sm ep-svg-input" rows="3" spellcheck="false" bind:value={newPattern.svgPath} placeholder="M 0,0 L 100,0 …"></textarea></div>
					{#if newPattern.svgPath.trim()}
						<div class="ep-edit-preview">
							<PatternPreview svgPath={newPattern.svgPath} widthInches={Number(newPattern.widthInches)} heightInches={Number(newPattern.heightInches)} label="Preview of the new pattern" />
						</div>
					{/if}
					<div class="form-group"><label class="form-label" for="np-svgurl">SVG URL <span class="form-label__opt">(optional, Cloud Storage)</span></label><input id="np-svgurl" type="text" class="form-input form-input--sm" bind:value={newPattern.svgUrl} placeholder="https://.../pattern.svg"/></div>
					<div class="form-group"><label class="form-label" for="np-notes">Notes <span class="form-label__opt">(optional)</span></label><input id="np-notes" type="text" class="form-input form-input--sm" bind:value={newPattern.notes}/></div>
					<div class="ep-add-form__footer">
						<label class="toggle-label"><input type="checkbox" bind:checked={newPattern.isPublished}/>Publish immediately</label>
						<div class="ep-row-actions">
							<button class="btn-ghost btn-ghost--sm" onclick={() => (showAddPattern = false)}>Cancel</button>
							<button class="btn-primary btn-primary--sm" disabled={seeding || !!patternFormError(newPattern)} onclick={handleAddPattern} title={patternFormError(newPattern) ?? undefined}>Add pattern…</button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.patterns-page { padding: 24px; display: flex; flex-direction: column; gap: 20px; max-width: 1100px; margin: 0 auto; }

	.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
	.page-title  { font-size: 1.375rem; margin-bottom: 3px; }
	.page-sub    { font-size: 0.875rem; color: var(--text-secondary); }
	.page-header__actions { display: flex; align-items: center; gap: 8px; }

	/* ─── Summary ─── */
	.summary-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }

	.summary-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
	}
	.summary-card--accent {
		border-color: color-mix(in srgb, #f59e0b 35%, transparent);
		background: color-mix(in srgb, #f59e0b 5%, var(--bg-surface));
	}
	.summary-card__label { font-size: 0.6875rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.08em; font-family: var(--font-mono); margin-bottom: 6px; }
	.summary-card__value { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); }
	.summary-card__sub   { font-size: 0.75rem; color: var(--text-tertiary); font-family: var(--font-mono); margin-top: 2px; }

	/* ─── Sections ─── */
	.section { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); overflow: hidden; }

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border-subtle);
		flex-wrap: wrap;
		gap: 10px;
	}
	.section-header__left { display: flex; align-items: center; gap: 10px; }
	.section-title { font-size: 0.9375rem; font-weight: 600; }
	.section-sub   { font-size: 0.8125rem; color: var(--text-tertiary); font-family: var(--font-mono); }

	.badge-pending {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 0.6875rem;
		font-weight: 700;
		background: color-mix(in srgb, #f59e0b 15%, transparent);
		border: 1px solid color-mix(in srgb, #f59e0b 35%, transparent);
		color: #fbbf24;
	}

	.refresh-btn {
		width: 30px; height: 30px;
		display: flex; align-items: center; justify-content: center;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.12s;
	}
	.refresh-btn:hover { color: var(--text-primary); background: var(--bg-surface-3); }

	.cat-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 7px;
		font-size: 0.6875rem;
		font-weight: 600;
		font-family: var(--font-mono);
		letter-spacing: 0.03em;
		text-transform: uppercase;
		border-radius: 4px;
		border: 1px solid color-mix(in srgb, var(--cat-accent) 35%, transparent);
		background: color-mix(in srgb, var(--cat-accent) 12%, transparent);
		color: var(--cat-accent);
		white-space: nowrap;
	}
	.search-wrap { position: relative; }
	.search-icon { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
	.search-input { width: 220px; padding: 6px 10px 6px 28px; background: var(--bg-base); border: 1px solid var(--border-default); border-radius: var(--radius-md); font-size: 0.8125rem; font-family: var(--font-body); color: var(--text-primary); outline: none; transition: border-color 0.12s; }
	.search-input:focus { border-color: var(--color-brand-dim); }
	.search-input::placeholder { color: var(--text-tertiary); }

	/* ─── Table ─── */
	.table-wrap { overflow-x: auto; }
	.data-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; min-width: 640px; }
	.data-table thead { background: var(--bg-surface-2); }
	.data-table th { padding: 9px 14px; text-align: left; font-size: 0.625rem; font-weight: 600; font-family: var(--font-mono); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; border-bottom: 1px solid var(--border-subtle); }
	.data-table tbody tr { border-bottom: 1px solid var(--border-subtle); transition: background 0.1s; }
	.data-table tbody tr:last-child { border-bottom: none; }
	.data-table tbody tr:hover { background: var(--interactive-hover); }
	.data-table td { padding: 10px 14px; vertical-align: middle; }
	.th-actions { width: 120px; }

	.pattern-cell { display: flex; align-items: center; gap: 10px; }
	.cell-name { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); }
	.cell-meta { font-size: 0.6875rem; color: var(--text-tertiary); font-family: var(--font-mono); margin-top: 1px; }

	.vehicle-cell { display: flex; align-items: center; gap: 9px; }
	.vehicle-icon { width: 30px; height: 30px; border-radius: var(--radius-md); background: var(--bg-surface-3); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); flex-shrink: 0; }
	.vehicle-name { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); }

	.coverage-bar { display: inline-block; width: 64px; height: 4px; background: var(--bg-surface-3); border-radius: 2px; overflow: hidden; vertical-align: middle; margin-right: 6px; }
	.coverage-bar__fill { height: 100%; background: var(--color-success); border-radius: 2px; transition: width 0.3s; }
	.coverage-bar--tint .coverage-bar__fill { background: var(--color-brand-dim); }
	.coverage-pct { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); vertical-align: middle; }

	.td-mono    { font-family: var(--font-mono); font-size: 0.8125rem; }
	.td-date    { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap; }
	.td-vehicle { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); white-space: nowrap; }
	.td-notes   { font-size: 0.75rem; color: var(--text-tertiary); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.td-empty   { text-align: center; padding: 40px; color: var(--text-tertiary); }
	.td-muted   { font-size: 0.75rem; color: var(--text-tertiary); }

	.user-cell { display: flex; flex-direction: column; min-width: 0; }
	.user-cell + .user-cell { margin-top: 4px; }
	.user-cell__name {
		all: unset; cursor: pointer; font-size: 0.8125rem; font-weight: 500; color: var(--text-primary);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
	}
	.user-cell__name:hover { color: var(--color-brand); text-decoration: underline; }
	.user-cell__name:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; border-radius: 2px; }

	.user-filter { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
	.user-filter__label { font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
	.user-filter__select { width: auto; min-width: 240px; max-width: 100%; }
	.user-filter__summary { font-size: 0.75rem; color: var(--text-tertiary); font-family: var(--font-mono); }
	.td-loading { text-align: center; padding: 28px; color: var(--text-tertiary); display: flex; align-items: center; justify-content: center; gap: 8px; }
	.td-actions { width: 100px; }

	.votes-cell { display: flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: 0.8125rem; color: var(--text-secondary); }
	.row-done     { opacity: 0.45; }
	.row-resolved { opacity: 0.6; }

	.row-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.12s; align-items: center; }
	tr:hover .row-actions { opacity: 1; }
	.row-actions--always { opacity: 1; }

	.row-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; transition: all 0.12s; }
	.row-btn:hover { background: var(--bg-surface-3); color: var(--text-primary); }
	.row-btn--danger:hover { background: var(--color-error); color: #fff; border-color: transparent; }

	.delete-confirm {
		display: flex;
		align-items: center;
		gap: 4px;
		animation: confirm-in 0.1s ease;
	}
	@keyframes confirm-in {
		from { opacity: 0; transform: scale(0.95); }
		to   { opacity: 1; transform: scale(1); }
	}
	.delete-confirm__label {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-danger, #f44);
		white-space: nowrap;
		font-family: var(--font-mono);
	}
	.delete-confirm__yes,
	.delete-confirm__no {
		padding: 2px 7px;
		font-size: 0.6875rem;
		font-weight: 600;
		font-family: var(--font-body);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		cursor: pointer;
		transition: background 0.1s, color 0.1s;
	}
	.delete-confirm__yes {
		background: color-mix(in srgb, #f44 12%, transparent);
		border-color: color-mix(in srgb, #f44 35%, transparent);
		color: #f66;
	}
	.delete-confirm__yes:hover { background: #f44; color: #fff; border-color: #f44; }
	.delete-confirm__no {
		background: var(--bg-surface-2);
		border-color: var(--border-default);
		color: var(--text-tertiary);
	}
	.delete-confirm__no:hover { background: var(--bg-surface-3); color: var(--text-primary); }

	.action-btn { padding: 4px 10px; font-size: 0.75rem; font-weight: 500; font-family: var(--font-body); background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; transition: all 0.12s; white-space: nowrap; }
	.action-btn:hover { background: var(--bg-surface-3); color: var(--text-primary); }
	.action-btn--primary { border-color: color-mix(in srgb, var(--color-brand) 45%, transparent); color: var(--color-brand); background: color-mix(in srgb, var(--color-brand) 8%, var(--bg-surface-2)); }
	.action-btn--primary:hover { background: color-mix(in srgb, var(--color-brand) 16%, var(--bg-surface-2)); }

	.adj-request-notes { background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 10px 12px; }
	.adj-request-notes__text { font-size: 0.875rem; color: var(--text-primary); line-height: 1.5; margin: 0; white-space: pre-wrap; }

	/* ─── Review Panel ─── */
	.review-panel {
		position: fixed; top: 0; right: 0; height: 100vh; width: 520px; max-width: 95vw;
		background: var(--bg-surface); border-left: 1px solid var(--border-default);
		box-shadow: -8px 0 32px rgba(0,0,0,0.25); z-index: 100;
		display: flex; flex-direction: column; overflow: hidden;
		animation: ep-slide-in 0.2s ease;
	}
	.review-panel__header { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
	.review-panel__sub   { font-size: 0.6875rem; color: var(--text-tertiary); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
	.review-panel__title { font-size: 1rem; font-weight: 600; }
	.review-panel__body  { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 18px; }
	.review-panel__footer { border-top: 1px solid var(--border-subtle); padding: 14px 20px; display: flex; gap: 10px; justify-content: flex-end; flex-shrink: 0; }

	.review-preview {
		width: 100%; aspect-ratio: 16/9;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		background: var(--bg-surface-2);
		display: flex; align-items: center; justify-content: center;
		padding: 16px; overflow: hidden;
	}
	.review-preview svg { width: 100%; height: 100%; }

	.review-meta { display: flex; flex-direction: column; gap: 8px; }
	.review-meta__row { display: flex; align-items: flex-start; gap: 12px; }
	.review-meta__label { font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-tertiary); width: 120px; flex-shrink: 0; padding-top: 1px; }
	.review-meta__val   { font-size: 0.875rem; color: var(--text-primary); }
	.review-meta__val--notes { color: var(--text-secondary); font-style: italic; line-height: 1.5; }

	.review-edits { background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
	.review-edits__title { font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px; }

	.btn-approve {
		padding: 8px 20px; font-size: 0.875rem; font-weight: 600; font-family: var(--font-body);
		background: var(--color-brand); border: none; border-radius: var(--radius-md); color: #fff;
		cursor: pointer; transition: filter 0.12s;
	}
	.btn-approve:hover:not(:disabled) { filter: brightness(1.1); }
	.btn-approve:disabled { opacity: 0.5; cursor: not-allowed; }

	/* Subjects: type tabs (primary) + category/status chips (secondary) */
	.subj-tabs {
		display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none;
		border-bottom: 1px solid var(--border-subtle); margin: 0 0 12px;
	}
	.subj-tabs::-webkit-scrollbar { display: none; }
	.subj-tab {
		all: unset; box-sizing: border-box; cursor: pointer; white-space: nowrap;
		display: inline-flex; align-items: center; gap: 7px;
		padding: 9px 12px 10px; margin-bottom: -1px;
		font-size: 0.8125rem; font-weight: 500; color: var(--text-tertiary);
		border-bottom: 2px solid transparent; transition: color 0.12s, border-color 0.12s;
	}
	.subj-tab:hover { color: var(--text-primary); }
	.subj-tab:focus-visible { outline: 2px solid var(--color-brand); outline-offset: -2px; border-radius: var(--radius-sm); }
	.subj-tab--active { color: var(--text-primary); border-bottom-color: var(--color-brand); }
	.subj-tab__count {
		font-family: var(--font-mono); font-size: 0.6875rem; line-height: 1;
		padding: 2px 6px; border-radius: 999px;
		background: var(--bg-surface-3); color: var(--text-tertiary);
	}
	.subj-tab--active .subj-tab__count { background: color-mix(in srgb, var(--color-brand) 15%, transparent); color: var(--text-brand); }

	.subj-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 24px; margin-bottom: 14px; }
	.subj-filters__group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
	.subj-filters__label {
		font-size: 0.625rem; font-weight: 600; font-family: var(--font-mono);
		text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); margin-right: 2px;
	}
	.chip {
		all: unset; box-sizing: border-box; cursor: pointer;
		display: inline-flex; align-items: center; gap: 6px;
		padding: 4px 10px; border-radius: 999px;
		border: 1px solid var(--border-default); background: var(--bg-surface);
		font-size: 0.75rem; font-weight: 500; color: var(--text-secondary);
		transition: background 0.12s, border-color 0.12s, color 0.12s;
	}
	.chip:hover { background: var(--interactive-hover); color: var(--text-primary); }
	.chip:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
	.chip--active { background: var(--bg-surface-3); border-color: var(--text-tertiary); color: var(--text-primary); }
	.chip__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--cat-accent, var(--text-tertiary)); }
	.chip__count { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); }

	/* Clickable rows open the details drawer */
	.row-clickable { cursor: pointer; }
	.row-clickable:focus-visible { outline: 2px solid var(--color-brand); outline-offset: -2px; }

	/* Details drawer */
	.review-panel--wide { width: 640px; }
	.dv-subtitle { font-size: 0.8125rem; color: var(--text-secondary); margin-top: 2px; }
	.dv-grid { display: grid; grid-template-columns: 150px 1fr; gap: 8px 14px; margin: 0; font-size: 0.8125rem; }
	.dv-grid dt { color: var(--text-tertiary); }
	.dv-grid dd { margin: 0; color: var(--text-primary); min-width: 0; overflow-wrap: anywhere; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
	.dv-grid--tight { grid-template-columns: 90px 1fr; gap: 5px 10px; font-size: 0.75rem; }
	.dv-mono { font-family: var(--font-mono); font-size: 0.75rem; }
	.dv-pre  { white-space: pre-wrap; }
	.dv-muted { color: var(--text-tertiary); font-size: 0.8125rem; margin: 0; }
	.dv-link { all: unset; cursor: pointer; color: var(--text-brand); font-size: 0.75rem; }
	.dv-link:hover { text-decoration: underline; }
	.dv-link:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; border-radius: 2px; }
	.dv-section { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 1px solid var(--border-subtle); }
	.dv-h { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 0.8125rem; font-weight: 600; color: var(--text-primary); }
	.dv-count { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); font-weight: 400; }
	.dv-raw { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
	.dv-code {
		width: 100%; margin: 0; max-height: 180px; overflow: auto; padding: 10px;
		background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
		font-family: var(--font-mono); font-size: 0.6875rem; line-height: 1.5; color: var(--text-secondary);
		white-space: pre-wrap; word-break: break-all;
	}
	.dv-patterns { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
	.dv-pattern { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--bg-surface-2); min-width: 0; }
	.dv-pattern__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	.dv-pattern__name { font-size: 0.875rem; font-weight: 600; color: var(--text-primary); }
	.dv-card {
		all: unset; box-sizing: border-box; cursor: pointer; width: 100%;
		display: flex; align-items: center; gap: 10px; padding: 8px 10px;
		border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: 0.8125rem;
	}
	.dv-card:hover { background: var(--interactive-hover); }
	.dv-card:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
	.dv-card__main { flex: 1; min-width: 0; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
	@media (max-width: 560px) {
		.dv-grid { grid-template-columns: 1fr; gap: 2px; }
		.dv-grid dd { margin-bottom: 8px; }
	}

	.form-group--check { justify-content: flex-end; padding-bottom: 8px; }
	.ep-edit-preview :global(.pp--large .pp__frame) { height: 160px; }
	.ep-svg-input { font-family: var(--font-mono); font-size: 0.6875rem; resize: vertical; min-height: 56px; }
	.btn-ghost--danger { color: var(--color-danger); border-color: color-mix(in srgb, var(--color-danger) 40%, transparent); margin-right: auto; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

	.req-cell { display: inline-flex; align-items: center; gap: 8px; }
	.req-cell__icon { display: inline-flex; color: var(--text-tertiary); }

	.catalog-banner {
		margin-bottom: 20px;
		padding: 12px 14px;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 40%, transparent);
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 8%, transparent);
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-secondary);
	}
	.catalog-banner strong { color: var(--text-primary); }
	.row-btn:disabled { opacity: 0.35; cursor: not-allowed; }

	.btn-reject {
		padding: 8px 16px; font-size: 0.875rem; font-weight: 600; font-family: var(--font-body);
		background: transparent; border: 1px solid color-mix(in srgb, #f44 40%, transparent);
		border-radius: var(--radius-md); color: #f66; cursor: pointer; transition: background 0.12s;
	}
	.btn-reject:hover:not(:disabled) { background: color-mix(in srgb, #f44 10%, transparent); }
	.btn-reject:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-reject-sm { padding: 7px 14px; font-size: 0.8125rem; font-weight: 600; font-family: var(--font-body); background: transparent; border: 1px solid color-mix(in srgb, #f44 40%, transparent); border-radius: var(--radius-md); color: #f66; cursor: pointer; transition: background 0.12s; }
	.btn-reject-sm:hover:not(:disabled) { background: color-mix(in srgb, #f44 10%, transparent); }
	.btn-reject-sm:disabled { opacity: 0.5; cursor: not-allowed; }

	/* ─── Modal ─── */
	.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
	.modal { background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-xl); width: 480px; max-width: 95vw; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
	.modal__header { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px 16px; border-bottom: 1px solid var(--border-subtle); gap: 12px; }
	.modal__title  { font-size: 1.0625rem; font-weight: 600; }
	.modal__close  { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; flex-shrink: 0; transition: all 0.12s; }
	.modal__close:hover { background: var(--bg-surface-3); color: var(--text-primary); }
	.modal__body   { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
	.modal__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }

	/* ─── Shared form ─── */
	.form-row   { display: flex; gap: 10px; }
	.form-group { display: flex; flex-direction: column; gap: 5px; flex: 1; }
	.form-label { font-size: 0.75rem; font-weight: 500; color: var(--text-secondary); font-family: var(--font-mono); }
	.form-label__opt { font-weight: 400; color: var(--text-tertiary); }
	.form-input { padding: 7px 10px; background: var(--bg-base); border: 1px solid var(--border-default); border-radius: var(--radius-md); font-size: 0.8125rem; font-family: var(--font-body); color: var(--text-primary); outline: none; transition: border-color 0.12s; width: 100%; }
	.form-input:focus { border-color: var(--color-brand-dim); }
	.form-input--sm { padding: 5px 8px; font-size: 0.75rem; }
	.btn-primary { padding: 7px 16px; font-size: 0.8125rem; font-weight: 600; font-family: var(--font-body); background: var(--color-brand-dim); border: none; border-radius: var(--radius-md); color: #fff; cursor: pointer; transition: background 0.12s; }
	.btn-primary:hover:not(:disabled) { background: var(--color-brand); }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-primary--sm { padding: 5px 12px; font-size: 0.75rem; }
	.btn-ghost { padding: 7px 16px; font-size: 0.8125rem; font-weight: 500; font-family: var(--font-body); background: transparent; border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; transition: all 0.12s; }
	.btn-ghost:hover { background: var(--bg-surface-3); color: var(--text-primary); }
	.btn-ghost--sm { padding: 5px 12px; font-size: 0.75rem; }
	.toggle-label { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; color: var(--text-secondary); cursor: pointer; }

	/* ─── Edit Panel ─── */
	.panel-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 99; }
	.edit-panel { position: fixed; top: 0; right: 0; height: 100vh; width: 480px; max-width: 95vw; background: var(--bg-surface); border-left: 1px solid var(--border-default); box-shadow: -8px 0 32px rgba(0,0,0,0.2); z-index: 100; display: flex; flex-direction: column; overflow: hidden; animation: ep-slide-in 0.2s ease; }
	@keyframes ep-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
	.edit-panel__header { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
	.edit-panel__sub   { font-size: 0.6875rem; color: var(--text-tertiary); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
	.edit-panel__title { font-size: 1rem; font-weight: 600; }
	.edit-panel__tabs  { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 20px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
	.ep-tab { display: flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 0.8125rem; font-weight: 500; font-family: var(--font-body); background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: var(--text-tertiary); cursor: pointer; transition: all 0.12s; }
	.ep-tab__icon { display: flex; color: color-mix(in srgb, var(--cat-accent) 70%, var(--text-tertiary)); }
	.ep-tab:hover  { color: var(--text-primary); border-color: color-mix(in srgb, var(--cat-accent) 40%, var(--border-subtle)); }
	.ep-tab.active { background: color-mix(in srgb, var(--cat-accent) 14%, var(--bg-surface-3)); color: var(--text-primary); border-color: var(--cat-accent); }
	.ep-tab.active .ep-tab__icon { color: var(--cat-accent); }
	.ep-tab__count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px; background: var(--bg-surface-2); border-radius: var(--radius-sm); font-size: 0.625rem; font-family: var(--font-mono); color: var(--text-tertiary); }
	.ep-tab.active .ep-tab__count { background: var(--cat-accent); color: #fff; }
	.edit-panel__list   { flex: 1; overflow-y: auto; padding: 12px 0; }
	.ep-empty { text-align: center; padding: 32px 24px; font-size: 0.8125rem; color: var(--text-tertiary); line-height: 1.6; }
	.pattern-row { display: flex; align-items: center; gap: 10px; padding: 10px 20px; border-bottom: 1px solid var(--border-subtle); transition: background 0.1s; }
	.pattern-row:last-child { border-bottom: none; }
	.pattern-row:hover { background: var(--interactive-hover); }
	.pattern-row--editing { align-items: flex-start; background: var(--bg-surface-2); }
	.pattern-row__preview { width: 44px; height: 38px; display: flex; align-items: center; justify-content: center; position: relative; background: var(--bg-surface-2); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); flex-shrink: 0; }
	.pattern-row__svg-link { position: absolute; bottom: -4px; right: -4px; font-size: 0.5625rem; font-family: var(--font-mono); color: var(--color-brand); background: var(--bg-surface-1); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 0 3px; line-height: 1.4; }
	.pattern-row__info { flex: 1; min-width: 0; }
	.pattern-row__name { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pattern-row__meta { font-size: 0.6875rem; font-family: var(--font-mono); color: var(--text-tertiary); margin-top: 2px; }
	.ep-row-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
	.ep-toggle { width: 32px; height: 18px; border-radius: 9px; background: var(--bg-surface-3); border: 1px solid var(--border-default); cursor: pointer; position: relative; transition: background 0.15s, border-color 0.15s; flex-shrink: 0; }
	.ep-toggle--on { background: var(--color-success); border-color: var(--color-success); }
	.ep-toggle__dot { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform 0.15s; display: block; }
	.ep-toggle--on .ep-toggle__dot { transform: translateX(14px); }
	.pattern-edit-form { flex: 1; display: flex; flex-direction: column; gap: 10px; }
	.pattern-edit-form__footer { display: flex; align-items: center; justify-content: space-between; }
	.ep-row-actions { display: flex; gap: 6px; }
	.edit-panel__footer { border-top: 1px solid var(--border-subtle); padding: 14px 20px; flex-shrink: 0; }
	.ep-add-btn { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 12px; font-size: 0.8125rem; font-weight: 500; font-family: var(--font-body); background: var(--bg-surface-2); border: 1px dashed var(--border-default); border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; justify-content: center; transition: all 0.12s; }
	.ep-add-btn:hover { border-color: var(--color-brand-dim); color: var(--text-brand); }
	.ep-add-form { display: flex; flex-direction: column; gap: 10px; }
	.ep-add-form__title { font-size: 0.8125rem; font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
	.ep-add-form__footer { display: flex; align-items: center; justify-content: space-between; padding-top: 4px; }

	@media (max-width: 1200px) { .summary-row { grid-template-columns: repeat(3, 1fr); } }
	@media (max-width: 1024px) { .summary-row { grid-template-columns: repeat(2, 1fr); } }
	@media (max-width: 640px) {
		.patterns-page { padding: 16px; }
		.summary-row   { grid-template-columns: 1fr; }
	}
	@media (max-width: 480px) {
		.form-row { flex-direction: column; }
		.search-input { width: 100%; }
	}
</style>
