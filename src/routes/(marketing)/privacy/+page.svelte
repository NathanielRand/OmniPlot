<svelte:head>
	<title>Privacy Policy — OmniPlot</title>
	<meta name="description" content="OmniPlot Privacy Policy. How we collect, use, and protect your data." />
</svelte:head>

<div class="legal-page">
	<div class="legal-header">
		<p class="legal-eyebrow">Legal</p>
		<h1 class="legal-title">Privacy Policy</h1>
		<p class="legal-meta">Last updated: May 22, 2026 · Effective immediately</p>
	</div>

	<div class="legal-body">

		<p class="legal-intro">
			This Privacy Policy explains what information OmniPlot ("we," "us," "our") collects,
			how we use it, and your rights. We are committed to being transparent and using your
			data only to operate and improve the Service.
		</p>

		<section class="legal-section">
			<h2>1. Information We Collect</h2>

			<h3>Account information</h3>
			<p>When you create an account we collect the information provided through your chosen sign-in method:</p>
			<ul>
				<li><strong>Google Sign-In:</strong> your Google profile name, email address, and profile photo URL as provided by Google</li>
				<li><strong>Email magic link:</strong> your email address and optionally a display name you provide</li>
				<li><strong>Phone number (SMS):</strong> your phone number in E.164 format</li>
			</ul>
			<p>No password is ever created or stored by OmniPlot.</p>

			<h3>Usage data</h3>
			<p>We store cut counts, job history (the canvas layout, patterns placed, plotter settings, and export format for each job), and the timestamp of your last activity. This data is used to enforce plan limits, display your job history, and improve the Service.</p>

			<h3>Subscription and billing data</h3>
			<p>We store your Stripe customer ID, subscription status, current plan, and billing period end date. Your full payment card details are never stored by us — they are handled entirely by Stripe.</p>

			<h3>Session data</h3>
			<p>We store a single session token per account in order to enforce our one-active-session policy. This token is stored in your browser's local storage and in your account record. When a new session is initiated from a different device, the prior session token is invalidated.</p>

			<h3>Shop and team data</h3>
			<p>If you create or join a shop, we store shop membership data including your role, the shop's name and plan, and invite records. Invite links are tied to the inviting user's account and expire after 7 days.</p>

			<h3>Plotter configuration</h3>
			<p>Plotter settings (blade force, speed, connection type, etc.) are stored per-session in your browser. Some settings may be persisted to your account profile to restore your configuration across devices.</p>
		</section>

		<section class="legal-section">
			<h2>2. How We Use Your Information</h2>
			<ul>
				<li><strong>To operate the Service:</strong> authenticate you, display your job history, enforce plan limits, and enable team features</li>
				<li><strong>Billing:</strong> manage your subscription and communicate billing status changes via Stripe webhook events</li>
				<li><strong>Security:</strong> detect and prevent unauthorized access through session management</li>
				<li><strong>Product improvement:</strong> aggregate, anonymized usage patterns (which vehicles are searched, which export formats are used) help us prioritize pattern library additions and feature development</li>
				<li><strong>Communications:</strong> transactional emails (sign-in links, billing receipts) and, if you opt in, product updates and changelog notifications</li>
			</ul>
			<p>We do not sell your data, build advertising profiles, or share your information with third parties for their own marketing purposes.</p>
		</section>

		<section class="legal-section">
			<h2>3. Third-Party Services</h2>
			<p>OmniPlot is built on the following infrastructure providers. Each has its own privacy practices:</p>

			<h3>Firebase / Google Cloud (Google LLC)</h3>
			<p>Firebase Authentication manages sign-in for Google, email, and phone methods. Firestore stores account profiles, job history, and shop data. Cloud Storage serves pattern SVG files. All data is processed under Google Cloud's infrastructure in accordance with the Google Cloud Privacy Notice.</p>

			<h3>Stripe, Inc.</h3>
			<p>Stripe processes all subscription billing. OmniPlot is a connected account under a Stripe platform account. Stripe receives your email address, payment card information, and billing-related events. Stripe's use of your data is governed by the <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Stripe Privacy Policy</a>. Your full card details are never transmitted to or stored by OmniPlot servers.</p>

			<h3>Firebase reCAPTCHA (Google LLC)</h3>
			<p>Phone number sign-in uses Firebase's reCAPTCHA verification to prevent abuse. This involves Google's reCAPTCHA service loading on sign-in pages, which may set cookies and send signals to Google as described in the Google Privacy Policy.</p>
		</section>

		<section class="legal-section">
			<h2>4. Data Retention</h2>
			<p>Your account data is retained for as long as your account is active. Job history for Free accounts older than 90 days may be pruned. Lite plan accounts retain 90 days of job history; Pro and Shop plan accounts retain full job history.</p>
			<p>If you close your account, your personal data and job history are scheduled for permanent deletion within 90 days, except where retention is required by law (e.g., billing records).</p>
		</section>

		<section class="legal-section">
			<h2>5. Cookies and Local Storage</h2>
			<p>OmniPlot does not use third-party advertising cookies. We use browser local storage for:</p>
			<ul>
				<li>Your session token (to keep you signed in)</li>
				<li>Pending sign-in state for magic link completion</li>
				<li>Plotter configuration preferences</li>
				<li>Theme preference (dark/light mode)</li>
			</ul>
			<p>Firebase Authentication and reCAPTCHA may set their own cookies or local storage entries as part of their operation. Stripe may set cookies on billing portal pages hosted by Stripe.</p>
		</section>

		<section class="legal-section">
			<h2>6. Your Rights</h2>
			<p>Depending on where you are located, you may have the right to:</p>
			<ul>
				<li>Access a copy of the personal data we hold about you</li>
				<li>Correct inaccurate data (update your display name in Settings → Profile)</li>
				<li>Request deletion of your account and associated data (Settings → Danger Zone, or email us)</li>
				<li>Object to or restrict certain processing</li>
				<li>Data portability (export your job files via the studio at any time)</li>
			</ul>
			<p>To exercise any of these rights, <a href="/support">contact us via our support page</a>. We will respond within 30 days.</p>
			<p><strong>California residents (CCPA):</strong> OmniPlot does not sell personal information. You have the right to know what data we collect and to request deletion.</p>
			<p><strong>EEA/UK residents (GDPR):</strong> Our legal basis for processing is performance of a contract (operating the Service you signed up for) and, for analytics, legitimate interest. You may withdraw consent at any time by closing your account.</p>
		</section>

		<section class="legal-section">
			<h2>7. Children's Privacy</h2>
			<p>OmniPlot is not directed at children under 13 (or under 16 in the EEA). We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, contact us and we will delete it.</p>
		</section>

		<section class="legal-section">
			<h2>8. Changes to This Policy</h2>
			<p>We may update this Privacy Policy from time to time. We will notify subscribers of material changes via email or in-app notice. The "last updated" date at the top of this page reflects the most recent revision. Continued use of the Service after changes are posted constitutes acceptance.</p>
		</section>

		<section class="legal-section">
			<h2>9. Contact</h2>
			<p>Questions about this Privacy Policy or your data? <a href="/support">Contact us via our support page</a>.</p>
		</section>

	</div>
