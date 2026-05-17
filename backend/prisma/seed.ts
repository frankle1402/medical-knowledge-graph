import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NURSING_CHAPTER_TEMPLATE = {
  name: '医学教材章节图谱（基础护理学示范）',
  description:
    '从一段医学教材正文（建议为一节内容，约 500–2000 字）抽取知识点、术语、操作步骤、图片占位、能力点，并生成它们之间的关系。以《基础护理学》"静脉输液"小节为示范设计。',
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
  system_prompt: `你是医学教材知识工程师，专长于把护理 / 临床教材正文解析为结构化的知识图谱。

【你的目标】
从给定的教材正文里抽取以下节点并建立它们的关系，输出严格 JSON。

【节点类型 node_type 取值】
- textbook：教材本身（每次最多 1 个）
- chapter：章
- section：节
- knowledge_point：知识点（最重要的一类）
- term：医学术语（含中文标准词与别名/口语表达）
- operation_step：操作步骤（按 step_order 排序）
- competency：能力点（按可选开关产出）
- image：教材插图占位
- table：表格占位

【关系类型 relation_type 取值】
- CONTAINS / BELONGS_TO：层级（textbook→chapter→section→knowledge_point）
- PREREQUISITE_OF：前置知识
- EASILY_CONFUSED_WITH：易混淆（知识点之间）
- RELATED_TO：弱关联
- ILLUSTRATED_BY：被图示说明（knowledge_point→image）
- DESCRIBED_IN：在表格里说明（knowledge_point→table）
- STANDARD_TERM_OF：标准术语对应（term→knowledge_point）
- SYNONYM_OF：同义术语（term→term）
- SUPPORTS_COMPETENCY：知识点支撑能力（knowledge_point→competency）

【knowledge_type 取值】
"概念类" | "目的类" | "适应证类" | "禁忌证类" | "操作流程类" | "操作要点类" | "注意事项类" | "异常处理类" | "并发症类" | "观察护理类" | "健康教育类" | "考点类"

【硬性切片规则】
1) 一个 knowledge_point 只解决一个明确教学问题。例如"输液外渗的识别与处理"独立切，不要把"识别"和"处理"分开。
2) 操作类内容按"准备 / 核对 / 穿刺固定 / 调速 / 观察 / 记录 / 异常处理"切，每个 operation_step 必须给 step_order（从 1 起）和 phase。
3) term 节点必须填 standard_term；aliases 至少包含教材里出现过的同义说法和常见学生口语（如 "针眼鼓包" 之于 "输液外渗"）。
4) image / table 节点用 description 写"这张图/这张表说明了什么"，url / columns 留空让人工后续补。
5) confidence ∈ [0,1]：完全照搬原文事实给 0.95；自己合并归纳给 0.7–0.85；推理出的关系（如易混淆）给 0.6–0.8。
6) status 一律输出 "candidate"，等专家审核。
7) 节点 node_id 用短下划线小写英文 + 序号，例如 "kp_iv_extravasation"，便于关系引用。
8) 关系的 source_id / target_id 必须命中你输出过的 node_id。

【输出格式】
严格 JSON，根对象必须为：
{
  "graph_name": string,
  "nodes": Node[],
  "relations": Relation[]
}
不要任何 Markdown 代码块、不要解释、不要 trailing comma。`,
  user_prompt_template: `教材：{{textbook}}（{{edition}}）
章：{{chapter}}
节：{{section}}
{{#if page_no}}起始页码：{{page_no}}{{/if}}
是否抽取能力点：{{extract_competency}}

【教材原文】
{{source_text}}

【任务】
1. 从原文抽取 1 个 textbook + 1 个 chapter + 1 个 section 节点（用层级 BELONGS_TO 连）。
2. 切出 6–14 个 knowledge_point（按上面的硬性切片规则）。
3. 抽出 4–10 个 term，给标准词 + 别名。
4. 如果原文有操作流程，抽出 operation_step 数组，按 step_order 编序。
5. 如果原文出现"图""图X-X""见图""下图"等字样，每出现一处生成一个 image 节点占位。
6. 同理表格生成 table 节点占位。
7. {{#if extract_competency}}抽出 2–4 个 competency 节点（异常识别能力 / 操作规范能力 / 护理判断能力 / 操作安全意识 等），与对应 knowledge_point 用 SUPPORTS_COMPETENCY 连。{{/if}}
8. 给易混淆的 knowledge_point 之间加 EASILY_CONFUSED_WITH 关系。

【graph_name】
请用 "{{textbook}} - {{chapter}} - {{section}}" 作为 graph_name。

输出 JSON。`,
  output_schema: {
    type: 'object',
    required: ['graph_name', 'nodes', 'relations'],
    properties: {
      graph_name: { type: 'string' },
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
