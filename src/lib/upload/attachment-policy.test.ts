import { describe, expect, it } from 'vitest';

import {
  buildAttachmentDisposition,
  EXT_TO_MIME,
  getFileExt,
  isAllowedMime,
  MIN_FILE_BYTES,
  resolveAttachmentType,
  SAFE_FILENAME_RE,
  validateFilename,
} from '@/lib/upload/attachment-policy';

describe('isAllowedMime', () => {
  it('PDF 허용', () => expect(isAllowedMime('application/pdf')).toBe(true));
  it('HWP 허용', () => expect(isAllowedMime('application/vnd.hancom.hwp')).toBe(true));
  it('image/* 모두 허용', () => expect(isAllowedMime('image/jpeg')).toBe(true));
  it('exe 차단', () => expect(isAllowedMime('application/x-msdownload')).toBe(false));
  it('빈 문자열 차단', () => expect(isAllowedMime('')).toBe(false));
});

describe('getFileExt', () => {
  it('확장자 소문자 반환', () => expect(getFileExt('Report.PDF')).toBe('pdf'));
  it('점 없으면 빈 문자열', () => expect(getFileExt('readme')).toBe(''));
  it('점으로 끝나면 빈 문자열', () => expect(getFileExt('a.')).toBe(''));
  it('한글 파일명도 처리', () => expect(getFileExt('공문.hwp')).toBe('hwp'));
});

describe('resolveAttachmentType', () => {
  it('확장자 우선 정책 — type 빈 문자열이어도 ext 로 추정', () => {
    expect(resolveAttachmentType('a.hwp', '')).toEqual({ mime: 'application/vnd.hancom.hwp' });
  });
  it('확장자가 허용 목록에 없으면 MIME 으로 폴백', () => {
    expect(resolveAttachmentType('noext', 'application/pdf')).toEqual({
      mime: 'application/pdf',
    });
  });
  it('확장자·MIME 모두 비허용이면 null', () => {
    expect(resolveAttachmentType('a.exe', 'application/x-msdownload')).toBeNull();
  });
});

describe('validateFilename', () => {
  it('정상 파일명 → null', () => expect(validateFilename('협조 공문.pdf')).toBeNull());
  it('빈 문자열 → 에러', () => expect(validateFilename('')).not.toBeNull());
  it('200자 초과 → 에러', () => expect(validateFilename('x'.repeat(201))).not.toBeNull());
  it('path traversal 차단', () => {
    expect(validateFilename('..')).not.toBeNull();
    expect(validateFilename('.')).not.toBeNull();
  });
  it('윈도우 reserved 문자 차단', () => {
    expect(validateFilename('a/b.pdf')).not.toBeNull();
    expect(validateFilename('a\\b.pdf')).not.toBeNull();
    expect(validateFilename('a:b.pdf')).not.toBeNull();
  });
  it('확장자만 있는 파일 차단', () => expect(validateFilename('.pdf')).not.toBeNull());
});

describe('상수', () => {
  it('MIN_FILE_BYTES === 1', () => expect(MIN_FILE_BYTES).toBe(1));
  it('SAFE_FILENAME_RE 한글 통과', () => expect(SAFE_FILENAME_RE.test('한글 파일.pdf')).toBe(true));
  it('EXT_TO_MIME 에 hwp/hwpx 포함', () => {
    expect(EXT_TO_MIME['hwp']).toBe('application/vnd.hancom.hwp');
    expect(EXT_TO_MIME['hwpx']).toBe('application/vnd.hancom.hwpx');
  });
});

describe('buildAttachmentDisposition', () => {
  it('ASCII 파일명 그대로 encode', () => {
    expect(buildAttachmentDisposition('report.pdf')).toBe(
      "attachment; filename*=UTF-8''report.pdf",
    );
  });
  it('한글 파일명 percent-encode', () => {
    expect(buildAttachmentDisposition('협조 공문.pdf')).toBe(
      "attachment; filename*=UTF-8''%ED%98%91%EC%A1%B0%20%EA%B3%B5%EB%AC%B8.pdf",
    );
  });
  it("RFC 5987 reserved 문자 (' ( ) *) 도 percent-encode", () => {
    expect(buildAttachmentDisposition("a'b(c)*.pdf")).toBe(
      "attachment; filename*=UTF-8''a%27b%28c%29%2A.pdf",
    );
  });
});
