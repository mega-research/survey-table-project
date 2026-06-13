import { describe, expect, it } from 'vitest';

import {
  DeleteImagesInput,
  isAllowedImageDeletionKey,
} from '@/features/media/domain/media';

/**
 * WS-2 media-scope — media.deleteImages R2 prefix 게이트.
 *
 * deleteImages 는 URL 배열을 받아 우리 R2 public URL 만 골라 영구 삭제한다.
 * publicUrl substring 포함만으로 임의 영구 키(survey/<known>.webp 등)를 지우면
 * IDOR — 다른 자원의 객체를 삭제할 수 있다. 그래서 두 층에서 게이트한다.
 *
 * 1. 키 게이트(isAllowedImageDeletionKey): 의도 namespace(survey/·tmp/)만 삭제 허용,
 *    traversal('..'/'//') 거부. service 가 URL→key 추출 후 이 게이트로 재검증한다.
 * 2. 입력 refine(DeleteImagesInput): traversal URL 거부(형제 첨부 삭제와 대칭).
 *    외부(non-R2) URL 은 service 단계에서 skip 되므로 입력에서 막지 않는다.
 */

describe('isAllowedImageDeletionKey — R2 키 namespace 게이트', () => {
  it('의도 namespace(survey/) 영구 키는 허용한다', () => {
    expect(isAllowedImageDeletionKey('survey/1234-abc.webp')).toBe(true);
  });

  it('의도 namespace(tmp/) tmp 키는 허용한다', () => {
    expect(isAllowedImageDeletionKey('tmp/cell-image/1234-abc.webp')).toBe(true);
    expect(isAllowedImageDeletionKey('tmp/survey/1234-abc.png')).toBe(true);
  });

  it('의도 namespace 밖 영구 키(mail/...)는 거부한다', () => {
    expect(isAllowedImageDeletionKey('mail/some-survey/secret.pdf')).toBe(false);
  });

  it('namespace 없는 루트 키는 거부한다', () => {
    expect(isAllowedImageDeletionKey('secret.webp')).toBe(false);
  });

  it("traversal('..') 키는 의도 prefix 라도 거부한다", () => {
    expect(isAllowedImageDeletionKey('survey/../mail/secret.pdf')).toBe(false);
    expect(isAllowedImageDeletionKey('tmp/survey/../../survey/x.webp')).toBe(
      false,
    );
  });

  it("'//' 더블 슬래시 키는 거부한다", () => {
    expect(isAllowedImageDeletionKey('survey//x.webp')).toBe(false);
    expect(isAllowedImageDeletionKey('tmp//cell-image/x.webp')).toBe(false);
  });
});

describe('DeleteImagesInput — 입력 refine traversal 게이트', () => {
  it('정상 R2 이미지 URL(survey/·tmp/)은 통과한다', () => {
    const parsed = DeleteImagesInput.parse({
      urls: [
        'https://pub-x.r2.dev/survey/1234-abc.webp',
        'https://pub-x.r2.dev/tmp/cell-image/1234-abc.webp',
      ],
    });
    expect(parsed.urls).toHaveLength(2);
  });

  it('외부(non-R2) URL 도 입력 단계에서는 통과한다(서비스에서 skip)', () => {
    const parsed = DeleteImagesInput.parse({
      urls: ['https://cdn.example.com/foo.jpg'],
    });
    expect(parsed.urls).toHaveLength(1);
  });

  it("traversal('..') URL 은 입력 refine 에서 거부한다", () => {
    expect(() =>
      DeleteImagesInput.parse({
        urls: ['https://pub-x.r2.dev/survey/../mail/secret.pdf'],
      }),
    ).toThrow();
  });

  it("'//' 더블 슬래시 path URL 은 거부한다", () => {
    expect(() =>
      DeleteImagesInput.parse({
        urls: ['https://pub-x.r2.dev/survey//secret.webp'],
      }),
    ).toThrow();
  });

  it('URL 형식이 아닌 bare key 문자열은 거부한다', () => {
    expect(() =>
      DeleteImagesInput.parse({ urls: ['survey/secret.webp'] }),
    ).toThrow();
  });
});
