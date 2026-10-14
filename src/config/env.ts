import 'dotenv/config';

import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a valid Discord ID');

const environmentSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'is required'),
  DISCORD_CLIENT_ID: snowflake,
  SDMC_FOUNDER_ROLE_ID: snowflake.default('1545973428018745434'),
  SDMC_CHURCH_TOPICS_CHANNEL_ID: snowflake.default('1546065581453611128'),
  SDMC_CHURCH_MINUTES_CHANNEL_ID: snowflake.default('1546066314500513903'),
  SDMC_VOTES_CHANNEL_ID: snowflake.default('1546176911024328775'),
  DISCORD_GUILD_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    snowflake.optional(),
  ),
  GOOGLE_PRIVATE_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.email().optional(),
  ),
  GOOGLE_SPREADSHEET_ID: z.string().min(20).default('1WaAwMsCw5wA1vXklryjri8CIri5gxJxoRc60jWAbj3A'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const details = z.prettifyError(parsedEnvironment.error);
  throw new Error(`Environment configuration is invalid:\n${details}`);
}

export const env = parsedEnvironment.data;
