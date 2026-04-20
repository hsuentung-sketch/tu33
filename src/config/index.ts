import dotenv from 'dotenv';
dotenv.config();

const isProd = (process.env.NODE_ENV || 'development') === 'production';

// Secrets that MUST be set in production — fall-through defaults here would
// silently create an exploitable service (known JWT secret = forgeable cookies
// and PDF download tokens).
function requireInProd(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v && v.length > 0) return v;
  if (isProd) {
    throw new Error(
      `Missing required env var ${key}. Set it via: fly secrets set ${key}=<value>`,
    );
  }
  return fallback ?? '';
}

const jwtSecret = requireInProd('JWT_SECRET', 'dev-only-secret-change-me');
const publicBaseUrl = requireInProd('PUBLIC_BASE_URL', 'http://localhost:3000');

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  publicBaseUrl,

  // LINE Bot (default channel, can be overridden per tenant)
  line: {
    channelId: process.env.LINE_CHANNEL_ID || '',
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  },

  // JWT — used for web-session cookie, PDF download tokens, LIFF id-token exchange.
  // Rotating this secret invalidates every session + every outstanding PDF link.
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // Email (SMTP)
  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },

  // OpenAI Whisper
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },

  // Google Cloud Vision
  google: {
    visionApiKey: process.env.GOOGLE_VISION_API_KEY || '',
  },

  // Anthropic (Claude Haiku for voice parsing)
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },

  // Supabase Storage — for product documents (PDS / SDS / DM)
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    productDocsBucket: process.env.SUPABASE_PRODUCT_DOCS_BUCKET || 'product-docs',
  },
} as const;
