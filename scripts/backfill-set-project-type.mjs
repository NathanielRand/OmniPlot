// Optional cleanup — not required for correctness. `toVehicle`/`toVehicleEntry`/
// `toPattern` converters already default a missing `projectType` field to
// "vehicle" at read time, so every pre-existing vehicle/pattern document keeps
// working with zero writes. This script just stamps `projectType: "vehicle"`
// onto existing `vehicles` and `patterns` docs explicitly, so future queries
// that filter directly on `projectType` (e.g. Firestore `where` clauses) see
// old docs without relying on the converter default.
// Idempotent: skips any doc that already has a `projectType` field.
//
// Run with:
//   node --env-file .env scripts/backfill-set-project-type.mjs
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  initializeApp({ credential: cert(sa) });
}

const db = getFirestore();

async function backfillCollection(name) {
  const snap = await db.collection(name).get();
  console.log(`Checking ${snap.size} docs in "${name}" for missing projectType.`);

  let fixed = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.projectType !== undefined) continue;

    await docSnap.ref.set({ projectType: 'vehicle' }, { merge: true });
    fixed++;
  }

  console.log(`Done with "${name}". Fixed ${fixed} doc(s).`);
  return fixed;
}

await backfillCollection('vehicles');
await backfillCollection('patterns');
