<script lang="ts">
	import { onMount } from "svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import PhoneInput from "$lib/components/ui/PhoneInput.svelte";
	import { toastStore, themeStore, userStore, uiStore } from "$lib/stores";
	import {
		linkGoogleAccount,
		sendLinkEmail,
		sendLinkPhoneOTP,
		finishLinkPhone,
		unlinkProvider,
		createRecaptchaVerifier,
	} from "$lib/firebase/auth";
	import type { ConfirmationResult, RecaptchaVerifier } from "firebase/auth";
	import { PRICING_PLANS, SHOP_PRICING_PLANS } from "$lib/config";
	import {
		getShop,
		getShopMembers,
		createShop,
		createShopInvite,
		getShopInvitesByShop,
		removeShopMember,
		updateShopMemberRole,
		revokeShopInvite,
		updateUserProfile,
	} from "$lib/firebase/firestore";
	import { auth } from "$lib/firebase/client";
	import { signOutUser } from "$lib/firebase/auth";
	import { goto } from "$app/navigation";
	import AddCardModal from "$lib/components/ui/AddCardModal.svelte";
	import type { Shop, ShopMember, ShopInvite, ShopRole, ShopPlan } from "$lib/types";

	let activeTab = $state<
		"profile" | "billing" | "notifications" | "team" | "security" | "danger"
	>("profile");

	// Profile form
	let displayName = $state(userStore.user?.displayName ?? "");
	const email = $derived(userStore.user?.email ?? "");
	let saving = $state(false);

	// ─── Auth method: link / unlink ────────────────
	interface LinkedProvider { id: string; label: string }
	let linkedProviders = $state<LinkedProvider[]>([]);

	const PROVIDER_LABELS: Record<string, string> = {
		"google.com": "Google",
		password:     "Email",
		phone:        "Phone",
	};
	// Every method OmniPlot supports, in display order
	const ALL_PROVIDERS: { id: string; label: string }[] = [
		{ id: "google.com", label: "Google" },
		{ id: "password",   label: "Email" },
		{ id: "phone",      label: "Phone" },
	];

	function loadLinkedProviders() {
		const providers = auth.currentUser?.providerData ?? [];
		linkedProviders = providers.map((p) => ({
			id:    p.providerId,
			label: PROVIDER_LABELS[p.providerId] ?? p.providerId,
		}));
	}

	const unlinkedProviders = $derived(
		ALL_PROVIDERS.filter((p) => !linkedProviders.some((lp) => lp.id === p.id)),
	);

	// ── Add-provider panel state ──
	let addProviderOpen = $state<string | null>(null); // provider id currently being added
	let linkingGoogle    = $state(false);
	let linkEmailValue   = $state("");
	let linkEmailSent    = $state(false);
	let sendingLinkEmail = $state(false);

	let linkPhoneValue     = $state("");
	let linkPhoneOtp       = $state("");
	let linkPhoneOtpSent   = $state(false);
	let linkPhoneConfirm   = $state<ConfirmationResult | null>(null);
	let linkPhoneRecaptchaEl = $state<HTMLElement | null>(null);
	let linkPhoneRecaptcha   = $state<RecaptchaVerifier | null>(null);
	let sendingPhoneOtp   = $state(false);
	let verifyingPhoneOtp = $state(false);

	let unlinkingProviderId = $state<string | null>(null);

	function closeAddProvider() {
		addProviderOpen = null;
		linkEmailValue = "";
		linkEmailSent = false;
		linkPhoneValue = "";
		linkPhoneOtp = "";
		linkPhoneOtpSent = false;
		linkPhoneConfirm = null;
		try { linkPhoneRecaptcha?.clear(); } catch {}
		linkPhoneRecaptcha = null;
	}

	async function handleLinkGoogle() {
		linkingGoogle = true;
		try {
			await linkGoogleAccount();
			loadLinkedProviders();
			toastStore.success("Google linked", "You can now sign in with Google too.");
			closeAddProvider();
		} catch (err: unknown) {
			const code = (err as { code?: string }).code ?? "";
			const msg =
				code === "auth/credential-already-in-use" ? "That Google account is already linked to a different OmniPlot login." :
				code === "auth/popup-closed-by-user" ? "" :
				err instanceof Error ? err.message : "";
			if (msg) toastStore.error("Couldn't link Google", msg);
		} finally {
			linkingGoogle = false;
		}
	}

	async function handleSendLinkEmail(e: Event) {
		e.preventDefault();
		if (!linkEmailValue) return;
		sendingLinkEmail = true;
		try {
			await sendLinkEmail(linkEmailValue);
			linkEmailSent = true;
		} catch (err: unknown) {
			const code = (err as { code?: string }).code ?? "";
			const msg =
				code === "auth/email-already-in-use" ? "That email is already linked to a different OmniPlot login." :
				err instanceof Error ? err.message : "";
			toastStore.error("Couldn't send link", msg || undefined);
		} finally {
			sendingLinkEmail = false;
		}
	}

	function resetPhoneRecaptcha() {
		try { linkPhoneRecaptcha?.clear(); } catch {}
		linkPhoneRecaptcha = null;
		if (linkPhoneRecaptchaEl) linkPhoneRecaptchaEl.innerHTML = "";
	}

	async function handleSendLinkPhoneOtp(e: Event) {
		e.preventDefault();
		if (!linkPhoneValue || !linkPhoneRecaptchaEl) return;
		sendingPhoneOtp = true;
		try {
			resetPhoneRecaptcha();
			linkPhoneRecaptcha = createRecaptchaVerifier(linkPhoneRecaptchaEl);
			linkPhoneConfirm = await sendLinkPhoneOTP(linkPhoneValue, linkPhoneRecaptcha);
			linkPhoneOtpSent = true;
		} catch (err: unknown) {
			resetPhoneRecaptcha();
			const code = (err as { code?: string }).code ?? "";
			const msg =
				code === "auth/credential-already-in-use" ? "That phone number is already linked to a different OmniPlot login." :
				code === "auth/too-many-requests" ? "Too many attempts. Try again later." :
				err instanceof Error ? err.message : "";
			toastStore.error("Couldn't send code", msg || undefined);
		} finally {
			sendingPhoneOtp = false;
		}
	}

	async function handleVerifyLinkPhoneOtp(e: Event) {
		e.preventDefault();
		if (!linkPhoneOtp || !linkPhoneConfirm) return;
		verifyingPhoneOtp = true;
		try {
			await linkPhoneConfirm.confirm(linkPhoneOtp);
			await finishLinkPhone(linkPhoneValue);
			loadLinkedProviders();
			toastStore.success("Phone linked", "You can now sign in with this number too.");
			closeAddProvider();
		} catch {
			toastStore.error("Invalid code", "Please check the code and try again.");
		} finally {
			verifyingPhoneOtp = false;
		}
	}

	async function handleUnlink(providerId: string) {
		if (linkedProviders.length <= 1) {
			toastStore.warning("Can't remove last sign-in method", "Add another method before removing this one.");
			return;
		}
		unlinkingProviderId = providerId;
		try {
			await unlinkProvider(providerId);
			loadLinkedProviders();
			toastStore.success("Sign-in method removed");
		} catch (err: unknown) {
			toastStore.error("Couldn't remove", err instanceof Error ? err.message : "");
		} finally {
			unlinkingProviderId = null;
		}
	}

	// ─── Billing email ─────────────────────────────
	// Defaults to the login email when the auth method provides one (Google, magic link).
	// Phone-only accounts start with none and must add one to receive receipts.
	let billingEmail    = $state(userStore.user?.billingEmail ?? userStore.user?.email ?? "");
	let editingBillingEmail = $state(false);
	let savingBillingEmail  = $state(false);

	async function saveBillingEmail() {
		if (!billingEmail.trim()) return;
		savingBillingEmail = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch("/api/billing/email", {
				method:  "PATCH",
				headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body:    JSON.stringify({ email: billingEmail.trim() }),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
			editingBillingEmail = false;
			toastStore.success("Billing email updated", "Receipts will be sent here.");
		} catch (err) {
			toastStore.error("Could not update billing email", err instanceof Error ? err.message : "");
		} finally {
			savingBillingEmail = false;
		}
	}

	async function saveProfile() {
		const uid = userStore.user?.uid;
		if (!uid) return;
		saving = true;
		try {
			await updateUserProfile(uid, { displayName });
			toastStore.success("Profile saved", "Your changes have been applied.");
		} catch (err) {
			toastStore.error("Save failed", err instanceof Error ? err.message : "");
		} finally {
			saving = false;
		}
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
	let addCardOpen      = $state(false);
	let addCardReturnTo  = $state('');

	interface PaymentMethod {
		id: string; brand: string; last4: string;
		expMonth: number; expYear: number; isDefault: boolean;
	}
	let paymentMethods = $state<PaymentMethod[]>([]);
	let pmLoading      = $state(false);

	async function loadPaymentMethods() {
		pmLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/billing/payment-methods', {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (res.ok) paymentMethods = (await res.json()).methods ?? [];
		} catch { /* non-fatal */ } finally {
			pmLoading = false;
		}
	}

	function fmtBrand(brand: string) {
		const map: Record<string, string> = {
			visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex',
			discover: 'Discover', unionpay: 'UnionPay', jcb: 'JCB',
		};
		return map[brand.toLowerCase()] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
	}

	async function handleSetDefault(methodId: string) {
		settingDefaultId = methodId;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/billing/payment-methods', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify({ methodId }),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
			await loadPaymentMethods();
			toastStore.success('Default card updated');
		} catch (err) {
			toastStore.error('Could not update default', err instanceof Error ? err.message : '');
		} finally {
			settingDefaultId = null;
		}
	}

	async function handleRemoveCard(methodId: string) {
		removingMethodId = methodId;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/billing/payment-methods', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify({ methodId }),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
			paymentMethods = paymentMethods.filter(m => m.id !== methodId);
			confirmRemoveId = null;
			toastStore.success('Card removed');
		} catch (err) {
			toastStore.error('Could not remove card', err instanceof Error ? err.message : '');
		} finally {
			removingMethodId = null;
		}
	}

	// ─── Invoices ─────────────────────────────────
	interface Invoice {
		id: string; number: string;
		amount: number; currency: string;
		status: string; date: number;
		pdfUrl: string | null; description: string | null;
	}
	let invoices        = $state<Invoice[]>([]);
	let invoicesLoading = $state(false);

	async function loadInvoices() {
		invoicesLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/billing/invoices', {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (res.ok) invoices = (await res.json()).invoices ?? [];
		} catch { /* non-fatal */ } finally {
			invoicesLoading = false;
		}
	}

	function fmtAmount(amount: number, currency: string): string {
		return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
	}

	function fmtInvoiceDate(ms: number): string {
		return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	// ─── Cancel / Reactivate ──────────────────────
	let cancelLoading      = $state(false);
	let confirmCancelOpen  = $state(false);
	let confirmRemoveId    = $state<string | null>(null);
	let settingDefaultId   = $state<string | null>(null);
	let removingMethodId   = $state<string | null>(null);

	async function handleCancel() {
		cancelLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/billing/cancel', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
			confirmCancelOpen = false;
			toastStore.success('Subscription cancelled', 'Your access continues until the end of the billing period.');
		} catch (err) {
			toastStore.error('Could not cancel', err instanceof Error ? err.message : '');
		} finally {
			cancelLoading = false;
		}
	}

	let confirmCancelNowOpen  = $state(false);
	let confirmClearOpen      = $state(false);
	let clearHistoryLoading   = $state(false);

	async function handleClearHistory() {
		clearHistoryLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch("/api/user/clear-history", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			});
			if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
			confirmClearOpen = false;
			toastStore.success("Job history cleared", "Your cut jobs have been deleted.");
		} catch (err) {
			toastStore.error("Could not clear history", err instanceof Error ? err.message : "");
		} finally {
			clearHistoryLoading = false;
		}
	}

	async function handleCancelNow() {
		cancelLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/billing/cancel', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
			confirmCancelNowOpen = false;
			confirmCancelOpen = false;
			toastStore.success('Subscription canceled', 'Your plan has ended immediately.');
		} catch (err) {
			toastStore.error('Could not cancel', err instanceof Error ? err.message : '');
		} finally {
			cancelLoading = false;
		}
	}

	async function handleReactivate() {
		cancelLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/billing/cancel', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
			toastStore.success('Subscription reactivated', 'Your plan will continue as normal.');
		} catch (err) {
			toastStore.error('Could not reactivate', err instanceof Error ? err.message : '');
		} finally {
			cancelLoading = false;
		}
	}

	// ─── Delete account ───────────────────────────
	let confirmDeleteOpen  = $state(false);
	let deleteConfirmText  = $state("");
	let deleteLoading      = $state(false);

	async function handleDeleteAccount() {
		deleteLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch("/api/user/delete-account", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			});
			if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
			confirmDeleteOpen = false;
			await signOutUser();
			await goto("/");
			toastStore.success("Account deleted", "Sorry to see you go.");
		} catch (err) {
			toastStore.error("Could not delete account", err instanceof Error ? err.message : "");
		} finally {
			deleteLoading = false;
		}
	}

	// ─── Pause / Resume ───────────────────────────
	let pauseLoading      = $state(false);
	let confirmPauseOpen  = $state(false);

	async function handlePause() {
		pauseLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/billing/pause', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
			confirmPauseOpen = false;
			toastStore.success('Subscription paused', 'Billing is paused — you can resume anytime.');
		} catch (err) {
			toastStore.error('Could not pause', err instanceof Error ? err.message : '');
		} finally {
			pauseLoading = false;
		}
	}

	async function handleResumePause() {
		pauseLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/billing/pause', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
			toastStore.success('Subscription resumed', 'Billing will continue as normal.');
		} catch (err) {
			toastStore.error('Could not resume', err instanceof Error ? err.message : '');
		} finally {
			pauseLoading = false;
		}
	}

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

	async function redirectToShopCheckout(shopId: string, plan: ShopPlan, interval: 'month' | 'year' = 'month') {
		checkoutLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch("/api/billing/checkout", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({ type: "shop", shopId, plan, interval }),
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

	$effect(() => {
		if (activeTab === "billing") {
			loadPaymentMethods();
			loadInvoices();
		}
	});

	onMount(() => {
		// Sync tab and checkout-success from URL params
		const params   = new URLSearchParams(window.location.search);
		const urlTab   = params.get("tab");
		const validTab = ["profile","plotter","billing","notifications","team","security","danger"] as const;
		if (urlTab && validTab.includes(urlTab as typeof validTab[number])) {
			activeTab = urlTab as typeof activeTab;
		}
		if (params.get("checkout") === "success") {
			toastStore.success("Subscription activated!", "Your new plan is now active.");
		}
		const returnTo = params.get("returnTo");
		if (params.get("addCard") === "true") {
			addCardOpen     = true;
			addCardReturnTo = returnTo ?? "";
		}
		currentSessionId = localStorage.getItem("omniplot_session_id") ?? "";
		loadShopData();
		loadLinkedProviders();
	});

	// Keep the billing email field in sync with the profile until the user edits it
	$effect(() => {
		if (!editingBillingEmail) {
			billingEmail = userStore.user?.billingEmail ?? userStore.user?.email ?? "";
		}
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
			// Plan is no longer user-selected at creation — always starts on
			// "starter"; upgrading the shop's plan happens from the shop
			// header once it exists ("Activate plan" / "Manage billing").
			const s = await createShop(userStore.user.uid, newShopName, "starter");
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
			await redirectToShopCheckout(s.id, "starter");
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
			id: "security",
			label: "Security",
			icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
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

	// ─── Security / Sessions ──────────────────────
	interface SessionEntry {
		id: string; sessionId: string;
		ip: string; city: string; region: string; country: string; countryCode: string;
		browser: string; browserVersion: string;
		os: string; osVersion: string;
		device: 'mobile' | 'tablet' | 'desktop';
		createdAt: number;
	}

	let sessions        = $state<SessionEntry[]>([]);
	let sessionsLoading = $state(false);
	let currentSessionId = $state('');

	$effect(() => {
		if (activeTab === 'security') loadSessions();
	});

	async function loadSessions() {
		sessionsLoading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/user/sessions', {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (res.ok) sessions = (await res.json()).sessions ?? [];
		} catch { /* non-fatal */ } finally {
			sessionsLoading = false;
		}
	}

	function timeAgo(ms: number): string {
		const diff = Date.now() - ms;
		const mins = Math.floor(diff / 60_000);
		if (mins < 1)   return 'Just now';
		if (mins < 60)  return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24)   return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 7)   return `${days}d ago`;
		return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function countryFlag(code: string): string {
		if (!code || code.length !== 2) return '';
		return [...code.toUpperCase()].map(c =>
			String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
		).join('');
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
						<label for="email" class="form-label">Login email</label>
						<input
							id="email"
							class="form-input"
							type="email"
							value={email || "—"}
							readonly
							title="Your login email is tied to how you sign in and can't be edited here"
						/>
					</div>
				</div>
				<p class="form-hint" style="margin-top:-12px;margin-bottom:20px">
					Your login email is tied to your sign-in method — see <button class="btn-link-sm" style="display:inline" onclick={() => (activeTab = "security")}>Security</button> to check how you sign in. Want receipts sent somewhere else? Set a billing email under <button class="btn-link-sm" style="display:inline" onclick={() => (activeTab = "billing")}>Billing</button>.
				</p>

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

			<!-- ─── Billing ─── -->
		{:else if activeTab === "billing"}
			{@const user     = userStore.user}
			{@const tier     = user?.tier ?? "free"}
			{@const sub      = user?.subscription}
			{@const usage    = user?.usage}
			{@const limit    = tier === "free" ? 1 : null}
			{@const cutCount = usage?.monthlyCount ?? 0}
			{@const usagePct = limit ? Math.min(100, Math.round((cutCount / limit) * 100)) : 0}

			<div class="settings-section">
				<h2 class="settings-section-title">Plan & Billing</h2>
				<p class="settings-section-sub">Manage your subscription, payment methods, and invoices.</p>

				<!-- ── Current plan card ── -->
				<div class="billing-plan">
					<div class="billing-plan__header">
						<div>
							<div class="billing-plan__name">{PLAN_NAMES[tier] ?? tier} Plan</div>
							{#if sub?.pausedCollection}
								<div class="billing-plan__desc billing-plan__desc--warn">Billing paused — you're on the Free plan until you resume</div>
							{:else if sub?.cancelAtPeriodEnd && sub.currentPeriodEnd}
								<div class="billing-plan__desc billing-plan__desc--warn">
									Cancels on {fmtDate(sub.currentPeriodEnd)} — you keep access until then
								</div>
							{:else if sub?.status === "active" && sub.currentPeriodEnd}
								<div class="billing-plan__desc">Renews {fmtDate(sub.currentPeriodEnd)}</div>
							{:else if sub?.status === "trialing" && sub.trialEnd}
								<div class="billing-plan__desc">Trial ends {fmtDate(sub.trialEnd)}</div>
							{:else if sub?.status === "past_due"}
								<div class="billing-plan__desc billing-plan__desc--warn">Payment past due — update your card below</div>
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
						{#if tier !== "pro" && tier !== "admin"}
							<Button variant="primary" size="sm" onclick={uiStore.openPricing}>
								Upgrade plan
							</Button>
						{/if}
						{#if sub?.stripeCustomerId}
							<Button variant="secondary" size="sm" loading={portalLoading} onclick={() => handlePortal("individual")}>
								Manage billing
							</Button>
						{/if}
						{#if sub?.pausedCollection}
							<Button variant="secondary" size="sm" loading={pauseLoading} onclick={handleResumePause}>
								Resume plan
							</Button>
						{:else if sub?.status === "active" || sub?.status === "trialing"}
							{#if sub.cancelAtPeriodEnd}
								<Button variant="secondary" size="sm" loading={cancelLoading} onclick={handleReactivate}>
									Undo cancellation
								</Button>
							{:else}
								{#if sub.status === "active"}
									<Button variant="secondary" size="sm" onclick={() => (confirmPauseOpen = true)}>
										Pause plan
									</Button>
								{/if}
								<Button variant="ghost" size="sm" onclick={() => (confirmCancelOpen = true)}>
									Cancel plan
								</Button>
							{/if}
						{/if}
					</div>
				</div>

				{#if sub?.status === "past_due"}
					<div class="billing-alert" style="margin-top:12px">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
						Payment failed. Add or update a card below to restore access.
					</div>
				{/if}

				<!-- ── Billing email ── -->
				<div class="billing-sub-section">
					<h3 class="settings-section-title" style="font-size:0.9375rem">Billing email</h3>
					<p class="form-hint" style="margin-top:-4px;margin-bottom:12px">
						Where we send receipts and invoices. Defaults to your login email if you signed in with one.
					</p>
					{#if editingBillingEmail}
						<div class="form-field" style="max-width:340px">
							<input
								class="form-input"
								type="email"
								bind:value={billingEmail}
								placeholder="you@shop.com"
							/>
						</div>
						<div class="form-actions">
							<Button variant="primary" size="sm" loading={savingBillingEmail} onclick={saveBillingEmail}>
								Save
							</Button>
							<Button variant="ghost" size="sm" onclick={() => (editingBillingEmail = false)}>
								Cancel
							</Button>
						</div>
					{:else}
						<div class="pm-row" style="max-width:340px">
							<div class="pm-info">
								<span class="pm-brand">{billingEmail || "No billing email set"}</span>
							</div>
							<button class="btn-link-sm" onclick={() => (editingBillingEmail = true)}>
								{billingEmail ? "Change" : "Add email"}
							</button>
						</div>
					{/if}
				</div>

				<!-- ── Payment methods ── -->
				<div class="billing-sub-section">
					<h3 class="settings-section-title" style="font-size:0.9375rem">Payment methods</h3>

					{#if pmLoading}
						<div class="team-loading">
							<span class="spinner-sm" aria-label="Loading…"></span>
							<span>Loading cards…</span>
						</div>
					{:else if paymentMethods.length === 0}
						<div class="billing-empty">No saved cards.</div>
					{:else}
						<div class="pm-list">
							{#each paymentMethods as pm (pm.id)}
								<div class="pm-row">
									<div class="pm-brand-icon" aria-hidden="true">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
									</div>
									<div class="pm-info">
										<span class="pm-brand">{fmtBrand(pm.brand)}</span>
										<span class="pm-last4">•••• {pm.last4}</span>
										<span class="pm-exp">Exp {pm.expMonth.toString().padStart(2, "0")}/{String(pm.expYear).slice(-2)}</span>
									</div>
									<div class="pm-card-actions">
										{#if pm.isDefault}
											<Badge variant="success" size="sm">Default</Badge>
										{:else}
											<button
												class="btn-link-sm"
												onclick={() => handleSetDefault(pm.id)}
												disabled={settingDefaultId === pm.id}
											>
												{settingDefaultId === pm.id ? "Saving…" : "Set default"}
											</button>
										{/if}
										{#if confirmRemoveId === pm.id}
											<span class="pm-remove-confirm">
												Remove?
												<button class="btn-link-sm danger" onclick={() => handleRemoveCard(pm.id)} disabled={removingMethodId === pm.id}>
													{removingMethodId === pm.id ? "Removing…" : "Yes"}
												</button>
												<button class="btn-link-sm" onclick={() => (confirmRemoveId = null)}>No</button>
											</span>
										{:else}
											<button class="pm-remove-btn" onclick={() => (confirmRemoveId = pm.id)} aria-label="Remove card">
												<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
											</button>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<div style="margin-top:10px">
						<Button variant="secondary" size="sm" onclick={() => (addCardOpen = true)}>
							Add card
						</Button>
					</div>
				</div>

				<!-- ── Invoice history ── -->
				<div class="billing-sub-section">
					<h3 class="settings-section-title" style="font-size:0.9375rem">Invoice history</h3>

					{#if invoicesLoading}
						<div class="team-loading">
							<span class="spinner-sm" aria-label="Loading…"></span>
							<span>Loading invoices…</span>
						</div>
					{:else if invoices.length === 0}
						<div class="billing-empty">No invoices yet.</div>
					{:else}
						<div class="invoice-list">
							<div class="invoice-list__header">
								<span>Date</span>
								<span>Invoice</span>
								<span>Amount</span>
								<span>Status</span>
								<span></span>
							</div>
							{#each invoices as inv (inv.id)}
								{@const statusVariant = inv.status === "paid" ? "success" : inv.status === "open" ? "warning" : "default"}
								<div class="invoice-row">
									<span class="invoice-date">{fmtInvoiceDate(inv.date)}</span>
									<span class="invoice-number">{inv.number}</span>
									<span class="invoice-amount">{fmtAmount(inv.amount, inv.currency)}</span>
									<span><Badge variant={statusVariant} size="sm">{inv.status}</Badge></span>
									<span class="invoice-actions">
										{#if inv.pdfUrl}
											<a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" class="btn-link-sm" aria-label="Download PDF">
												<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
												PDF
											</a>
										{/if}
									</span>
								</div>
							{/each}
						</div>
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

				{:else if !shop && userStore.user?.tier === "free"}
					<!-- Not entitled — team creation is a paid-plan feature. Gated
					     only when there's no shop yet: an existing shop's access is
					     governed by its own subscriptionStatus, not the owner's
					     individual UserTier, so this must never hide an existing
					     shop's management UI from its owner/members. -->
					<div class="create-shop-callout">
						<div>
							<div class="create-shop-callout__title">Upgrade to create a team</div>
							<p class="create-shop-callout__sub">
								Team access — one account per technician, shared patterns, a single billing subscription — comes with any paid plan.
							</p>
						</div>
					</div>
					<div class="form-actions">
						<Button variant="primary" size="sm" onclick={uiStore.openPricing}>
							Upgrade plan
						</Button>
					</div>

				{:else if !shop}
					<!-- Create shop — plan is no longer user-selected here; the shop
					     starts on "starter" and is upgraded from the shop header. -->
					<form onsubmit={handleCreateShop}>
						<div class="form-field" style="margin-bottom:20px">
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
						<div class="create-shop-callout">
							<div>
								<div class="create-shop-callout__title">One account per technician</div>
								<p class="create-shop-callout__sub">
									Each tech gets their own login. One billing subscription covers the whole team.
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

			<!-- ─── Security ─── -->
		{:else if activeTab === "security"}
			<div class="settings-section">
				<h2 class="settings-section-title">Security</h2>
				<p class="settings-section-sub">How you sign in, and recent activity across your devices.</p>

				<div class="billing-sub-section" style="margin-top:0">
					<h3 class="settings-section-title" style="font-size:0.9375rem">Sign-in methods</h3>
					<p class="form-hint" style="margin-top:-4px;margin-bottom:12px">
						Add another way to sign in so you're never locked out — for example, add an email if you signed up with just a phone number.
					</p>

					{#if linkedProviders.length === 0}
						<div class="billing-empty">No sign-in method found.</div>
					{:else}
						<div class="auth-method-list">
							{#each linkedProviders as p (p.id)}
								<div class="auth-method-row">
									<span class="auth-method-label">{p.label}</span>
									<div class="auth-method-actions">
										<Badge variant="success" size="sm">Linked</Badge>
										{#if linkedProviders.length > 1}
											<button
												class="btn-link-sm danger"
												onclick={() => handleUnlink(p.id)}
												disabled={unlinkingProviderId === p.id}
											>
												{unlinkingProviderId === p.id ? "Removing…" : "Remove"}
											</button>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if unlinkedProviders.length > 0}
						<div class="auth-method-add-list">
							{#each unlinkedProviders as p (p.id)}
								<div class="auth-method-row auth-method-row--muted">
									<span class="auth-method-label">{p.label}</span>
									<button class="btn-link-sm" onclick={() => (addProviderOpen = addProviderOpen === p.id ? null : p.id)}>
										{addProviderOpen === p.id ? "Cancel" : "Add"}
									</button>
								</div>

								{#if addProviderOpen === p.id}
									<div class="auth-method-add-panel">
										{#if p.id === "google.com"}
											<Button variant="secondary" size="sm" loading={linkingGoogle} onclick={handleLinkGoogle}>
												Continue with Google
											</Button>

										{:else if p.id === "password"}
											{#if linkEmailSent}
												<p class="form-hint" style="margin:0">
													Check <strong>{linkEmailValue}</strong> for a link to confirm. It expires shortly.
												</p>
											{:else}
												<form onsubmit={handleSendLinkEmail} class="auth-method-form">
													<input
														class="form-input"
														type="email"
														placeholder="you@shop.com"
														bind:value={linkEmailValue}
														required
													/>
													<Button variant="secondary" size="sm" type="submit" loading={sendingLinkEmail}>
														Send link
													</Button>
												</form>
											{/if}

										{:else if p.id === "phone"}
											{#if !linkPhoneOtpSent}
												<form onsubmit={handleSendLinkPhoneOtp} class="auth-method-form">
													<PhoneInput bind:value={linkPhoneValue} required />
													<Button variant="secondary" size="sm" type="submit" loading={sendingPhoneOtp}>
														Send code
													</Button>
												</form>
											{:else}
												<form onsubmit={handleVerifyLinkPhoneOtp} class="auth-method-form">
													<input
														class="form-input"
														type="text"
														inputmode="numeric"
														maxlength="6"
														placeholder="000000"
														bind:value={linkPhoneOtp}
														autocomplete="one-time-code"
														required
													/>
													<Button variant="secondary" size="sm" type="submit" loading={verifyingPhoneOtp}>
														Verify
													</Button>
												</form>
											{/if}
											<div bind:this={linkPhoneRecaptchaEl}></div>
										{/if}
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				</div>

				<div class="settings-divider" style="max-width:100%;margin:24px 0" aria-hidden="true"></div>

				{#if sessionsLoading}
					<div class="team-loading">
						<span class="spinner-sm" aria-label="Loading…"></span>
						<span>Loading activity…</span>
					</div>
				{:else if sessions.length === 0}
					<div class="billing-empty">No session history yet. It will appear after your next sign-in.</div>
				{:else}
					<div class="sessions-list">
						{#each sessions as s (s.id)}
							{@const isCurrent = !!currentSessionId && s.sessionId === currentSessionId}
							<div class="session-row" class:session-row--current={isCurrent}>
								<!-- Device icon -->
								<div class="session-device" aria-label={s.device}>
									{#if s.device === "mobile"}
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
											<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
										</svg>
									{:else if s.device === "tablet"}
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
											<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
										</svg>
									{:else}
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
											<rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/><line x1="12" y1="17" x2="12" y2="21"/>
										</svg>
									{/if}
								</div>

								<!-- Info -->
								<div class="session-info">
									<div class="session-primary">
										<span class="session-browser">{s.browser}{s.browserVersion ? ` ${s.browserVersion}` : ""}</span>
										<span class="session-sep">on</span>
										<span class="session-os">{s.os}{s.osVersion ? ` ${s.osVersion}` : ""}</span>
										{#if isCurrent}
											<Badge variant="success" size="sm">Current session</Badge>
										{/if}
									</div>
									<div class="session-meta">
										{#if s.city}
											<span class="session-location">
												{countryFlag(s.countryCode)}&nbsp;{s.city}{s.country ? `, ${s.country}` : ""}
											</span>
											<span class="session-dot" aria-hidden="true">·</span>
										{/if}
										<span class="session-ip">{s.ip}</span>
										<span class="session-dot" aria-hidden="true">·</span>
										<span class="session-time">{timeAgo(s.createdAt)}</span>
									</div>
								</div>
							</div>
						{/each}
					</div>
					<p class="sessions-note">Showing up to 15 most recent sessions. Each entry represents a browser tab or window.</p>
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
						onclick={() => (confirmClearOpen = true)}
					>
						Clear history
					</Button>
				</div>

				{#if userStore.user?.subscription?.status === "active" || userStore.user?.subscription?.status === "trialing"}
					<div class="danger-card">
						<div>
							<div class="danger-card__title">
								Cancel subscription
							</div>
							<p class="danger-card__desc">
								{#if userStore.user.subscription.cancelAtPeriodEnd}
									Your plan is already set to cancel on {fmtDate(userStore.user.subscription.currentPeriodEnd)}.
								{:else}
									Your plan will revert to Free at the end of the
									billing period.
								{/if}
							</p>
						</div>
						{#if userStore.user.subscription.cancelAtPeriodEnd}
							<Button variant="secondary" size="sm" loading={cancelLoading} onclick={handleReactivate}>
								Undo cancellation
							</Button>
						{:else}
							<Button variant="danger" size="sm" onclick={() => (confirmCancelOpen = true)}>
								Cancel plan
							</Button>
						{/if}
					</div>
				{/if}

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
						onclick={() => (confirmDeleteOpen = true)}
					>
						Delete account
					</Button>
				</div>
			</div>
		{/if}
	</div>
</div>

{#if confirmCancelOpen}
	<div class="cancel-confirm-overlay" role="button" tabindex="-1" aria-label="Close dialog" onclick={() => (confirmCancelOpen = false)} onkeydown={(e) => e.key === 'Escape' && (confirmCancelOpen = false)}>
		<div class="cancel-confirm" onclick={(e) => e.stopPropagation()}>
			<div class="cancel-confirm__body">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
				<p>
					Your access continues until <strong>{fmtDate(userStore.user?.subscription?.currentPeriodEnd)}</strong>.
					You won't be charged again after that date.
				</p>
			</div>
			<div class="cancel-confirm__actions">
				<Button variant="ghost" size="sm" onclick={() => (confirmCancelOpen = false)}>Keep plan</Button>
				<Button variant="danger" size="sm" loading={cancelLoading} onclick={handleCancel}>Confirm cancellation</Button>
			</div>
			<button
				type="button"
				class="btn-link-sm"
				style="margin-top:10px"
				onclick={() => { confirmCancelOpen = false; confirmCancelNowOpen = true; }}
			>
				Need it canceled right now instead? →
			</button>
		</div>
	</div>
{/if}

{#if confirmCancelNowOpen}
	<div class="cancel-confirm-overlay" role="button" tabindex="-1" aria-label="Close dialog" onclick={() => (confirmCancelNowOpen = false)} onkeydown={(e) => e.key === 'Escape' && (confirmCancelNowOpen = false)}>
		<div class="cancel-confirm" onclick={(e) => e.stopPropagation()}>
			<div class="cancel-confirm__body">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
				<p>
					This ends your access <strong>immediately</strong> — you drop to the Free plan right
					now. There's no refund or credit for the remaining time on this billing period.
				</p>
			</div>
			<div class="cancel-confirm__actions">
				<Button variant="ghost" size="sm" onclick={() => (confirmCancelNowOpen = false)}>Never mind</Button>
				<Button variant="danger" size="sm" loading={cancelLoading} onclick={handleCancelNow}>Cancel immediately</Button>
			</div>
		</div>
	</div>
{/if}

{#if confirmPauseOpen}
	<div class="cancel-confirm-overlay" role="button" tabindex="-1" aria-label="Close dialog" onclick={() => (confirmPauseOpen = false)} onkeydown={(e) => e.key === 'Escape' && (confirmPauseOpen = false)}>
		<div class="cancel-confirm" onclick={(e) => e.stopPropagation()}>
			<div class="cancel-confirm__body">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
				<p>
					Billing pauses immediately and you'll drop to the Free plan until you resume.
					Your subscription isn't canceled — resume anytime to pick up where you left off.
				</p>
			</div>
			<div class="cancel-confirm__actions">
				<Button variant="ghost" size="sm" onclick={() => (confirmPauseOpen = false)}>Keep plan active</Button>
				<Button variant="danger" size="sm" loading={pauseLoading} onclick={handlePause}>Pause billing</Button>
			</div>
		</div>
	</div>
{/if}

{#if confirmClearOpen}
	<div class="cancel-confirm-overlay" role="button" tabindex="-1" aria-label="Close dialog" onclick={() => (confirmClearOpen = false)} onkeydown={(e) => e.key === 'Escape' && (confirmClearOpen = false)}>
		<div class="cancel-confirm" onclick={(e) => e.stopPropagation()}>
			<div class="cancel-confirm__body">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
				<p>
					This permanently deletes all of your cut job history. Patterns in your library
					are not affected. This cannot be undone.
				</p>
			</div>
			<div class="cancel-confirm__actions">
				<Button variant="ghost" size="sm" onclick={() => (confirmClearOpen = false)}>Cancel</Button>
				<Button variant="danger" size="sm" loading={clearHistoryLoading} onclick={handleClearHistory}>Clear history</Button>
			</div>
		</div>
	</div>
{/if}

{#if confirmDeleteOpen}
	<div class="cancel-confirm-overlay" role="button" tabindex="-1" aria-label="Close dialog" onclick={() => { confirmDeleteOpen = false; deleteConfirmText = ""; }} onkeydown={(e) => e.key === 'Escape' && (confirmDeleteOpen = false)}>
		<div class="cancel-confirm" onclick={(e) => e.stopPropagation()}>
			<div class="cancel-confirm__body">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
				<p>
					This permanently deletes your account, jobs, and patterns, and cancels any active
					subscription. This cannot be undone. Type <strong>DELETE</strong> to confirm.
				</p>
			</div>
			<input
				class="form-input"
				style="margin-bottom:12px"
				bind:value={deleteConfirmText}
				placeholder="DELETE"
				autocomplete="off"
			/>
			<div class="cancel-confirm__actions">
				<Button variant="ghost" size="sm" onclick={() => { confirmDeleteOpen = false; deleteConfirmText = ""; }}>Cancel</Button>
				<Button
					variant="danger"
					size="sm"
					loading={deleteLoading}
					disabled={deleteConfirmText !== "DELETE"}
					onclick={handleDeleteAccount}
				>
					Delete my account
				</Button>
			</div>
		</div>
	</div>
{/if}

{#if addCardOpen}
	<AddCardModal
		onclose={() => (addCardOpen = false)}
		onsuccess={() => {
			addCardOpen = false;
			if (addCardReturnTo) {
				// Came from upgrade flow — signal layout to reopen pricing modal on return
				sessionStorage.setItem("omniplot_open_upgrade", "1");
				window.location.href = addCardReturnTo;
			} else {
				loadPaymentMethods();
			}
		}}
	/>
{/if}

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

	/* Billing sub-sections */
	.billing-sub-section {
		margin-top: 28px;
		padding-top: 24px;
		border-top: 1px solid var(--border-subtle);
	}

	/* Cancel confirmation */
	.cancel-confirm-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	.cancel-confirm {
		width: 100%;
		max-width: 380px;
		margin: 16px;
		padding: 14px 16px;
		background: var(--bg-surface);
		border: 1px solid rgba(255, 77, 109, 0.25);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.2));
	}
	.cancel-confirm__body {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: 12px;
	}
	.cancel-confirm__body svg { color: var(--color-warning); flex-shrink: 0; margin-top: 2px; }
	.cancel-confirm__body p { margin: 0; line-height: 1.5; }
	.cancel-confirm__body strong { color: var(--text-primary); }
	.cancel-confirm__actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	/* Payment method card actions */
	.pm-card-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.pm-remove-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: color 0.12s, background 0.12s;
	}
	.pm-remove-btn:hover { color: var(--color-danger); background: rgba(255, 77, 109, 0.08); }
	.pm-remove-confirm {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	/* Invoice list */
	.invoice-list {
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.invoice-list__header {
		display: grid;
		grid-template-columns: 110px 1fr 90px 70px 60px;
		gap: 8px;
		padding: 8px 14px;
		background: var(--bg-surface-3);
		border-bottom: 1px solid var(--border-subtle);
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
	}
	.invoice-row {
		display: grid;
		grid-template-columns: 110px 1fr 90px 70px 60px;
		gap: 8px;
		align-items: center;
		padding: 11px 14px;
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
		font-size: 0.8125rem;
	}
	.invoice-row:last-child { border-bottom: none; }
	.invoice-date { color: var(--text-secondary); }
	.invoice-number { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); }
	.invoice-amount { font-weight: 600; color: var(--text-primary); }
	.invoice-actions {
		display: flex;
		justify-content: flex-end;
	}
	.invoice-actions .btn-link-sm {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	/* Payment methods */
	.pm-section {
		margin-top: 24px;
	}

	.pm-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-bottom: 12px;
	}

	.pm-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 14px;
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
	}
	.pm-row:last-child { border-bottom: none; }

	/* Auth method */
	.auth-method-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.auth-method-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 11px 14px;
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
	}
	.auth-method-row:last-child { border-bottom: none; }
	.auth-method-row--muted { background: var(--bg-surface); }
	.auth-method-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
	}
	.auth-method-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.auth-method-add-list {
		display: flex;
		flex-direction: column;
		border: 1px dashed var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-top: 8px;
	}
	.auth-method-add-panel {
		padding: 12px 14px;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-subtle);
	}
	.auth-method-form {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.auth-method-form .form-input {
		max-width: 260px;
	}

	.pm-brand-icon {
		width: 32px;
		height: 22px;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.pm-info {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
	}

	.pm-brand {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.pm-last4 {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.pm-exp {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.pm-actions {
		margin-top: 4px;
	}

	/* ─── Sessions / Security ─── */
	.sessions-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-bottom: 12px;
	}

	.session-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 13px 16px;
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}
	.session-row:last-child { border-bottom: none; }
	.session-row--current {
		background: rgba(0, 112, 255, 0.04);
		border-left: 3px solid var(--color-brand-dim);
		padding-left: 13px;
	}

	.session-device {
		width: 34px;
		height: 34px;
		border-radius: var(--radius-md);
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.session-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
		min-width: 0;
	}

	.session-primary {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
		font-size: 0.875rem;
	}

	.session-browser {
		font-weight: 600;
		color: var(--text-primary);
	}

	.session-sep {
		color: var(--text-tertiary);
		font-size: 0.8125rem;
	}

	.session-os {
		color: var(--text-secondary);
	}

	.session-meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px;
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.session-dot {
		opacity: 0.4;
	}

	.session-location {
		color: var(--text-secondary);
	}

	.session-ip {
		font-family: var(--font-mono);
	}

	.sessions-note {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin: 0;
	}

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
