import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from '../shared/logger.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: config.email.user
        ? { user: config.email.user, pass: config.email.pass }
        : undefined,
    });
  }
  return transporter;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  from?: string;
}): Promise<void> {
  const from = opts.from ?? config.email.from;
  try {
    await getTransporter().sendMail({
      from,
      to: Array.isArray(opts.to) ? opts.to.join(',') : opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });
    logger.info('Email sent', { to: opts.to, subject: opts.subject });
  } catch (err) {
    logger.error('Email send failed', { error: err, to: opts.to });
    throw err;
  }
}

export async function sendDocumentEmail(opts: {
  to: string;
  subject: string;
  body: string;
  pdfBuffer: Buffer;
  pdfFilename: string;
}): Promise<void> {
  await sendEmail({
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    attachments: [
      {
        filename: opts.pdfFilename,
        content: opts.pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}
