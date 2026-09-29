-- 0127: 외주 실사 링크 귀속 — 이 회차·이 응답을 어느 링크가 넣었는가. (2026-09-29, ADR-0026)
--
-- 0126 이 「귀속 칸은 이 마이그레이션에 없다」로 미뤄 둔 자리다. 외주에게는 계정이 없으므로
-- 기존 계정 칸(`contact_attempts.created_by`·`survey_responses.fieldwork_user_id`)에 채울
-- 값이 없다 — 억지로 채우면 남의 이름으로 기록이 남는다. 그래서 **옆 칸을 하나씩** 둔다.
--
-- **NULL 이 기본이고 그것이 「링크가 아닌 경로」다.** 응답의 절대다수는 응답자 직접 입력이고
-- 회차의 대부분은 연구원·사내 실사원이 남긴다. NULL 이 그 사실을 말한다.
--
-- **배타 CHECK** — 계정 칸과 링크 칸 중 최대 하나만 채워진다. 한 행 안의 조건이라 DB 가
-- 강제할 수 있다(`survey_participants.kind` 를 CHECK 로 못 걸었던 것과 갈리는 지점: 저쪽은
-- 두 테이블에 걸친 조건이었다). 둘 다 채운 행이 생기면 「누가 넣었는가」에 답이 둘이 되고,
-- 그때는 이미 어느 쪽이 참인지 알 방법이 없다 — 그래서 서비스 가드가 아니라 제약이다.
--
-- **RESTRICT 인 이유는 형제 감사 컬럼들과 같다.** 기록이 남은 링크는 하드 삭제되지 않는다 —
-- 0126 이 종료를 `closed_at` 전환으로 둔 것이 이 제약을 내다본 결정이고, 그 결정을 되돌리면
-- 「종료했더니 지난 회차의 기록자가 끊긴다」가 된다.
--
-- 인덱스는 **부분 인덱스**다. 이 컬럼을 조건으로 거는 질문은 언제나 「그 링크가 넣은 것」
-- 쪽이고 전체 행의 대부분은 NULL 이라 색인에 담을 이유가 없다.
--
-- 멱등 (IF NOT EXISTS / DO 블록) — 빈 DB 재생과 재적용 양쪽 안전.

BEGIN;

-- ── 결과코드 회차 ────────────────────────────────────────────────────────────

ALTER TABLE contact_attempts
  ADD COLUMN IF NOT EXISTS fieldwork_link_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_attempts_fieldwork_link_id_fkey'
      AND conrelid = 'contact_attempts'::regclass
  ) THEN
    ALTER TABLE contact_attempts ADD CONSTRAINT contact_attempts_fieldwork_link_id_fkey
      FOREIGN KEY (fieldwork_link_id) REFERENCES survey_fieldwork_links (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_attempts_author_exclusive_check'
      AND conrelid = 'contact_attempts'::regclass
  ) THEN
    ALTER TABLE contact_attempts ADD CONSTRAINT contact_attempts_author_exclusive_check
      CHECK (created_by IS NULL OR fieldwork_link_id IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS contact_attempts_fieldwork_link_idx
  ON contact_attempts (fieldwork_link_id)
  WHERE fieldwork_link_id IS NOT NULL;

COMMENT ON COLUMN contact_attempts.fieldwork_link_id IS
  '이 회차를 넣은 외주 실사 링크. NULL 이면 계정이 넣었다(created_by) — ADR-0026';

-- ── 대리 응답 ────────────────────────────────────────────────────────────────
--
-- 칸은 여기서 만들고 **채우는 것은 대리 응답 티켓이 한다**(티켓 09). 두 칸을 한 번에 만드는
-- 이유는 배타 CHECK 가 두 테이블에서 같은 모양이어야 하기 때문이다 — 나눠 쓰면 뒤에 오는
-- 쪽이 앞의 결정을 다시 읽어야 하고, 그 사이에 한쪽만 제약 없는 창이 생긴다.

ALTER TABLE survey_responses
  ADD COLUMN IF NOT EXISTS fieldwork_link_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_responses_fieldwork_link_id_fkey'
      AND conrelid = 'survey_responses'::regclass
  ) THEN
    ALTER TABLE survey_responses ADD CONSTRAINT survey_responses_fieldwork_link_id_fkey
      FOREIGN KEY (fieldwork_link_id) REFERENCES survey_fieldwork_links (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_responses_proxy_exclusive_check'
      AND conrelid = 'survey_responses'::regclass
  ) THEN
    ALTER TABLE survey_responses ADD CONSTRAINT survey_responses_proxy_exclusive_check
      CHECK (fieldwork_user_id IS NULL OR fieldwork_link_id IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS survey_responses_fieldwork_link_idx
  ON survey_responses (fieldwork_link_id, survey_id)
  WHERE fieldwork_link_id IS NOT NULL;

COMMENT ON COLUMN survey_responses.fieldwork_link_id IS
  '이 응답을 대신 입력한 외주 실사 링크. NULL 이면 응답자 직접 또는 계정 대행 — ADR-0026';

COMMIT;
