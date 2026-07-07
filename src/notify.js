import nodemailer from 'nodemailer';

function displayName(item) {
  if (item.label) return item.label;
  try {
    return new URL(item.url).hostname;
  } catch {
    return item.url;
  }
}

export function buildInStockEmail(item, price, detectedAt) {
  const name = displayName(item);
  return {
    subject: `🎉 Back in stock: ${name}`,
    text: [
      `${name} looks IN STOCK right now${price ? ` (price: ${price})` : ''}.`,
      '',
      `Go go go: ${item.url}`,
      '',
      `Detected at ${detectedAt} by Restock Radar.`,
    ].join('\n'),
  };
}

export function buildBlockedEmail(item) {
  const name = displayName(item);
  return {
    subject: `⚠️ Can't monitor: ${name}`,
    text: [
      `Restock Radar failed to check ${name} three times in a row — the site is probably blocking automated checks.`,
      '',
      `You'll need to watch this one manually: ${item.url}`,
      '',
      `It stays on the list; if checks start working again it resumes automatically.`,
    ].join('\n'),
  };
}

export async function sendEmail({ subject, text }, env = process.env) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({
    from: `Restock Radar <${env.GMAIL_USER}>`,
    to: env.NOTIFY_TO,
    subject,
    text,
  });
}
