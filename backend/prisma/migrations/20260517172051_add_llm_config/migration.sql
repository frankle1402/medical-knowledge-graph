-- CreateTable
CREATE TABLE "llm_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "base_url" TEXT,
    "api_key" TEXT,
    "model" TEXT,
    "timeout_ms" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "llm_config_pkey" PRIMARY KEY ("id")
);
