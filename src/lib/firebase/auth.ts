// ─────────────────────────────────────────────
// OmniPlot — AUTH SERVICE
// ─────────────────────────────────────────────
import {
	onAuthStateChanged,
	signOut,
	signInWithPopup,
	linkWithPopup,
	linkWithCredential,
	linkWithPhoneNumber,
	unlink,
	EmailAuthProvider,
	GoogleAuthProvider,
	sendSignInLinkToEmail,
	isSignInWithEmailLink,
	signInWithEmailLink,
	signInWithPhoneNumber,
	RecaptchaVerifier,
	initializeRecaptchaConfig,
	updateProfile,
	type ConfirmationResult,
} from "firebase/auth";
import { auth } from "./client";
import {
	getUserProfile,
	createUserProfile,
	updateUserProfile,
	subscribeToUser,
	writeSessionId,
} from "./firestore";
import { userStore } from "$lib/stores";

// ─── Constants ────────────────────────────────
const EMAIL_KEY    = "omniplot_signin_email";
const NAME_KEY     = "omniplot_signin_name";
const SESSION_KEY  = "omniplot_session_id";
const LINK_MODE_KEY = "omniplot_link_mode";
export const PENDING_INVITE_KEY = "omniplot_pending_invite";

// ─── Internal state ───────────────────────────
let unsubProfile: (() => void) | null = null;
let localSessionId: string | null = null;

// Returns the browser-local session ID, creating it once per browser profile.
function getOrCreateSessionId(): string {
	let id = localStorage.getItem(SESSION_KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(SESSION_KEY, id);
	}
	return id;
}

// ─── Session listener ─────────────────────────
// Call once from the root layout onMount.
// Returns the Firebase unsubscribe function.
export function initAuth(): () => void {
	// Pre-warm reCAPTCHA config so phone auth doesn't fail on first attempt.
	// Requires the current domain to be in Firebase Console → Auth → Authorized Domains.
	if (typeof window !== "undefined") {
		initializeRecaptchaConfig(auth).catch(() => {});
	}

	return onAuthStateChanged(auth, async (firebaseUser) => {
		// Tear down previous profile subscription
		unsubProfile?.();
		unsubProfile = null;

		if (!firebaseUser) {
			localSessionId = null;
			userStore.set(null);
			userStore.setLoading(false);
			return;
		}

		// Ensure Firestore profile exists for this user
		const existing = await getUserProfile(firebaseUser.uid);
		if (!existing) {
			await createUserProfile(firebaseUser.uid, {
				email:       firebaseUser.email ?? "",
				displayName: firebaseUser.displayName ?? "",
				photoURL:    firebaseUser.photoURL ?? null,
				phone:       firebaseUser.phoneNumber ?? null,
			});

			// Fire-and-forget welcome email (non-fatal if it fails)
			firebaseUser.getIdToken()
				.then(token => fetch('/api/user/welcome', {
					method:  'POST',
					headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				}))
				.catch(() => {});
		} else if (firebaseUser.phoneNumber && !existing.phone) {
			// Backfill phone for profiles created before this field was added
			await updateUserProfile(firebaseUser.uid, { phone: firebaseUser.phoneNumber });
		}

		// Claim this session: write our ID to Firestore, kicking any other active session
		localSessionId = getOrCreateSessionId();
		await writeSessionId(firebaseUser.uid, localSessionId).catch(() => {});

		// Log session activity once per browser tab (sessionStorage clears on tab close)
		if (!sessionStorage.getItem('omniplot_session_logged')) {
			sessionStorage.setItem('omniplot_session_logged', '1');
			firebaseUser.getIdToken()
				.then(token => fetch('/api/user/log-session', {
					method:  'POST',
					headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
					body:    JSON.stringify({ sessionId: localSessionId }),
				}))
				.catch(() => {});
		}

		// Subscribe to live Firestore updates; detect session kicks
		unsubProfile = subscribeToUser(firebaseUser.uid, (profile) => {
			if (!profile) {
				userStore.set(null);
				userStore.setLoading(false);
				return;
			}

			// Another device wrote a different sessionId → we've been kicked
			if (
				profile.activeSessionId &&
				localSessionId &&
				profile.activeSessionId !== localSessionId
			) {
				localSessionId = null;
				localStorage.removeItem(SESSION_KEY);
				sessionStorage.removeItem('omniplot_session_logged');
				unsubProfile?.();
				unsubProfile = null;
				userStore.set(null);
				signOut(auth).catch(() => {});
				// Redirect to login with reason — SvelteKit goto isn't available here,
				// so we use location.replace which works in any context
				if (typeof window !== "undefined") {
					window.location.replace("/login?reason=kicked");
				}
				return;
			}

			userStore.set(profile);
			userStore.setLoading(false);
		});
	});
}

// ─── Google ───────────────────────────────────
export async function signInWithGoogle(): Promise<void> {
	const provider = new GoogleAuthProvider();
	await signInWithPopup(auth, provider);
}

// ─── Magic Link ───────────────────────────────
export async function sendMagicLink(
	email: string,
	displayName?: string,
): Promise<void> {
	const actionCodeSettings = {
		url: `${window.location.origin}/verify`,
		handleCodeInApp: true,
	};
	await sendSignInLinkToEmail(auth, email, actionCodeSettings);
	localStorage.setItem(EMAIL_KEY, email);
	localStorage.removeItem(LINK_MODE_KEY);
	if (displayName) localStorage.setItem(NAME_KEY, displayName);
}

