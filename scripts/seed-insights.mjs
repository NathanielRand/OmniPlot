// One-time seed script — run with:
//   node --env-file .env scripts/seed-insights.mjs
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  initializeApp({ credential: cert(sa) });
}

const db = getFirestore();

// ─── Post: OmniPlot Launch ────────────────────
const launchPost = {
  slug: 'introducing-omniplot-browser-based-ppf-window-tint-cutting',
  title: 'Introducing OmniPlot: Professional PPF & Window Tint Cutting in Any Browser',
  excerpt:
    'We built OmniPlot because the best PPF and window tint shops shouldn\'t be locked into one plotter brand or one piece of desktop software. Here\'s what we made — and why.',
  content: `
<p>
  If you run a PPF or window tint shop, you already know the friction: proprietary software that only works on one computer, patterns that don't transfer between machines, and a plotter that holds your whole workflow hostage to a single vendor's ecosystem. We built OmniPlot to fix that.
</p>

<p>
  OmniPlot is the first fully browser-based PPF and window tint cutting platform. No install, no drivers, no dongles. Open a tab, pick your vehicle, nest your pieces, and send to your plotter — from any device in your shop.
</p>

<h2>The problem we kept hearing</h2>

<p>
  Talk to enough PPF and tint installers and the same complaints surface. The software they rely on is expensive, locked to a single workstation, and often bundled with a plotter brand they didn't choose for the software. When that machine goes down, the whole cutting side of the business stops.
</p>

<p>
  Worse, pattern libraries are siloed. Switching brands means re-purchasing access to the same measurements you already paid for. And for shops running both PPF and window tint jobs, managing two separate tools — often from different vendors — adds real overhead every day.
</p>

<h2>What OmniPlot changes</h2>

<p>
  OmniPlot runs entirely in the browser. There's nothing to install and nothing to license per-machine. Every tech in your shop can open OmniPlot on the nearest device — the shop iPad, a tablet at the bay, or your main desk — and the state is synced across all of them.
</p>

<p>
  The pattern library covers <strong>PPF and window tint zones in the same place</strong>. One search, one vehicle, two job types. No switching tools, no double-entering the make and model, no reconciling two different pattern formats.
</p>

<h2>12,400+ professionally measured templates</h2>

<p>
  The OmniPlot pattern library launches with templates for every major make and model going back years — sedans, SUVs, trucks, coupes, hatchbacks. Every zone is professionally measured: hood, fenders, bumpers, mirrors, rockers, all four doors, and the full window tint set including windshield, rear glass, and quarter windows.
</p>

<p>
  New vehicles are added weekly. If your model isn't there yet, submit a request in the library. The community votes on priority and we turn around high-demand vehicles fast.
</p>

<h2>Auto-nesting: your material works harder</h2>

<p>
  Material waste is one of the biggest hidden costs in any cutting shop. Manually arranging pieces on a roll is slow and leaves money on the floor.
</p>

<p>
  OmniPlot's auto-nest optimizer runs a shelf-packing algorithm across every piece in your job, evaluating multiple sort orders and running a swap-improvement pass to push efficiency higher. The result is tight, organized layouts that respect your roll width and minimize the tail you cut off at the end.
</p>

<p>
  Efficiency percentage is shown in real time as you add pieces, so you can see exactly how much of the material you're actually using before you ever send the file.
</p>

<h2>Works with your existing plotter</h2>

<p>
  OmniPlot exports universal <strong>HPGL (.plt)</strong> — the command language understood by every major cutting plotter on the market. Roland, Graphtec, Mimaki, USCutter, Summa, VEVOR, Silhouette — if it cuts, OmniPlot drives it.
</p>

<p>
  Three ways to send your file, depending on your setup:
</p>

<ul>
  <li><strong>Download and open</strong> — export the .plt and open it in your plotter's existing software. No changes to your current workflow.</li>
  <li><strong>Web Serial (Chrome/Edge)</strong> — connect directly from the browser with zero install, no drivers needed.</li>
  <li><strong>Cut Agent</strong> — a small background app for Windows, Mac, and Linux that handles automated sending over USB serial or your local network.</li>
</ul>

<p>
  You don't need to replace your plotter. You don't need to change how you send files unless you want to. OmniPlot fits into your existing bay without disruption.
</p>

<h2>Built for shops of every size</h2>

<p>
  Solo installer working out of a one-bay shop? Free tier gets you cutting today, no credit card required. Growing team running multiple bays? Shop plans scale from 3 to 25 seats with shared job history, role-based access for owners, managers, and techs, and priority support.
</p>

<p>
  Every plan includes the full pattern library, auto-nesting, and all three send methods. Paid plans unlock unlimited cuts, multi-seat access, and AI-assisted pattern review.
</p>

<h2>Start cutting in 30 seconds</h2>

<p>
  There's no setup, no demo call, and no lock-in. Sign up with Google, a magic link, or your phone number — passwordless, no account to manage. Your first cut is a minute away.
</p>

<p>
  If you're already running a shop on desktop software, bring your first job into OmniPlot and compare the workflow side-by-side. We think the result speaks for itself.
</p>
  `.trim(),
  category: 'guides',
  tags: ['launch', 'ppf', 'window-tint', 'plotter', 'overview'],
  status: 'published',
  coverImageUrl:
    'https://images.pexels.com/photos/10126661/pexels-photo-10126661.jpeg?auto=compress&cs=tinysrgb&w=1200',
  author: 'OmniPlot Team',
  readTimeMinutes: 5,
  metaTitle: 'Introducing OmniPlot — Browser-Based PPF & Window Tint Cutting Software',
  metaDescription:
    'OmniPlot is the first browser-based PPF and window tint cutting platform. Works with any plotter, 12,400+ vehicle templates, no install required. Free to start.',
  publishedAt: Timestamp.now(),
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
};

// ─── Write to Firestore ───────────────────────
async function run() {
  // Check for duplicate slug before inserting
  const existing = await db.collection('insights')
    .where('slug', '==', launchPost.slug)
    .limit(1)
    .get();

  if (!existing.empty) {
    console.log(`Post with slug "${launchPost.slug}" already exists (id: ${existing.docs[0].id}). Skipping.`);
    process.exit(0);
  }

  const ref = await db.collection('insights').add(launchPost);
  console.log(`✓ Created insight post`);
  console.log(`  ID:   ${ref.id}`);
  console.log(`  Slug: ${launchPost.slug}`);
  console.log(`  URL:  /insights/${launchPost.slug}`);
}

run().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
