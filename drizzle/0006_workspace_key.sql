-- Дописано вручную: колонка сначала без NOT NULL — существующей области ключ ставится по id.
ALTER TABLE "workspaces" ADD COLUMN "key" text;--> statement-breakpoint
UPDATE "workspaces" SET "key" = 'grammar-in-use' WHERE "id" = 1;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_key_unique" UNIQUE("key");
