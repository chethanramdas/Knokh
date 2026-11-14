export async function sendEmail(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error('Email delivery is disabled. Configure RESEND_API_KEY and EMAIL_FROM.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type':'application/json'},
    body: JSON.stringify({from,to:[to],subject,text}), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Email delivery failed (HTTP ${response.status})`);
}
