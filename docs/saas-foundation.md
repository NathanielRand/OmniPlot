# SaaS Foundation Template

A complete, production-ready SaaS scaffold extracted from a live application. Includes every common layer — auth, billing, org hierarchy, email, admin panel, marketing site, user settings, session security, and transactional infrastructure — abstracted from any specific product. Drop this into a new project, swap in your product's core feature routes, and you have a shippable SaaS.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit 2 + Svelte 5 Runes (`$state`, `$derived`, `$effect`) |
| Language | TypeScript (strict) |
| Styling | CSS custom properties (design token system, no utility framework) |
| Auth + DB | Firebase Auth + Firestore (Google Cloud) |
| Billing | Stripe (Checkout, Customer Portal, Webhooks, Connected Accounts) |
| Email | Resend (transactional, HTML-only, table-safe inline styles) |
| Deploy | Vercel (`@sveltejs/adapter-vercel`), `pnpm` with `shamefully-hoist=true` |
| Heavy compute (optional) | Go API on GCP Cloud Run — SvelteKit client calls `/api/[route]` which proxies to the Cloud Run service. Only needed for CPU-intensive server-side work. |

### `package.json` notes
- `"type": "module"` required
- pnpm `.npmrc`: `shamefully-hoist=true` (required for Firebase compat with Vercel)
- `vite.config.ts`: standard SvelteKit plugin, no special config needed

---

## Route Architecture

SvelteKit route groups organize the app into four separate layout contexts.

```
src/routes/
├── +layout.svelte              # Root layout: theme, auth init, global overlays
├── +error.svelte               # Global error page
│
├── (marketing)/                # Public marketing site, no auth required
│   ├── +layout.svelte
│   ├── +page.svelte            # Landing / home
│   ├── pricing/+page.svelte
│   ├── faq/+page.svelte
│   ├── changelog/+page.svelte
│   ├── about/+page.svelte
│   ├── support/+page.svelte
│   ├── privacy/+page.svelte
│   ├── terms/+page.svelte
│   ├── insights/+page.svelte          # Blog listing
│   ├── insights/+page.server.ts       # SSR fetch
│   └── insights/[slug]/+page.svelte   # Blog post
│
├── (auth)/                     # Auth pages, centered card layout
│   ├── +layout.svelte
│   ├── login/+page.svelte
│   ├── signup/+page.svelte
│   ├── verify/+page.svelte     # Magic link completion
│   └── join/[token]/+page.svelte  # Shop invite acceptance
│
├── (app)/                      # Authenticated app, AppShell layout
│   ├── +layout.svelte          # Auth gate + AppShell wrapper
│   ├── [PRODUCT_CORE]/         # ← Your product's main feature goes here
│   ├── jobs/+page.svelte       # Operation history
│   ├── settings/+page.svelte
│   └── community/upload/+page.svelte  # User content submission
│
├── admin/                      # Admin panel, admin-only shell
│   ├── +layout.svelte
│   ├── +page.svelte            # Dashboard / overview
│   ├── users/+page.svelte
│   ├── analytics/+page.svelte
│   ├── products/+page.svelte   # Stripe products + pricing sync
│   ├── products/+page.server.ts
│   ├── coupons/+page.svelte
│   ├── emails/+page.svelte     # Batch email sender
│   ├── reports/+page.svelte    # User-submitted reports/flags
│   ├── billing/+page.svelte    # Platform-level Stripe costs
│   ├── billing/+page.server.ts
│   ├── insights/+page.svelte   # Blog CMS
│   ├── insights/[id]/+page.svelte
│   └── settings/+page.svelte   # Global app settings, promo banner
│
└── api/
    ├── billing/
    │   ├── checkout/+server.ts      # Create Stripe Checkout session
    │   ├── portal/+server.ts        # Stripe Customer Portal redirect
    │   ├── webhook/+server.ts       # Stripe webhook handler
    │   ├── cancel/+server.ts        # POST = cancel, DELETE = reactivate
    │   ├── payment-methods/+server.ts # GET/PATCH/DELETE
    │   ├── invoices/+server.ts
    │   ├── setup-intent/+server.ts  # SetupIntent for adding cards
    │   └── setup/+server.ts
    ├── admin/
    │   ├── stats/+server.ts
    │   ├── users/+server.ts
    │   ├── users/[uid]/+server.ts
    │   ├── billing/+server.ts
    │   ├── coupons/+server.ts
    │   ├── emails/+server.ts
    │   ├── products/+server.ts
    │   ├── promo-banner/+server.ts
    │   ├── reports/+server.ts
    │   └── settings/+server.ts
    ├── user/
    │   ├── welcome/+server.ts       # Triggers welcome email on first sign-in
    │   ├── log-session/+server.ts   # Records session activity for security tab
    │   └── sessions/+server.ts      # Returns last 15 sessions
    ├── promo-banner/+server.ts      # Public promo banner read
    ├── reports/+server.ts           # User-submitted bug/feedback reports
    ├── support/+server.ts           # Support contact form
    └── cron/
        └── monthly-report/+server.ts # Vercel cron: send monthly usage emails
```

---

## Part I: Pages & UI/UX

### Root Layout (`src/routes/+layout.svelte`)

Mounted once at the top of every route. Responsibilities:
- `themeStore.init()` — reads `localStorage` for saved theme, applies `data-theme` attribute to `<html>`
- `initAuth()` — starts the Firebase `onAuthStateChanged` listener
- `patternStore.init()` or equivalent — subscribes to any app-wide Firestore collections
- Shop subscription: `$effect` watches `userStore.user?.shopId`, calls `subscribeToShop()` when set
- Renders global overlays: `<Toast />`, `<PricingModal />`, `<ReportModal />`, `<UpdateBanner />`
- On mount: checks `sessionStorage` for `"open_upgrade"` flag, opens pricing modal if set

