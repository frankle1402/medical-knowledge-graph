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

// 更新图谱元数据：所有字段均可选；不允许改 created_by / graph_id 等不可变字段
export const GraphUpdateInput = GraphCreateInput.partial().extend({
  status: z.enum(['active', 'archived']).optional(),
  chapter_name: z.string().optional(),
  textbook_id: z.string().optional(),
  cover_url: z.string().url().optional(),
});
export type GraphUpdateInput = z.infer<typeof GraphUpdateInput>;
