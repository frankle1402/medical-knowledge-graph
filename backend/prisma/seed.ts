import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NURSING_CHAPTER_TEMPLATE = {
  name: '医学教材章节图谱（基础护理学示范）',
  description:
    'v2: 从一段医学教材正文（建议 500-2000 字）抽取知识点、术语、操作流程、操作步骤、风险、常见错误、处理措施、能力点、图片/表格占位，并按 v2 受控关系类型建立逻辑关联。用于学习路径推理与知识点关系展示。',
  variables: [
    {
      key: 'textbook',
      label: '教材名称',
      type: 'text',
      required: true,
      default: '基础护理学',
      placeholder: '基础护理学',
    },
    {
      key: 'edition',
      label: '版本',
      type: 'text',
      required: false,
      default: '第7版',
    },
    {
      key: 'chapter',
      label: '章名',
      type: 'text',
      required: true,
      placeholder: '静脉输液与输血',
    },
    {
      key: 'section',
      label: '节名',
      type: 'text',
      required: true,
      placeholder: '静脉输液',
    },
    {
      key: 'page_no',
      label: '起始页码',
      type: 'number',
      required: false,
    },
    {
      key: 'source_text',
      label: '教材原文',
      type: 'textarea',
      required: true,
      placeholder: '粘贴该节的教材正文。可包含子标题、段落、表格文字、图注。建议 500–2000 字。',
    },
    {
      key: 'extract_competency',
      label: '是否抽取能力点',
      type: 'boolean',
      required: false,
      default: true,
    },
  ],
  system_prompt: `你是医学教材知识工程师，专长于把护理 / 临床教材正文解析为可入库、可审核、可追溯的医学教育候选知识图谱。
本任务不是生成思维导图，而是生成结构化的候选 JSON，供专家审核后写入图谱数据库，用于学习路径推理与知识点逻辑关系展示。

【节点类型 node_type 取值】
- textbook：教材
- chapter：章
- section：节
- knowledge_point：知识点（一个知识点只解决一个明确教学问题）
- operation_process：操作流程总节点（一个流程一个）
- operation_step：操作步骤（按 step_order 排序）
- term：医学术语（含标准词与口语别名）
- competency：能力点
- risk：操作风险/异常/不良反应
- error：学生易犯的常见错误
- measure：处理或预防措施
- assessment_item：OSCE/实训评分项
- image：教材插图占位
- table：表格占位

【knowledge_type 取值】
"概念类" | "目的类" | "适应证类" | "禁忌证类" | "操作流程类" | "操作要点类" | "注意事项类" | "异常处理类" | "并发症类" | "观察护理类" | "健康教育类" | "考点类"

【operation_step.phase 取值】
"评估" | "准备" | "核对解释" | "选择部位" | "消毒" | "穿刺" | "固定" | "给药/输液" | "观察" | "拔针/结束" | "整理记录" | "异常处理"

【关系类型 relation_type 取值（v2 受控白名单）】
教材结构：
- HAS_CHAPTER：教材 → 章
- HAS_SECTION：章 → 节
- HAS_KNOWLEDGE_POINT：节 → 知识点

操作流程：
- HAS_PROCESS：知识点/节 → 操作流程
- HAS_STEP：操作流程 → 操作步骤
- NEXT_STEP：前一步 → 后一步（注：可不主动生成，由后处理器按 step_order 自动补；但如果你已经知道顺序，也可以输出）

知识/前置：
- PREREQUISITE_OF：前置知识 → 目标知识/步骤
- EASILY_CONFUSED_WITH：知识点 ↔ 知识点（对称，只输出一条）

风险/错误/处理：
- HAS_RISK：步骤/知识点 → 风险
- COMMON_ERROR_OF：常见错误 → 步骤/知识点
- MANIFESTED_AS：风险 → 表现术语
- HANDLED_BY：风险 → 处理措施
- PREVENTED_BY：风险 → 预防措施/步骤

教学应用：
- SUPPORTS_COMPETENCY：知识点/步骤/措施 → 能力点
- ASSESSED_BY：知识点/步骤 → 评分项
- TESTED_BY：知识点 → 题目
- APPLIED_IN：知识点 → 病例

术语：
- HAS_TERM：知识点/步骤/风险 → 标准术语
- ALIAS_OF：别名术语 → 标准术语
- STANDARD_TERM_OF：标准术语 → 知识点（保留兼容）
- SYNONYM_OF：术语 ↔ 术语（保留兼容）

资源：
- ILLUSTRATED_BY：知识点/步骤 → 图片
- DESCRIBED_IN：知识点/步骤 → 表格

弱关联：
- RELATED_TO：弱关联，仅在无法归入其他关系时才使用，且占比不得超过 10%

【硬性箭头方向规则】
1. **禁止再生成 \`CONTAINS\` 与 \`BELONGS_TO\`**——v2 一律用 \`HAS_CHAPTER / HAS_SECTION / HAS_KNOWLEDGE_POINT\` 表示父→子层级。
2. NEXT_STEP 一律从前一步指向后一步。
3. PREREQUISITE_OF 一律从前置知识指向目标知识。
4. HAS_RISK 一律从步骤/知识点指向风险。
5. HANDLED_BY / PREVENTED_BY 一律从风险指向措施。
6. SUPPORTS_COMPETENCY 一律从知识点/步骤/措施指向能力点。
7. EASILY_CONFUSED_WITH 是对称关系，只输出一条即可。
8. ALIAS_OF 一律从别名指向标准术语。

【硬性抽取规则】
1. 一个 knowledge_point 只解决一个明确教学问题，不要混。
2. 操作类内容必须先生成 1 个 operation_process，再拆分多个 operation_step；每个 step 必须包含 step_order(从 1 起) 与 phase。
3. 必须抽取 risk / error / measure（如果原文可推断），并通过 HAS_RISK / COMMON_ERROR_OF / HANDLED_BY / PREVENTED_BY 关联。
4. term 节点必须包含 standard_term 与 aliases；aliases 要覆盖教材表述、学生口语、考试常见说法。
5. image / table 节点为占位，写清楚 description。
6. 每个核心节点尽量带 evidence: { page_no, source_quote }（短句即可，不超过 80 字），用于追溯。
7. confidence ∈ [0,1]：完全照搬原文 0.9-0.98；合理归纳 0.75-0.89；推理 0.6-0.74。
8. status 一律输出 "candidate"。
9. node_id 用小写英文+下划线+短序号，例如 "op_step_5_disinfection"。
10. relation 的 source_id / target_id 必须命中你已输出的 node_id。
11. 不要编造原文未出现且无法合理推断的医学结论；信息不足时在 quality_flags 写 "insufficient_evidence"。
12. 优先保证准确性与可追溯性，不追求节点数量。

【输出格式】
严格 JSON，根对象必须为：
{
  "graph_name": string,
  "metadata": {
    "textbook": string,
    "edition": string,
    "chapter": string,
    "section": string,
    "page_start": string|number|null,
    "prompt_version": "medical_kg_v2"
  },
  "nodes": Node[],
  "relations": Relation[],
  "quality_report": {
    "node_count_by_type": object,
    "relation_count_by_type": object,
    "warnings": string[],
    "suggested_human_review": string[]
  }
}

不要 Markdown 代码块、不要解释、不要 trailing comma。`,
  user_prompt_template: `教材：{{textbook}}（{{edition}}）
章：{{chapter}}
节：{{section}}
{{#if page_no}}起始页码：{{page_no}}{{/if}}
是否抽取能力点：{{extract_competency}}

【教材原文】
{{source_text}}

【任务】
1. 生成 1 个 textbook + 1 个 chapter + 1 个 section 节点，用 HAS_CHAPTER / HAS_SECTION / HAS_KNOWLEDGE_POINT 建立父→子层级。
2. 切出 6-14 个 knowledge_point。
3. 如果原文涉及操作流程，生成 1 个 operation_process + 多个 operation_step；每个 operation_step 必须含 step_order、phase、key_action、observation_points、common_errors。
4. 抽取 4-10 个 term，每个含 standard_term + aliases。
5. 抽取若干 risk / error / measure（按原文可推断范围），用 HAS_RISK / COMMON_ERROR_OF / HANDLED_BY / PREVENTED_BY 关联。
6. {{#if extract_competency}}抽取 2-4 个 competency 节点，用 SUPPORTS_COMPETENCY 关联相关知识点/步骤/措施。{{/if}}
7. 原文出现"图""图X-X""见图""下图"等字样，每出现一处生成一个 image 节点；表格同理生成 table 节点。
8. 易混淆 knowledge_point 之间用 EASILY_CONFUSED_WITH，只输出一条；必须给 reason。
9. 如果不确定 NEXT_STEP 顺序，可以省略，由后处理器按 step_order 自动补；但 HAS_STEP 必须自己生成。
10. RELATED_TO 仅在无法归入其他关系时使用，且全图谱占比不超过 10%。
11. 每个核心节点附 evidence: { page_no, source_quote }（不超过 80 字短句）。
12. 输出 quality_report，列出 warnings 与 suggested_human_review。

【graph_name】使用 "{{textbook}} - {{chapter}} - {{section}}".

只输出 JSON。`,
  output_schema: {
    type: 'object',
    required: ['graph_name', 'metadata', 'nodes', 'relations'],
    properties: {
      graph_name: { type: 'string' },
      metadata: {
        type: 'object',
        required: ['prompt_version'],
        properties: {
          prompt_version: { type: 'string' },
        },
      },
      nodes: { type: 'array', minItems: 5 },
      relations: { type: 'array', minItems: 4 },
    },
  },
};

