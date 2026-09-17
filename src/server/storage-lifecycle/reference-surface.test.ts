/**
 * R2 참조 표면의 불변식 (역할 모델 v2 티켓 17).
 *
 * 티켓 17 의 「R2 파일은 삭제하지 않음」을 실제로 지탱하는 것은 삭제 코드가 아니라 **이
 * 표면 정의**다. 설문 삭제가 soft delete 로 바뀌어 `surveys`·`questions` 행이 살아남고,
 * 살아남은 행이 그 키의 참조를 계속 주장하므로 유예 큐에 등록된 후보가 집행 직전 재확인에서
 * '보존됨' 으로 닫힌다.
 *
 * 그래서 위험은 삭제 경로가 아니라 **이 파일에 술어 한 줄이 추가되는 것**이다. 바로 옆에
 * `mail_templates: isNull(deletedAt)` 이라는 선례가 있어(그쪽은 의도된 정책이다) 누군가
 * 「일관성」을 이유로 surveys 에도 같은 줄을 달기 쉽다. 그러면 삭제 7일 뒤 집행자가 파일을
 * 지우고, 그 시점 이후의 복구는 이미지·첨부가 빠진 설문을 되살린다 — 되돌릴 방법이 없다.
 */
import { describe, expect, it } from 'vitest';

import { REFERENCE_SURFACE } from './reference-surface';

describe('R2 참조 표면', () => {
  it('조사표 테이블이 등재돼 있다', () => {
    // 등재를 빠뜨리면 조사표 PDF 가 어떤 콘텐츠에서도 참조되지 않는 키로 보여
    // 유예 기간 뒤 삭제 큐가 지운다. 에러 없이 파일만 사라지는 실패라 테스트로 잡는다.
    expect(REFERENCE_SURFACE.map((s) => s.name)).toContain('survey_documents');
  });

  it('조사표는 가변 소스다 — 일일 재추출 대상', () => {
    const source = REFERENCE_SURFACE.find((s) => s.name === 'survey_documents');
    expect(source?.immutable).toBeUndefined();
  });

  it('surveys·questions 는 술어 없이 전 행이 참조 자격을 갖는다 — soft delete 된 설문 포함', () => {
    for (const name of ['surveys', 'questions']) {
      const source = REFERENCE_SURFACE.find((s) => s.name === name);
      expect(source, `${name} 이 참조 표면에서 사라졌다`).toBeDefined();
      // extraWhere 가 붙는 순간 삭제된 설문의 키가 '참조 없음' 으로 판정돼 집행 대상이 된다.
      expect(source?.extraWhere, `${name} 에 술어가 붙었다 — 복구가 파일을 잃는다`).toBeUndefined();
    }
  });

  it('mail_templates 만 soft delete 술어를 갖는다 — 의도된 예외임을 고정한다', () => {
    const withPredicate = REFERENCE_SURFACE.filter((s) => s.extraWhere !== undefined).map(
      (s) => s.name,
    );
    // survey_versions 는 snapshot IS NULL(보존 정책 정리분) 이라 축이 다르다.
    expect(withPredicate.sort()).toEqual(['mail_templates', 'survey_versions']);
  });
});