### `(marketing)` Layout

Thin wrapper: `<MarketingLayout>` component with sticky top nav (`MARKETING_NAV`) and footer. No auth required.

#### Landing Page (`/`)
- Hero with headline, subheadline, two CTAs (primary = sign up, secondary = pricing)
- Features grid (3–4 blocks)
- Social proof / testimonials section
- Final CTA banner
- Pricing section (mirrors `/pricing`)

#### Pricing Page (`/pricing`)
- Monthly / Yearly billing toggle (saves ~20% — show per-month equivalent price)
- Plan cards from `PRICING_PLANS` config array
- Each card: name, price, description, features list, CTA button
- Shop plans section below individual plans (`SHOP_PRICING_PLANS`)
- "Most popular" badge support
- FAQ accordion inline or linked to `/faq`

#### Insights / Blog (`/insights`, `/insights/[slug]`)
- Listing page: category filter tabs, card grid with cover image, excerpt, read time, date
- Post page: full HTML content, author, publish date, category badge, back link
- SSR via `+page.server.ts` (fetch from Firestore or CMS)
- Admin CMS at `/admin/insights` for creating / publishing posts

#### Changelog (`/changelog`)
- Rendered from static `CHANGELOG` config array
- Each entry: version, date, label, changes array with `type` ("feature" | "improvement" | "fix") and text
- Styled as a vertical timeline

#### Support (`/support`)
- Contact form: name, email, category dropdown, message textarea
- Submits to `/api/support` → sends email via Resend
- Category options: billing, bug report, feature request, general

#### FAQ (`/faq`)
- Accordion grouped by category
- Rendered from `FAQ_ITEMS` config array

#### Legal (`/privacy`, `/terms`)
- Static content pages

### `(auth)` Layout

Centered card layout. Logo at top. No sidebar. Redirects authenticated users away (via `$effect` watching `userStore.isAuth`).

#### Login (`/login`)
Three auth methods on one page:

1. **Google OAuth** — "Continue with Google" button → `signInWithPopup(GoogleAuthProvider)`
2. **Magic link** (email) — email field → `sendSignInLinkToEmail()` → stores email in localStorage → confirmation state shows "check inbox" message
3. **Phone OTP** — tab switch → international phone input with country selector → invisible reCAPTCHA → `signInWithPhoneNumber()` → OTP code input → `confirmationResult.confirm(otp)`

Session kick banner: if URL param `?reason=kicked`, show a warning that the account was opened on another device.

After any successful sign-in, `$effect` redirects to `/[product-core-route]`.

#### Signup (`/signup`)
Same three methods as login. Adds:
- Display name field (stored in localStorage during magic link flow, applied after verification)
- After phone OTP confirmation, prompts for name if not set

#### Verify (`/verify`)
- Called when user clicks the magic link email
- On mount: `completeMagicLinkSignIn()` — checks `isSignInWithEmailLink()`, retrieves stored email, calls `signInWithEmailLink()`
- Handles cross-device case: if no stored email, prompts with `window.prompt()`
- Applies stored display name to Firebase profile and Firestore

#### Join (`/join/[token]`)
- Reads `ShopInvite` from Firestore using `token` as doc ID
- If user not signed in: saves token to `localStorage` under `PENDING_INVITE_KEY`, redirects to `/signup`
- After auth: reads pending invite from localStorage, calls `acceptShopInvite(shopId, uid, role)`
- Shows shop name and role in UI before accepting

### `(app)` Layout

Auth gate pattern:
```
$effect(() => {
  if (userStore.loading) return;
  if (!userStore.isAuth) goto('/login', { replaceState: true });
  else cutJobStore.init(userStore.user.uid);
});
```
While `userStore.loading`, shows full-screen spinner. Once resolved and authenticated, renders `<AppShell>`.

#### AppShell Layout

Two-column grid: `220px sidebar | 1fr main`.

**Sidebar:**
- Logo at top
- Nav items from `APP_NAV` config: icon + label, active state via `page.url.pathname.startsWith(href)`
- Collapsible (icon-only mode on toggle, persisted to localStorage)
- Mobile: off-canvas drawer, hamburger in topbar
- Footer: user avatar, display name, email, tier badge

**Topbar:**
- Left: hamburger (mobile), breadcrumb (current section name)
- Right: theme toggle, notification bell (optional), avatar button
- Avatar dropdown menu (fixed position, click-outside to close):
  - User identity header: avatar image or initials, display name, email, tier badge, shop chip
  - Navigation items: app sections
  - Divider
  - Sign out button

#### Settings (`/settings`)

Tab-based layout: sidebar nav (200px) + scrollable content area.

Tabs (in order):
1. **Profile** — display name input (editable), email (read-only), appearance section with dark/light theme picker, shop membership card (if in a shop)
2. **Billing** — current plan card (shows tier, renewal date, trial end, cancelAtPeriodEnd warning, past_due alert, usage progress bar), upgrade button (opens PricingModal), cancel/reactivate, payment methods list (brand/last4/expiry, set default, remove), invoice history table (date, number, amount, status, PDF download link)
3. **Notifications** — toggles for: job complete, job failed, usage warning, changelog, newsletter
4. **Team** — if no shop: create shop form (name, plan select) with Stripe checkout redirect; if in shop: shop header with billing button, seat usage bar, members list (avatar, name, email, role selector/tag, remove button), invite section (role select, generate link, copy button, pending invites list with revoke)
5. **Security** — session history list (last 15): device icon (mobile/tablet/desktop), browser + OS, flag + city/country, IP, time ago; current session highlighted
6. **Danger Zone** — clear history, cancel subscription, delete account (each as a card with title + desc + destructive button, with inline confirmation for irreversible actions)

URL param handling on mount: `?tab=billing`, `?checkout=success`, `?addCard=true&returnTo=/path`