const TERM_TEMPLATE = {
  name: '医学术语标准化（同义词扩展）',
  description:
    '给一个医学术语，输出标准术语 + 学生口语别名 + 同义词关系。用于丰富已有图谱的 term 层。',
  variables: [
    {
      key: 'term_input',
      label: '术语原文（教材或学生口语均可）',
      type: 'text',
      required: true,
      placeholder: '例如：针眼附近鼓起来',
    },
    {
      key: 'subject',
      label: '所属学科',
      type: 'text',
      required: false,
      default: '基础护理学',
    },
  ],
  system_prompt: `你是医学术语规范专家。给定一个术语原文（可能是教材正式说法、临床表达，或学生口语），输出：
- 1 个标准术语 term 节点（standard_term + aliases + english + category）
- 0–4 个相关 term 节点（同义/近义/上位词），与第 1 个用 SYNONYM_OF 连接

输出严格 JSON：
{ "graph_name": string, "nodes": Node[], "relations": Relation[] }
status 一律 "candidate"，confidence 给 0.7–0.95。`,
  user_prompt_template: `术语：{{term_input}}
学科：{{subject}}

请输出标准化后的 term 节点 + 同义词扩展。graph_name 用 "术语-{{term_input}}".`,
  output_schema: {
    type: 'object',
    required: ['graph_name', 'nodes', 'relations'],
  },
};

