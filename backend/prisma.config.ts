// This file is used by Prisma CLI.
// In Docker/production we rely on real environment variables (DATABASE_URL)
// injected by the runtime (e.g. docker compose env_file), not a local .env file.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'npx ts-node prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'] || '',
  },
});