#### Jobs (`/jobs`)
Generic operation history page. Shows a paginated list of past operations with status, date, key metrics. Product-specific fields can be added as columns.

#### Community Upload (`/community/upload`)
User content submission form. Submitted items go to a Firestore collection; admin reviews at `/admin/[content-type]`.

### Admin Panel

Layout: `220px sidebar | 1fr main`.

Auth gate in `+layout.svelte`:
```svelte
$effect(() => {
  if (!userStore.loading && !userStore.isAdmin) goto('/[product-core]', { replaceState: true });
});
```
`isAdmin` is true when `userStore.user?.tier === 'admin'`.

Sidebar: logo + "Admin" danger badge, flat nav list from `ADMIN_NAV`, "Back to app" footer link.
Topbar: breadcrumb (Admin / [current page]), theme toggle, avatar dropdown.

**Admin pages:**

| Route | Purpose |
|---|---|
| `/admin` | Dashboard — 4-stat row (total users, active today, MTD, revenue MRR), tier breakdown, recent operations, top items |
| `/admin/users` | User table with search/filter, per-user: email, tier badge, join date, last seen, usage, flag toggle, notes field, manual tier override |
| `/admin/analytics` | Charts: signups over time, revenue over time, DAU/MAU, top features |
| `/admin/products` | Stripe products + prices list; sync button to pull latest from Stripe API; metadata editor |
| `/admin/coupons` | Create and list Stripe coupons (percent-off, amount-off, duration, max redemptions, expiry) |
| `/admin/emails` | Compose and send a transactional email to a specific user or all users of a tier; preview panel |
| `/admin/reports` | User-submitted reports/flags table: message, category, reporter, date, resolve action |
| `/admin/billing` | Platform-level Stripe costs: balance, recent charges, payouts, connected account fees |
| `/admin/insights` | Blog CMS: list posts (title, status, date), create/edit/publish/delete |
| `/admin/settings` | Global app config: maintenance mode toggle, promo banner text/CTA/visibility, support email, feature flags |

---

## Part II: Implementation Appendix

### A. Firebase Setup

#### Client (`src/lib/firebase/client.ts`)
```typescript
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const config = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app  = getApps().length ? getApps()[0] : initializeApp(config);
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
```

#### Firebase Admin (`src/lib/server/firebase-admin.ts`)
Server-only. Used in API routes for token verification and privileged Firestore writes.
```typescript
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth }      from 'firebase-admin/auth';
import { FIREBASE_SERVICE_ACCOUNT } from '$env/static/private';

const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });

export const getAdminDb   = () => getFirestore(app);
export const getAdminAuth = () => getAuth(app);
```

Auth verification helper used in every API route:
```typescript
export async function requireAuth(request: Request) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) throw error(401, 'Unauthorized');
  const decoded = await getAdminAuth().verifyIdToken(token);
  return decoded;
}

export async function requireAdmin(request: Request) {
  const decoded = await requireAuth(request);
  const snap = await getAdminDb().doc(`users/${decoded.uid}`).get();
  if (snap.data()?.tier !== 'admin') throw error(403, 'Forbidden');
  return decoded;
}
```

---

### B. Auth Implementation (`src/lib/firebase/auth.ts`)

#### Constants
```typescript
const EMAIL_KEY   = '[app]_signin_email';
const NAME_KEY    = '[app]_signin_name';
const SESSION_KEY = '[app]_session_id';
export const PENDING_INVITE_KEY = '[app]_pending_invite';
```

#### `initAuth()` — call once from root layout `onMount`
```typescript
export function initAuth(): () => void {
  if (typeof window !== 'undefined') {
    initializeRecaptchaConfig(auth).catch(() => {});
  }
  return onAuthStateChanged(auth, async (firebaseUser) => {
    unsubProfile?.();
    if (!firebaseUser) { userStore.set(null); userStore.setLoading(false); return; }

    // Ensure profile exists; fire welcome email on first sign-in
    const existing = await getUserProfile(firebaseUser.uid);
    if (!existing) {
      await createUserProfile(firebaseUser.uid, { email, displayName, photoURL, phone });
      firebaseUser.getIdToken().then(token =>
        fetch('/api/user/welcome', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      ).catch(() => {});
    }

    // Session enforcement: write this browser's sessionId to Firestore
    localSessionId = getOrCreateSessionId();
    await writeSessionId(firebaseUser.uid, localSessionId).catch(() => {});

    // Log session activity once per tab
    if (!sessionStorage.getItem('[app]_session_logged')) {
      sessionStorage.setItem('[app]_session_logged', '1');
      // POST /api/user/log-session with sessionId
    }

    // Live profile subscription + session kick detection
    unsubProfile = subscribeToUser(firebaseUser.uid, (profile) => {
      if (profile?.activeSessionId && localSessionId &&
          profile.activeSessionId !== localSessionId) {
        // Kicked — another device took over
        signOut(auth);
        window.location.replace('/login?reason=kicked');
        return;
      }
      userStore.set(profile);
      userStore.setLoading(false);
    });
  });
}
```

