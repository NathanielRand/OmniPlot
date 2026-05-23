<script lang="ts">
	import { onMount } from "svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { toastStore, themeStore, plotterStore, userStore, uiStore } from "$lib/stores";
	import { PLOTTER_PRESETS, PRICING_PLANS, SHOP_PRICING_PLANS } from "$lib/config";
	import {
		getShop,
		getShopMembers,
		createShop,
		createShopInvite,
		getShopInvitesByShop,
		removeShopMember,
		updateShopMemberRole,
		revokeShopInvite,
	} from "$lib/firebase/firestore";
	import { auth } from "$lib/firebase/client";
	import type { Shop, ShopMember, ShopInvite, ShopRole, ShopPlan } from "$lib/types";

	let activeTab = $state<
		"profile" | "plotter" | "billing" | "notifications" | "team" | "danger"
	>("profile");

	// Profile form
	let displayName = $state("Nick Radford");
	let email = $state("nick@omniplot.app");
	let shopName = $state("Radford Auto Wraps");
	let saving = $state(false);

	async function saveProfile() {
		saving = true;
		await new Promise((r) => setTimeout(r, 800));
		saving = false;
		toastStore.success("Profile saved", "Your changes have been applied.");
	}

	// Notification prefs
	let notifs = $state({
		jobComplete: true,
		jobFailed: true,
		usageWarning: true,
		newsletter: false,
		changelog: true,
	});

	// ─── Team / Shop state ────────────────────────
	let shop           = $state<Shop | null>(null);
	let members        = $state<ShopMember[]>([]);
	let pendingInvites = $state<ShopInvite[]>([]);
	let shopLoading    = $state(false);
	let newShopName    = $state("");
	let newShopPlan    = $state<ShopPlan>("starter");
	let creatingShop   = $state(false);
	let newInviteRole  = $state<ShopRole>("tech");
	let creatingInvite = $state(false);
	let newInviteLink  = $state("");
	let copiedLink     = $state(false);

	const SHOP_PLAN_LABELS: Record<ShopPlan, string> = {
		starter: "Starter — 3 seats",
		team:    "Team — 10 seats",
		studio:  "Studio — 25 seats",
	};
	const ROLE_LABELS: Record<ShopRole, string> = {
		owner:   "Owner",
		manager: "Manager",
		tech:    "Technician",
	};

	// ─── Billing state ────────────────────────────
	let portalLoading    = $state(false);
	let checkoutLoading  = $state(false);

	async function handlePortal(type: "individual" | "shop" = "individual") {
		if (!userStore.user) return;
		portalLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch("/api/billing/portal", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({
					type,
					...(type === "shop" ? { shopId: userStore.user.shopId } : {}),
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? "Portal unavailable");
			const { url } = await res.json();
			window.location.href = url;
		} catch (err) {
			toastStore.error("Billing portal unavailable", err instanceof Error ? err.message : "");
		} finally {
			portalLoading = false;
		}
	}

	async function redirectToShopCheckout(shopId: string, plan: ShopPlan) {
		const shopPlan = SHOP_PRICING_PLANS.find((p) => p.id === plan);
		const priceId  = shopPlan?.stripePriceId;
		if (!priceId) return; // no price configured yet — skip checkout
		checkoutLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch("/api/billing/checkout", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({ priceId, type: "shop", shopId, plan }),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? "Checkout failed");
			const { url } = await res.json();
			window.location.href = url;
		} catch (err) {
			toastStore.error("Checkout failed", err instanceof Error ? err.message : "");
		} finally {
			checkoutLoading = false;
		}
	}

	onMount(() => {
		// Sync tab and checkout-success from URL params
		const params   = new URLSearchParams(window.location.search);
		const urlTab   = params.get("tab");
		const validTab = ["profile","plotter","billing","notifications","team","danger"] as const;
		if (urlTab && validTab.includes(urlTab as typeof validTab[number])) {
			activeTab = urlTab as typeof activeTab;
		}
		if (params.get("checkout") === "success") {
			toastStore.success("Subscription activated!", "Your new plan is now active.");
		}
		loadShopData();
	});

	async function loadShopData() {
		if (!userStore.user?.shopId) return;
		shopLoading = true;
		try {
			const [s, m, i] = await Promise.all([
				getShop(userStore.user.shopId),
				getShopMembers(userStore.user.shopId),
				getShopInvitesByShop(userStore.user.shopId).catch(() => [] as ShopInvite[]),
			]);
			shop = s;
			members = m;
			pendingInvites = i;
		} catch {
			// Non-fatal; user may not have Firestore rules set up yet
		} finally {
			shopLoading = false;
		}
	}

	async function handleCreateShop(e: Event) {
		e.preventDefault();
		if (!newShopName || !userStore.user) return;
		creatingShop = true;
		try {
			const s = await createShop(userStore.user.uid, newShopName, newShopPlan);
			shop = s;
			members = [{
				uid: userStore.user.uid,
				shopId: s.id,
				role: "owner",
				displayName: userStore.user.displayName,
				email: userStore.user.email,
				joinedAt: new Date(),
			}];
			toastStore.success("Shop created", "Redirecting to billing…");
			// Kick off Stripe checkout for the chosen plan
			await redirectToShopCheckout(s.id, newShopPlan);
		} catch (err) {
			toastStore.error("Couldn't create shop", err instanceof Error ? err.message : "");
			creatingShop = false;
		}
	}

	async function handleGenerateInvite() {
		if (!shop || !userStore.user) return;
		creatingInvite = true;
		try {
			const inv = await createShopInvite(shop.id, shop.name, userStore.user.uid, newInviteRole);
			newInviteLink = `${window.location.origin}/join/${inv.id}`;
			pendingInvites = [inv, ...pendingInvites];
		} catch (err) {
			toastStore.error("Couldn't create invite", err instanceof Error ? err.message : "");
		} finally {
			creatingInvite = false;
		}
	}

	async function handleCopyLink() {
		if (!newInviteLink) return;
		await navigator.clipboard.writeText(newInviteLink);
		copiedLink = true;
		setTimeout(() => { copiedLink = false; }, 2000);
	}

	async function handleRemoveMember(uid: string) {
		if (!shop) return;
		try {
			await removeShopMember(shop.id, uid);
			members = members.filter((m) => m.uid !== uid);
			toastStore.success("Member removed");
		} catch (err) {
			toastStore.error("Couldn't remove member", err instanceof Error ? err.message : "");
		}
	}

	async function handleRoleChange(uid: string, role: ShopRole) {
		if (!shop) return;
		try {
			await updateShopMemberRole(shop.id, uid, role);
			members = members.map((m) => (m.uid === uid ? { ...m, role } : m));
		} catch (err) {
			toastStore.error("Couldn't update role", err instanceof Error ? err.message : "");
		}
	}

	async function handleLeaveShop() {
		if (!shop || !userStore.user) return;
		try {
			await removeShopMember(shop.id, userStore.user.uid);
			shop = null;
			members = [];
			pendingInvites = [];
			toastStore.success("Left shop", "You've been removed from the team.");
		} catch (err) {
			toastStore.error("Couldn't leave shop", err instanceof Error ? err.message : "");
		}
	}

	async function handleRevokeInvite(token: string) {
		try {
			await revokeShopInvite(token);
			pendingInvites = pendingInvites.filter((i) => i.id !== token);
			toastStore.success("Invite revoked");
		} catch (err) {
			toastStore.error("Couldn't revoke invite", err instanceof Error ? err.message : "");
		}
	}

	const isShopManager = $derived(
		userStore.user?.shopRole === "owner" || userStore.user?.shopRole === "manager"
	);

	const TABS = [
		{
			id: "profile",
			label: "Profile",
			icon: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
		},
		{
			id: "plotter",
			label: "Plotter",
			icon: "M6 6a3 3 0 100-6 3 3 0 000 6zM6 18a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12",
		},
		{
			id: "billing",
			label: "Billing",
			icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
		},
		{
			id: "notifications",
			label: "Notifications",
			icon: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0",
		},
		{
			id: "team",
			label: "Team",
			icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
		},
		{
			id: "danger",
			label: "Danger Zone",
			icon: "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
		},
	] as const;

	const PLAN_NAMES: Record<string, string> = { free: "Free", lite: "Lite", pro: "Pro", admin: "Admin" };

	function fmtDate(d: Date | null | undefined) {
		if (!d) return "—";
		return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
	}
