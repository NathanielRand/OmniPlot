// One-time backfill — Phase 4 moved billing fields (plan, seats,
// stripeCustomerId, stripePriceId, subscriptionStatus, currentPeriodEnd)
// onto Organization. New orgs get these at creation; orgs created before
// this change (via the Phase 1 backfill or earlier createShop calls) don't
// have them at all. Mirrors each org's owning shop's current values —
// both existing shops have null billing fields (never had a working
// Stripe price to check out with), so this is a same-shape copy, not a
// real migration.
//
// Run with:
//   node --env-file .env scripts/backfill-org-billing-fields.mjs
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  initializeApp({ credential: cert(sa) });
}

const db = getFirestore();

const orgsSnap = await db.collection('orgs').get();
console.log(`Checking ${orgsSnap.size} orgs.`);

let fixed = 0;
for (const orgDoc of orgsSnap.docs) {
  const org = orgDoc.data();
  if (org.plan !== undefined) continue; // already backfilled

  const shopsSnap = await db.collection('shops').where('orgId', '==', orgDoc.id).limit(1).get();
  const shop = shopsSnap.docs[0]?.data();

  await orgDoc.ref.update({
    plan: shop?.plan ?? 'starter',
    seats: shop?.seats ?? 3,
    stripeCustomerId: shop?.stripeCustomerId ?? null,
    stripePriceId: shop?.stripePriceId ?? null,
    subscriptionStatus: shop?.subscriptionStatus ?? null,
    currentPeriodEnd: shop?.currentPeriodEnd ?? null,
  });

  console.log(`Backfilled orgs/${orgDoc.id}`);
  fixed++;
}

console.log(`Done. Fixed ${fixed} org(s).`);