#### Auth methods
```typescript
// Google
export async function signInWithGoogle() {
  await signInWithPopup(auth, new GoogleAuthProvider());
}

// Magic link — step 1: send
export async function sendMagicLink(email: string, displayName?: string) {
  await sendSignInLinkToEmail(auth, email, { url: `${origin}/verify`, handleCodeInApp: true });
  localStorage.setItem(EMAIL_KEY, email);
  if (displayName) localStorage.setItem(NAME_KEY, displayName);
}

// Magic link — step 2: complete (called from /verify on mount)
export async function completeMagicLinkSignIn(): Promise<boolean> {
  if (!isSignInWithEmailLink(auth, window.location.href)) return false;
  let email = localStorage.getItem(EMAIL_KEY) ?? window.prompt('Confirm your email') ?? '';
  const { user } = await signInWithEmailLink(auth, email, window.location.href);
  localStorage.removeItem(EMAIL_KEY);
  const name = localStorage.getItem(NAME_KEY);
  if (name && !user.displayName) {
    await updateProfile(user, { displayName: name });
    await updateUserProfile(user.uid, { displayName: name });
    localStorage.removeItem(NAME_KEY);
  }
  return true;
}

// Phone — step 1: send OTP
export function createRecaptchaVerifier(container: HTMLElement) {
  return new RecaptchaVerifier(auth, container, { size: 'invisible', 'error-callback': () => {} });
}
export async function sendPhoneOTP(phone: string, verifier: RecaptchaVerifier) {
  return signInWithPhoneNumber(auth, phone, verifier);
}
// Phone — step 2: verify (call confirmationResult.confirm(otp) from component)

export async function signOutUser() {
  unsubProfile?.(); localSessionId = null;
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem('[app]_session_logged');
  userStore.set(null);
  await signOut(auth);
}
```

---

### C. Firestore Schema

#### Collections

```
users/{uid}
  uid, email, displayName, photoURL, phone
  tier: "free" | "lite" | "pro" | "admin"
  createdAt, updatedAt
  usage: { [productCount]: number, lastAt: Date|null, monthlyCount: number, monthResetAt: Date }
  subscription: {
    stripeCustomerId, stripePriceId, stripeSubscriptionId
    status: "active"|"canceled"|"past_due"|"trialing"|null
    currentPeriodEnd, trialEnd, cancelAtPeriodEnd
  }
  preferences: { theme: "dark"|"light"|"system", [productPrefs] }
  activeSessionId: string | null   ← session enforcement
  shopId: string | null
  shopRole: "owner"|"manager"|"tech"|null

shops/{shopId}
  id, name, plan: "starter"|"team"|"studio"
  seats: number  (3 | 10 | 25)
  ownerId
  stripeCustomerId, stripePriceId
  subscriptionStatus: "active"|"canceled"|"past_due"|"trialing"|null
  currentPeriodEnd
  createdAt, updatedAt

shops/{shopId}/members/{uid}
  uid, shopId, role, displayName, email, joinedAt

shopInvites/{token}           ← token is the doc ID
  id, shopId, shopName, role
  email: string | null        ← null = open link
  createdBy (uid), status: "pending"|"accepted"|"revoked"
  createdAt, expiresAt

userSessions/{uid}/sessions/{sessionId}
  sessionId, ip, city, region, country, countryCode
  browser, browserVersion, os, osVersion
  device: "mobile"|"tablet"|"desktop"
  createdAt: number (epoch ms)

[productContent]/{id}         ← your product's data goes here

userSubmissions/{id}          ← community uploads / user content
  ownerId, status: "private"|"pending"|"approved"|"rejected"
  submitToCommunity, isPublished, adminNotes
  createdAt, updatedAt

reports/{id}                  ← user-submitted bug/feedback
  userId, userEmail, category, message
  autoReported, resolvedAt, createdAt

insights/{id}                 ← blog posts
  slug, title, excerpt, content (HTML)
  category, tags, status: "draft"|"published"
  coverImageUrl, author, readTimeMinutes, viewCount
  metaTitle, metaDescription, publishedAt, createdAt, updatedAt
```

#### Firestore Rules (security rules template)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuth() { return request.auth != null; }
    function isAdmin() {
      return isAuth() && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.tier == 'admin';
    }
    function isOwner(uid) { return isAuth() && request.auth.uid == uid; }

    match /users/{uid} {
      allow read:   if isOwner(uid) || isAdmin();
      allow create: if isOwner(uid);
      allow update: if isOwner(uid) || isAdmin();
    }
    match /shops/{shopId} {
      allow read: if isAuth() && (
        resource.data.ownerId == request.auth.uid ||
        exists(/databases/$(database)/documents/shops/$(shopId)/members/$(request.auth.uid))
      ) || isAdmin();
      allow write: if isAdmin();
    }
    match /shops/{shopId}/members/{uid} {
      allow read:  if isAuth();
      allow write: if isAdmin();
    }
    match /shopInvites/{token} {
      allow read:   if isAuth();
      allow create: if isAuth();
      allow update: if isAuth();
      allow delete: if isAdmin();
    }
    match /userSessions/{uid}/sessions/{sessionId} {
      allow create: if isOwner(uid);
      allow read:   if isOwner(uid) || isAdmin();
    }
    match /insights/{id} {
      allow read:  if resource.data.status == 'published' || isAdmin();
      allow write: if isAdmin();
    }
    match /reports/{id} {
      allow create: if isAuth();
      allow read, update, delete: if isAdmin();
    }
  }
}
```

---

### D. Stripe Billing

#### Server client (`src/lib/server/stripe.ts`)
```typescript
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY, STRIPE_CONNECTED_ACCOUNT_ID } from '$env/static/private';

