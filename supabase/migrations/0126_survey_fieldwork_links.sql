-- 0126: 외주 실사 링크. (2026-09-29, ADR-0026)
--
-- 외주 실사 인력에게는 계정을 발급하지 않는다. 연구원이 설문마다 **전용 URL 하나와 공유
-- 비밀번호 하나**를 만들어 업체에 전달하고, 외주는 그 링크로 그 설문의 운영 콘솔에 들어온다.
-- 업체도 담당자도 시스템에 등록하지 않는다 — 현장의 외주 실사는 단기 인력이 한 접속 수단을
-- 돌려쓰므로 사람 단위 귀속·사람 단위 폐기가 처음부터 성립하지 않고, 남는 것은 업체 등록·
-- 계정 발급·상태 전이·비밀번호 분실 대응이라는 운영 부담뿐이다. 그래서 귀속의 단위를 사람에서
-- 링크로 내린다. ADR-0019(실사 업체 + 개인 초대)를 대체한다.
--
-- **만료일 컬럼이 없다.** 연구원이 「설문 중단」을 누르면 링크도 함께 닫힌다 — 이 시스템에는
-- 「조사 종료」 상태가 없고(surveys.status 의 closed 는 도달 불가 어휘) 운영에서 중단이 사실상
-- 종료 신호라, 날짜를 따로 관리하게 하면 관리 지점만 하나 늘어난다. 중단은 토글이라 재개하면
-- 같은 링크가 그대로 다시 열리므로 이것은 만료가 아니라 **중단 중 차단**이다. 판정은
-- server/survey-access 의 링크 분기가 surveys.is_paused 로 한다 — 이 테이블에는 그 축이 없다.
--
-- **token 을 UPDATE 하는 경로가 없다.** 주소는 설문당 하나로 영구 고정이고 재발급이 없다:
-- 주소만 새어도 비밀번호 화면까지만 보이고, 사람을 막는 일(유출·업체 교체)은 전부 비밀번호
-- 변경이 진다. 주소가 변하지 않으므로 연구원이 공유 문서·메일에 링크를 박아 둘 수 있다.
--
-- **password_cipher 는 가역 암호화다(해시가 아니다).** 개인 계정 비밀번호가 아니라 공유 출입
-- 암호이므로 업체가 잊었을 때 연구원이 바로 답할 수 있어야 한다. 해시로 두면 문의마다 새 암호를
-- 만들어 전달해야 하고 그 전달 자체가 유출 경로다. 키는 컨택 PII 와 같은 것을 쓴다 — 반경이
-- 겹쳐(그 키가 새면 이미 PII 가 열린다) 분리가 값을 하지 않는다.
--
-- **password_updated_at 은 세션 폐기 표식이다.** 링크 세션 쿠키가 이 값을 함께 들고 다니고 매
-- 요청에서 DB 값과 대조하므로, 비밀번호를 바꾸면 이미 들어와 있던 세션이 그 순간 끊긴다.
-- 시각의 대소가 아니라 **같은 값인가**를 보므로 앱·DB 시계 오차와 무관하다. 이 컬럼이 없으면
-- ADR 의 「사람을 막는 일은 전부 이 비밀번호가 진다」가 거짓이 된다.
--
-- **종료는 행 삭제가 아니라 closed_at 이다.** 두 가지 이유가 있고 하나는 아직 미래다.
--  ① 지금 참인 것: 종료된 링크는 「그 링크가 무엇을 넣었는가」의 계보다. 팀 해산·실사 업체
--     종료가 archived 로 가는 것과 같은 관례이며, 그래서 UNIQUE 는 부분 인덱스다 — 활성
--     링크는 설문당 하나이고 종료된 행은 그 제약 밖에 남는다.
--  ② 곧 참이 될 것: 귀속 칸(contact_attempts·survey_responses 의 링크 칸)은 **이 마이그레이션에
--     없다.** 붙을 때 RESTRICT 로 걸므로 그 뒤에는 기록이 남은 링크의 하드 삭제가 DB 에서도
--     막힌다. 그 칸을 붙이는 마이그레이션은 이 결정을 되돌리지 말 것.
--
-- survey_id CASCADE : 설문이 하드 삭제되면 접속 수단도 의미가 없다. 형제 survey_participants
-- 와 같은 판단이며, 앱의 삭제는 soft delete 라 이 경로는 사실상 안 쓰인다.
-- created_by·password_updated_by RESTRICT : 사람은 하드 삭제되지 않는다(퇴사는 status 전이다).
--
-- RLS: 0035 하우스 룰 — 신규 public 테이블은 같은 마이그레이션에서 ENABLE (정책 0개 =
-- anon/authenticated deny-all, 앱은 BYPASSRLS 인 postgres 롤로만 접근). 이 테이블은 비밀번호
-- 암호문을 담으므로 특히 그렇다.
-- 멱등 (IF NOT EXISTS / DO 블록) — 빈 DB 재생(pnpm db:setup-test)과 재적용 양쪽 안전.

BEGIN;

CREATE TABLE IF NOT EXISTS survey_fieldwork_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
  token text NOT NULL,
  password_cipher text NOT NULL,
  password_updated_at timestamptz NOT NULL DEFAULT now(),
  password_updated_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  closed_at timestamptz,
  closed_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 주소는 전역 유일하다 — 토큰 하나로 설문을 찾는 것이 진입의 전부다.
CREATE UNIQUE INDEX IF NOT EXISTS survey_fieldwork_links_token_uq
  ON survey_fieldwork_links (token);

-- 활성 링크는 설문당 하나. 종료된 행은 감사로 남아 이 제약 밖이다.
CREATE UNIQUE INDEX IF NOT EXISTS survey_fieldwork_links_active_survey_uq
  ON survey_fieldwork_links (survey_id)
  WHERE closed_at IS NULL;

-- 종료 시각과 종료자는 함께 있거나 함께 없다 — 한 행 안의 조건이라 CHECK 로 걸 수 있다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'survey_fieldwork_links_closed_fields_check'
  ) THEN
    ALTER TABLE survey_fieldwork_links ADD CONSTRAINT survey_fieldwork_links_closed_fields_check
      CHECK ((closed_at IS NULL) = (closed_by IS NULL));
  END IF;
END $$;

ALTER TABLE survey_fieldwork_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE survey_fieldwork_links IS
  '외주 실사 링크 — 설문 하나에 대한 접속 수단(전용 URL + 공유 비밀번호). 계정이 아니다 (0126, ADR-0026)';
COMMENT ON COLUMN survey_fieldwork_links.token IS
  '주소에 실리는 값. 설문당 하나로 영구 고정이며 재발급 경로가 없다 — 사람을 막는 일은 비밀번호 변경이 한다';
COMMENT ON COLUMN survey_fieldwork_links.password_cipher IS
  '공유 출입 암호의 **가역 암호화**본. 해시가 아니다 — 연구원이 다시 읽어 업체에 답해 준다';
COMMENT ON COLUMN survey_fieldwork_links.password_updated_at IS
  '세션 폐기 표식. 링크 세션 쿠키가 이 값을 들고 다니며 매 요청 대조하므로 비밀번호 변경이 선 세션을 즉시 끊는다';
COMMENT ON COLUMN survey_fieldwork_links.closed_at IS
  '링크 종료. 행을 지우지 않는 이유는 종료된 링크가 「그 링크가 무엇을 넣었는가」의 계보이기 때문이다 — 활성 UNIQUE 가 부분 인덱스라 종료 뒤 재발급이 된다';

COMMIT;
