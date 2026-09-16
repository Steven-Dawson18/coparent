type Environment = Record<string, unknown>;

export function validateEnvironment(config: Environment) {
  const required = [
    'DATABASE_URL',
    'CORS_ORIGIN',
    'AUTH_MODE',
    'EMAIL_PROVIDER',
    'EMAIL_OUTBOX_ENCRYPTION_KEY',
    'FILE_STORAGE_ROOT',
    'FILE_STORAGE_ENCRYPTION_KEY',
  ] as const;
  for (const name of required) {
    if (typeof config[name] !== 'string' || config[name].length === 0) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }

  if (config.AUTH_MODE !== 'local' && config.AUTH_MODE !== 'oidc') {
    throw new Error('AUTH_MODE must be either local or oidc');
  }

  if (
    config.EMAIL_PROVIDER !== 'development' &&
    config.EMAIL_PROVIDER !== 'resend'
  ) {
    throw new Error('EMAIL_PROVIDER must be either development or resend');
  }

  const encryptionKey = Buffer.from(
    config.EMAIL_OUTBOX_ENCRYPTION_KEY as string,
    'base64',
  );
  if (encryptionKey.length !== 32) {
    throw new Error('EMAIL_OUTBOX_ENCRYPTION_KEY must decode to 32 bytes');
  }

  const fileEncryptionKey = Buffer.from(
    config.FILE_STORAGE_ENCRYPTION_KEY as string,
    'base64',
  );
  if (fileEncryptionKey.length !== 32) {
    throw new Error('FILE_STORAGE_ENCRYPTION_KEY must decode to 32 bytes');
  }

  if (config.EMAIL_PROVIDER === 'resend') {
    for (const name of [
      'RESEND_API_KEY',
      'RESEND_WEBHOOK_SIGNING_SECRET',
      'EMAIL_FROM',
    ]) {
      if (typeof config[name] !== 'string' || config[name].length === 0) {
        throw new Error(`Missing Resend configuration: ${name}`);
      }
    }
  }

  if (
    config.AUTH_MODE === 'local' &&
    (typeof config.JWT_SECRET !== 'string' || config.JWT_SECRET.length < 32)
  ) {
    throw new Error(
      'JWT_SECRET must contain at least 32 characters in local mode',
    );
  }

  if (config.AUTH_MODE === 'oidc') {
    for (const name of ['OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URI']) {
      if (typeof config[name] !== 'string' || config[name].length === 0) {
        throw new Error(`Missing required OIDC environment variable: ${name}`);
      }
    }
  }

  return config;
}
