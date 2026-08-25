-- 0084: Better Auth 인증 테이블 4종(users/sessions/accounts/verifications) + 계정 상태
--       감사 테이블(user_status_events) 생성. (2026-08-25)
--
-- 프로덕션·스테이징 DB 에는 이 5테이블이 **선반영**돼 있다(2026-07-14, 참조 워크트리
-- 0048 과 동일 내용 — 2026-08-25 실측 대조 완료: 컬럼·기본값·FK·인덱스·RLS 일치).
-- 따라서 이 파일은 프로덕션·스테이징에 적용하지 않는다 — 빈 DB 재생(pnpm db:setup-test)과
-- 신규 환경 부트스트랩 전용이다. 선반영분과 어댑터 기대의 차이는 0085 가 해소한다.
--
-- id 는 Better Auth 설정(advanced.database.generateId)이 crypto.randomUUID() 로 생성해
-- 삽입하므로 DB default 가 없다. 시드 스크립트도 동일하게 UUID 를 직접 넣는다.
--
-- RLS: 0035 하우스 룰 — 신규 public 테이블은 같은 마이그레이션에서 ENABLE (정책 없이
-- anon/authenticated deny, 앱은 BYPASSRLS 인 postgres 롤로만 접근). 특히 accounts 는
-- 비밀번호 해시, sessions 는 세션 토큰을 보유한다. anon/authenticated REVOKE 는 0037 의
-- 기본 권한 설정이 이미 막지만 belt-and-suspenders 로 명시한다(무권한 상태에선 no-op).

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_superadmin" boolean DEFAULT false NOT NULL,
	"job_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_status_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"changed_by" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_status_events" ADD CONSTRAINT "user_status_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_status_events" ADD CONSTRAINT "user_status_events_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" ("user_id");--> statement-breakpoint
CREATE INDEX "user_status_events_user_id_idx" ON "user_status_events" ("user_id");--> statement-breakpoint
CREATE INDEX "user_status_events_changed_by_idx" ON "user_status_events" ("changed_by");
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_status_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "users", "sessions", "accounts", "verifications", "user_status_events" FROM anon, authenticated;
