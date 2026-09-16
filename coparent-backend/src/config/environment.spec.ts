import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  const valid = {
    DATABASE_URL: 'postgresql://localhost/coparent',
    AUTH_MODE: 'local',
    JWT_SECRET: 'a'.repeat(32),
    CORS_ORIGIN: 'http://localhost:5173',
    EMAIL_PROVIDER: 'development',
    EMAIL_OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    FILE_STORAGE_ROOT: '/tmp/coparent-test-documents',
    FILE_STORAGE_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
  };

  it('accepts a complete configuration', () => {
    expect(validateEnvironment(valid)).toBe(valid);
  });

  it('rejects a short signing secret', () => {
    expect(() =>
      validateEnvironment({ ...valid, JWT_SECRET: 'short' }),
    ).toThrow('JWT_SECRET must contain at least 32 characters');
  });

  it.each([
    'DATABASE_URL',
    'CORS_ORIGIN',
    'AUTH_MODE',
    'EMAIL_PROVIDER',
    'EMAIL_OUTBOX_ENCRYPTION_KEY',
    'FILE_STORAGE_ROOT',
    'FILE_STORAGE_ENCRYPTION_KEY',
  ])('requires %s', (name) => {
    const config = { ...valid } as Record<string, unknown>;
    delete config[name];
    expect(() => validateEnvironment(config)).toThrow(
      `Missing required environment variable: ${name}`,
    );
  });

  it('requires the OIDC trust configuration in oidc mode', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        AUTH_MODE: 'oidc',
        JWT_SECRET: undefined,
      }),
    ).toThrow('Missing required OIDC environment variable: OIDC_ISSUER');
  });

  it('accepts OIDC mode without a local signing secret', () => {
    const oidc = {
      ...valid,
      AUTH_MODE: 'oidc',
      JWT_SECRET: undefined,
      OIDC_ISSUER: 'https://identity.example.test/',
      OIDC_AUDIENCE: 'coparent-api',
      OIDC_JWKS_URI: 'https://identity.example.test/.well-known/jwks.json',
    };
    expect(validateEnvironment(oidc)).toBe(oidc);
  });

  it('requires Resend secrets only in Resend mode', () => {
    expect(() =>
      validateEnvironment({ ...valid, EMAIL_PROVIDER: 'resend' }),
    ).toThrow('Missing Resend configuration: RESEND_API_KEY');
  });
});
