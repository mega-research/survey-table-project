-- 0166: 설문 그룹 3단계 중첩 — 상위 그룹 칸과 깊이 제약. (2026-11-10, 설문 그룹 중첩 티켓 01)
--
-- **앱 배포 전에 적용한다.** nullable 칸 추가와 이름 유일 제약 완화뿐이라 구버전 앱과 양립한다 —
-- 구버전의 그룹 만들기는 상위 칸을 비운 채 넣으므로 전부 최상위(깊이 1)가 되고, 최상위끼리의
-- 이름 유일은 전과 같은 범위(팀 안)다. 기존 그룹은 전부 최상위로 남고 데이터 이관은 없다.
--
-- 그룹은 여전히 **접근 권한이 아니라 정리용 묶음**이다(0117). 여기서 더하는 것은 폴더 안의
-- 폴더뿐이고, 설문은 지금처럼 그룹 하나에만(어느 단계든) 담긴다.
--
-- ── 깊이 제약: 선언형 (트리거·함수 없음) ──────────────────────────────────────────────
--
--   parent_group_id  상위 그룹 (NULL = 최상위)
--   parent_depth     상위 그룹의 깊이 — **앱이 쓰는 값이지만 거짓으로 쓸 수 없다**(아래 복합 FK)
--   depth            GENERATED: COALESCE(parent_depth, 0) + 1
--
--   FK (team_id, parent_group_id, parent_depth) → (team_id, id, depth)  ON UPDATE CASCADE
--   CHECK parent_depth BETWEEN 1 AND 2   → depth ≤ 3
--
-- 자식이 적은 parent_depth 가 부모의 실제 depth 와 다르면 FK 가 가리킬 행이 없어 거부된다.
-- 그래서 depth 는 언제나 「부모의 깊이 + 1」이고, 동시 요청이 각자 한 단계씩 늘려도 4단계가
-- 생기지 않는다(트리거의 「읽고 나서 쓰기」 창이 없다).
--
-- 같은 FK 가 세 가지를 함께 막는다.
--   ① 깊이 3 초과      — 3단계 그룹(깊이 3)을 부모로 삼으려면 parent_depth = 3 이어야 하는데 CHECK 가 막는다.
--   ② 다른 팀의 부모   — team_id 가 FK 에 들어 있어 부모와 자식의 팀이 같아야 한다.
--   ③ 순환            — 순환 위의 모든 그룹이 「내 깊이 = 부모 깊이 + 1」을 만족해야 하는데 그런 수는 없다.
--                       자기 자신을 부모로 두는 것도 같은 이유로 막히지만, 오류가 무엇을 말하는지
--                       분명하도록 CHECK 를 따로 둔다.
--
-- **그룹을 옮기면 하위 그룹의 깊이가 따라온다**(ON UPDATE CASCADE). 옮기는 쓰기는 그 그룹의
-- (parent_group_id, parent_depth) 만 고친다 → depth 가 다시 계산된다 → 그 그룹을 가리키던
-- 자식들의 parent_depth 가 연쇄로 갱신된다 → 자식의 depth 가 다시 계산된다 → 손자까지 이어진다.
-- 연쇄 도중 어느 하위 그룹이 깊이 3 을 넘으면 CHECK 가 문장 전체를 되돌린다. 격리 DB 에서
-- 확인한 결과는 티켓 01 Comments 와 survey-groups.realdb 스위트에 있다.
--
-- MATCH SIMPLE 은 FK 칸 중 하나라도 NULL 이면 검사를 건너뛴다. 「상위는 있는데 parent_depth 만
-- NULL」이면 검사 없이 깊이 1 이 되어 버리므로, 두 칸이 **함께 NULL 이거나 함께 값이 있도록**
-- CHECK 로 묶는다.
--
-- ON DELETE 는 기본값(NO ACTION)이다 — 하위 그룹이 있는 그룹은 지워지지 않는다(따라 지우지 않는다).
-- RESTRICT 가 아닌 이유: 가지를 통째로 지우는 한 문장(부모와 자식을 함께 지우는 정리)은 문장 끝에
-- 남은 참조가 없으므로 허용돼야 한다. 부모만 지우는 문장은 둘 다 똑같이 막는다.
--
-- ── 이름 유일 ────────────────────────────────────────────────────────────────────────
--
-- 「팀 안에서 유일」을 「같은 상위 그룹 안에서 유일」로 바꾼다 — 사람마다 「2025」 폴더를 둘 수
-- 있어야 한다. NULL 은 유일 인덱스에서 서로 다르다고 보므로 인덱스가 둘이다.
--   최상위끼리        (team_id, name)          WHERE parent_group_id IS NULL
--   같은 부모 안에서   (parent_group_id, name)  WHERE parent_group_id IS NOT NULL
--
-- 멱등 (IF NOT EXISTS / DO 블록) — 빈 DB 재생과 재적용 양쪽 안전. 새 테이블이 없어 RLS·권한은 그대로다.

