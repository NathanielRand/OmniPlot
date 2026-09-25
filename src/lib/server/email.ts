// ─────────────────────────────────────────────
// OmniPlot — TRANSACTIONAL EMAIL SERVICE
// ─────────────────────────────────────────────
import { RESEND_API_KEY } from '$env/static/private';
import { getPlanSettings } from '$lib/server/plans';
import { cutAllowanceText } from '$lib/plans';
import { STAFF_EMAIL } from '$lib/server/staff';

const FROM    = 'OmniPlot <noreply@omniplot.app>';
const APP_URL = 'https://www.omniplot.app';

// ─── Utilities ────────────────────────────────

export function fmtAmount(amount: number, currency: string): string {
	return new Intl.NumberFormat('en-US', {
		style:    'currency',
		currency: currency.toUpperCase(),
	}).format(amount);
}

export function fmtDate(d: Date): string {
	return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function firstName(displayName: string): string {
	return displayName?.trim().split(' ')[0] || 'there';
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// ─── HTML Helpers (table-safe, inline styles only) ────────────────────────────

function heading(text: string): string {
	return `
<tr>
  <td style="font-family:'Syne',Georgia,serif;font-size:26px;font-weight:800;color:#f0f2f7;letter-spacing:-0.02em;padding-bottom:8px;line-height:1.2;">
    ${text}
  </td>
</tr>`;
}

function subtext(text: string): string {
	return `
<tr>
  <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;color:#a0a8bc;line-height:1.6;padding-bottom:20px;">
    ${text}
  </td>
</tr>`;
}

function bodyText(text: string): string {
	return `
<tr>
  <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;color:#a0a8bc;line-height:1.6;padding-bottom:16px;">
    ${text}
  </td>
</tr>`;
}

function cta(label: string, href: string, color = '#0070ff'): string {
	return `
<tr>
  <td style="padding-bottom:0;">
    <table border="0" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td bgcolor="${color}" style="background-color:${color};border-radius:8px;padding:12px 28px;">
          <a href="${href}" style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;display:inline-block;">${label}</a>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function infoBox(rows: [string, string][]): string {
	const rowsHtml = rows.map(([ label, value ], i) => `
    <tr>
      <td colspan="2" style="padding:0;${i > 0 ? 'border-top:1px solid #1c2130;' : ''}"></td>
    </tr>
    <tr>
      <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#6a7288;padding:10px 16px 10px 16px;width:50%;">${label}</td>
      <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;font-weight:600;color:#f0f2f7;text-align:right;padding:10px 16px 10px 16px;width:50%;">${value}</td>
    </tr>`).join('');

	return `
<tr>
  <td style="padding-bottom:20px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color:#141820;border:1px solid #1c2130;border-radius:10px;">
      ${rowsHtml}
    </table>
  </td>
</tr>`;
}

function statBlock(items: { label: string; value: string }[]): string {
	const cells = items.map(({ label, value }) => `
    <td style="text-align:center;padding:16px 8px;width:${Math.floor(100 / items.length)}%;">
      <div style="font-family:'Syne',Georgia,serif;font-size:26px;font-weight:800;color:#f0f2f7;line-height:1.1;">${value}</div>
      <div style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#6a7288;margin-top:4px;">${label}</div>
    </td>`).join('');

	return `
<tr>
  <td style="padding-bottom:20px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>${cells}</tr>
    </table>
  </td>
</tr>`;
}

function divider(): string {
	return `
<tr>
  <td style="padding:4px 0 20px 0;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td bgcolor="#1c2130" style="background-color:#1c2130;height:1px;font-size:1px;line-height:1px;">&nbsp;</td>
      </tr>
    </table>
  </td>
</tr>`;
}

function alertBox(text: string, variant: 'warning' | 'success' | 'danger'): string {
	const map = {
		warning: { border: '#ffb547', bg: 'rgba(255,181,71,0.08)' },
		success: { border: '#00d68f', bg: 'rgba(0,214,143,0.08)' },
		danger:  { border: '#ff4d6d', bg: 'rgba(255,77,109,0.08)' },
	};
	const { border, bg } = map[variant];
	return `
<tr>
  <td style="padding-bottom:20px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td width="3" bgcolor="${border}" style="background-color:${border};border-radius:2px 0 0 2px;">&nbsp;</td>
        <td style="background-color:${bg};padding:12px 16px;border-radius:0 6px 6px 0;">
          <span style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#a0a8bc;line-height:1.5;">${text}</span>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

// ─── Base Layout ──────────────────────────────

function base(previewText: string, content: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>OmniPlot</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@800&family=Instrument+Sans:wght@400;500;600&display=swap');
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; }
    body { margin:0; padding:0; background-color:#080a0f; }
    a { color:#0070ff; }
  </style>
</head>
<body bgcolor="#080a0f" style="background-color:#080a0f;margin:0;padding:0;">
  <!-- Preview text -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${previewText}&nbsp;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>

  <!-- Outer wrapper -->
  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" bgcolor="#080a0f" style="background-color:#080a0f;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Card -->
        <table border="0" cellpadding="0" cellspacing="0" width="560" role="presentation" bgcolor="#0e1118" style="background-color:#0e1118;border:1px solid #1c2130;border-radius:16px;max-width:560px;width:100%;">

          <!-- Top accent bar -->
          <tr>
            <td bgcolor="#0070ff" style="background-color:#0070ff;height:3px;border-radius:16px 16px 0 0;font-size:3px;line-height:3px;">&nbsp;</td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:28px 36px 20px 36px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                <tr>
                  <td style="font-family:'Syne',Georgia,serif;font-size:20px;font-weight:800;color:#f0f2f7;letter-spacing:-0.01em;">
                    OMNI<span style="color:#0070ff;">PLOT</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Header divider -->
          <tr>
            <td style="padding:0 36px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                <tr>
                  <td bgcolor="#1c2130" style="background-color:#1c2130;height:1px;font-size:1px;line-height:1px;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content area -->
          <tr>
            <td style="padding:32px 36px 0 36px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                ${content}
              </table>
            </td>
          </tr>

          <!-- Footer divider -->
          <tr>
            <td style="padding:0 36px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                <tr>
                  <td bgcolor="#1c2130" style="background-color:#1c2130;height:1px;font-size:1px;line-height:1px;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px 28px 36px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                <tr>
                  <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#6a7288;line-height:1.6;text-align:center;">
                    OmniPlot &middot; Professional Cutting Software<br/>
                    <a href="${APP_URL}/settings?tab=notifications" style="color:#6a7288;text-decoration:underline;">Manage notifications</a>
                    &nbsp;&middot;&nbsp;
                    <a href="${APP_URL}/privacy" style="color:#6a7288;text-decoration:underline;">Privacy</a>
                    &nbsp;&middot;&nbsp;
                    <a href="${APP_URL}/terms" style="color:#6a7288;text-decoration:underline;">Terms</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Core Send ────────────────────────────────

export async function sendEmail(
	to: string | string[],
	subject: string,
	html: string,
): Promise<void> {
	if (!RESEND_API_KEY) {
		console.warn('[email] RESEND_API_KEY not set — skipping email to', to);
		return;
	}

	const res = await fetch('https://api.resend.com/emails', {
		method:  'POST',
		headers: {
			'Authorization': `Bearer ${RESEND_API_KEY}`,
			'Content-Type':  'application/json',
		},
		body: JSON.stringify({ from: FROM, to, subject, html }),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`[email] Resend error ${res.status}: ${body}`);
	}
}

// ─── Welcome Email ────────────────────────────

export async function sendWelcomeEmail(to: string, displayName: string): Promise<void> {
	const name    = firstName(displayName);
	const content = `
${heading(`Welcome to OmniPlot, ${name}`)}
${subtext("You're all set. OmniPlot gives you professional-grade PPF and window tint cutting in your browser — no install required.")}
<tr>
  <td style="padding-bottom:24px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#a0a8bc;padding:6px 0;line-height:1.6;">
          &bull;&nbsp; <strong style="color:#f0f2f7;">Pattern Studio</strong> — Design and cut PPF &amp; tint patterns with precision
        </td>
      </tr>
      <tr>
        <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#a0a8bc;padding:6px 0;line-height:1.6;">
          &bull;&nbsp; <strong style="color:#f0f2f7;">Smart Nesting</strong> — Maximize material usage automatically
        </td>
      </tr>
      <tr>
        <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#a0a8bc;padding:6px 0;line-height:1.6;">
          &bull;&nbsp; <strong style="color:#f0f2f7;">No install required</strong> — Works entirely in your browser
        </td>
      </tr>
    </table>
  </td>
</tr>
${cta('Open Studio', `${APP_URL}/studio`)}
<tr><td style="height:32px;"></td></tr>`;

	await sendEmail(
		to,
		'Welcome to OmniPlot',
		base('Your account is ready. Start cutting professionally.', content),
	);
}

// ─── Upgrade Email ────────────────────────────

export async function sendUpgradeEmail(
	to: string,
	displayName: string,
	tierLabel: string,
	amount: number,
	currency: string,
	periodEnd: Date,
): Promise<void> {
	const content = `
${heading(`You're on ${tierLabel}.`)}
${subtext('Your upgrade is active and you now have full access.')}
${infoBox([
	['Plan',          tierLabel],
	['Billing',       fmtAmount(amount, currency)],
	['Next renewal',  fmtDate(periodEnd)],
])}
${cta('Go to Studio', `${APP_URL}/studio`)}
<tr>
  <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#6a7288;padding-top:16px;padding-bottom:32px;">
    Questions? <a href="${APP_URL}/support" style="color:#6a7288;text-decoration:underline;">Chat with support</a> anytime.
  </td>
</tr>`;

	await sendEmail(
		to,
		`You're on ${tierLabel} — let's get cutting`,
		base(`Your ${tierLabel} plan is now active.`, content),
	);
}

// ─── Receipt Email ────────────────────────────

export async function sendReceiptEmail(
	to: string,
	displayName: string,
	amount: number,
	currency: string,
	planName: string,
	invoicePdfUrl: string | null,
	periodEnd: Date,
): Promise<void> {
	const formatted = fmtAmount(amount, currency);
	const content   = `
${heading('Payment confirmed')}
${subtext(`${formatted} has been charged for your ${planName} plan.`)}
${infoBox([
	['Plan',        planName],
	['Amount',      formatted],
	['Date',        fmtDate(new Date())],
	['Period end',  fmtDate(periodEnd)],
])}
${invoicePdfUrl ? cta('Download invoice PDF', invoicePdfUrl) : ''}
<tr>
  <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#6a7288;padding-top:16px;padding-bottom:32px;">
    Need help with billing? <a href="${APP_URL}/support" style="color:#6a7288;text-decoration:underline;">Chat with support</a> — we reply within one business day.
  </td>
</tr>`;

	await sendEmail(
		to,
		`Receipt from OmniPlot — ${formatted}`,
		base(`Your payment of ${formatted} was processed successfully.`, content),
	);
}

// ─── Cancellation Email ───────────────────────

export async function sendCancellationEmail(
	to: string,
	displayName: string,
	planName: string,
	accessUntil: Date,
): Promise<void> {
	const untilStr = fmtDate(accessUntil);
	const content  = `
${alertBox('Your subscription is scheduled to cancel at the end of your billing period.', 'warning')}
${heading('Subscription cancelled')}
${subtext(`Your ${planName} access continues until ${untilStr}. After that, your account reverts to the free plan.`)}
${infoBox([
	['Plan cancelled',  planName],
	['Access until',    untilStr],
])}
${cta('Reactivate subscription', `${APP_URL}/settings?tab=billing`)}
${divider()}
${bodyText('Changed your mind? You can reactivate anytime before your access ends.')}
<tr><td style="height:16px;"></td></tr>`;

	await sendEmail(
		to,
		'Your OmniPlot subscription has been cancelled',
		base(`Your access continues until ${untilStr}.`, content),
	);
}

// ─── Refund Email ─────────────────────────────

export async function sendRefundEmail(
	to: string,
	displayName: string,
	amount: number,
	currency: string,
): Promise<void> {
	const formatted = fmtAmount(amount, currency);
	const content   = `
${alertBox('Your refund has been processed.', 'success')}
${heading('Refund confirmed')}
${subtext(`A refund of ${formatted} has been issued to your original payment method.`)}
${infoBox([
	['Amount refunded',   formatted],
	['Expected arrival',  '5–10 business days'],
])}
${bodyText(`Questions? <a href="${APP_URL}/support" style="color:#a0a8bc;text-decoration:underline;">Chat with support</a> — we reply within one business day.`)}
<tr><td style="height:16px;"></td></tr>`;

	await sendEmail(
		to,
		`Refund issued — ${formatted}`,
		base(`${formatted} refund is on its way.`, content),
	);
}

// ─── Monthly Report Email ─────────────────────

export async function sendMonthlyReportEmail(
	to: string,
	displayName: string,
	monthLabel: string,
	cutCount: number,
	savedCount: number,
	tier: string,
): Promise<void> {
	const name    = firstName(displayName);
	// Admin-set allowance for their tier (Admin → Products), not a hardcoded claim.
	const plans   = await getPlanSettings();
	const allowance = tier === 'free' || tier === 'lite' || tier === 'pro'
		? cutAllowanceText(plans[tier]).replace(/^Unlimited/, 'unlimited')
		: 'unlimited cuts';
	const content = `
${heading(`Your ${monthLabel} summary, ${name}`)}
${subtext(`Here's what you accomplished this month on OmniPlot.`)}
${statBlock([
	{ label: 'Cuts this month',  value: cutCount.toString()  },
	{ label: 'Patterns saved',   value: savedCount.toString() },
])}
${divider()}
${bodyText(`Keep up the great work. Your ${escapeHtml(tier)} plan includes ${allowance} — use it.`)}
${cta('View Studio', `${APP_URL}/studio`)}
<tr><td style="height:32px;"></td></tr>`;

	await sendEmail(
		to,
		`Your ${monthLabel} usage report — OmniPlot`,
		base(`You made ${cutCount} cuts in ${monthLabel}.`, content),
	);
}

// ─── Support Ticket Emails ────────────────────
// Customer-facing ones carry the full reply text (a guest may have no other
// way to read it) plus a link back to the thread. Conversations stay in the
// in-app tickets — these are notifications only, and say so.

const NO_EMAIL_REPLIES = "Please reply on your ticket rather than to this email — replies here aren't seen by our team.";

function quoteBlock(text: string): string {
	return `
<tr>
  <td style="padding-bottom:20px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td width="3" bgcolor="#2a3144" style="background-color:#2a3144;border-radius:2px 0 0 2px;">&nbsp;</td>
        <td style="background-color:#141820;padding:14px 16px;border-radius:0 6px 6px 0;font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#d4d8e2;line-height:1.6;">
          ${escapeHtml(text).replace(/\n/g, '<br/>')}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function smallPrint(html: string): string {
	return `
<tr>
  <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#6a7288;padding-top:16px;padding-bottom:32px;line-height:1.6;">
    ${html}
  </td>
</tr>`;
}

export interface SupportEmailTicket {
	ref: string;
	subject: string;
	name: string;
	email: string;
	topicLabel: string;
	link: string;
}

export async function sendTicketReceivedEmail(
	t: SupportEmailTicket,
	suggestions: { title: string; body: string; href: string }[],
): Promise<void> {
	const tips = suggestions.length
		? `${divider()}${bodyText('<strong style="color:#f0f2f7;">While you wait, these often help:</strong>')}
<tr>
  <td style="padding-bottom:20px;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      ${suggestions.map((s) => `
      <tr>
        <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#a0a8bc;padding:6px 0;line-height:1.6;">
          &bull;&nbsp; <a href="${APP_URL}${s.href}" style="color:#f0f2f7;font-weight:600;">${escapeHtml(s.title)}</a> — ${escapeHtml(s.body)}
        </td>
      </tr>`).join('')}
    </table>
  </td>
</tr>`
		: '';

	const content = `
${heading('We got your message')}
${subtext(`Hi ${escapeHtml(firstName(t.name))}, thanks for reaching out. Our team typically replies within one business day — we'll email you as soon as we do.`)}
${infoBox([
	['Ticket',  t.ref],
	['Subject', escapeHtml(t.subject)],
	['Topic',   escapeHtml(t.topicLabel)],
])}
${cta('View your ticket', t.link)}
<tr><td style="height:24px;"></td></tr>
${tips}
${smallPrint(`You can add more details anytime from the ticket page.<br/>${NO_EMAIL_REPLIES}`)}`;

	await sendEmail(
		t.email,
		`[${t.ref}] We got your message: ${t.subject}`,
		base("We've received your support request.", content)
	);
}

export async function sendTicketReplyEmail(
	t: SupportEmailTicket,
	replyBody: string,
	status: string,
): Promise<void> {
	const footer =
		status === 'resolved'
			? "We've marked this ticket resolved. If it's not quite sorted, just reply on the ticket and it will reopen automatically."
			: status === 'awaiting_customer'
				? "We need a reply from you to keep going — respond on the ticket page when you're ready."
				: "No need to reply — we'll update you here as soon as there's news.";

	const content = `
${heading('New reply from OmniPlot Support')}
${subtext(`Hi ${escapeHtml(firstName(t.name))}, we replied to <strong style="color:#f0f2f7;">${escapeHtml(t.subject)}</strong>:`)}
${quoteBlock(replyBody)}
${status === 'resolved' ? alertBox('Marked resolved', 'success') : ''}
${cta(status === 'resolved' ? 'View ticket' : 'View &amp; reply', t.link)}
${smallPrint(`${footer}<br/>${NO_EMAIL_REPLIES}<br/>Ticket ${t.ref}`)}`;

	await sendEmail(
		t.email,
		`[${t.ref}] Re: ${t.subject}`,
		base('We replied to your support request.', content)
	);
}

/** Status-only changes the customer should hear about (resolved/closed —
 *  in-progress flips would just be noise). `auto` = closed by the cron. */
export async function sendTicketStatusEmail(t: SupportEmailTicket, status: 'resolved' | 'closed', auto = false): Promise<void> {
	const name = escapeHtml(firstName(t.name));
	const subj = `<strong style="color:#f0f2f7;">${escapeHtml(t.subject)}</strong>`;
	const content = `
${alertBox(status === 'resolved' ? 'Your ticket was marked resolved.' : 'Your ticket was closed.', status === 'resolved' ? 'success' : 'warning')}
${heading(status === 'resolved' ? 'All sorted?' : 'Ticket closed')}
${subtext(
	auto
		? `Hi ${name}, we haven't heard back on ${subj} in a week, so we've marked it resolved.`
		: `Hi ${name}, ${subj} has been marked ${status}.`,
)}
${cta('View ticket', t.link)}
${smallPrint(
	status === 'resolved'
		? `Still need help? Reply on the ticket and it reopens automatically.<br/>${NO_EMAIL_REPLIES}<br/>Ticket ${t.ref}`
		: `Need more help? <a href="${APP_URL}/support" style="color:#6a7288;text-decoration:underline;">Chat with support</a>.`,
)}`;

	await sendEmail(
		t.email,
		`[${t.ref}] ${status === 'resolved' ? 'Resolved' : 'Closed'}: ${t.subject}`,
		base(status === 'resolved' ? 'Your support ticket was resolved.' : 'Your support ticket was closed.', content)
	);
}

export async function sendTicketNudgeEmail(t: SupportEmailTicket): Promise<void> {
	const content = `
${heading('Still need a hand?')}
${subtext(`Hi ${escapeHtml(firstName(t.name))}, we're waiting on a reply from you on <strong style="color:#f0f2f7;">${escapeHtml(t.subject)}</strong>.`)}
${cta('Reply to ticket', t.link)}
${smallPrint(`If it's already sorted, you can mark it resolved from the ticket page — otherwise we'll resolve it automatically in a few days.<br/>${NO_EMAIL_REPLIES}<br/>Ticket ${t.ref}`)}`;

	await sendEmail(
		t.email,
		`[${t.ref}] Waiting on your reply: ${t.subject}`,
		base("We're waiting on your reply.", content)
	);
}

// ─── Support: staff notifications ─────────────

export async function sendAdminTicketEmail(
	t: SupportEmailTicket & { priority: string; tags: string[]; tier: string | null },
	kind: 'new' | 'reply' | 'reopened',
	body: string,
	adminLink: string,
): Promise<void> {
	const title = { new: 'New support ticket', reply: 'Customer replied', reopened: 'Ticket reopened' }[kind];
	const content = `
${t.priority !== 'normal' ? alertBox(`${t.priority.toUpperCase()} priority${t.tags.length ? ` · ${escapeHtml(t.tags.join(', '))}` : ''}`, t.priority === 'urgent' ? 'danger' : 'warning') : ''}
${heading(title)}
${infoBox([
	['From',    `${escapeHtml(t.name || '—')} &lt;${escapeHtml(t.email)}&gt;`],
	['Plan',    escapeHtml(t.tier ?? 'guest')],
	['Topic',   escapeHtml(t.topicLabel)],
	['Subject', escapeHtml(t.subject)],
])}
${quoteBlock(body.slice(0, 1500))}
${cta('Open in admin', adminLink)}
${smallPrint(`Ticket ${t.ref}`)}`;

	await sendEmail(
		STAFF_EMAIL,
		`[${t.ref}]${t.priority !== 'normal' ? ` [${t.priority.toUpperCase()}]` : ''} ${title}: ${t.subject}`,
		base(`${title} from ${t.name || t.email}`, content)
	);
}

export async function sendAdminDigestEmail(
	items: { ref: string; subject: string; name: string; priority: string; waitingHours: number; link: string }[],
): Promise<void> {
	const rows = items
		.map((i) => `
    <tr>
      <td style="font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#a0a8bc;padding:8px 0;border-top:1px solid #1c2130;line-height:1.5;">
        <a href="${i.link}" style="color:#f0f2f7;font-weight:600;">${escapeHtml(i.subject)}</a><br/>
        ${escapeHtml(i.name)} · ${i.ref} · waiting ${i.waitingHours >= 48 ? `${Math.round(i.waitingHours / 24)} days` : `${i.waitingHours}h`}${i.priority !== 'normal' ? ` · <span style="color:#ffb547;">${i.priority}</span>` : ''}
      </td>
    </tr>`)
		.join('');

	const content = `
${heading(`${items.length} ticket${items.length === 1 ? '' : 's'} waiting on a reply`)}
${subtext('These have gone past the one-business-day response we promise customers.')}
<tr><td style="padding-bottom:20px;"><table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">${rows}</table></td></tr>
${cta('Open support inbox', `${APP_URL}/admin/support?view=needs_reply`)}
<tr><td style="height:32px;"></td></tr>`;

	await sendEmail(
		STAFF_EMAIL,
		`[OmniPlot] ${items.length} support ticket${items.length === 1 ? '' : 's'} overdue`,
		base(`${items.length} tickets waiting on a reply`, content),
	);
}

// ─── Free Month (Credit) Email ────────────────

/** A free-month / amount-off coupon was applied to their subscription. No
 *  money moves — their next invoice is simply discounted. */
export async function sendAccountCreditEmail(
	to: string,
	displayName: string,
	label: string,
	months: number | null,
): Promise<void> {
	const title = months ? (months === 1 ? 'Next month is on us' : `Your next ${months} months are on us`) : 'A discount on us';
	const content = `
${alertBox(`${escapeHtml(label)} — applied to your subscription.`, 'success')}
${heading(title)}
${subtext(`Hi ${escapeHtml(firstName(displayName))}, we've applied <strong style="color:#f0f2f7;">${escapeHtml(label)}</strong> to your OmniPlot subscription. It comes off your next invoice automatically — there's nothing you need to do, and your plan stays exactly as it is.`)}
${cta('View billing', `${APP_URL}/settings?tab=billing`)}
${smallPrint(`Questions? <a href="${APP_URL}/support" style="color:#6a7288;text-decoration:underline;">Chat with support</a>.`)}`;

	await sendEmail(to, `${title} — OmniPlot`, base(`${label} applied to your subscription.`, content));
}
