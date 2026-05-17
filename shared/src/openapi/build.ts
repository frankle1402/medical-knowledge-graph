// Agent-F：OpenAPI YAML 生成器
//
// 当前输出到 stdout，被 npm script 重定向至 `shared/dist/openapi.yaml`
// （见 shared/package.json 的 `openapi:gen`）。
//
// TODO: 待 Agent-A 建好 backend 工作区后，把脚本输出目标改为
// `../backend/openapi.yaml`，配合 Agent-A `/api/docs` 渲染 Swagger UI。
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import yaml from 'yaml';
import { registry } from './registry.js';

const generator = new OpenApiGeneratorV31(registry.definitions);
const doc = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: '医学知识图谱 API',
    version: '0.1.0',
    description: '由 @mkg/shared 自动生成，请勿手工修改。',
  },
  servers: [{ url: 'http://localhost:4000' }],
});

process.stdout.write(yaml.stringify(doc));