// Called from /verify on page load.
// Returns true if sign-in (or, in link mode, account linking) was completed.
export async function completeMagicLinkSignIn(): Promise<boolean> {
	if (!isSignInWithEmailLink(auth, window.location.href)) return false;

	let email = localStorage.getItem(EMAIL_KEY) ?? "";
	if (!email) {
		// Cross-device scenario: prompt the user
		email = window.prompt("Please confirm the email address you signed in with") ?? "";
	}
	if (!email) return false;

	// Settings → "Add email" flow: attach this email to the already-signed-in
	// account instead of starting a new session.
	if (localStorage.getItem(LINK_MODE_KEY) === "1" && auth.currentUser) {
		const credential = EmailAuthProvider.credentialWithLink(email, window.location.href);
		const { user } = await linkWithCredential(auth.currentUser, credential);
		localStorage.removeItem(EMAIL_KEY);
		localStorage.removeItem(LINK_MODE_KEY);
		await updateUserProfile(user.uid, { email: user.email ?? email });
		return true;
	}

	const { user } = await signInWithEmailLink(auth, email, window.location.href);
	localStorage.removeItem(EMAIL_KEY);

	// Apply name if captured during signup
	const name = localStorage.getItem(NAME_KEY);
	if (name && !user.displayName) {
		await updateProfile(user, { displayName: name });
		await updateUserProfile(user.uid, { displayName: name });
		localStorage.removeItem(NAME_KEY);
	}

	return true;
}

// ─── Link additional sign-in methods ──────────
// All require an active session (auth.currentUser). Used from Settings → Security
// so a user can add a second way to sign in (e.g. a phone-only account adding email).

export async function linkGoogleAccount(): Promise<void> {
	if (!auth.currentUser) throw new Error("Not signed in.");
	await linkWithPopup(auth.currentUser, new GoogleAuthProvider());
}

// Sends the magic link in "link mode" — /verify will attach it to the current
// session instead of signing in as a new user.
export async function sendLinkEmail(email: string): Promise<void> {
	if (!auth.currentUser) throw new Error("Not signed in.");
	const actionCodeSettings = {
		url: `${window.location.origin}/verify`,
		handleCodeInApp: true,
	};
	await sendSignInLinkToEmail(auth, email, actionCodeSettings);
	localStorage.setItem(EMAIL_KEY, email);
	localStorage.setItem(LINK_MODE_KEY, "1");
}

export async function sendLinkPhoneOTP(
	phoneNumber: string,
	verifier: RecaptchaVerifier,
): Promise<ConfirmationResult> {
	if (!auth.currentUser) throw new Error("Not signed in.");
	return linkWithPhoneNumber(auth.currentUser, phoneNumber, verifier);
}

// Called after confirmationResult.confirm(otp) succeeds for a phone link.
export async function finishLinkPhone(phoneNumber: string): Promise<void> {
	if (!auth.currentUser) return;
	await updateUserProfile(auth.currentUser.uid, { phone: phoneNumber });
}

// Removes a linked provider. Firebase itself refuses to unlink the last
// remaining provider, so callers still get a friendly error instead of a broken account.
export async function unlinkProvider(providerId: string): Promise<void> {
	if (!auth.currentUser) throw new Error("Not signed in.");
	await unlink(auth.currentUser, providerId);

	// Clear the corresponding profile field if no other provider still supplies it
	const remaining = auth.currentUser.providerData;
	if (providerId === "phone" && !remaining.some((p) => p.providerId === "phone")) {
		await updateUserProfile(auth.currentUser.uid, { phone: null });
	}
	if (
		(providerId === "password" || providerId === "google.com") &&
		!remaining.some((p) => p.email)
	) {
		await updateUserProfile(auth.currentUser.uid, { email: "" });
	}
}

// ─── Phone / OTP ──────────────────────────────
// container: an invisible <div bind:this={el}> in the component
export function createRecaptchaVerifier(container: HTMLElement): RecaptchaVerifier {
	return new RecaptchaVerifier(auth, container, {
		size: "invisible",
		// Silence unhandled-rejection noise from the Enterprise probe
		"error-callback": () => {},
	});
}

export async function sendPhoneOTP(
	phoneNumber: string,
	verifier: RecaptchaVerifier,
): Promise<ConfirmationResult> {
	return signInWithPhoneNumber(auth, phoneNumber, verifier);
}

// ─── Update display name ──────────────────────
// Used after phone sign-in on signup page where user entered a name.
export async function applyDisplayName(displayName: string): Promise<void> {
	if (!auth.currentUser) return;
	await updateProfile(auth.currentUser, { displayName });
	await updateUserProfile(auth.currentUser.uid, { displayName });
}

// ─── Sign out ─────────────────────────────────
export async function signOutUser(): Promise<void> {
	unsubProfile?.();
	unsubProfile = null;
	localSessionId = null;
	localStorage.removeItem(SESSION_KEY);
	sessionStorage.removeItem('omniplot_session_logged');
	userStore.set(null);
	await signOut(auth);
}
