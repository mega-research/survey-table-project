-- 0134: 링크 테이블을 종류 중립 이름으로 옮기고 종류(kind)를 둔다. (2026-10-12, ADR-0029)
--
-- 외주 실사 링크(0126, ADR-0026)에 두 번째 종류인 **클라이언트 링크**가 붙는다. 고객사도
-- 계정 없이 설문별 URL + 공유 비밀번호로 그 설문의 현황 화면을 본다. 같은 테이블에 살게
-- 되므로 `survey_fieldwork_links` 라는 이름이 거짓이 된다 — `survey_access_links` 로 옮긴다.
--
-- **귀속 칸(`fieldwork_link_id`) 넷은 이름을 그대로 둔다** (0127·0133). 그 칸을 채우는 것은
-- 외주 링크뿐이고 클라이언트 링크는 아무것도 쓰지 않는다. FK 는 테이블을 OID 로 가리키므로
-- 개명을 따라온다.
--
-- ## kind
--
-- `fieldwork` | `client`. NOT NULL + 기본값 `fieldwork` 라 **2단계 배포가 필요 없다** — 옛 앱의
-- INSERT 는 kind 를 모르지만 기본값이 채운다. 기존 행은 전부 외주 링크다.
--
-- ## 활성 링크는 설문당 「종류별로」 하나
--
-- UNIQUE 를 (survey_id) 에서 (survey_id, kind) 로 바꾼다. 한 설문에 외주 링크와 클라이언트
-- 링크가 함께 서야 한다(실사와 고객사 보고를 동시에 돌린다).
--
-- ## client_tabs
--
-- 클라이언트 링크의 현황 탭 화이트리스트(JSONB). 참여 행의 `guest_tabs` 가 하던 일이고 어휘·
-- 기본값·정규화는 그대로다 — NULL 이면 기본값(응답 현황 하나). **외주 링크에서는 NULL 이어야
-- 한다**: 외주 콘솔에는 설문마다 고르는 화면 축이 없고, 값이 들어가면 「탭을 저장했는데 아무
-- 일도 없는」 행이 된다.
--
-- ## 재생·재적용
--
-- 빈 DB 재생에서는 0126 이 옛 이름으로 만든 테이블을 여기서 옮긴다. **전량을 다시 적용하면**
-- 0126 의 `CREATE TABLE IF NOT EXISTS` 가 옛 이름의 빈 테이블을 새로 세우므로(옛 이름이 이미
-- 비어 있다), 그 빈 껍데기를 지운다. 행이 하나라도 있으면 멈춘다 — 그것은 껍데기가 아니다.
--
-- ## 배포 주의
--
-- 테이블 개명은 옛 코드와 양립하지 않는다. **앱 배포 직전에** 적용한다.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.survey_access_links') IS NULL THEN
    ALTER TABLE survey_fieldwork_links RENAME TO survey_access_links;
  ELSIF to_regclass('public.survey_fieldwork_links') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM survey_fieldwork_links) THEN
      RAISE EXCEPTION 'survey_fieldwork_links 에 행이 남아 있다 — 개명 뒤에 옛 이름으로 쓴 코드가 있다';
    END IF;
    DROP TABLE survey_fieldwork_links;
  END IF;
END $$;

-- 이름이 박힌 객체를 함께 옮긴다. Postgres 는 테이블 개명 때 이것들을 따라 바꾸지 않는다 —
-- 그대로 두면 `\d survey_access_links` 가 옛 이름의 제약을 보여 주고, drizzle 스키마의 인덱스
-- 이름과 어긋나 드리프트 점검이 「이름이 같은데 정의가 다른 인덱스」로 읽는다.
ALTER INDEX IF EXISTS survey_fieldwork_links_pkey RENAME TO survey_access_links_pkey;
ALTER INDEX IF EXISTS survey_fieldwork_links_token_uq RENAME TO survey_access_links_token_uq;

DO $$
DECLARE
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['survey_fieldwork_links_closed_fields_check', 'survey_access_links_closed_fields_check'],
    ['survey_fieldwork_links_survey_id_fkey', 'survey_access_links_survey_id_fkey'],
    ['survey_fieldwork_links_password_updated_by_fkey', 'survey_access_links_password_updated_by_fkey'],
    ['survey_fieldwork_links_closed_by_fkey', 'survey_access_links_closed_by_fkey'],
    ['survey_fieldwork_links_created_by_fkey', 'survey_access_links_created_by_fkey']
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = pair[1] AND conrelid = 'public.survey_access_links'::regclass
    ) THEN
      EXECUTE format('ALTER TABLE survey_access_links RENAME CONSTRAINT %I TO %I', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;

ALTER TABLE survey_access_links
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'fieldwork';

ALTER TABLE survey_access_links
  ADD COLUMN IF NOT EXISTS client_tabs jsonb;

ALTER TABLE survey_access_links
  DROP CONSTRAINT IF EXISTS survey_access_links_kind_check;
ALTER TABLE survey_access_links
  ADD CONSTRAINT survey_access_links_kind_check
  CHECK (kind IN ('fieldwork', 'client'));

ALTER TABLE survey_access_links
  DROP CONSTRAINT IF EXISTS survey_access_links_client_tabs_check;
ALTER TABLE survey_access_links
  ADD CONSTRAINT survey_access_links_client_tabs_check
  CHECK (kind = 'client' OR client_tabs IS NULL);

-- 활성 링크: 설문당 하나 → 설문당 종류별 하나.
DROP INDEX IF EXISTS survey_fieldwork_links_active_survey_uq;
CREATE UNIQUE INDEX IF NOT EXISTS survey_access_links_active_survey_kind_uq
  ON survey_access_links (survey_id, kind)
  WHERE closed_at IS NULL;

-- 개명은 RLS 를 건드리지 않지만, 「켜져 있다」를 이 파일에서도 말해 둔다 — 정책 0 = deny-all.
ALTER TABLE survey_access_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE survey_access_links IS
  '설문 접속 링크 — 설문 하나에 대한 접속 수단(전용 URL + 공유 비밀번호). 계정이 아니다. kind 로 외주 실사 링크와 클라이언트 링크를 가른다 (0126·0134, ADR-0026·0029)';
COMMENT ON COLUMN survey_access_links.kind IS
  '링크의 종류 — fieldwork(외주 실사: 운영 콘솔) | client(클라이언트: 현황 열람). 활성 링크는 설문당 종류별 하나';
COMMENT ON COLUMN survey_access_links.client_tabs IS
  '클라이언트 링크의 현황 탭 화이트리스트. NULL 이면 기본값(응답 현황 하나). 외주 링크에서는 항상 NULL';

COMMIT;
