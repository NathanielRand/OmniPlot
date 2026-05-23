import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';
import { RESEND_API_KEY } from '$env/static/private';

const TOPIC_LABELS: Record<string, string> = {
	account:   'Account & Login',
	billing:   'Billing & Subscription',
	patterns:  'Patterns & Library',
	technical: 'Technical Issue',
	feature:   'Feature Request',
	other:     'Other',
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	let body: { topic?: string; name?: string; email?: string; message?: string };
	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
	}

	const { topic = 'other', name = '', email = '', message = '' } = body;

	if (!email.trim() || !message.trim()) {
		return new Response(JSON.stringify({ error: 'Email and message are required.' }), { status: 400 });
	}
	if (!email.includes('@')) {
		return new Response(JSON.stringify({ error: 'Please enter a valid email address.' }), { status: 400 });
	}

	const topicLabel = TOPIC_LABELS[topic] ?? topic;

	// Always persist to Firestore so no submission is ever lost
	try {
		const db = getAdminDb();
		await db.collection('supportRequests').add({
			topic,
			topicLabel,
			name:      name.trim(),
			email:     email.trim().toLowerCase(),
			message:   message.trim(),
			ip:        getClientAddress(),
			status:    'open',
			createdAt: new Date(),
		});
	} catch (err) {
		console.error('Support Firestore write failed:', err);
		return new Response(JSON.stringify({ error: 'Failed to submit request. Please try again.' }), { status: 500 });
	}

	// Send notification email via Resend
	if (RESEND_API_KEY) {
		try {
			await fetch('https://api.resend.com/emails', {
				method: 'POST',
				headers: {
					'Content-Type':  'application/json',
					'Authorization': `Bearer ${RESEND_API_KEY}`,
				},
				body: JSON.stringify({
					from:     'OmniPlot Support <noreply@omniplot.app>',
					to:       ['support@omniplot.app'],
					reply_to: email.trim(),
					subject:  `[${topicLabel}] ${name.trim() || email.trim()}`,
					html: `
						<p><strong>Topic:</strong> ${topicLabel}</p>
						<p><strong>From:</strong> ${name.trim() || '(no name)'} &lt;${email.trim()}&gt;</p>
						<hr/>
						<p>${message.trim().replace(/\n/g, '<br>')}</p>
					`.trim(),
				}),
			});
		} catch (err) {
			// Logged but not fatal — submission is already in Firestore
			console.error('Resend email failed:', err);
		}
	}

	return json({ ok: true });
};
