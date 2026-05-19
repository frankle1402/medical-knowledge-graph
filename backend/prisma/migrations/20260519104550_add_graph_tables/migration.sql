-- CreateTable
CREATE TABLE "graphs" (
    "graph_id" VARCHAR(50) NOT NULL,
    "graph_name" VARCHAR(100) NOT NULL,
    "graph_type" VARCHAR(40) NOT NULL,
    "subject" VARCHAR(50),
    "course_name" VARCHAR(100),
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "graphs_pkey" PRIMARY KEY ("graph_id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "node_id" VARCHAR(80) NOT NULL,
    "graph_id" VARCHAR(50) NOT NULL,
    "node_type" VARCHAR(40) NOT NULL,
    "knowledge_type" VARCHAR(40),
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'approved',
    "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "ai_job_id" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "relations" (
    "relation_id" BIGSERIAL NOT NULL,
    "graph_id" VARCHAR(50) NOT NULL,
    "source_id" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(80) NOT NULL,
    "relation_type" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'approved',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "description" TEXT,
    "ai_job_id" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "relations_pkey" PRIMARY KEY ("relation_id")
);

-- CreateIndex
CREATE INDEX "nodes_graph_id_idx" ON "nodes"("graph_id");

-- CreateIndex
CREATE INDEX "nodes_graph_id_status_idx" ON "nodes"("graph_id", "status");

-- CreateIndex
CREATE INDEX "nodes_ai_job_id_idx" ON "nodes"("ai_job_id");

-- CreateIndex
CREATE INDEX "relations_graph_id_idx" ON "relations"("graph_id");

-- CreateIndex
CREATE INDEX "relations_source_id_idx" ON "relations"("source_id");

-- CreateIndex
CREATE INDEX "relations_target_id_idx" ON "relations"("target_id");

-- CreateIndex
CREATE UNIQUE INDEX "relations_source_id_target_id_relation_type_key" ON "relations"("source_id", "target_id", "relation_type");

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_graph_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("graph_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relations" ADD CONSTRAINT "relations_graph_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("graph_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relations" ADD CONSTRAINT "relations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "nodes"("node_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relations" ADD CONSTRAINT "relations_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "nodes"("node_id") ON DELETE CASCADE ON UPDATE CASCADE;
