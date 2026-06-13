import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WS-2 media-scope — service.deleteImages 의 실제 삭제 경로 회귀 테스트.
 *
 * 핵심 결함(적대 리뷰): deleteImages 가 prefix 게이트(isAllowedImageDeletionKey)를
 * deleted/failed 카운트 계산에만 쓰고, 실제 R2 삭제(deleteImagesFromR2Server)에는
 * 게이트되지 않은 raw urls 를 그대로 넘겼다. lib 은 url.includes(publicUrl) 만 검사하고
 * 자체적으로 key 를 재추출해 DeleteObjectCommand 를 실행하므로, mail/·루트·타 설문
 * survey/ 의 well-formed URL 이 게이트를 통과하지 못한 채로 실제 삭제되었다(IDOR).
 *
 * 그래서 게이트가 삭제 경로에 연결됐는지 — lib 에 무엇이 전달되는지 — 를 직접 검증한다.
 * 첨부 라우트(deleteMailAttachmentTmp/Notice)와 대칭: 게이트한 그 대상만 삭제한다.
 */

const deleteImagesFromR2ServerMock =
  vi.fn<(urls: string[]) => Promise<boolean>>();

vi.mock('@/lib/image-utils-server', () => ({
  deleteImagesFromR2Server: (urls: string[]) =>
    deleteImagesFromR2ServerMock(urls),
  deleteR2ObjectsByKey: vi.fn(async () => true),
}));

import { deleteImages } from '@/features/media/server/services/media.service';

const PUBLIC_URL = 'https://pub-x.r2.dev';

describe('service.deleteImages — 게이트가 실제 삭제 경로를 통제한다', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteImagesFromR2ServerMock.mockResolvedValue(true);
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = PUBLIC_URL;
  });

  /** lib 으로 실제 전달된 URL 배열(첫 호출 인자)을 꺼낸다. */
  function urlsSentToLib(): string[] {
    expect(deleteImagesFromR2ServerMock).toHaveBeenCalledTimes(1);
    const firstCall = deleteImagesFromR2ServerMock.mock.calls[0];
    if (!firstCall) throw new Error('lib 호출 인자가 없습니다.');
    return firstCall[0];
  }

  it('의도 namespace(survey/·tmp/) URL 만 lib 삭제 호출에 전달한다', async () => {
    const allowed = [
      `${PUBLIC_URL}/survey/1234-abc.webp`,
      `${PUBLIC_URL}/tmp/cell-image/1234-abc.webp`,
    ];
    const res = await deleteImages({ urls: allowed });

    const sent = urlsSentToLib();
    expect(sent).toEqual(allowed);
    expect(res.deleted).toBe(2);
    expect(res.deletedUrls).toEqual(allowed);
  });

  it('mail/ 영구 첨부 URL 은 lib 삭제 호출에 도달하지 않는다(IDOR 차단)', async () => {
    const attack = `${PUBLIC_URL}/mail/victim-survey/secret-attachment.pdf`;
    const res = await deleteImages({ urls: [attack] });

    // lib 에 mail/ URL 이 전달되면 실제 DeleteObjectCommand 가 실행된다 -> 절대 안 됨.
    const sent = urlsSentToLib();
    expect(sent).not.toContain(attack);
    expect(sent).toEqual([]);
    expect(res.deleted).toBe(0);
    expect(res.deletedUrls).toEqual([]);
  });

  it('namespace 없는 루트 키 URL 은 lib 삭제 호출에 도달하지 않는다', async () => {
    const attack = `${PUBLIC_URL}/secret.webp`;
    await deleteImages({ urls: [attack] });

    const sent = urlsSentToLib();
    expect(sent).not.toContain(attack);
    expect(sent).toEqual([]);
  });

  it('mail/·root 공격 URL 을 정상 survey/ URL 과 섞어 보내도 정상만 전달한다', async () => {
    const ok = `${PUBLIC_URL}/survey/keep-me.webp`;
    const attackMail = `${PUBLIC_URL}/mail/victim/secret.pdf`;
    const attackRoot = `${PUBLIC_URL}/another-victim.webp`;
    const res = await deleteImages({
      urls: [ok, attackMail, attackRoot],
    });

    const sent = urlsSentToLib();
    expect(sent).toEqual([ok]);
    expect(sent).not.toContain(attackMail);
    expect(sent).not.toContain(attackRoot);
    expect(res.deleted).toBe(1);
    expect(res.deletedUrls).toEqual([ok]);
  });

  it('외부(non-R2) URL 은 게이트 밖이라 lib 에 전달하지 않고 카운트에서도 빠진다', async () => {
    const external = 'https://cdn.example.com/foo.jpg';
    const res = await deleteImages({ urls: [external] });

    const sent = urlsSentToLib();
    expect(sent).toEqual([]);
    expect(res.deleted).toBe(0);
    expect(res.failed).toBe(0);
  });

  it('lib 가 false(전체 실패) 면 게이트 통과 URL 을 failed 로 보고한다', async () => {
    deleteImagesFromR2ServerMock.mockResolvedValue(false);
    const ok = `${PUBLIC_URL}/survey/keep-me.webp`;
    const res = await deleteImages({ urls: [ok] });

    expect(res.deleted).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.failedUrls).toEqual([ok]);
    expect(res.deletedUrls).toEqual([]);
  });
});
