import nodemailer from 'nodemailer';

export const emailField = { type: 'string', minLength: 3, maxLength: 254 };

export function recoveryEmail(value) {
  const email = value?.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email)) return null;
  return email;
}

export function createRecoveryMailer({ url: address, from: sender, webOrigin }) {
  if (!address) return undefined;
  const url = URL.parse(address);
  const from = recoveryEmail(sender);
  if (!url || !['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname || url.search || url.hash
      || (url.pathname && url.pathname !== '/') || !from || !webOrigin) {
    throw new Error('La configuration SMTP du compte direction est invalide.');
  }
  const secure = url.protocol === 'smtps:';
  const transport = nodemailer.createTransport({
    host: url.hostname, port: Number(url.port || (secure ? 465 : 587)), secure, requireTLS: !secure,
    auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 10_000,
  });
  return async (to, purpose, token) => {
    const verify = purpose === 'verify';
    const link = new URL('/?espace=direction', webOrigin);
    link.hash = new URLSearchParams({ [verify ? 'verification' : 'recuperation']: token }).toString();
    await transport.sendMail({
      from, to,
      subject: verify ? 'Vérifier l’adresse de récupération Open Cartable' : 'Réinitialiser le mot de passe Open Cartable',
      text: (verify ? 'Vérifiez l’adresse de récupération du compte direction.' : 'Choisissez un nouveau mot de passe pour le compte direction.')
        + '\n\n' + link.href + '\n\nCe lien est valable 30 minutes et s’utilise une fois.',
    });
  };
}
