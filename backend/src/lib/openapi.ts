import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import swaggerUi from 'swagger-ui-express';
import type { Express } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mount Swagger UI at /api/docs.
 *
 * Reads the OpenAPI YAML produced by `@mkg/shared` (`shared/src/openapi/build.ts`).
 * If the YAML is missing during early bootstrap or in tests, we serve a minimal
 * placeholder so the route still works.
 */
export function mountSwagger(app: Express): void {
  const yamlPath = path.resolve(__dirname, '../../openapi.yaml');

  let doc: object = {
    openapi: '3.1.0',
    info: { title: 'MKG API', version: '0.0.0' },
    paths: {},
  };

  if (fs.existsSync(yamlPath)) {
    try {
      const raw = fs.readFileSync(yamlPath, 'utf8');
      doc = yaml.parse(raw) ?? doc;
    } catch {
      // fall back to placeholder doc
    }
  }

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(doc));
}
