/*
  Warnings:

  - You are about to drop the column `data` on the `EngineSnapshot` table. All the data in the column will be lost.
  - Added the required column `balances` to the `EngineSnapshot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `open_orders` to the `EngineSnapshot` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."EngineSnapshot" DROP COLUMN "data",
ADD COLUMN     "balances" JSONB NOT NULL,
ADD COLUMN     "open_orders" JSONB NOT NULL;
