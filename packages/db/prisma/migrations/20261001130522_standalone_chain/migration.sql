/*
  Warnings:

  - Added the required column `prompt` to the `skin_render_jobs` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RenderJobKind" AS ENUM ('RENDER', 'FINALIZE');

-- AlterTable
ALTER TABLE "skin_render_jobs" ADD COLUMN     "kind" "RenderJobKind" NOT NULL DEFAULT 'RENDER',
ADD COLUMN     "prompt" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "skin_finalized_skins" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "arm_model" "ArmModel" NOT NULL,
    "second_layer" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skin_finalized_skins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skin_idempotency_records" (
    "id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skin_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skin_finalized_skins_conversation_id_key" ON "skin_finalized_skins"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "skin_idempotency_operation_key_key" ON "skin_idempotency_records"("operation", "key");

-- AddForeignKey
ALTER TABLE "skin_finalized_skins" ADD CONSTRAINT "skin_finalized_skins_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "skin_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
