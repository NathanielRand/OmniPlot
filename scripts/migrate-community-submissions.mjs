// One-off: moves docs from the legacy `communitySubmissions` collection into
// `userPatterns` as pending community submissions, so they show up in
// Admin → Patterns → Community Submissions (which only reads userPatterns).
//
// Idempotent: each legacy doc becomes `userPatterns/legacy_<id>`, created only
// if it doesn't exist yet. The legacy doc is kept and stamped `migratedTo`.
//
// Dry run by default — prints what it would write. Run with:
//   node --env-file .env scripts/migrate-community-submissions.mjs
//   node --env-file .env scripts/migrate-community-submissions.mjs --apply
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  initializeApp({ credential: cert(sa) });
}

const db = getFirestore();
const APPLY = process.argv.includes('--apply');

const snap = await db.collection('communitySubmissions').get();
console.log(`${snap.size} legacy submission(s) found.${APPLY ? '' : ' (dry run — pass --apply to write)'}`);

let created = 0;
let skipped = 0;
for (const legacy of snap.docs) {
  const d = legacy.data();
  const targetRef = db.doc(`userPatterns/legacy_${legacy.id}`);

  if ((await targetRef.get()).exists) {
    console.log(`- ${legacy.id}: already migrated, skipping`);
    skipped++;
    continue;
  }
  if (!d.submittedBy) {
    console.log(`- ${legacy.id}: no submittedBy — skipping (can't assign an owner)`);
    skipped++;
    continue;
  }

  // Legacy "approved" never went through today's publish step, so it comes
  // back as pending for an admin to approve properly. The original status is
  // kept in adminNotes.
  const status = d.status === 'rejected' ? 'rejected' : 'pending';
  const doc = {
    ownerId:           d.submittedBy,
    submitToCommunity: true,
    // Never publish on migration — an admin approves it through the normal flow.
    isPublished:       false,
    status,
    projectType:       'vehicle',
    make:              d.make ?? '',
    models:            d.model ? [String(d.model)] : [],
    years:             d.year ? [String(d.year)] : [],
    bodyStyle:         d.bodyStyle ?? 'sedan',
    category:          d.category ?? 'ppf',
    zones:             d.zone ? [d.zone] : [],
    name:              d.name ?? '',
    coverage:          d.coverage ?? 'full',
    widthInches:       Number(d.widthInches) || 0,
    heightInches:      Number(d.heightInches) || 0,
    svgPath:           d.svgPath ?? '',
    ...(d.notes ? { notes: d.notes } : {}),
    adminNotes:        `Migrated from legacy communitySubmissions/${legacy.id}${d.status ? ` (legacy status: ${d.status})` : ''}.`,
    createdAt:         d.submittedAt ?? FieldValue.serverTimestamp(),
    updatedAt:         FieldValue.serverTimestamp(),
  };

  console.log(`+ ${legacy.id} → userPatterns/legacy_${legacy.id}: "${doc.name}" by ${doc.ownerId} [${doc.status}]`);
  if (APPLY) {
    await targetRef.create(doc);
    await legacy.ref.update({ migratedTo: targetRef.path, migratedAt: FieldValue.serverTimestamp() });
  }
  created++;
}

console.log(`${APPLY ? 'Migrated' : 'Would migrate'} ${created}, skipped ${skipped}.`);
