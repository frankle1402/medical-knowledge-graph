import { z } from 'zod';
import { GraphType } from '../enums';

export const Graph = z.object({
  graph_id: z.string().min(1),
  graph_name: z.string().min(1),
  graph_type: GraphType.default('course'),
  subject: z.string().optional(),
  course_name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived']).default('active'),
  node_count: z.number().int().default(0),
  relation_count: z.number().int().default(0),
  created_by: z.string().optional(),
  created_at: z.string().datetime().optional(),
});
export type Graph = z.infer<typeof Graph>;

export const GraphCreateInput = Graph.pick({
  graph_name: true,
  graph_type: true,
  subject: true,
  course_name: true,
  description: true,
});
export type GraphCreateInput = z.infer<typeof GraphCreateInput>;
