CREATE TABLE "workspaces" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspaces_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "units" DROP CONSTRAINT "units_position_unique";--> statement-breakpoint
ALTER TABLE "units" DROP CONSTRAINT "units_book_number_unique";--> statement-breakpoint
DROP INDEX "units_book_idx";--> statement-breakpoint
-- Дописано вручную: колонка сначала без NOT NULL — существующие юниты уходят в первую область.
ALTER TABLE "units" ADD COLUMN "workspace_id" bigint;--> statement-breakpoint
INSERT INTO "workspaces" ("name") VALUES ('Grammar In Use');--> statement-breakpoint
UPDATE "units" SET "workspace_id" = (SELECT min("id") FROM "workspaces");--> statement-breakpoint
ALTER TABLE "units" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "units_workspace_book_idx" ON "units" USING btree ("workspace_id","book");--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_workspace_position_unique" UNIQUE("workspace_id","position");--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_workspace_book_number_unique" UNIQUE("workspace_id","book","number");--> statement-breakpoint
-- Дописано вручную: drizzle-kit не генерирует триггеры и RLS.
CREATE TRIGGER workspaces_touch BEFORE UPDATE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