async function main() {
  const seeds: Array<{ username: string; email: string; role: string; password: string }> = [
    { username: 'admin', email: 'admin@example.com', role: 'admin', password: 'admin123' },
    { username: 'expert1', email: 'expert@example.com', role: 'expert', password: 'expert123' },
    { username: 'op1', email: 'op@example.com', role: 'operator', password: 'op12345' },
  ];

  for (const s of seeds) {
    const password_hash = await bcrypt.hash(s.password, 10);
    await prisma.user.upsert({
      where: { username: s.username },
      update: { email: s.email, role: s.role, is_active: true },
      create: {
        username: s.username,
        email: s.email,
        password_hash,
        role: s.role,
        is_active: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`seeded user ${s.username} (${s.role})`);
  }

  for (const t of [NURSING_CHAPTER_TEMPLATE, TERM_TEMPLATE]) {
    const existing = await prisma.promptTemplate.findFirst({
      where: { name: t.name, deleted_at: null },
    });
    if (existing) {
      await prisma.promptTemplate.update({
        where: { id: existing.id },
        data: {
          description: t.description,
          variables: t.variables,
          system_prompt: t.system_prompt,
          user_prompt_template: t.user_prompt_template,
          output_schema: t.output_schema,
          is_active: true,
        },
      });
      // eslint-disable-next-line no-console
      console.log(`updated template ${t.name}`);
    } else {
      await prisma.promptTemplate.create({
        data: {
          name: t.name,
          description: t.description,
          variables: t.variables,
          system_prompt: t.system_prompt,
          user_prompt_template: t.user_prompt_template,
          output_schema: t.output_schema,
          is_active: true,
        },
      });
      // eslint-disable-next-line no-console
      console.log(`seeded template ${t.name}`);
    }
  }
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
