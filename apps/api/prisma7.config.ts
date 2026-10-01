import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const schemaOnlyUrl = 'postgresql://schema:validation@127.0.0.1:1/mc_plan_skin_schema_only';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.SKIN_DATABASE_URL ?? schemaOnlyUrl,
  },
});
