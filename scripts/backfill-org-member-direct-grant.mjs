// One-time backfill — Phase 3 added directRole/directShopIds to OrgMember,
// and changed the meaning of shopIds for a direct (non-group) grant from
// "null = org-wide" to "always shop-scoped" (only a group's grant can be
// org-wide). Existing orgs/{orgId}/members/{uid} docs from the Phase 1
// backfill predate both changes. This makes them consistent with what
// recomputeOrgMember would produce, instead of leaving that narrowing to
// happen silently on the member's first recompute.
//
// Run with:
//   node --env-file .env scripts/backfill-org-member-direct-grant.mjs
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
  const membersSnap = await orgDoc.ref.collection('members').get();
  for (const memberDoc of membersSnap.docs) {
    const m = memberDoc.data();
    if (m.directRole !== undefined) continue; // already backfilled

    // Derive the direct grant the same way recomputeOrgMember would: scan
    // this org's shops for a shops/{shopId}/members/{uid} doc.
    const shopsSnap = await db.collection('shops').where('orgId', '==', orgDoc.id).get();
    let directRole = null;
    let directShopIds = null;
    for (const shopDoc of shopsSnap.docs) {
      const shopMemberSnap = await shopDoc.ref.collection('members').doc(memberDoc.id).get();
      const role = shopMemberSnap.data()?.role;
      if (!role) continue;
      directRole = role; // only one shop per org today, so no max() needed
      directShopIds = [...(directShopIds ?? []), shopDoc.id];
    }

    await memberDoc.ref.update({
      directRole,
      directShopIds,
      // A direct grant is always shop-scoped, never org-wide — narrow the
      // Phase 1 default (null) to match, same as recomputeOrgMember would.
      shopIds: directShopIds,
    });

    console.log(`Backfilled orgs/${orgDoc.id}/members/${memberDoc.id}`);
    fixed++;
  }
}

console.log(`Done. Fixed ${fixed} member doc(s).`);
