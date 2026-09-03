-- 0103: users.organization — 게스트 계정의 소속 기관 메모. (2026-08-26, 역할 모델 v2 티켓 03)
--
-- 사용자 관리 목록의 「소속 (팀·기관·업체)」 열은 계정 유형마다 다른 곳에서 값을 얻는다.
--   internal  팀 멤버십 (teams·team_members — 티켓 06)
--   guest     이 컬럼 (클라이언트 회사·협회 이름을 슈퍼어드민이 손으로 적는 자유 메모)
--   fieldwork 실사 업체 엔티티 (fieldwork_orgs — 티켓 24)
-- 즉 이 컬럼은 게스트 전용 표시 메모이지 권한·조회 키가 아니다. 유형 정합은 서비스
-- 레이어가 강제한다(다른 유형으로 만들면 NULL 로 떨어진다) — CHECK 로 묶지 않은 이유는
-- 유형 전환(게스트 → 내부 등)을 나중에 열 때 제약이 먼저 걸려 넘어지지 않게 하기 위해서다.
--
-- nullable 추가라 2단계 배포 규칙(앱 생성값 NOT NULL) 대상이 아니다. 구버전 앱의
-- INSERT 는 이 컬럼을 몰라도 NULL 로 통과한다.

BEGIN;

ALTER TABLE "users" ADD COLUMN "organization" text;

COMMENT ON COLUMN "users"."organization" IS
  '게스트 계정의 소속 기관 메모 (internal 은 팀, fieldwork 는 fieldwork_orgs 에서 소속을 얻는다)';

COMMIT;
