CREATE TABLE "exercise_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exercise_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"exercise_id" bigint NOT NULL,
	"seq" integer NOT NULL,
	"answer" jsonb NOT NULL,
	"evaluation" jsonb NOT NULL,
	"verdict" text,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_attempts_exercise_id_seq_unique" UNIQUE("exercise_id","seq"),
	CONSTRAINT "exercise_attempts_verdict_check" CHECK ("exercise_attempts"."verdict" in ('correct_target', 'correct_non_target', 'incorrect'))
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exercises_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"unit_id" bigint NOT NULL,
	"type" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" text,
	"target_score" integer,
	"topic" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "exercises_type_check" CHECK ("exercises"."type" in ('gap', 'choice', 'rephrase', 'translate', 'free')),
	CONSTRAINT "exercises_status_check" CHECK ("exercises"."status" in ('accepted', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercises_unit_created_idx" ON "exercises" USING btree ("unit_id","created_at");--> statement-breakpoint
-- Дописано вручную: drizzle-kit не генерирует RLS. Читает и пишет только сервер.
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.exercise_attempts ENABLE ROW LEVEL SECURITY;
