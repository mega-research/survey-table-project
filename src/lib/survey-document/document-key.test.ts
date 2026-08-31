import { describe, expect, it } from 'vitest';

import { gateR2Key } from '@/lib/r2-lifecycle/key-extract';

import {
  isTmpSurveyDocumentKey,
  SURVEY_DOCUMENT_PREFIX,
  toPermanentSurveyDocumentKey,
  TMP_SURVEY_DOCUMENT_PREFIX,
} from './document-key';

describe('조사표 R2 키 규약', () => {
  it('영구 접두사는 기존 영구 네임스페이스 안에 있다', () => {
    // 새 네임스페이스를 만들지 않는다는 결정 — 만들면 key-extract 화이트리스트를
    // 함께 고쳐야 하고, 빠뜨리면 조사표가 삭제 큐에서 조용히 사라진다.
    expect(SURVEY_DOCUMENT_PREFIX.startsWith('survey/')).toBe(true);
    expect(gateR2Key(`${SURVEY_DOCUMENT_PREFIX}abc.pdf`)).toBe(`${SURVEY_DOCUMENT_PREFIX}abc.pdf`);
  });

  it('tmp 키는 유예 삭제 시스템의 대상이 아니다', () => {
    // tmp 는 R2 lifecycle(24h) 소관이라 게이트가 거부해야 한다
    expect(gateR2Key(`${TMP_SURVEY_DOCUMENT_PREFIX}abc.pdf`)).toBeNull();
  });

  it('tmp 키를 영구 키로 옮긴다', () => {
    expect(toPermanentSurveyDocumentKey(`${TMP_SURVEY_DOCUMENT_PREFIX}abc.pdf`)).toBe(
      `${SURVEY_DOCUMENT_PREFIX}abc.pdf`,
    );
  });

  it('tmp 접두사가 아닌 키는 붙일 수 없다', () => {
    expect(toPermanentSurveyDocumentKey('survey/document/abc.pdf')).toBeNull();
    expect(toPermanentSurveyDocumentKey('tmp/mail/abc.pdf')).toBeNull();
    expect(toPermanentSurveyDocumentKey('')).toBeNull();
  });

  it('경로 조작과 하위 경로를 거부한다', () => {
    expect(isTmpSurveyDocumentKey(`${TMP_SURVEY_DOCUMENT_PREFIX}../mail/x.pdf`)).toBe(false);
    expect(toPermanentSurveyDocumentKey(`${TMP_SURVEY_DOCUMENT_PREFIX}nested/x.pdf`)).toBeNull();
  });
});