export const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' });
export const connectedAccount: Stripe.RequestOptions = {
  stripeAccount: STRIPE_CONNECTED_ACCOUNT_ID,
};
```

#### Checkout (`/api/billing/checkout/+server.ts`)
Handles both individual and shop subscriptions based on `type` in request body.
```typescript
// POST body: { type: 'individual'|'shop', tier?, plan?, shopId?, interval: 'month'|'year' }
// Creates Stripe Checkout session with metadata: { uid, type, tier?, plan?, shopId? }
// Returns: { url: string }
```
Session metadata is used by webhook to identify who completed checkout.

#### Portal (`/api/billing/portal/+server.ts`)
```typescript
// POST body: { type: 'individual'|'shop', shopId? }
// Looks up stripeCustomerId from Firestore (user or shop doc)
// Creates Stripe Billing Portal session
// Returns: { url: string }
```

#### Webhook (`/api/billing/webhook/+server.ts`)
Read raw body as text, verify `stripe-signature` header with `STRIPE_WEBHOOK_SECRET`.
Always return 200 (even on handler error) to avoid Stripe retries for partially-processed events.

Events handled:
```typescript
'checkout.session.completed'       → onCheckoutComplete(session)
'customer.subscription.updated'    → onSubscriptionUpdated(sub)
'customer.subscription.deleted'    → onSubscriptionDeleted(sub)
'invoice.payment_failed'           → onPaymentFailed(invoice)
'invoice.payment_succeeded'        → onInvoicePaid(invoice)   // skip billing_reason='subscription_create'
'charge.refunded'                  → onChargeRefunded(charge)
```

**`onCheckoutComplete`** — reads `session.metadata.type`:
- `'shop'` → updates `shops/{shopId}` with plan, stripeCustomerId, subscriptionStatus=active
- `'individual'` → updates `users/{uid}` with tier, all subscription fields; sends upgrade email

**`onSubscriptionUpdated`** — updates status, priceId, periodEnd, cancelAtPeriodEnd on user or shop

**`onSubscriptionDeleted`** — sets status='canceled'; user tier → 'free'

**`onInvoicePaid`** — sends receipt email (skip `subscription_create` reason)

**`onChargeRefunded`** — looks up user by stripeCustomerId, sends refund email

#### Cancel / Reactivate (`/api/billing/cancel/+server.ts`)
```typescript
POST → stripe.subscriptions.update(subId, { cancel_at_period_end: true })
DELETE → stripe.subscriptions.update(subId, { cancel_at_period_end: false })
```

#### Payment Methods (`/api/billing/payment-methods/+server.ts`)
```typescript
GET   → stripe.paymentMethods.list({ customer, type: 'card' }), mark default
PATCH → stripe.customers.update(customerId, { invoice_settings: { default_payment_method: methodId } })
DELETE → stripe.paymentMethods.detach(methodId)
```

#### Setup Intent (adding a new card)
```typescript
// /api/billing/setup-intent → stripe.setupIntents.create({ customer, usage: 'off_session' })
// /api/billing/setup → confirm SetupIntent, attach payment method
```

Client-side: `<AddCardModal>` component mounts Stripe Elements (`CardElement`), creates SetupIntent via API, confirms client-side with `stripe.confirmCardSetup()`.

---

### E. Email System (`src/lib/server/email.ts`)

Resend via REST (not SDK) — single `sendEmail(to, subject, html)` function.

```typescript
const FROM = '[App Name] <noreply@[domain]>';

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) { console.warn('[email] RESEND_API_KEY not set'); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}`);
}
```

Email HTML: inline styles only, table-based layout for email client compatibility. Design token system not available in email — hardcode all colors.

Base layout structure:
- Dark background wrapper (`#080a0f`)
- 560px centered card with 1px brand-color accent bar at top
- Logo wordmark in header
- Content area with padding
- Footer: unsubscribe link, privacy link, terms link

Transactional email functions to implement:
```typescript
sendWelcomeEmail(to, displayName)
// Triggered by: /api/user/welcome POST, called from initAuth() on first sign-in
// Content: welcome headline, 3-bullet feature list, CTA to app

sendUpgradeEmail(to, displayName, tierLabel, amount, currency, periodEnd)
// Triggered by: webhook checkout.session.completed
// Content: "You're on [Plan]", info box (plan/billing/renewal), CTA to app

sendReceiptEmail(to, displayName, amount, currency, planName, invoicePdfUrl, periodEnd)
// Triggered by: webhook invoice.payment_succeeded (skip subscription_create)
// Content: "Payment confirmed", info box (plan/amount/date/period end), PDF download link

sendCancellationEmail(to, displayName, planName, accessUntil)
// Triggered by: call from cancel endpoint or subscription.updated webhook
// Content: warning alert box, "Subscription cancelled", info box, reactivate CTA

sendRefundEmail(to, displayName, amount, currency)
// Triggered by: webhook charge.refunded
// Content: success alert box, "Refund confirmed", info box (amount/expected arrival)

sendMonthlyReportEmail(to, displayName, monthLabel, [productMetric1], [productMetric2], tier)
// Triggered by: /api/cron/monthly-report (Vercel cron, runs ~1st of month)
// Content: stat block with key usage metrics, CTA to app
```

HTML building blocks (functions that return table row strings):
- `heading(text)` — large serif bold headline
- `subtext(text)` — muted subtitle
- `bodyText(text)` — body paragraph
- `cta(label, href, color?)` — colored button row
- `infoBox(rows: [label, value][])` — dark bordered grid
- `statBlock(items: { label, value }[])` — horizontal stat metrics
- `divider()` — 1px horizontal rule
- `alertBox(text, variant: 'warning'|'success'|'danger')` — left-border colored box

---

### F. Store Architecture (Svelte 5 Runes)

Pattern: factory functions returning plain objects with reactive `$state` getters. All stores live in `src/lib/stores/stores.svelte.ts`. Export aggregated from `src/lib/stores/index.ts`.

