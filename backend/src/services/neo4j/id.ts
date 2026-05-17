/**
 * Backend-side ID generator helpers.
 *
 * Single source of truth lives in `@mkg/shared/utils/id` (Agent-F). This file
 * exists so internal modules can import via the relative `services/neo4j/id`
 * path without reaching across the workspace each time.
 */
export {
  generateNodeId,
  generateGraphId,
  generateRelationId,
  isValidNodeId,
  isValidGraphId,
  isValidRelationId,
} from '@mkg/shared';
