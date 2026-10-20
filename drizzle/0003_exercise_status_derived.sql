ALTER TABLE "exercises" DROP CONSTRAINT "exercises_status_check";--> statement-breakpoint
ALTER TABLE "exercises" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "exercises" DROP COLUMN "target_score";--> statement-breakpoint
ALTER TABLE "exercises" DROP COLUMN "finished_at";