```typescript
// Theme store
function createThemeStore() {
  let theme = $state<'dark' | 'light'>('dark');
  function setTheme(t: 'dark' | 'light') {
    theme = t;
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('[app]-theme', t);
  }
  return {
    get current() { return theme; },
    set: setTheme,
    toggle() { setTheme(theme === 'dark' ? 'light' : 'dark'); },
    init() {
      const saved = localStorage.getItem('[app]-theme') as 'dark'|'light'|null;
      const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      setTheme(saved ?? system);
    },
  };
}

// Toast store
function createToastStore() {
  let toasts = $state<Toast[]>([]);
  function add(toast: Omit<Toast, 'id'>): string {
    const id = crypto.randomUUID();
    toasts = [...toasts, { ...toast, id }];
    const duration = toast.duration ?? 3500;
    if (duration > 0) setTimeout(() => remove(id), duration);
    return id;
  }
  function remove(id: string) { toasts = toasts.filter(t => t.id !== id); }
  return {
    get items() { return toasts; },
    add, remove,
    success: (title, message?) => add({ type: 'success', title, message }),
    error:   (title, message?) => add({ type: 'error', title, message, duration: 6000 }),
    warning: (title, message?) => add({ type: 'warning', title, message }),
    info:    (title, message?) => add({ type: 'info', title, message }),
  };
}

// User store
function createUserStore() {
  let user    = $state<UserProfile | null>(null);
  let loading = $state(true);
  return {
    get user()    { return user; },
    get loading() { return loading; },
    get isAuth()  { return user !== null; },
    get isAdmin() { return user?.tier === 'admin'; },
    set(u: UserProfile | null) { user = u; },
    setLoading(v: boolean)     { loading = v; },
  };
}

// Shop store
function createShopStore() {
  let shop = $state<Shop | null>(null);
  return {
    get shop()     { return shop; },
    get isActive() { return shop?.subscriptionStatus === 'active' || shop?.subscriptionStatus === 'trialing'; },
    set(s: Shop | null) { shop = s; },
  };
}

// UI store (modals + layout state)
function createUiStore() {
  let sidebarOpen        = $state(true);
  let pricingModalOpen   = $state(false);
  let reportModalOpen    = $state(false);
  let commandPaletteOpen = $state(false);
  let tourOpen           = $state(false);
  return {
    get sidebarOpen()        { return sidebarOpen; },
    get pricingModalOpen()   { return pricingModalOpen; },
    get reportModalOpen()    { return reportModalOpen; },
    get commandPaletteOpen() { return commandPaletteOpen; },
    get tourOpen()           { return tourOpen; },
    toggleSidebar()     { sidebarOpen = !sidebarOpen; },
    openPricing()       { pricingModalOpen = true; },
    closePricing()      { pricingModalOpen = false; },
    openReport()        { reportModalOpen = true; },
    closeReport()       { reportModalOpen = false; },
    openCommandPalette() { commandPaletteOpen = true; },
    closeCommandPalette() { commandPaletteOpen = false; },
    openTour()  { tourOpen = true; },
    closeTour() { tourOpen = false; },
  };
}

export const themeStore = createThemeStore();
export const toastStore = createToastStore();
export const userStore  = createUserStore();
export const shopStore  = createShopStore();
export const uiStore    = createUiStore();
```

---

### G. Type Definitions (`src/lib/types/index.ts`)

Core types that every SaaS needs:

```typescript
export type UserTier = 'free' | 'lite' | 'pro' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  phone: string | null;
  tier: UserTier;
  createdAt: Date;
  updatedAt: Date;
  usage: {
    [productActionCount]: number;    // replace with your metric
    lastActionAt: Date | null;
    monthlyCount: number;
    monthResetAt: Date;
  };
  subscription: {
    stripeCustomerId:     string | null;
    stripePriceId:        string | null;
    stripeSubscriptionId: string | null;
    status: 'active' | 'canceled' | 'past_due' | 'trialing' | null;
    currentPeriodEnd: Date | null;
    trialEnd:         Date | null;
    cancelAtPeriodEnd: boolean;
  };
  preferences: {
    theme: 'dark' | 'light' | 'system';
    // add product-specific preferences here
  };
  activeSessionId: string | null;
  shopId:   string | null;
  shopRole: ShopRole | null;
}

export type ShopPlan = 'starter' | 'team' | 'studio';
export type ShopRole = 'owner' | 'manager' | 'tech';
export type InviteStatus = 'pending' | 'accepted' | 'revoked';

export interface Shop {
  id: string;
  name: string;
  plan: ShopPlan;
  seats: number;
  ownerId: string;
  stripeCustomerId: string | null;
  stripePriceId:    string | null;
  subscriptionStatus: 'active' | 'canceled' | 'past_due' | 'trialing' | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShopMember {
  uid: string; shopId: string; role: ShopRole;
  displayName: string; email: string; joinedAt: Date;
}

export interface ShopInvite {
  id: string; shopId: string; shopName: string; role: ShopRole;
  email: string | null;   // null = open link (anyone with token can join)
  createdBy: string;
  status: InviteStatus;
  createdAt: Date; expiresAt: Date;
}

export interface PricingPlan {
  id: UserTier;
  name: string;
  price: number;        // monthly USD
  yearlyPrice: number;  // per-month equivalent when billed annually
  description: string;
  features: string[];
  limits: {
    actionsPerDay:   number | null;   // null = unlimited
    actionsPerMonth: number | null;
    seats: number;
    customContent:  boolean;
    aiAssist:       boolean;
    prioritySupport: boolean;
  };
  stripePriceId: string;
  stripeYearlyPriceId: string;
  popular?: boolean;
  badge?: string;
}

export interface InsightPost {
  id: string; slug: string; title: string; excerpt: string;
  content: string;   // HTML
  category: string; tags: string[];
  status: 'draft' | 'published';
  coverImageUrl: string | null;
  author: string; readTimeMinutes: number; viewCount: number;
  metaTitle: string | null; metaDescription: string | null;
  publishedAt: Date | null; createdAt: Date; updatedAt: Date;
}

export interface AdminStats {
  totalUsers: number; activeToday: number; activeMTD: number;
  tierBreakdown: Record<UserTier, number>;
  [productMetric]: number;
  revenue: { mrr: number; arr: number; lifetimeValue: number; };
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  action?: { label: string; fn: () => void };
}

export interface ApiResponse<T = unknown> {
  data: T | null;
  error: string | null;
  status: number;
}
```

---

### H. Config (`src/lib/config/index.ts`)

