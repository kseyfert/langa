CREATE TABLE "units" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "units_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"book" text NOT NULL,
	"section" text NOT NULL,
	"number" integer,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"summary_ru" text DEFAULT '' NOT NULL,
	"guide" text DEFAULT '' NOT NULL,
	"builds_on" bigint[] DEFAULT '{}' NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_position_unique" UNIQUE("position"),
	CONSTRAINT "units_book_number_unique" UNIQUE("book","number")
);
--> statement-breakpoint
CREATE INDEX "units_book_idx" ON "units" USING btree ("book");--> statement-breakpoint
-- Дописано вручную: drizzle-kit не генерирует триггеры и RLS.
-- updated_at при любой правке, в том числе из Table Editor.
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER units_touch BEFORE UPDATE ON public.units
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint
-- Каталог читает только сервер: без политик anon/authenticated через API Supabase не видят ничего.
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
