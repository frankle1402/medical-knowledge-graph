import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import type { TemplateVariable } from '@mkg/shared';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface TemplateInput {
  name: string;
  description?: string | undefined;
  variables: TemplateVariable[];
  system_prompt: string;
  user_prompt_template: string;
  output_schema?: Record<string, unknown> | undefined;
  created_by?: string | undefined;
}

export interface TemplatePatch {
  name?: string | undefined;
  description?: string | undefined;
  variables?: TemplateVariable[] | undefined;
  system_prompt?: string | undefined;
  user_prompt_template?: string | undefined;
  output_schema?: Record<string, unknown> | null | undefined;
}

interface PromptTemplateRow {
  id: string;
  name: string;
  description: string | null;
  variables: Prisma.JsonValue;
  system_prompt: string;
  user_prompt_template: string;
  output_schema: Prisma.JsonValue | null;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function row(t: PromptTemplateRow) {
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? undefined,
    variables: t.variables as TemplateVariable[],
    system_prompt: t.system_prompt,
    user_prompt_template: t.user_prompt_template,
    output_schema: t.output_schema as Record<string, unknown> | undefined,
    is_active: t.is_active,
    created_by: t.created_by ?? undefined,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  };
}

export const templatesService = {
  async list() {
    const rows = await prisma.promptTemplate.findMany({
      where: { is_active: true, deleted_at: null },
      orderBy: { created_at: 'desc' },
    });
    return rows.map(row);
  },

  async get(id: string) {
    const t = await prisma.promptTemplate.findFirst({
      where: { id, is_active: true, deleted_at: null },
    });
    return t ? row(t) : null;
  },

  async create(input: TemplateInput) {
    const t = await prisma.promptTemplate.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        variables: input.variables as unknown as Prisma.InputJsonValue,
        system_prompt: input.system_prompt,
        user_prompt_template: input.user_prompt_template,
        output_schema:
          input.output_schema !== undefined
            ? (input.output_schema as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        created_by: input.created_by ?? null,
      },
    });
    return row(t);
  },

  async update(id: string, patch: TemplatePatch) {
    try {
      const data: Prisma.PromptTemplateUpdateInput = {};
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.description !== undefined) data.description = patch.description;
      if (patch.variables !== undefined)
        data.variables = patch.variables as unknown as Prisma.InputJsonValue;
      if (patch.system_prompt !== undefined) data.system_prompt = patch.system_prompt;
      if (patch.user_prompt_template !== undefined)
        data.user_prompt_template = patch.user_prompt_template;
      if (patch.output_schema !== undefined)
        data.output_schema =
          patch.output_schema === null
            ? Prisma.JsonNull
            : (patch.output_schema as Prisma.InputJsonValue);

      const t = await prisma.promptTemplate.update({ where: { id }, data });
      return row(t);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') {
        throw new HttpError(404, 'NOT_FOUND', 'template_not_found');
      }
      throw e;
    }
  },

  async softDelete(id: string) {
    try {
      await prisma.promptTemplate.update({
        where: { id },
        data: { is_active: false, deleted_at: new Date() },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') {
        throw new HttpError(404, 'NOT_FOUND', 'template_not_found');
      }
      throw e;
    }
    return { ok: true };
  },
};