```typescript
export const APP_NAME    = '[Your App Name]';
export const APP_URL     = import.meta.env.VITE_APP_URL ?? 'https://[yourdomain].com';
export const SUPPORT_EMAIL = 'support@[yourdomain].com';

export const TIER_LIMITS = {
  free: { actionsPerMonth: 1,  actionsPerDay: null, seats: 1 },
  lite: { actionsPerMonth: null, actionsPerDay: 1,  seats: 1 },
  pro:  { actionsPerMonth: null, actionsPerDay: null, seats: 1 },
} as const;

export const SHOP_PLAN_LIMITS = {
  starter: { seats: 3,  /* ... */ },
  team:    { seats: 10, /* ... */ },
  studio:  { seats: 25, /* ... */ },
};

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free', name: 'Free', price: 0, yearlyPrice: 0,
    description: '[Free tier description]',
    features: ['[feature 1]', '[feature 2]'],
    limits: { actionsPerDay: null, actionsPerMonth: 1, seats: 1, customContent: false, aiAssist: false, prioritySupport: false },
    stripePriceId: '', stripeYearlyPriceId: '',
  },
  {
    id: 'lite', name: 'Lite', price: 29, yearlyPrice: 24,
    description: '[Lite tier description]',
    features: ['[feature 1]', '[feature 2]', '[feature 3]'],
    limits: { actionsPerDay: 1, actionsPerMonth: null, seats: 1, customContent: false, aiAssist: false, prioritySupport: false },
    stripePriceId: import.meta.env.VITE_STRIPE_LITE_MONTHLY,
    stripeYearlyPriceId: import.meta.env.VITE_STRIPE_LITE_YEARLY,
    popular: true, badge: 'Most popular',
  },
  {
    id: 'pro', name: 'Pro', price: 79, yearlyPrice: 66,
    description: '[Pro tier description]',
    features: ['Unlimited [actions]', 'Everything in Lite', 'AI assist', 'Custom content', 'Priority support'],
    limits: { actionsPerDay: null, actionsPerMonth: null, seats: 1, customContent: true, aiAssist: true, prioritySupport: true },
    stripePriceId: import.meta.env.VITE_STRIPE_PRO_MONTHLY,
    stripeYearlyPriceId: import.meta.env.VITE_STRIPE_PRO_YEARLY,
  },
];

export const SHOP_PRICING_PLANS = [/* similar structure with seats */];

export const APP_NAV = [
  { label: '[Core Feature]', href: '/[route]',  icon: '[icon-name]' },
  { label: 'Jobs',           href: '/jobs',       icon: 'briefcase' },
  { label: 'Settings',       href: '/settings',   icon: 'settings' },
] as const;

export const MARKETING_NAV = [
  { label: 'Features',  href: '/#features' },
  { label: 'Pricing',   href: '/pricing' },
  { label: 'Insights',  href: '/insights' },
  { label: 'FAQ',       href: '/faq' },
  { label: 'Changelog', href: '/changelog' },
  { label: 'About',     href: '/about' },
  { label: 'Support',   href: '/support' },
] as const;

export const ADMIN_NAV = [
  { label: 'Overview',  href: '/admin',            icon: 'layout-dashboard' },
  { label: 'Users',     href: '/admin/users',       icon: 'users' },
  { label: 'Analytics', href: '/admin/analytics',   icon: 'chart-bar' },
  { label: 'Products',  href: '/admin/products',    icon: 'package' },
  { label: 'Coupons',   href: '/admin/coupons',     icon: 'tag' },
  { label: 'Reports',   href: '/admin/reports',     icon: 'flag' },
  { label: 'Emails',    href: '/admin/emails',      icon: 'mail' },
  { label: 'Billing',   href: '/admin/billing',     icon: 'receipt' },
  { label: 'Insights',  href: '/admin/insights',    icon: 'book-open' },
  { label: 'Settings',  href: '/admin/settings',    icon: 'settings' },
] as const;

export const CHANGELOG = [
  {
    version: '1.0.0',
    date: 'YYYY-MM-DD',
    label: 'Launch',
    changes: [
      { type: 'feature', text: '[description]' },
    ],
  },
] as const;

export const FAQ_ITEMS = [
  {
    category: 'Getting Started',
    items: [
      { q: '[question]', a: '[answer]' },
    ],
  },
] as const;
```

---

### I. Global UI Components

#### `Toast.svelte`
Fixed bottom-right stack. Reads `toastStore.items`. Each toast: icon (by type), title, optional message, optional action button, dismiss X, progress bar for auto-dismiss. Entry/exit animations.

#### `PricingModal.svelte`
Full-screen overlay (triggered by `uiStore.pricingModalOpen`). Contains the same plan cards as `/pricing`. On plan select: `fetch('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ type: 'individual', tier, interval }) })` then `window.location.href = url`. If no payment method yet, redirect to add card first.

#### `ReportModal.svelte`
Small modal (triggered by `uiStore.reportModalOpen`). Category select + message textarea. Submits to `/api/reports`. Non-fatal, auto-closes on success.

#### `UpdateBanner.svelte`
Polls (or uses SSE) to detect new deployment version. When version mismatch detected, shows sticky banner: "A new version is available — [Refresh]". Click refreshes `window.location.reload()`.

#### `PromoBanner.svelte`
Reads from `/api/promo-banner` (Firestore doc managed from `/admin/settings`). Shows dismissible top banner with text + optional CTA link. Dismissed state stored in `sessionStorage` so it reappears on next visit.

#### `GuidedTour.svelte`
Onboarding overlay system. `tourStore.start()` kicks off a step sequence. Each step: target element selector (via `data-tour="step-id"` attributes), title, description, position (top/right/bottom/left). Spotlight highlight + tooltip. Progress dots. Skip and Next buttons.

#### `Badge.svelte`
```svelte
<!-- variants: default, success, warning, danger, brand, free, lite, pro -->
<!-- sizes: sm, md -->
<Badge variant="success" size="sm">Active</Badge>
```

