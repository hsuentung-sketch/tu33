import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://erp-line-bot.onrender.com',

  // LINE Bot (default channel, can be overridden per tenant)
  line: {
    channelId: process.env.LINE_CHANNEL_ID || '',
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
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
    // Service role key — required for server-side uploads & signed URLs.
    // NEVER expose to the browser.
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    productDocsBucket: process.env.SUPABASE_PRODUCT_DOCS_BUCKET || 'product-docs',
  },
} as const;