</script>

<svelte:head><title>Settings — OmniPlot</title></svelte:head>

<div class="settings-page">
	<!-- Sidebar nav -->
	<nav class="settings-nav" aria-label="Settings sections">
		{#each TABS as tab}
			<button
				class="settings-nav-item"
				class:active={activeTab === tab.id}
				class:danger={tab.id === "danger"}
				onclick={() => (activeTab = tab.id)}
				aria-current={activeTab === tab.id ? "page" : undefined}
			>
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d={tab.icon} />
				</svg>
				{tab.label}
			</button>
		{/each}
	</nav>

	<!-- Content -->
	<div class="settings-content">
		<!-- ─── Profile ─── -->
		{#if activeTab === "profile"}
			<div class="settings-section">
				<h2 class="settings-section-title">Profile</h2>
				<p class="settings-section-sub">
					Your account information and shop details.
				</p>

				<div class="form-grid">
					<div class="form-field">
						<label for="displayName" class="form-label"
							>Display name</label
						>
						<input
							id="displayName"
							class="form-input"
							type="text"
							bind:value={displayName}
						/>
					</div>
					<div class="form-field">
						<label for="email" class="form-label">Email</label>
						<input
							id="email"
							class="form-input"
							type="email"
							bind:value={email}
						/>
					</div>
					<div class="form-field form-field--full">
						<label for="shopName" class="form-label"
							>Shop / Business name</label
						>
						<input
							id="shopName"
							class="form-input"
							type="text"
							bind:value={shopName}
						/>
					</div>
				</div>

				<div class="form-actions">
					<Button
						variant="primary"
						size="sm"
						loading={saving}
						onclick={saveProfile}
					>
						Save changes
					</Button>
				</div>
			</div>

			<div class="settings-divider" aria-hidden="true"></div>

			<div class="settings-section">
				<h3 class="settings-section-title">Appearance</h3>
				<div class="appearance-row">
					<div>
						<div class="form-label">Theme</div>
						<p class="form-hint">
							Choose how OmniPlot looks for you.
						</p>
					</div>
					<div
						class="theme-options"
						role="group"
						aria-label="Theme selection"
					>
						{#each ["dark", "light"] as const as t}
							<button
								class="theme-option"
								class:active={themeStore.current === t}
								onclick={() => themeStore.set(t)}
								aria-pressed={themeStore.current === t}
							>
								<div
									class="theme-option__preview theme-option__preview--{t}"
									aria-hidden="true"
								></div>
								<span
									>{t.charAt(0).toUpperCase() +
										t.slice(1)}</span
								>
							</button>
						{/each}
					</div>
				</div>
			</div>

			{#if userStore.user?.shopId && shop}
				<div class="settings-divider" aria-hidden="true"></div>
				<div class="settings-section">
					<h3 class="settings-section-title">Team membership</h3>
					<div class="membership-card">
						<div class="membership-icon" aria-hidden="true">{shop.name.charAt(0).toUpperCase()}</div>
						<div class="membership-info">
							<span class="membership-name">{shop.name}</span>
							<span class="membership-role">{ROLE_LABELS[userStore.user.shopRole ?? "tech"] ?? userStore.user.shopRole}</span>
						</div>
						<button class="btn-link-sm" onclick={() => activeTab = "team"}>Manage team →</button>
					</div>
				</div>
			{/if}

			<!-- ─── Plotter ─── -->
		{:else if activeTab === "plotter"}
			<div class="settings-section">
				<h2 class="settings-section-title">Plotter Settings</h2>
				<p class="settings-section-sub">
					Configure your cutting device. Settings are saved
					per-session.
				</p>

				<div class="form-field">
					<label for="plotterPreset" class="form-label"
						>Device preset</label
					>
					<select
						id="plotterPreset"
						class="form-select"
						onchange={(e) => {
							const p = PLOTTER_PRESETS.find(
								(pr) =>
									pr.name ===
									(e.target as HTMLSelectElement).value,
							);
							if (p) plotterStore.applyPreset(p);
							toastStore.success("Preset applied", p?.name);
						}}
					>
						{#each PLOTTER_PRESETS as preset}
							<option
								value={preset.name}
								selected={plotterStore.config.name ===
									preset.name}>{preset.name}</option
							>
						{/each}
					</select>
				</div>

				<div class="form-grid">
					{#each [["Blade Force (g)", "bladeForce", 10, 200], ["Speed (mm/s)", "cuttingSpeed", 50, 900], ["Passes", "passes", 1, 4], ["Overcut (mm)", "overcut", 0, 2]] as const as [label, key, min, max]}
						<div class="form-field">
							<label class="form-label">{label}</label>
							<div class="slider-row">
								<input
									type="range"
									class="form-slider"
									{min}
									{max}
									step={key === "overcut" ? 0.1 : 1}
									value={plotterStore.config[key]}
									aria-label={label}
									oninput={(e) =>
										plotterStore.update({
											[key]: parseFloat(
												(e.target as HTMLInputElement)
													.value,
											),
										})}
								/>
								<span class="slider-val"
									>{plotterStore.config[key]}</span
								>
							</div>
						</div>
					{/each}
				</div>

				<div class="form-field">
					<label for="connection" class="form-label"
						>Connection method</label
					>
					<select
						id="connection"
						class="form-select"
						onchange={(e) =>
							plotterStore.update({
								connection: (e.target as HTMLSelectElement)
									.value as any,
							})}
					>
						<option value="download"
							>Download PLT file (universal)</option
						>
						<option value="usb-serial"
							>USB via Web Serial API (Chrome/Edge only)</option
						>
						<option value="network">Network TCP/IP</option>
						<option value="cut-agent">Local Cut Agent</option>
					</select>
					<p class="form-hint">
						Web Serial requires Chrome or Edge. All other methods
						work in any browser.
					</p>
				</div>

				<div class="form-actions">
					<Button
						variant="primary"
						size="sm"
						onclick={() =>
							toastStore.success("Plotter settings saved")}
					>
						Save plotter settings
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onclick={() =>
							toastStore.info(
								"Test cut sent",
								'A 1" × 1" test square was sent to your plotter.',
							)}
					>
						Send test cut
					</Button>
				</div>
			</div>

			<!-- ─── Billing ─── -->
		{:else if activeTab === "billing"}
			{@const user       = userStore.user}
			{@const tier       = user?.tier ?? "free"}
			{@const sub        = user?.subscription}
			{@const usage      = user?.usage}
			{@const limit      = tier === "free" ? 1 : tier === "lite" ? null : null}
			{@const cutCount   = usage?.monthlyCount ?? 0}
			{@const usagePct   = limit ? Math.min(100, Math.round((cutCount / limit) * 100)) : 0}

			<div class="settings-section">
				<h2 class="settings-section-title">Plan & Billing</h2>
				<p class="settings-section-sub">Manage your subscription and usage.</p>

				<!-- Current plan card -->
				<div class="billing-current">
					<div class="billing-plan">
						<div class="billing-plan__header">
							<div>
								<div class="billing-plan__name">{PLAN_NAMES[tier] ?? tier} Plan</div>
								{#if sub?.status === "active" && sub.currentPeriodEnd}
									<div class="billing-plan__desc">Renews {fmtDate(sub.currentPeriodEnd)}</div>
								{:else if sub?.status === "trialing" && sub.trialEnd}
									<div class="billing-plan__desc">Trial ends {fmtDate(sub.trialEnd)}</div>
								{:else if sub?.status === "past_due"}
									<div class="billing-plan__desc billing-plan__desc--warn">Payment past due — please update your card</div>
								{:else if sub?.status === "canceled" && sub.currentPeriodEnd}
									<div class="billing-plan__desc billing-plan__desc--warn">Access until {fmtDate(sub.currentPeriodEnd)}</div>
								{:else if tier === "free"}
									<div class="billing-plan__desc">1 cut per 30 days</div>
								{/if}
							</div>
							<Badge variant={tier === "lite" ? "lite" : tier === "pro" ? "pro" : "free"}>
								{PLAN_NAMES[tier] ?? tier}
							</Badge>
						</div>

						{#if tier === "free" && limit}
							<div class="billing-plan__usage">
								<div class="usage-row">
									<span class="usage-label">Cuts this period</span>
									<span class="usage-val">{cutCount} / {limit}</span>
								</div>
								<div class="usage-bar-track" role="progressbar" aria-valuenow={cutCount} aria-valuemax={limit}>
									<div class="usage-bar-fill" class:usage-bar-fill--warn={usagePct >= 80} style="width:{usagePct}%"></div>
								</div>
							</div>
						{:else if tier !== "free"}
							<div class="billing-plan__usage">
								<div class="usage-row">
									<span class="usage-label">Cuts this month</span>
									<span class="usage-val">{cutCount} <span style="color:var(--text-tertiary)">/ unlimited</span></span>
								</div>
							</div>
						{/if}

						<div class="billing-plan__actions">
							{#if sub?.stripeCustomerId}
								<Button variant="secondary" size="sm" loading={portalLoading} onclick={() => handlePortal("individual")}>
									Manage billing
								</Button>
							{/if}
							{#if tier !== "pro" && tier !== "admin"}
								<Button variant="primary" size="sm" onclick={uiStore.openPricing}>
									Upgrade plan
								</Button>
							{/if}
						</div>
					</div>
				</div>

				{#if sub?.status === "past_due"}
					<div class="billing-alert">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
						Payment failed. Please update your payment method to keep access.
						<Button variant="danger" size="sm" loading={portalLoading} onclick={() => handlePortal("individual")}>
							Update card
						</Button>
					</div>
				{/if}

				<!-- Billing history note -->
				<div class="settings-section" style="margin-top:24px">
					<h3 class="settings-section-title">Billing history</h3>
					{#if sub?.stripeCustomerId}
						<p class="billing-portal-note">
							View invoices, download receipts, and update your payment method in the
							<button class="btn-link" onclick={() => handlePortal("individual")}>Stripe billing portal</button>.
						</p>
					{:else}
						<div class="billing-empty">No invoices yet.</div>
					{/if}
				</div>
			</div>

			<!-- ─── Notifications ─── -->
		{:else if activeTab === "notifications"}
			<div class="settings-section">
				<h2 class="settings-section-title">Notifications</h2>
				<p class="settings-section-sub">
					Control what emails and alerts you receive.
				</p>

				<div class="notif-list">
					{#each [["jobComplete", "Job complete", "Get notified when a cut job finishes."], ["jobFailed", "Job failed", "Get notified when a cut job fails or has errors."], ["usageWarning", "Usage warning", "Alert when you're approaching your tier limit."], ["changelog", "Changelog", "Notify me about new features and updates."], ["newsletter", "Newsletter", "Occasional tips, tutorials, and news."]] as const as [key, label, desc]}
						<div class="notif-row">
							<div>
								<div class="notif-label">{label}</div>
								<div class="notif-desc">{desc}</div>
							</div>
							<button
								class="toggle"
								class:on={notifs[key]}
								role="switch"
								aria-checked={notifs[key]}
								aria-label={label}
								onclick={() =>
									(notifs = {
										...notifs,
										[key]: !notifs[key],
									})}
							>
								<span class="toggle__thumb" aria-hidden="true"
								></span>
							</button>
						</div>
					{/each}
				</div>

				<div class="form-actions">
					<Button
						variant="primary"
						size="sm"
						onclick={() =>
							toastStore.success(
								"Notification preferences saved",
							)}
					>
						Save preferences
					</Button>
				</div>
			</div>

			<!-- ─── Team ─── -->
		{:else if activeTab === "team"}
			<div class="settings-section">
				<h2 class="settings-section-title">Team</h2>
				<p class="settings-section-sub">
					Share OmniPlot with your shop under one subscription.
				</p>

				{#if shopLoading}
					<div class="team-loading">
						<span class="spinner-sm" aria-label="Loading team…"></span>
						<span>Loading team…</span>
					</div>

				{:else if !shop}
					<!-- Create shop -->
					<form onsubmit={handleCreateShop}>
						<div class="form-field" style="margin-bottom:14px">
							<label for="newShopName" class="form-label">Shop name</label>
							<input
								id="newShopName"
								class="form-input"
								type="text"
								placeholder="Radford Auto Wraps"
								bind:value={newShopName}
								required
							/>
						</div>
						<div class="form-field" style="margin-bottom:20px">
							<label for="newShopPlan" class="form-label">Plan</label>
							<select id="newShopPlan" class="form-select" bind:value={newShopPlan}>
								{#each Object.entries(SHOP_PLAN_LABELS) as [val, label]}
									<option value={val}>{label}</option>
								{/each}
							</select>
						</div>
						<div class="create-shop-callout">
							<div>
								<div class="create-shop-callout__title">One account per technician</div>
								<p class="create-shop-callout__sub">
									Each tech gets their own login. One billing subscription covers the whole team. Invite up to {newShopPlan === "starter" ? "3" : newShopPlan === "team" ? "10" : "25"} members.
								</p>
							</div>
						</div>
						<div class="form-actions">
							<Button variant="primary" size="sm" type="submit" loading={creatingShop}>
								Create shop
							</Button>
						</div>
					</form>

				{:else}
					<!-- Shop header -->
					<div class="shop-header">
						<div class="shop-header__icon" aria-hidden="true">{shop.name.charAt(0).toUpperCase()}</div>
						<div class="shop-header__info">
							<span class="shop-header__name">{shop.name}</span>
							<span class="shop-header__plan">{SHOP_PLAN_LABELS[shop.plan]}</span>
						</div>
						{#if userStore.user?.shopRole === "owner"}
							{#if shop.subscriptionStatus === "active" || shop.subscriptionStatus === "trialing"}
								<Button variant="secondary" size="sm" loading={portalLoading} onclick={() => handlePortal("shop")}>
									Manage billing
								</Button>
							{:else if shop.subscriptionStatus === "past_due"}
								<Button variant="danger" size="sm" loading={portalLoading} onclick={() => handlePortal("shop")}>
									Update payment
								</Button>
							{:else}
								<Button variant="primary" size="sm" loading={checkoutLoading} onclick={() => redirectToShopCheckout(shop!.id, shop!.plan)}>
									Activate plan
								</Button>
							{/if}
						{/if}
					</div>

					{#if shop.subscriptionStatus === "past_due"}
						<div class="billing-alert" style="margin-bottom:16px">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
							Shop payment past due — team access may be restricted.
						</div>
					{/if}

					<!-- Seat usage -->
					{@const seatPct = Math.min(100, Math.round((members.length / shop.seats) * 100))}
					<div class="seat-usage">
						<div class="usage-row">
							<span class="usage-label">Seats used</span>
							<span class="usage-val">{members.length} / {shop.seats}</span>
						</div>
						<div class="usage-bar-track" role="progressbar" aria-valuenow={members.length} aria-valuemax={shop.seats}>
							<div class="usage-bar-fill" class:usage-bar-fill--warn={seatPct >= 80} style="width:{seatPct}%"></div>
						</div>
					</div>

					<!-- Members list -->
					<div class="members-list">
						{#each members as member (member.uid)}
							<div class="member-row">
								<div class="member-avatar" aria-hidden="true">
									{(member.displayName || member.email).charAt(0).toUpperCase()}
								</div>
								<div class="member-info">
									<span class="member-name">{member.displayName || "—"}</span>
									<span class="member-email">{member.email}</span>
								</div>
								{#if isShopManager && member.uid !== userStore.user?.uid}
									<select
										class="role-select"
										value={member.role}
										onchange={(e) => handleRoleChange(member.uid, (e.target as HTMLSelectElement).value as ShopRole)}
										aria-label="Change role for {member.displayName}"
									>
										<option value="tech">Technician</option>
										<option value="manager">Manager</option>
										<option value="owner" disabled={userStore.user?.shopRole !== "owner"}>Owner</option>
									</select>
									<button class="member-remove" onclick={() => handleRemoveMember(member.uid)} aria-label="Remove {member.displayName}">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
									</button>
								{:else}
									<span class="role-tag">{ROLE_LABELS[member.role]}</span>
								{/if}
							</div>
						{/each}
					</div>

					<!-- Invite section (managers only) -->
					{#if isShopManager}
						<div class="settings-divider" style="max-width:100%;margin:20px 0" aria-hidden="true"></div>
						<h3 class="settings-section-title" style="font-size:0.9375rem;margin-bottom:12px">Invite a team member</h3>

						<div class="invite-controls">
							<select class="form-select invite-role-select" bind:value={newInviteRole} aria-label="Role for new invite">
								<option value="tech">Technician</option>
								<option value="manager">Manager</option>
							</select>
							<Button variant="secondary" size="sm" onclick={handleGenerateInvite} loading={creatingInvite}>
								Generate link
							</Button>
						</div>

						{#if newInviteLink}
							<div class="invite-link-row">
								<input class="form-input invite-link-input" type="text" value={newInviteLink} readonly aria-label="Invite link" />
								<Button variant={copiedLink ? "ghost" : "secondary"} size="sm" onclick={handleCopyLink}>
									{copiedLink ? "Copied!" : "Copy"}
								</Button>
							</div>
							<p class="form-hint" style="margin-top:4px">This link expires in 7 days. Anyone with it can join as {ROLE_LABELS[newInviteRole]}.</p>
						{/if}

						{#if pendingInvites.length > 0}
							<div class="pending-invites">
								<div class="pending-invites__label">Pending invites</div>
								{#each pendingInvites as inv (inv.id)}
									<div class="pending-invite-row">
										<span class="pending-invite-role">{ROLE_LABELS[inv.role]}</span>
										<span class="pending-invite-exp">Expires {inv.expiresAt.toLocaleDateString()}</span>
										<button class="btn-link-sm danger" onclick={() => handleRevokeInvite(inv.id)}>Revoke</button>
									</div>
								{/each}
							</div>
						{/if}
					{/if}

					<!-- Leave shop (non-owners) -->
					{#if userStore.user?.shopRole !== "owner"}
						<div class="settings-divider" style="max-width:100%;margin:24px 0" aria-hidden="true"></div>
						<div class="danger-card">
							<div>
								<div class="danger-card__title">Leave shop</div>
								<p class="danger-card__desc">You'll lose access to shared patterns and the team plan.</p>
							</div>
							<Button variant="danger" size="sm" onclick={handleLeaveShop}>Leave</Button>
						</div>
					{/if}
				{/if}
			</div>

			<!-- ─── Danger Zone ─── -->
		{:else if activeTab === "danger"}
			<div class="settings-section">
				<h2 class="settings-section-title danger-title">Danger Zone</h2>
				<p class="settings-section-sub">
					These actions are permanent and cannot be undone.
				</p>

				<div class="danger-card">
					<div>
						<div class="danger-card__title">
							Clear all job history
						</div>
						<p class="danger-card__desc">
							Permanently delete all cut jobs. Patterns in the
							library are not affected.
						</p>
					</div>
					<Button
						variant="danger"
						size="sm"
						onclick={() =>
							toastStore.warning(
								"Not implemented",
								"This would clear all job history.",
							)}
					>
						Clear history
					</Button>
				</div>

				<div class="danger-card">
					<div>
						<div class="danger-card__title">
							Cancel subscription
						</div>
						<p class="danger-card__desc">
							Your plan will revert to Free at the end of the
							billing period.
						</p>
					</div>
					<Button
						variant="danger"
						size="sm"
						onclick={() =>
							toastStore.info(
								"No active subscription",
								"You are on the Free plan.",
							)}
					>
						Cancel plan
					</Button>
				</div>

				<div class="danger-card danger-card--severe">
					<div>
						<div class="danger-card__title">Delete account</div>
						<p class="danger-card__desc">
							Permanently delete your account, all jobs, and all
							data. This cannot be undone.
						</p>
					</div>
					<Button
						variant="danger"
						size="sm"
						onclick={() =>
							toastStore.error(
								"Not implemented",
								"Contact support to delete your account.",
							)}
					>
						Delete account
					</Button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.settings-page {
		display: grid;
		grid-template-columns: 200px 1fr;
		height: 100%;
		overflow: hidden;
	}

	/* ─── Nav ────── */
	.settings-nav {
		background: var(--bg-surface);
		border-right: 1px solid var(--border-subtle);
		padding: 16px 10px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
	}

	.settings-nav-item {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 8px 10px;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		color: var(--text-tertiary);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		transition: all 0.12s;
		width: 100%;
	}

	.settings-nav-item:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}
	.settings-nav-item.active {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}
	.settings-nav-item.danger {
		color: var(--color-danger);
	}
	.settings-nav-item.danger:hover,
	.settings-nav-item.danger.active {
		background: rgba(255, 77, 109, 0.08);
		color: var(--color-danger);
	}

	/* ─── Content ────── */
	.settings-content {
		overflow-y: auto;
		padding: 28px;
	}

	.settings-section {
		max-width: 560px;
	}
	.settings-section-title {
		font-size: 1.125rem;
		margin-bottom: 4px;
	}
	.settings-section-sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: 24px;
	}

	.settings-divider {
		max-width: 560px;
		height: 1px;
		background: var(--border-subtle);
		margin: 28px 0;
	}

	/* Forms */
	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		margin-bottom: 20px;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.form-field--full {
		grid-column: 1 / -1;
	}

	.form-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.form-hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 4px;
	}

	.form-input,
	.form-select {
		padding: 8px 11px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
		width: 100%;
	}

	.form-input:focus,
	.form-select:focus {
		border-color: var(--color-brand-dim);
	}

	.form-select {
		cursor: pointer;
	}

	.slider-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.form-slider {
		flex: 1;
		-webkit-appearance: none;
		height: 4px;
		background: var(--bg-surface-3);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.form-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-brand-dim);
		cursor: pointer;
		border: 2px solid var(--bg-surface);
	}

	.slider-val {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
		min-width: 32px;
		text-align: right;
	}

	.form-actions {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 20px;
	}

	/* Appearance */
	.appearance-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
	}

	.theme-options {
		display: flex;
		gap: 8px;
	}

	.theme-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		background: var(--bg-surface);
		border: 1.5px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.75rem;
		font-family: var(--font-body);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
		font-weight: 500;
	}

	.theme-option:hover {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}
	.theme-option.active {
		border-color: var(--color-brand-dim);
		color: var(--text-primary);
	}

	.theme-option__preview {
		width: 52px;
		height: 34px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
	}

	.theme-option__preview--dark {
		background: #0e1118;
	}
	.theme-option__preview--light {
		background: #f8fafc;
	}

	/* Billing */
	.billing-current {
		margin-bottom: 20px;
	}

	.billing-plan {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.billing-plan__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.billing-plan__name {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 2px;
	}
	.billing-plan__desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}
	.billing-plan__desc--warn { color: var(--color-warning); }

	.billing-plan__actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.billing-plan__usage { display: flex; flex-direction: column; gap: 0; }

	.usage-row {
		display: flex;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	.usage-label {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}
	.usage-val {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--text-primary);
	}

	.usage-bar-track {
		height: 4px;
		background: var(--bg-surface-3);
		border-radius: 2px;
		overflow: hidden;
		margin-bottom: 6px;
	}

	.usage-bar-fill {
		height: 100%;
		background: var(--color-brand-dim);
		border-radius: 2px;
		transition: width 0.4s var(--ease-smooth);
	}
	.usage-bar-fill--warn { background: var(--color-warning); }

	.usage-reset {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.upgrade-callout {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		background: rgba(0, 112, 255, 0.06);
		border: 1px solid rgba(0, 112, 255, 0.2);
		border-radius: var(--radius-lg);
		margin-bottom: 24px;
	}

	.upgrade-callout__icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}
	.upgrade-callout__title {
		font-size: 0.9375rem;
		font-weight: 600;
		margin-bottom: 2px;
	}
	.upgrade-callout__sub {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.billing-empty {
		font-size: 0.875rem;
		color: var(--text-tertiary);
		padding: 20px 0;
	}

	.billing-alert {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		background: rgba(255, 181, 71, 0.08);
		border: 1px solid rgba(255, 181, 71, 0.3);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-warning);
		margin-bottom: 16px;
	}
	.billing-alert svg { flex-shrink: 0; }

	.billing-portal-note {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.5;
		margin: 0;
	}

	.btn-link {
		background: none;
		border: none;
		padding: 0;
		font-size: inherit;
		font-family: var(--font-body);
		color: var(--text-brand);
		cursor: pointer;
		text-decoration: underline;
	}
	.btn-link:hover { opacity: 0.8; }

	/* Notifications */
	.notif-list {
		display: flex;
		flex-direction: column;
		gap: 0;
		margin-bottom: 20px;
	}

	.notif-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 0;
		border-bottom: 1px solid var(--border-subtle);
	}

	.notif-row:last-child {
		border-bottom: none;
	}

	.notif-label {
		font-size: 0.875rem;
		font-weight: 500;
		margin-bottom: 2px;
	}
	.notif-desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	/* Toggle switch */
	.toggle {
		width: 36px;
		height: 20px;
		border-radius: 10px;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		cursor: pointer;
		position: relative;
		transition:
			background 0.2s,
			border-color 0.2s;
		flex-shrink: 0;
	}

	.toggle.on {
		background: var(--color-brand-dim);
		border-color: var(--color-brand-dim);
	}

	.toggle__thumb {
		position: absolute;
		top: 1px;
		left: 1px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.2s var(--ease-smooth);
		display: block;
	}

	.toggle.on .toggle__thumb {
		transform: translateX(16px);
	}

	/* Danger zone */
	.danger-title {
		color: var(--color-danger);
	}

	.danger-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		margin-bottom: 10px;
	}

	.danger-card--severe {
		border-color: rgba(255, 77, 109, 0.3);
		background: rgba(255, 77, 109, 0.04);
	}

	.danger-card__title {
		font-size: 0.9375rem;
		font-weight: 600;
		margin-bottom: 3px;
	}
	.danger-card__desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		max-width: 360px;
	}

	/* ─── Team tab ─── */
	.team-loading {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text-tertiary);
		font-size: 0.875rem;
		padding: 16px 0;
	}
	.spinner-sm {
		display: block;
		width: 16px;
		height: 16px;
		border: 2px solid var(--border-default);
		border-top-color: var(--color-brand);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.create-shop-callout {
		padding: 14px 16px;
		background: rgba(0, 112, 255, 0.05);
		border: 1px solid rgba(0, 112, 255, 0.18);
		border-radius: var(--radius-md);
		margin-bottom: 20px;
	}
	.create-shop-callout__title { font-size: 0.875rem; font-weight: 600; margin-bottom: 3px; }
	.create-shop-callout__sub { font-size: 0.8125rem; color: var(--text-secondary); margin: 0; }

	.shop-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 18px;
	}
	.shop-header__icon {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		background: var(--color-brand-dim);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.125rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.shop-header__name {
		display: block;
		font-size: 1rem;
		font-weight: 600;
	}
	.shop-header__plan {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	.seat-usage { margin-bottom: 20px; }

	.usage-bar-fill--warn { background: var(--color-warning); }

	.members-list {
		display: flex;
		flex-direction: column;
		gap: 0;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.member-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 14px;
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
	}
	.member-row:last-child { border-bottom: none; }
	.member-avatar {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: var(--bg-surface-3);
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8125rem;
		font-weight: 600;
		flex-shrink: 0;
	}
	.member-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex: 1;
		min-width: 0;
	}
	.member-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.member-email {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.role-tag {
		font-size: 0.75rem;
		font-weight: 500;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--bg-surface-3);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.role-select {
		font-size: 0.8125rem;
		padding: 4px 8px;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-family: var(--font-body);
		cursor: pointer;
		outline: none;
	}
	.member-remove {
		padding: 4px;
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		flex-shrink: 0;
		transition: color 0.12s, background 0.12s;
	}
	.member-remove:hover { color: var(--color-danger); background: rgba(255,77,109,0.08); }

	.invite-controls {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 10px;
	}
	.invite-role-select { flex: 1; }
	.invite-link-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.invite-link-input {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.pending-invites {
		margin-top: 14px;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.pending-invites__label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		padding: 8px 12px;
		background: var(--bg-surface-3);
		border-bottom: 1px solid var(--border-subtle);
	}
	.pending-invite-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
		font-size: 0.8125rem;
	}
	.pending-invite-row:last-child { border-bottom: none; }
	.pending-invite-role { color: var(--text-primary); font-weight: 500; }
	.pending-invite-exp { color: var(--text-tertiary); flex: 1; }

	/* Shop membership card in profile tab */
	.membership-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
	}
	.membership-icon {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-sm);
		background: var(--color-brand-dim);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.membership-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}
	.membership-name { font-size: 0.9375rem; font-weight: 600; color: var(--text-primary); }
	.membership-role {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.btn-link-sm {
		background: none;
		border: none;
		font-size: 0.8125rem;
		color: var(--text-brand);
		cursor: pointer;
		padding: 0;
		font-family: var(--font-body);
		white-space: nowrap;
	}
	.btn-link-sm:hover { text-decoration: underline; }
	.btn-link-sm.danger { color: var(--color-danger); }
	.btn-link-sm.danger:hover { text-decoration: underline; }

	/* Responsive */
	@media (max-width: 768px) {
		.settings-page {
			grid-template-columns: 1fr;
		}
		.settings-nav {
			display: none;
		}
		.form-grid {
			grid-template-columns: 1fr;
		}
		.appearance-row {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
