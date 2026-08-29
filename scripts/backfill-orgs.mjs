// One-time backfill — creates an Organization + owner OrgMember for every
// existing shop that doesn't have one yet, and stamps orgId onto the shop.
// Idempotent: shops that already have orgId are skipped, so re-running
// after a partial failure never mints duplicate orgs.
//
// Run with:
//   node --env-file .env scripts/backfill-orgs.mjs
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  initializeApp({ credential: cert(sa) });
}

const db = getFirestore();

const shopsSnap = await db.collection('shops').get();
const pending = shopsSnap.docs.filter((d) => !d.data().orgId);

console.log(`Found ${shopsSnap.size} shops, ${pending.length} missing orgId.`);

const CHUNK_SIZE = 150; // 3 writes per shop, well under the 500-op batch cap

for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
  const chunk = pending.slice(i, i + CHUNK_SIZE);
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  for (const shopDoc of chunk) {
    const shop = shopDoc.data();
    const orgRef = db.collection('orgs').doc();

    batch.set(orgRef, {
      name: shop.name ?? '',
      ownerId: shop.ownerId ?? '',
      createdAt: shop.createdAt ?? now,
      updatedAt: now,
    });

    batch.update(shopDoc.ref, { orgId: orgRef.id, updatedAt: now });

    if (shop.ownerId) {
      const orgMemberRef = orgRef.collection('members').doc(shop.ownerId);
      batch.set(orgMemberRef, {
        uid: shop.ownerId,
        orgId: orgRef.id,
        role: 'owner',
        shopIds: null, // org-wide
        joinedAt: now,
      });
    }
  }

  await batch.commit();
  console.log(`Backfilled ${Math.min(i + CHUNK_SIZE, pending.length)}/${pending.length}`);
}

console.log('Done.');