</div>

<style>
	.legal-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 64px 24px 96px;
	}

	.legal-header {
		margin-bottom: 48px;
		padding-bottom: 32px;
		border-bottom: 1px solid var(--border-subtle);
	}
	.legal-eyebrow {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-brand);
		margin: 0 0 12px;
	}
	.legal-title {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		margin: 0 0 10px;
	}
	.legal-meta {
		font-size: 0.875rem;
		color: var(--text-tertiary);
		margin: 0;
	}

	.legal-intro {
		font-size: 1rem;
		color: var(--text-secondary);
		line-height: 1.7;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 20px 24px;
		margin: 0 0 40px;
	}

	.legal-body {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.legal-section {
		padding: 28px 0;
		border-bottom: 1px solid var(--border-subtle);
	}
	.legal-section:last-child {
		border-bottom: none;
	}

	.legal-section h2 {
		font-size: 1.0625rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		margin: 0 0 14px;
		color: var(--text-primary);
	}

	.legal-section h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 16px 0 8px;
	}
	.legal-section h3:first-of-type { margin-top: 0; }

	.legal-section p {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.7;
		margin: 0 0 12px;
	}
	.legal-section p:last-child { margin-bottom: 0; }

	.legal-section ul {
		margin: 0 0 12px;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.legal-section li {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.legal-section a {
		color: var(--text-brand);
		text-decoration: none;
	}
	.legal-section a:hover { text-decoration: underline; }

	.legal-section strong {
		color: var(--text-primary);
		font-weight: 600;
	}
</style>
