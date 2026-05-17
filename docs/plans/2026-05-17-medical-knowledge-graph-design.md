# 医学教材知识图谱构建系统 — 设计文档

**项目**：天堰医学教育知识图谱平台  
**作者**：李智高  
**日期**：2026-05-17  
**版本**：v1.0 MVP

---

## 一、项目背景与目标

天堰科技需要将医学教材（护理、临床、康复等专业）加工成可被 Agent 调用的知识资产。核心路线是：

> 图谱骨架先行 → AI 辅助构建知识图谱 → 知识图谱支撑 RAG 知识库 → 题库/病例关联 → 教学闭环

MVP 阶段目标：**通过可视化界面 + AI 提示词模板，让用户快速构建单门课程的知识图谱，并支持后续多图谱关联合并。**

---

## 二、系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                    前端 (React + TypeScript)          │
│  ┌─────────────────┐    ┌──────────────────────────┐ │
│  │  图谱编辑器      │    │  管理面板                 │ │
│  │  React Flow     │    │  节点/关系 CRUD 表单       │ │
│  │  拖拽/连线/标注  │    │  搜索/筛选/导出           │ │
│  └─────────────────┘    └──────────────────────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────┐
│                后端 (Express + TypeScript)            │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │ 图谱 API │  │ 用户权限 │  │ AI 生成服务         │ │
│  │ CRUD     │  │ JWT Auth │  │ 提示词模板引擎       │ │
│  └──────────┘  └──────────┘  │ LLM 调用 + 解析     │ │
│                               └────────────────────┘ │
└──────────────────────┬──────────────────────────────┘
          ┌────────────┴────────────┐
          ▼                         ▼
┌─────────────────┐       ┌─────────────────────────┐
│     Neo4j        │       │      PostgreSQL           │
│  知识图谱数据    │       │  用户、模板、配置、日志   │
│  节点 + 关系     │       │                          │
└─────────────────┘       └─────────────────────────┘
```

### 2.2 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | React 18 + TypeScript | 主框架 |
| 图可视化 | React Flow | 节点拖拽、连线、画布编辑 |
| UI 组件 | Tailwind CSS + shadcn/ui | 样式系统 |
| 后端 | Node.js + Express + TypeScript | API 服务 |
| 图数据库 | Neo4j 5.x | 知识图谱存储 |
| 关系数据库 | PostgreSQL | 用户/模板/配置 |
| AI 接口 | OpenAI 兼容接口 | 可配置 endpoint，支持 GPT/Claude/国产模型 |
| 认证 | JWT | 无状态认证 |
| 部署 | Docker Compose | 本地开发，后续可迁云 |

---

## 三、数据模型

### 3.1 Neo4j 节点模型

所有节点共享基础字段，不同类型节点有专属扩展字段。

#### 基础字段（所有节点共有）

```json
{
  "node_id": "KP_BN_IV_007",
  "node_type": "knowledge_point",
  "name": "输液外渗的识别与处理",
  "status": "approved",
  "confidence": 0.88,
  "source": "ai_generated",
  "description": "...",
  "tags": [],
  "created_at": "2026-05-17T10:00:00Z",
  "updated_at": "2026-05-17T10:00:00Z",
  "created_by": "user_id"
}
```

#### 节点类型枚举

| node_type | 中文名 | 专属字段 |
|-----------|--------|---------|
| `textbook` | 教材 | `edition`, `publisher`, `publish_year` |
| `chapter` | 章 | `chapter_no`, `page_range` |
| `section` | 节 | `section_no` |
| `knowledge_point` | 知识点 | `textbook`, `edition`, `chapter`, `section`, `page_no`, `knowledge_type`, `difficulty`, `importance` |
| `term` | 术语/概念 | `standard_term`, `aliases[]`, `english`, `category` |
| `operation_step` | 操作步骤 | `step_order`, `phase` |
| `competency` | 能力点 | `competency_level`, `domain` |
| `image` | 图片 | `oss_key`, `caption`, `visual_summary`, `page_no`, `bbox` |
| `table` | 表格 | `table_title`, `html`, `markdown`, `summary` |
| `question` | 题目 | `question_type`, `difficulty`, `exam_scene`, `cognitive_level` |
| `case` | 病例 | `case_type`, `scene`, `symptoms[]`, `teaching_objectives[]` |

#### knowledge_type 枚举（知识点专用）

`概念类` | `目的类` | `适应证类` | `禁忌证类` | `操作流程类` | `操作要点类` | `注意事项类` | `异常处理类` | `并发症类` | `观察护理类` | `健康教育类` | `考点类`

#### difficulty 枚举

`基础` | `中等` | `较难`

#### importance 枚举

`高频考点` | `重点掌握` | `一般了解`

#### competency_level 枚举

`核心能力` | `基础能力` | `支持能力`

### 3.2 Neo4j 关系模型

```cypher
// 层级关系
(chapter)-[:CONTAINS]->(section)
(section)-[:CONTAINS]->(knowledge_point)
(knowledge_point)-[:BELONGS_TO]->(chapter)

