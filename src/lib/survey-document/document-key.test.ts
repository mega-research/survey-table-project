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

  it('tmp 키를 영구 네임스페이스의 새 키로 옮긴다', () => {
    expect(toPermanentSurveyDocumentKey(`${TMP_SURVEY_DOCUMENT_PREFIX}abc.pdf`, () => 'new-id')).toBe(
      `${SURVEY_DOCUMENT_PREFIX}new-id.pdf`,
    );
  });

  it('같은 tmp 키로 두 번 붙여도 서로 다른 영구 키가 나온다', () => {
    // 파생 키였을 때는 두 요청이 같은 객체를 가리켰다. 한쪽이 커밋에 성공한 뒤
    // 다른 쪽이 실패하면 실패한 쪽의 롤백이 성공한 행의 파일을 지웠다.
    const tmp = `${TMP_SURVEY_DOCUMENT_PREFIX}abc.pdf`;
    expect(toPermanentSurveyDocumentKey(tmp)).not.toBe(toPermanentSurveyDocumentKey(tmp));
  });

  it('새로 발급한 키도 영구 네임스페이스 게이트를 통과한다', () => {
    const key = toPermanentSurveyDocumentKey(`${TMP_SURVEY_DOCUMENT_PREFIX}abc.pdf`);
    expect(key).not.toBeNull();
    expect(gateR2Key(key!)).toBe(key);
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
