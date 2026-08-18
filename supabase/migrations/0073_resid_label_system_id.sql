-- 0073: system.resid 컬럼 기본 라벨 '번호' -> '시스템ID'
-- 고객 엑셀의 NO/ID 류 컬럼과 구분 목적. 기본 라벨('번호')인 스킴만 갱신하고
-- 사용자가 직접 바꾼 커스텀 라벨은 보존한다. jsonb_agg 는 WITH ORDINALITY 로
-- 컬럼 순서를 유지한다.

UPDATE surveys
SET contact_columns = jsonb_set(
  contact_columns,
  '{columns}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN c->>'source' = 'system.resid' AND c->>'label' = '번호'
          THEN jsonb_set(c, '{label}', '"시스템ID"')
        ELSE c
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(contact_columns->'columns') WITH ORDINALITY AS t(c, ord)
  )
)
WHERE contact_columns IS NOT NULL
  AND jsonb_typeof(contact_columns->'columns') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(contact_columns->'columns') c
    WHERE c->>'source' = 'system.resid' AND c->>'label' = '번호'
  );

UPDATE surveys
SET test_contact_columns = jsonb_set(
  test_contact_columns,
  '{columns}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN c->>'source' = 'system.resid' AND c->>'label' = '번호'
          THEN jsonb_set(c, '{label}', '"시스템ID"')
        ELSE c
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(test_contact_columns->'columns') WITH ORDINALITY AS t(c, ord)
  )
)
WHERE test_contact_columns IS NOT NULL
  AND jsonb_typeof(test_contact_columns->'columns') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(test_contact_columns->'columns') c
    WHERE c->>'source' = 'system.resid' AND c->>'label' = '번호'
  );
