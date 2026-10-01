-- CreateEnum
CREATE TYPE "SkinConversationStatus" AS ENUM ('ACTIVE', 'FINALIZING', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RenderJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ArmModel" AS ENUM ('STEVE', 'ALEX');

-- CreateEnum
CREATE TYPE "ConversationMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateTable
CREATE TABLE "skin_conversations" (
    "id" UUID NOT NULL,
    "status" "SkinConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "attempts_used" INTEGER NOT NULL DEFAULT 0,
    "attempts_limit" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "skin_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skin_conversation_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "ConversationMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skin_conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skin_render_jobs" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "RenderJobStatus" NOT NULL DEFAULT 'QUEUED',
    "arm_model" "ArmModel" NOT NULL,
    "provider_call_id" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "skin_render_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skin_candidates" (
    "id" UUID NOT NULL,
    "render_job_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "arm_model" "ArmModel" NOT NULL,
    "second_layer" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "skin_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skin_conversation_messages_conversation_idx" ON "skin_conversation_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "skin_render_jobs_conversation_idx" ON "skin_render_jobs"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "skin_render_jobs_conversation_attempt_key" ON "skin_render_jobs"("conversation_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "skin_candidates_render_job_id_key" ON "skin_candidates"("render_job_id");

-- CreateIndex
CREATE INDEX "skin_candidates_expires_idx" ON "skin_candidates"("expires_at");

-- AddForeignKey
ALTER TABLE "skin_conversation_messages" ADD CONSTRAINT "skin_conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "skin_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skin_render_jobs" ADD CONSTRAINT "skin_render_jobs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "skin_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skin_candidates" ADD CONSTRAINT "skin_candidates_render_job_id_fkey" FOREIGN KEY ("render_job_id") REFERENCES "skin_render_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
