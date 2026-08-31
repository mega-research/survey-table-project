import { describe, expect, it } from 'vitest';

import { REFERENCE_SURFACE } from './reference-surface.server';

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
});
