import nodemailer from 'nodemailer';

// SMTP is optional in local development; callers receive an explicit 503 when
// requesting email features without a configured transport.
export function createAccountMailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM || !process.env.PUBLIC_APP_URL) return null;
  const baseUrl = new URL(process.env.PUBLIC_APP_URL);
  if (process.env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:') throw new Error('PUBLIC_APP_URL must use HTTPS in production.');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: process.env.NODE_ENV === 'production',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return async ({ to, token, type }) => {
    const url = new URL('/', baseUrl);
    // Fragments are consumed and removed by the client, never sent to HTTP logs.
    url.hash = `${type === 'email_verify' ? 'verify-email' : 'reset-password'}=${encodeURIComponent(token)}`;
    await transport.sendMail({
      from: process.env.SMTP_FROM, to,
      subject: type === 'email_verify' ? 'Xác minh email Bầu Cua' : 'Đặt lại mật khẩu Bầu Cua',
      text: `Mở liên kết sau để ${type === 'email_verify' ? 'xác minh email' : 'đặt lại mật khẩu'}: ${url.href}\nLiên kết chỉ dùng một lần và hết hạn sau 30 phút. Nếu bạn không yêu cầu, hãy bỏ qua thư này.`,
    });
  };
}
