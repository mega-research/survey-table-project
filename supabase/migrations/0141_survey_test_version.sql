-- 테스트 버전 (CONTEXT.md 「테스트 버전」)
--
-- 테스트 링크 · 테스트 대상자 링크 · 관리자 미리보기가 배포본 대신 지금 저장본으로 만든 스냅샷을
-- 본다. 저장만으로 끝까지(응답 확정 · 자격미달 · 종료 이동까지) 테스트하고, 실응답 링크는 배포본에
-- 그대로 둔다.
--
-- 테스트 버전은 survey_versions 의 한 줄이다(status = 'test', version_number 는 음수 — 배포 번호
-- max+1 계산과 겹치지 않는다). 저장본이 바뀌면 새 줄을 만들고 직전 테스트 버전의 snapshot 은 바로
-- 비운다 — 배포 스냅샷처럼 줄은 불변이고, 남는 스냅샷은 최신 하나다. 그래서 버전 id 가 바뀌는 것만으로
-- 무중단 갈아타기 · 재개 이관 · 「스냅샷이 비워진 버전의 테스트 응답」 안내가 그대로 동작한다.
--
-- surveys.test_version_id — 지금 테스트 버전. current_version_id 와 같은 모양(FK 없음, nullable).
-- survey_versions.fingerprints — { revision, questions, groups } 지문. snapshot 을 비워도 남겨,
-- 다음 테스트 버전으로 옮길 때 「바뀐 문항」을 가른다. 배포 버전은 NULL.
--
-- nullable 이고 기본값이 필요 없어 구버전 앱의 INSERT 도 깨지지 않는다 — 2단계 배포 대상이 아니다.
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS test_version_id uuid;

ALTER TABLE survey_versions
  ADD COLUMN IF NOT EXISTS fingerprints jsonb;

COMMENT ON COLUMN surveys.test_version_id IS
  '지금 테스트 버전(survey_versions.status = ''test''). 테스트 링크·대상자·관리자 미리보기가 본다.';
COMMENT ON COLUMN survey_versions.fingerprints IS
  '테스트 버전 지문 { revision, questions, groups } — snapshot 을 비워도 남긴다. 배포 버전은 NULL.';
