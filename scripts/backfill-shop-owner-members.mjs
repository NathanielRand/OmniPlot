// One-time fix — the shops/{shopId}/members/{ownerId} bootstrap create rule
// had a gap (isOwnerOrManager can never be true for a brand-new shop's
// first member write), so some existing shops never got an owner member
// doc. Creates the missing owner member doc for every shop that lacks one.
// Idempotent: skips shops whose owner member doc already exists.
//
// Run with:
//   node --env-file .env scripts/backfill-shop-owner-members.mjs
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  initializeApp({ credential: cert(sa) });
}

const db = getFirestore();

const shopsSnap = await db.collection('shops').get();
console.log(`Checking ${shopsSnap.size} shops for missing owner member docs.`);

let fixed = 0;
for (const shopDoc of shopsSnap.docs) {
  const shop = shopDoc.data();
  if (!shop.ownerId) continue;

  const memberRef = shopDoc.ref.collection('members').doc(shop.ownerId);
  const memberSnap = await memberRef.get();
  if (memberSnap.exists) continue;

  const userSnap = await db.collection('users').doc(shop.ownerId).get();
  const u = userSnap.exists ? userSnap.data() : {};

  await memberRef.set({
    uid: shop.ownerId,
    shopId: shopDoc.id,
    role: 'owner',
    displayName: u.displayName ?? '',
    email: u.email ?? '',
    joinedAt: FieldValue.serverTimestamp(),
  });

  console.log(`Created owner member doc for shop ${shopDoc.id}`);
  fixed++;
}

console.log(`Done. Fixed ${fixed} shop(s).`);
