CREATE TABLE "response_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"text_value" text,
	"array_value" jsonb,
	"object_value" jsonb,
	"question_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_note" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "survey_responses" ADD COLUMN "version_id" uuid;--> statement-breakpoint
ALTER TABLE "surveys" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "surveys" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
ALTER TABLE "surveys" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "response_answers" ADD CONSTRAINT "response_answers_response_id_survey_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_versions" ADD CONSTRAINT "survey_versions_survey_id_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 인덱스: survey_versions
CREATE INDEX "idx_survey_versions_survey_id" ON "survey_versions" ("survey_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_survey_versions_survey_version" ON "survey_versions" ("survey_id", "version_number");--> statement-breakpoint
-- 인덱스: response_answers
CREATE INDEX "idx_response_answers_response_id" ON "response_answers" ("response_id");--> statement-breakpoint
CREATE INDEX "idx_response_answers_question_id" ON "response_answers" ("question_id");--> statement-breakpoint
CREATE INDEX "idx_response_answers_response_question" ON "response_answers" ("response_id", "question_id");--> statement-breakpoint
-- 인덱스: 기존 테이블 (성능 개선)
CREATE INDEX "idx_surveys_status" ON "surveys" ("status");--> statement-breakpoint
CREATE INDEX "idx_survey_responses_survey_id" ON "survey_responses" ("survey_id");--> statement-breakpoint
CREATE INDEX "idx_survey_responses_completed" ON "survey_responses" ("survey_id", "is_completed");--> statement-breakpoint
CREATE INDEX "idx_survey_responses_version_id" ON "survey_responses" ("version_id");--> statement-breakpoint
CREATE INDEX "idx_questions_survey_id" ON "questions" ("survey_id");--> statement-breakpoint
CREATE INDEX "idx_questions_survey_order" ON "questions" ("survey_id", "order");--> statement-breakpoint
CREATE INDEX "idx_question_groups_survey_id" ON "question_groups" ("survey_id");

-- 2026-08-19 재생 가능성 수선: 아래는 push 시대의 누락·환경 차이를 메우는 보정이다.
-- 프로덕션은 이미 적용된 상태라 재실행되지 않으며, 빈 DB 에서 이 파일이 통과하도록 만드는 것이 목적이다.
-- 아래 컬럼들은 프로덕션에 push 로 들어와 어떤 마이그레이션도 만들지 않았다. 뒤쪽
-- 마이그레이션들이 이들을 전제하므로(0026·0028·0038·0040·0057·0076) 첫 소비자보다 앞선
-- 이 지점에 모아 복구한다. 정의는 2026-08-19 프로덕션 information_schema 조회 그대로다.
-- 프로덕션에는 이미 존재하므로 재실행 시 무해하다.
ALTER TABLE "survey_responses" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
ALTER TABLE "survey_responses" ADD COLUMN IF NOT EXISTS "ip_hash" text;
ALTER TABLE "survey_responses" ADD COLUMN IF NOT EXISTS "fp_hash" text;
ALTER TABLE "survey_responses" ADD COLUMN IF NOT EXISTS "device_id" text;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "contact_email" text;