BEGIN;

ALTER TABLE survey_groups
  ADD COLUMN IF NOT EXISTS parent_group_id uuid,
  ADD COLUMN IF NOT EXISTS parent_depth integer;

ALTER TABLE survey_groups
  ADD COLUMN IF NOT EXISTS depth integer
    GENERATED ALWAYS AS (COALESCE(parent_depth, 0) + 1) STORED;

-- 복합 FK 가 가리킬 자리. id 가 이미 PK 라 유일성은 늘 참이고, FK 의 대상이 되기 위해 둔다.
CREATE UNIQUE INDEX IF NOT EXISTS survey_groups_team_id_depth_uq
  ON survey_groups (team_id, id, depth);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'survey_groups_parent_pair_check'
  ) THEN
    ALTER TABLE survey_groups ADD CONSTRAINT survey_groups_parent_pair_check
      CHECK ((parent_group_id IS NULL) = (parent_depth IS NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'survey_groups_parent_depth_check'
  ) THEN
    ALTER TABLE survey_groups ADD CONSTRAINT survey_groups_parent_depth_check
      CHECK (parent_depth IS NULL OR parent_depth BETWEEN 1 AND 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'survey_groups_not_own_parent_check'
  ) THEN
    ALTER TABLE survey_groups ADD CONSTRAINT survey_groups_not_own_parent_check
      CHECK (parent_group_id IS NULL OR parent_group_id <> id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'survey_groups_parent_fk'
  ) THEN
    ALTER TABLE survey_groups ADD CONSTRAINT survey_groups_parent_fk
      FOREIGN KEY (team_id, parent_group_id, parent_depth)
      REFERENCES survey_groups (team_id, id, depth)
      ON UPDATE CASCADE;
  END IF;
END $$;

-- 이름 유일: 팀 전체 → 같은 상위 그룹 안.
-- **새 인덱스 둘을 먼저 만들고 옛 인덱스를 지운다.** 거꾸로 두면 그 사이에 이름 유일을 막는 인덱스가
-- 하나도 없다 — 문장을 하나씩 적용하는 도구에서는 그 구간이 실제로 열리고, 새 인덱스 생성이 실패하면
-- 옛 인덱스만 사라진 채 남는다. 이 순서에서는 실패해도 옛 인덱스가 그대로다.
CREATE UNIQUE INDEX IF NOT EXISTS survey_groups_root_name_uq
  ON survey_groups (team_id, name)
  WHERE parent_group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS survey_groups_parent_name_uq
  ON survey_groups (parent_group_id, name)
  WHERE parent_group_id IS NOT NULL;

DROP INDEX IF EXISTS survey_groups_team_name_uq;

-- 한 부모의 하위 그룹을 순서대로 읽는 조회와, 부모 행이 바뀌거나 지워질 때 FK 가 자식을 찾는 조회가 탄다.
CREATE INDEX IF NOT EXISTS survey_groups_parent_order_idx
  ON survey_groups (parent_group_id, "order");

COMMENT ON COLUMN survey_groups.parent_group_id IS
  '상위 그룹 (NULL = 최상위). 같은 팀의 그룹이어야 하고 깊이는 3 까지다 — survey_groups_parent_fk 가 막는다';
COMMENT ON COLUMN survey_groups.parent_depth IS
  '상위 그룹의 깊이. 복합 FK 가 부모의 depth 와 맞는지 검사하고, 부모가 옮겨지면 ON UPDATE CASCADE 로 따라온다';
COMMENT ON COLUMN survey_groups.depth IS
  '이 그룹의 깊이 (1 = 최상위). parent_depth 에서 계산되는 칸이라 직접 쓸 수 없다';

COMMIT;