// 知识关联
(kp1)-[:PREREQUISITE_OF]->(kp2)          // 前置知识
(kp1)-[:EASILY_CONFUSED_WITH]->(kp2)     // 易混淆
(kp1)-[:RELATED_TO]->(kp2)               // 相关

// 资源关联
(kp)-[:ILLUSTRATED_BY]->(image)          // 图示说明
(kp)-[:DESCRIBED_IN]->(table)            // 表格描述
(kp)-[:TESTED_BY]->(question)            // 被题目考查
(kp)-[:APPLIED_IN]->(case)               // 应用于病例

// 术语关联
(term)-[:STANDARD_TERM_OF]->(kp)         // 标准术语对应
(term)-[:SYNONYM_OF]->(term)             // 同义词

// 能力关联
(kp)-[:SUPPORTS_COMPETENCY]->(competency) // 支撑能力点

// 多图谱归属（支持跨图谱关联）
(node)-[:BELONGS_TO_GRAPH]->(graph)
(graph1)-[:MERGED_INTO]->(graph2)
(graph1)-[:RELATED_GRAPH]->(graph2)
```

### 3.3 Graph（图谱）节点

```json
{
  "graph_id": "graph_001",
  "graph_name": "基础护理学知识图谱",
  "graph_type": "course",
  "subject": "护理学",
  "course_name": "基础护理学",
  "description": "...",
  "status": "active",
  "node_count": 0,
  "relation_count": 0,
  "created_by": "user_id",
  "created_at": "..."
}
```

graph_type 枚举：`course`（课程级）| `chapter`（章节级）| `subject`（专业级）| `custom`（自定义）

### 3.4 PostgreSQL 数据表

#### prompt_templates（提示词模板）

```sql
CREATE TABLE prompt_templates (
  id          UUID PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  variables   JSONB,          -- 变量定义数组
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  output_schema JSONB,        -- LLM 输出的 JSON Schema
  is_active   BOOLEAN DEFAULT true,
  created_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### users（用户）

```sql
CREATE TABLE users (
  id       UUID PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email    VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role     VARCHAR(20) DEFAULT 'operator', -- admin | expert | operator | ai_service
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### ai_generation_logs（AI 生成日志）

```sql
CREATE TABLE ai_generation_logs (
  id           UUID PRIMARY KEY,
  graph_id     VARCHAR(50),
  template_id  UUID,
  user_id      UUID,
  prompt_used  TEXT,
  llm_response TEXT,
  nodes_created INT DEFAULT 0,
  relations_created INT DEFAULT 0,
  status       VARCHAR(20), -- success | failed | partial
  error_msg    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 四、提示词模板设计

### 4.1 模板变量系统

管理员在模板中定义变量占位符 `{{variable_name}}`，用户填写后系统自动拼装完整 Prompt。

```json
{
  "template_name": "医学课程章节知识图谱",
  "variables": [
    {
      "key": "course_name",
      "label": "课程名称",
      "type": "text",
      "placeholder": "如：基础护理学",
      "required": true
    },
    {
      "key": "chapter_name",
      "label": "章节名称",
      "type": "text",
      "placeholder": "如：静脉输液与输血",
      "required": true
    },
    {
      "key": "depth",
      "label": "图谱详细程度",
      "type": "select",
      "options": ["基础（仅核心知识点）", "标准（含操作步骤和术语）", "详细（含能力点、易混淆关系）"],
      "default": "标准",
      "required": true
    }
  ]
}
```

### 4.2 系统提示词（内置图谱 Schema）

```
你是一个医学教育知识图谱构建专家。你的任务是根据用户提供的课程和章节信息，构建结构化的知识图谱数据。

【节点类型规范】
- knowledge_point：知识点，必须包含 knowledge_type 字段
  knowledge_type 可选值：概念类|目的类|适应证类|禁忌证类|操作流程类|操作要点类|注意事项类|异常处理类|并发症类|观察护理类|健康教育类|考点类
- term：术语，必须包含 standard_term 和 aliases 数组
- operation_step：操作步骤，必须包含 step_order 和 phase
- competency：能力点，必须包含 competency_level 和 domain
- image：图片描述（虚拟节点，描述教材中应有的图示）
- table：表格描述（虚拟节点，描述教材中应有的表格）

【关系类型规范】
CONTAINS | BELONGS_TO | PREREQUISITE_OF | EASILY_CONFUSED_WITH | RELATED_TO |
ILLUSTRATED_BY | DESCRIBED_IN | TESTED_BY | APPLIED_IN | SUPPORTS_COMPETENCY | STANDARD_TERM_OF

【输出格式要求】
严格按以下 JSON 格式返回，不要包含任何其他文字：
{
  "graph_name": "...",
  "nodes": [
    {
      "node_id": "唯一ID，格式如 KP_001",
      "node_type": "knowledge_point",
      "name": "节点名称",
      "description": "简要描述",
      "knowledge_type": "异常处理类",
      "difficulty": "中等",
      "importance": "高频考点",
      "tags": [],
      "confidence": 0.9
    }
  ],
  "relations": [
    {
      "source_id": "KP_001",
      "target_id": "KP_002",
      "relation_type": "PREREQUISITE_OF",
      "description": "关系说明",
      "confidence": 0.85
    }
  ]
}
```

### 4.3 用户提示词模板示例

```
请为《{{course_name}}》中的「{{chapter_name}}」章节构建知识图谱。

详细程度要求：{{depth}}

要求：
1. 覆盖该章节所有核心知识点
2. 识别知识点之间的前置关系、易混淆关系
3. 提取重要术语及其同义词
4. 标注高频考点
5. 每个节点的 confidence 字段反映你对该节点准确性的置信度（0-1）
```

---

## 五、核心 API 设计

### 5.1 图谱管理

```
GET    /api/graphs                    # 图谱列表
POST   /api/graphs                    # 创建图谱
GET    /api/graphs/:id                # 图谱详情（含节点和关系）
PUT    /api/graphs/:id                # 更新图谱基本信息
DELETE /api/graphs/:id                # 删除图谱

POST   /api/graphs/:id/merge          # 合并图谱
POST   /api/graphs/:id/export         # 导出图谱（JSON/CSV）
```

### 5.2 节点管理

```
GET    /api/graphs/:id/nodes          # 节点列表（支持筛选）
POST   /api/graphs/:id/nodes          # 创建节点
PUT    /api/nodes/:nodeId             # 更新节点
DELETE /api/nodes/:nodeId             # 删除节点
POST   /api/nodes/batch-approve       # 批量审核通过
```

### 5.3 关系管理

```
GET    /api/graphs/:id/relations      # 关系列表
POST   /api/graphs/:id/relations      # 创建关系
PUT    /api/relations/:relId          # 更新关系
DELETE /api/relations/:relId          # 删除关系
```

### 5.4 AI 生成

```
GET    /api/templates                 # 模板列表
POST   /api/templates                 # 创建模板（管理员）
PUT    /api/templates/:id             # 更新模板（管理员）

POST   /api/ai/generate               # 触发 AI 生成图谱
  Body: { template_id, variables, graph_id? }
  Response: { job_id, status: "pending" }

GET    /api/ai/jobs/:jobId            # 查询生成状态
  Response: { status, nodes, relations, graph_id }

POST   /api/ai/jobs/:jobId/approve-all  # 一键全部确认
POST   /api/ai/jobs/:jobId/approve      # 逐条确认
  Body: { node_ids[], relation_ids[] }
```

### 5.5 用户与权限

```
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/users                     # 用户列表（管理员）
POST   /api/users                     # 创建用户（管理员）
PUT    /api/users/:id/role            # 修改角色（管理员）
```

---

## 六、前端界面设计

### 6.1 页面结构

```
/login                    登录页
/graphs                   图谱列表页
/graphs/:id/edit          图谱编辑器（主界面）
/graphs/:id/review        AI 生成审核页
/admin/templates          提示词模板管理（管理员）
/admin/users              用户管理（管理员）
/admin/settings           系统配置（LLM endpoint/key）
```

### 6.2 图谱编辑器布局

```
┌──────────────────────────────────────────────────────────────┐
│  顶部导航：[图谱名称] [保存] [导出] [图谱设置]  [用户头像]    │
├──────────────┬───────────────────────────┬───────────────────┤
│  左侧面板     │   中央画布（React Flow）   │  右侧属性面板      │
│  ─────────── │                           │  ───────────────  │
│  图谱列表     │   节点可视化              │  选中节点字段编辑  │
│  [切换图谱]   │   拖拽移动                │                   │
│              │   连线创建关系             │  节点类型          │
│  节点类型图例 │   右键菜单：              │  名称              │
│  ● 知识点    │   - 添加节点              │  描述              │
│  ● 术语      │   - 删除节点              │  知识类型          │
│  ● 操作步骤  │   - 编辑属性              │  难度/重要性       │
│  ● 能力点    │   - 连接到...             │  标签              │
│  ● 图片      │                           │  ─────────────    │
│  ● 表格      │   [缩放控件]              │  关联关系列表      │
│  ● 题目      │   [全屏]                  │  [+ 添加关系]      │
│  ● 病例      │   [布局重排]              │                   │
│              │                           │  [保存] [删除节点] │
├──────────────┴───────────────────────────┴───────────────────┤
│  底部 AI 生成面板                                              │
│  [选择模板 ▼]  [课程名称: ___]  [章节: ___]  [详细程度 ▼]    │
│  [🤖 AI 生成图谱]                                             │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 AI 生成审核界面

生成完成后，在编辑器内弹出审核面板：

```
┌─────────────────────────────────────────────────────┐
│  AI 生成结果  共 24 个节点，38 条关系                 │
│  [一键全部确认]  [逐条审核]  [全部丢弃]               │
├─────────────────────────────────────────────────────┤
│  节点预览（画布已显示，节点为橙色"待审核"状态）        │
│                                                     │
│  ✓ 静脉输液的概念        知识点  置信度 0.95         │
│  ✓ 静脉输液的目的        知识点  置信度 0.92         │
│  ✗ 输液外渗的识别与处理  知识点  置信度 0.88  [编辑]  │
│  ...                                                │
└─────────────────────────────────────────────────────┘
```

### 6.4 节点颜色规范

| 节点类型 | 颜色 |
|---------|------|
| 知识点 | 蓝色 `#3B82F6` |
| 术语 | 绿色 `#10B981` |
| 操作步骤 | 橙色 `#F59E0B` |
| 能力点 | 紫色 `#8B5CF6` |
| 图片 | 粉色 `#EC4899` |
| 表格 | 青色 `#06B6D4` |
| 题目 | 红色 `#EF4444` |
| 病例 | 棕色 `#92400E` |
| 待审核（candidate）| 灰色边框虚线 |

---

## 七、角色权限矩阵

| 功能 | 管理员 | 内容专家 | 内容运营 |
|------|--------|---------|---------|
| 创建/删除图谱 | ✓ | ✓ | ✗ |
| 编辑节点和关系 | ✓ | ✓ | ✗ |
| 审核 AI 生成内容 | ✓ | ✓ | ✗ |
| 查看/搜索图谱 | ✓ | ✓ | ✓ |
| 导出图谱 | ✓ | ✓ | ✓ |
| 管理提示词模板 | ✓ | ✗ | ✗ |
| 管理用户 | ✓ | ✗ | ✗ |
| 配置 LLM 接口 | ✓ | ✗ | ✗ |

---

## 八、多图谱关联设计

### 8.1 节点归属机制

节点不复制，通过 `BELONGS_TO_GRAPH` 关系归属多个图谱：

```cypher
(n:KnowledgePoint {node_id: "KP_IV_007"})
  -[:BELONGS_TO_GRAPH]-> (g1:Graph {graph_id: "graph_001"})
  -[:BELONGS_TO_GRAPH]-> (g3:Graph {graph_id: "graph_003"})
```

### 8.2 跨图谱操作

- **关联**：在两个图谱的节点间创建跨图谱关系边，前端支持跨图谱拖线
- **合并**：创建新专业图谱节点，将两个课程图谱节点关联进来，AI 推荐跨课程候选关系
- **拆分**：按条件筛选节点，创建新图谱并建立归属关系

### 8.3 前端多图谱视图

画布顶部增加图谱叠加控件：

```
[视图模式: 单图谱 ▼]  [基础护理学 ✓] [解剖学 ✓] [合并视图]
```

不同图谱节点用颜色区分，跨图谱关系用虚线显示。

---

## 九、MVP 开发范围

### 包含（MVP）

- 用户登录/权限（3 个角色）
- 图谱 CRUD
- 节点和关系的可视化编辑（React Flow）
- 提示词模板管理（管理员）
- AI 生成图谱（调用 OpenAI 兼容接口）
- 生成结果审核（逐条 + 一键确认）
- 节点属性面板编辑
- 图谱导出（JSON）
- Docker Compose 本地部署

### 不包含（后续扩展）

- 教材 PDF 解析（MinerU 集成）
- RAG 知识库对接
- 题库/病例关联
- 多图谱合并/拆分 UI
- 学情分析
- 版本历史/回滚

---

## 十、目录结构

```
medical-knowledge-graph/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── GraphEditor/        # React Flow 编辑器
│   │   │   ├── NodePanel/          # 右侧属性面板
│   │   │   ├── AIGeneratePanel/    # AI 生成面板
│   │   │   ├── ReviewPanel/        # 审核面板
│   │   │   └── TemplateManager/    # 模板管理
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── api/                    # API 调用层
│   │   └── types/                  # TypeScript 类型定义
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── graphs.ts
│   │   │   ├── nodes.ts
│   │   │   ├── relations.ts
│   │   │   ├── ai.ts
│   │   │   ├── templates.ts
│   │   │   └── auth.ts
│   │   ├── services/
│   │   │   ├── neo4j.service.ts    # Neo4j 操作
│   │   │   ├── llm.service.ts      # LLM 调用
│   │   │   ├── template.service.ts # 提示词拼装
│   │   │   └── graph.service.ts    # 图谱业务逻辑
│   │   ├── middleware/
│   │   │   └── auth.ts
│   │   └── types/
│   └── package.json
├── docker-compose.yml
└── docs/
    └── plans/
        └── 2026-05-17-medical-knowledge-graph-design.md
```

---

## 十一、Docker Compose 配置

```yaml
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend

  backend:
    build: ./backend
    ports:
      - "4000:4000"
    environment:
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=password
      - POSTGRES_URL=postgresql://postgres:password@postgres:5432/knowledge_graph
      - JWT_SECRET=your-secret-key
      - LLM_BASE_URL=https://api.openai.com/v1
      - LLM_API_KEY=your-api-key
    depends_on:
      - neo4j
      - postgres

  neo4j:
    image: neo4j:5
    ports:
      - "7474:7474"
      - "7687:7687"
    environment:
      - NEO4J_AUTH=neo4j/password
    volumes:
      - neo4j_data:/data

  postgres:
    image: postgres:16
    environment:
      - POSTGRES_DB=knowledge_graph
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  neo4j_data:
  postgres_data:
```
