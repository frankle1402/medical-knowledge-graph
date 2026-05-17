# 本地开发环境安装指南（Windows / 云电脑）

## 1. Node.js 20 LTS

下载安装：<https://nodejs.org/>。安装后验证：

```powershell
node -v   # v20.x
npm -v    # 10.x
```

## 2. PostgreSQL 16

下载 EnterpriseDB 的 Windows 安装包：
<https://www.postgresql.org/download/windows/>

安装时设置：

- 用户：`postgres`
- 密码：`postgres`（与 `.env.example` 一致；如改请同步改 `.env`）
- 端口：`5432`

安装完成后建库：

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE knowledge_graph;"
```

## 3. Neo4j 5 Community

推荐 Neo4j Desktop（带图形管理）：
<https://neo4j.com/download/>

或 Server 版直接解压。启动后：

- Bolt：`bolt://localhost:7687`
- Browser：<http://localhost:7474>
- 首次登录用 `neo4j/neo4j`，按提示改成 `.env` 里的 `NEO4J_PASSWORD`。

## 4. （可选）pgAdmin

便于查看 Postgres 数据：<https://www.pgadmin.org/>

## 5. 验证

```powershell
psql -h localhost -U postgres -d knowledge_graph -c "SELECT 1;"
```

```powershell
# Cypher Shell（Neo4j 自带）
cypher-shell -u neo4j -p neo4j-password "RETURN 1;"
```

两条都能返回 `1` 即环境就绪。
