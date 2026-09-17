import { describe, expect, it } from 'vitest';

import { readUploadErrorMessage } from './read-upload-error-message';

describe('readUploadErrorMessage', () => {
  it('JSON 본문의 error 를 문자열로 돌려준다', () => {
    expect(readUploadErrorMessage('{"error":"용량 초과"}', '기본')).toBe('용량 초과');
  });

  it('비-JSON 본문이면 fallback — 원래 중첩 try/catch 가 하던 처리', () => {
    expect(readUploadErrorMessage('<html>502</html>', '기본')).toBe('기본');
    expect(readUploadErrorMessage('', '기본')).toBe('기본');
  });

  it('JSON 이지만 error 가 없으면 fallback', () => {
    expect(readUploadErrorMessage('{"ok":true}', '기본')).toBe('기본');
    expect(readUploadErrorMessage('null', '기본')).toBe('기본');
  });
});
