import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';

export type InvitationMessage = { to: string; organization: string; inviter?: string | null; role: string; url: string; expires: Date };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function invitationContent(m: InvitationMessage) {
  const expiry = m.expires.toISOString();
  const inviter = m.inviter ? ` (${m.inviter})` : '';
  return {
    subject: `MIDAN: ${m.organization} — Invitation / دعوة`,
    text: `${m.organization}${inviter}\nRole / الدور: ${m.role}\nExpires / تنتهي: ${expiry}\nAccept Invitation: ${m.url}\nسجّل الدخول ببريد الدعوة المؤكد ثم اقبل الدعوة.`,
    html: `<div><h1>${escape(m.organization)}</h1><p>Invitation / دعوة${escape(inviter)}</p><p>Role / الدور: ${escape(m.role)}</p><p>Expires / تنتهي: ${expiry}</p><p><a href="${escape(m.url)}" style="display:inline-block;padding:12px 20px;border:1px solid currentColor;border-radius:8px;text-decoration:none">Accept Invitation</a></p><p dir="rtl">سجّل الدخول ببريد الدعوة المؤكد ثم اقبل الدعوة.</p></div>`,
  };
}

@Injectable()
export class InvitationMailer {
  async send(message: InvitationMessage): Promise<void> {
    const host = process.env.SMTP_HOST;
    const from = process.env.SMTP_FROM;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 || (process.env.SMTP_USER && !process.env.SMTP_PASSWORD)) {
      throw new ServiceUnavailableException('Invitation email was not sent. Configure SMTP and retry the same invitation.');
    }
    const transport = nodemailer.createTransport({
      host, port, secure: process.env.SMTP_SECURE === 'true',
      requireTLS: !local && process.env.SMTP_SECURE !== 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
    try {
      const info = await transport.sendMail({ from, to: message.to, ...invitationContent(message) });
      if (!info.accepted?.length || info.rejected?.length) throw new Error('Recipient not accepted');
    } catch {
      // No provider response, credentials or tokens in logs/API errors.
      throw new ServiceUnavailableException('Invitation email was not sent or delivery is uncertain. Retry the same invitation.');
    } finally {
      transport.close();
    }
  }
}