#### `Button.svelte`
```svelte
<!-- variants: primary, secondary, ghost, danger -->
<!-- sizes: sm, md, lg -->
<!-- loading prop: shows spinner, disables button -->
<Button variant="primary" size="md" {loading} onclick={fn}>Label</Button>
```

#### `ThemeToggle.svelte`
Icon button (sun/moon). `onclick={() => themeStore.toggle()}`.

---

### J. Session Tracking API Routes

#### `POST /api/user/log-session`
Called once per browser tab on auth. Parses `User-Agent` for browser/OS/device. Optionally calls IP geolocation API (e.g. `ip-api.com/json/{ip}`) for city/country. Writes to `userSessions/{uid}/sessions/{sessionId}`, capped at 15 docs per user (delete oldest).

#### `GET /api/user/sessions`
Returns last 15 sessions for the authenticated user, ordered by `createdAt` descending.

#### `POST /api/user/welcome`
Calls `sendWelcomeEmail()`. Non-fatal — always returns 200.

#### `POST /api/user/log-session`
```typescript
// Parses:
const ua = request.headers.get('user-agent') ?? '';
// Parse with a UA parser library (e.g. 'ua-parser-js')
// Write { sessionId, ip, browser, os, device, city, country, createdAt: Date.now() }
// to userSessions/{uid}/sessions/{sessionId}
// Trim to 15 docs if over limit
```

---

### K. Cron Jobs

#### `POST /api/cron/monthly-report`
Vercel cron job. Configure in `vercel.json`:
```json
{
  "crons": [{ "path": "/api/cron/monthly-report", "schedule": "0 9 1 * *" }]
}
```
Secure with a `CRON_SECRET` header check. Queries all users with `tier !== 'free'`, sends `sendMonthlyReportEmail()` to each.

---

### L. Environment Variables

```bash
# Firebase (client — exposed to browser via VITE_ prefix)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Firebase (server — never exposed to browser)
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}  # JSON string

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECTED_ACCOUNT_ID=acct_...   # omit if not using Connect

# Stripe price IDs (exposed to browser — not sensitive)
VITE_STRIPE_LITE_MONTHLY=price_...
VITE_STRIPE_LITE_YEARLY=price_...
VITE_STRIPE_PRO_MONTHLY=price_...
VITE_STRIPE_PRO_YEARLY=price_...
VITE_STRIPE_SHOP_STARTER_MONTHLY=price_...
VITE_STRIPE_SHOP_STARTER_YEARLY=price_...
VITE_STRIPE_SHOP_TEAM_MONTHLY=price_...
VITE_STRIPE_SHOP_TEAM_YEARLY=price_...
VITE_STRIPE_SHOP_STUDIO_MONTHLY=price_...
VITE_STRIPE_SHOP_STUDIO_YEARLY=price_...

# Resend
RESEND_API_KEY=re_...

# App
VITE_APP_URL=https://[yourdomain].com

# Cron security
CRON_SECRET=[random-secret]

# Optional: GCP Cloud Run (if using Go compute API)
GCP_COMPUTE_API_URL=https://[service]-[hash]-uc.a.run.app
GCP_COMPUTE_API_KEY=
```

---

### M. Deployment (Vercel)

`svelte.config.js`:
```javascript
import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() },
};
```

`.npmrc` (required for Firebase + Vercel):
```
shamefully-hoist=true
```

`vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/monthly-report", "schedule": "0 9 1 * *" }
  ]
}
```

Firebase authorized domains: add your Vercel preview URLs and production domain in Firebase Console → Authentication → Settings → Authorized Domains.

Stripe webhooks: register `/api/billing/webhook` endpoint in Stripe Dashboard → Webhooks. Use Stripe CLI (`stripe listen --forward-to localhost:5173/api/billing/webhook`) in local dev.

---

### N. Optional Go API on GCP Cloud Run

For compute-heavy operations that SvelteKit's serverless functions handle poorly (long-running, CPU-intensive, memory-heavy). Examples: image processing, batch exports, complex algorithmic work.

Architecture:
1. Client calls SvelteKit API route: `POST /api/[feature]`
2. SvelteKit route proxies to Cloud Run: authenticates with GCP service account or API key, forwards request
3. Cloud Run Go service processes and returns result
4. SvelteKit returns result to client

SvelteKit proxy pattern:
```typescript
// src/routes/api/[feature]/+server.ts
export const POST: RequestHandler = async ({ request }) => {
  const token = await requireAuth(request);
  const body  = await request.json();

  const res = await fetch(`${GCP_COMPUTE_API_URL}/[endpoint]`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': GCP_COMPUTE_API_KEY,
    },
    body: JSON.stringify({ ...body, uid: token.uid }),
  });

  if (!res.ok) throw error(res.status, await res.text());
  return json(await res.json());
};
```

The Go service is only included on a per-project basis when the product specifically needs heavy compute. The SaaS foundation itself does not require it.

---

## What Goes Where When Adding Your Product

After scaffolding from this template, add product-specific code in these locations:

| What | Where |
|---|---|
| Core feature UI | `src/routes/(app)/[feature]/+page.svelte` |
| Product data types | Append to `src/lib/types/index.ts` |
| Product Firestore collections | New collection in `firebase.ts` + Firestore rules |
| Product-specific stores | `src/lib/stores/[feature]Store.svelte.ts` |
| Product API routes | `src/routes/api/[feature]/+server.ts` |
| Admin product management | `src/routes/admin/[feature]/+page.svelte` + entry in `ADMIN_NAV` |
| App nav link | Add to `APP_NAV` in config |
| Usage metric field | Add to `UserProfile.usage` in types |
| Usage enforcement | In product API routes, check `userStore.user.usage` against `TIER_LIMITS` |
| Feature-gated UI | Check `userStore.user.tier` in Svelte; call `uiStore.openPricing()` if gated |
