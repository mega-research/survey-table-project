-- 0156: 이력 칸에 남은 옛 Supabase Auth 계정 id 를 앱 users 로 잇는다. (2026-11-09)
--
-- **배열에서 0121 앞에 선다.** 0121 이 `contact_attempts.created_by` 에 `public.users` FK 를 거는데,
-- 운영에는 그 칸에 옛 Supabase Auth(`auth.users`) id 가 401행 있다(관리자 110 · 외주 게스트
-- from@ 291 — 2026-11-09 운영 데이터 리허설 실측). 0121 머리말의 「기존 값 0건」은 로컬·스테이징
-- 에서만 참이었다. 이 파일 없이 0121 을 적용하면 FK 생성이 실패한다.
--
-- 같은 옛 id 는 FK 없는 이력 칸에도 남아 있다 — 응답 수정 이력 · 메일 캠페인 · 대상 정보 수정
-- 이력 · 응답 이관 이력 · 메일 정산 기간 · `surveys.user_id`(실측 약 1,400행). 막지는 않지만 그대로
-- 두면 이력 화면이 작성자를 찾지 못한다. 그래서 0121 의 두 칸만이 아니라 **이 칸들을 함께** 잇는다.
--
-- ## 잇는 규칙 — 옛 id 하나마다
--
-- 1. 같은 이메일의 `public.users` 행이 있으면(Better Auth 선반영 때 같은 사람이 새 id 로 들어온
--    경우 — 운영의 관리자) **그 id 로 바꿔 쓴다.**
-- 2. 없으면 **같은 id 로 로그인할 수 없는 계정 행을 만든다** — `status='departed'`·`user_type='guest'`,
--    `accounts` 행이 없어 비밀번호가 없다. 옛 게스트 계정(guest1~10 · from@ · prime@ · dairy@)이
--    여기 해당하고, 행이 있어야 이력이 「from」과 「prime」을 계속 갈라 보인다. departed 라
--    capability 코어와 세션 둘 다 막는다.
--
-- 대상은 **이 칸들에서 실제로 참조되는 옛 id 만**이다 — 쓰이지 않은 옛 계정까지 행을 만들면 그 이메일로
-- 새 계정을 발급할 때 유일 인덱스에 걸린다.
--
-- ## 빈 DB 재생
--
-- 재생 DB 의 `auth.users` 는 id 하나뿐인 스텁이라 이메일 칸이 없다. 칸이 없으면 규칙 1 은 건너뛰고
-- (같은 사람인지 알 수 없다), 참조된 옛 id 가 애초에 없으므로 아무 일도 하지 않는다.
-- 재적용도 안전하다 — 두 번째에는 바꿀 옛 id 가 남아 있지 않다.
--
-- ## 순서
--
-- 기존 `contact_attempts_created_by_fkey` 가 `auth.users` 를 가리키므로 관리자 id 를 바꿔 쓰기 전에
-- 내린다(새 id 는 auth.users 에 없다). 0121 이 같은 이름으로 `public.users` FK 를 다시 건다.

BEGIN;

-- auth.users 를 가리킬 때만 내린다 — 0121 을 이미 지난 DB(스테이징)에 다시 적용해도 public.users FK 는 남는다
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_attempts_created_by_fkey'
      AND conrelid = 'public.contact_attempts'::regclass
      AND confrelid = to_regclass('auth.users')
  ) THEN
    ALTER TABLE contact_attempts DROP CONSTRAINT contact_attempts_created_by_fkey;
  END IF;
END $$;

DO $$
DECLARE
  has_email boolean;
  col record;
  legacy record;
  target uuid;
  cols constant text[][] := ARRAY[
    ['contact_attempts', 'created_by'],
    ['contact_uploads', 'uploaded_by'],
    ['response_edit_logs', 'edited_by'],
    ['mail_campaigns', 'created_by'],
    ['mail_billing_periods', 'created_by'],
    ['response_migration_history', 'edited_by'],
    ['contact_target_edit_logs', 'edited_by'],
    ['surveys', 'user_id']
  ];
  pair text[];
  refs text := '';
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email'
  ) INTO has_email;

  -- 참조된 옛 id 집합 — 칸마다 text 로 접어 합친다(칸 타입이 uuid·text 로 섞여 있다)
  FOREACH pair SLICE 1 IN ARRAY cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = pair[1] AND column_name = pair[2]
    ) THEN
      refs := refs || CASE WHEN refs = '' THEN '' ELSE ' UNION ' END
        || format('SELECT %I::text AS v FROM public.%I WHERE %I IS NOT NULL', pair[2], pair[1], pair[2]);
    END IF;
  END LOOP;

  IF refs = '' THEN
    RETURN;
  END IF;

  FOR legacy IN EXECUTE format(
    'SELECT a.id, %s AS email
     FROM auth.users a
     WHERE a.id::text IN (%s)
       AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.id)
     ORDER BY a.id',
    CASE WHEN has_email THEN 'a.email::text' ELSE 'NULL::text' END,
    refs
  ) LOOP
    target := NULL;

    IF legacy.email IS NOT NULL THEN
      SELECT u.id INTO target FROM public.users u WHERE lower(u.email) = lower(legacy.email);
    END IF;

    IF target IS NULL THEN
      IF legacy.email IS NULL THEN
        -- 이메일을 알 수 없으면 행을 만들 수 없다(users.email NOT NULL) — 0121 이 그 행에서 멈춰 알린다
        RAISE WARNING '0156: 옛 계정 % 의 이메일을 몰라 잇지 못했다', legacy.id;
        CONTINUE;
      END IF;
      INSERT INTO public.users (id, name, email, email_verified, status, user_type)
      VALUES (legacy.id, split_part(legacy.email, '@', 1), legacy.email, true, 'departed', 'guest');
      CONTINUE;
    END IF;

    FOREACH pair SLICE 1 IN ARRAY cols LOOP
      SELECT data_type INTO col FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = pair[1] AND column_name = pair[2];
      IF FOUND THEN
        EXECUTE format(
          'UPDATE public.%I SET %I = $1::text::%s WHERE %I::text = $2::text',
          pair[1], pair[2], col.data_type, pair[2]
        ) USING target, legacy.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
