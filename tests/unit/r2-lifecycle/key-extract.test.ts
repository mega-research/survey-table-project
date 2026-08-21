import { describe, expect, it } from 'vitest';

import {
  KNOWN_R2_HOSTS_STATIC,
  PERMANENT_KEY_NAMESPACES,
  collectRemovedR2Keys,
  diffRemovedR2Keys,
  extractMailContentKeys,
  extractR2KeysFromHtml,
  extractR2KeysFromJsonbValue,
  getKnownR2Hosts,
  normalizeUrlToR2Key,
} from '@/server/storage-lifecycle/key-extract';

// 테스트는 env 와 무관하게 명시 hosts 로 고정한다
const HOSTS = ['cdn-dev.megaresearch.co.kr'];
const opts = { hosts: HOSTS };
const CDN = 'https://cdn-dev.megaresearch.co.kr';

describe('known R2 host SSOT', () => {
  it('실DB 조사로 확정된 역대 도메인 3종이 정적 목록에 있다', () => {
    expect(KNOWN_R2_HOSTS_STATIC).toContain('cdn-dev.megaresearch.co.kr');
    expect(KNOWN_R2_HOSTS_STATIC).toContain('cdn.dev.megaresearch.co.kr');
    expect(KNOWN_R2_HOSTS_STATIC).toContain(
      '4d4323ede9dcdd6083ada9e2f0f89468.r2.cloudflarestorage.com',
    );
  });

  it('getKnownR2Hosts 는 정적 목록을 포함한다', () => {
    const hosts = getKnownR2Hosts();
    for (const h of KNOWN_R2_HOSTS_STATIC) expect(hosts).toContain(h);
  });

  it('영구 네임스페이스 화이트리스트 4종', () => {
    expect([...PERMANENT_KEY_NAMESPACES].sort()).toEqual(
      ['mail-attachment/', 'mail/', 'notice-attachment/', 'survey/'].sort(),
    );
  });
});

describe('normalizeUrlToR2Key — 3중 게이트', () => {
  it('known host + 영구 네임스페이스 URL 은 key 로 정규화된다', () => {
    expect(normalizeUrlToR2Key(`${CDN}/mail/1779-abc.png`, opts)).toBe('mail/1779-abc.png');
    expect(normalizeUrlToR2Key(`${CDN}/survey/img.webp`, opts)).toBe('survey/img.webp');
  });

  it('게이트 1: 외부 도메인 URL 은 키로 취급하지 않는다', () => {
    expect(normalizeUrlToR2Key('https://svybx.kr/mail/a.png', opts)).toBeNull();
    expect(normalizeUrlToR2Key('http://woodsurvey.kr', opts)).toBeNull();
  });

  it('게이트 1: data: URI·파싱 불가 입력은 키로 취급하지 않는다', () => {
    expect(normalizeUrlToR2Key('data:image/png;base64,iVBOR', opts)).toBeNull();
    expect(normalizeUrlToR2Key('not a url', opts)).toBeNull();
    expect(normalizeUrlToR2Key('', opts)).toBeNull();
  });

  it('게이트 2: 영구 네임스페이스 밖 키는 거부된다', () => {
    expect(normalizeUrlToR2Key(`${CDN}/images/legacy.webp`, opts)).toBeNull();
    expect(normalizeUrlToR2Key(`${CDN}/etc/x.png`, opts)).toBeNull();
  });

  it('게이트 3: tmp/* 는 거부된다', () => {
    expect(normalizeUrlToR2Key(`${CDN}/tmp/mail/x.png`, opts)).toBeNull();
    expect(normalizeUrlToR2Key(`${CDN}/tmp/notice-attachment/y.pdf`, opts)).toBeNull();
  });

  it('경로 traversal·이중 슬래시는 거부된다', () => {
    expect(normalizeUrlToR2Key(`${CDN}/mail/../contact.csv`, opts)).toBeNull();
    expect(normalizeUrlToR2Key(`${CDN}/mail//x.png`, opts)).toBeNull();
  });

  it('query·hash 는 키에서 제거된다', () => {
    expect(normalizeUrlToR2Key(`${CDN}/mail/a.png?v=2#top`, opts)).toBe('mail/a.png');
  });
});

describe('extractR2KeysFromHtml', () => {
  it('img src 를 추출한다 (단일·복수·중복 제거)', () => {
    const html = `<p>안녕</p><img src="${CDN}/mail/a.webp"><img src="${CDN}/mail/b.webp"><img src="${CDN}/mail/a.webp">`;
    expect(extractR2KeysFromHtml(html, opts).sort()).toEqual(['mail/a.webp', 'mail/b.webp']);
  });

  it('data: URL 과 외부 도메인 src 는 무시한다', () => {
    const html = `<img src="data:image/png;base64,iVBOR..."><img src="https://svybx.kr/x/logo.png"><img src="${CDN}/mail/a.webp">`;
    expect(extractR2KeysFromHtml(html, opts)).toEqual(['mail/a.webp']);
  });

  it('img 태그가 없으면 빈 배열', () => {
    expect(extractR2KeysFromHtml('<p>텍스트만 있는 본문</p>', opts)).toEqual([]);
  });

  it('data-key 속성(공지 첨부)을 추출한다 — href 와 중복이면 1개', () => {
    const html = `<a data-file-attachment="true" data-key="notice-attachment/f.pdf" href="${CDN}/notice-attachment/f.pdf">파일</a>`;
    expect(extractR2KeysFromHtml(html, opts)).toEqual(['notice-attachment/f.pdf']);
  });

  it('data-key 가 tmp prefix 면 거부된다', () => {
    const html = `<a data-file-attachment="true" data-key="tmp/notice-attachment/f.pdf" href="${CDN}/tmp/notice-attachment/f.pdf">파일</a>`;
    expect(extractR2KeysFromHtml(html, opts)).toEqual([]);
  });

  it('data-link-bands(클릭영역 밴드) 파이프 구분 URL 을 추출한다 — 빈 세그먼트 허용', () => {
    const html = `<img src="${CDN}/mail/base.png" data-link-bands="${CDN}/mail/link-bands/h-top.png|${CDN}/mail/link-bands/h-mid.png|">`;
    expect(extractR2KeysFromHtml(html, opts).sort()).toEqual([
      'mail/base.png',
      'mail/link-bands/h-mid.png',
      'mail/link-bands/h-top.png',
    ]);
  });

  it('엔티티 인코딩(&amp;)을 해제한 뒤 추출한다', () => {
    const html = `<img src="${CDN}/mail/a.png?x=1&amp;y=2">`;
    expect(extractR2KeysFromHtml(html, opts)).toEqual(['mail/a.png']);
  });

  it('img src 한정이 아니다 — known host 문자열 전체 스캔 (배경 style 등)', () => {
    const html = `<div style="background-image:url(${CDN}/mail/bg.png)">x</div>`;
    expect(extractR2KeysFromHtml(html, opts)).toEqual(['mail/bg.png']);
  });
});

describe('extractR2KeysFromJsonbValue', () => {
  it('attachments 배열의 bare key 를 추출한다 — 빈 key·tmp key 는 제외', () => {
    const attachments = [
      { key: 'mail-attachment/u1.pdf', filename: 'a.pdf', size: 100, mime: 'application/pdf' },
      { key: '', filename: 'empty.pdf', size: 1, mime: 'application/pdf' },
      { key: 'tmp/mail-attachment/t.pdf', filename: 't.pdf', size: 1, mime: 'application/pdf' },
    ];
    expect(extractR2KeysFromJsonbValue(attachments, opts)).toEqual(['mail-attachment/u1.pdf']);
  });

  it('질문형 객체의 imageUrl·noticeContent HTML·테이블 셀 imageUrl 을 재귀 추출한다', () => {
    const question = {
      imageUrl: `${CDN}/survey/top.png`,
      videoUrl: 'https://youtube.com/watch?v=x',
      noticeContent: `<img src="${CDN}/survey/notice.png">`,
      tableRowsData: [{ cells: [{ imageUrl: `${CDN}/survey/cell.png` }, { label: '텍스트' }] }],
    };
    expect(extractR2KeysFromJsonbValue(question, opts).sort()).toEqual([
      'survey/cell.png',
      'survey/notice.png',
      'survey/top.png',
    ]);
  });

  it('응답 헤더 composed blocks 의 로고 imageUrl 을 추출한다', () => {
    const header = {
      kind: 'composed',
      blocks: [
        { type: 'mark', imageUrl: `${CDN}/survey/mark.png` },
        { type: 'logo', imageUrl: '' },
      ],
    };
    expect(extractR2KeysFromJsonbValue(header, opts)).toEqual(['survey/mark.png']);
  });

  it('null·숫자·불리언·중첩 null 은 안전하게 무시한다', () => {
    expect(extractR2KeysFromJsonbValue(null, opts)).toEqual([]);
    expect(extractR2KeysFromJsonbValue({ a: 1, b: true, c: null, d: [null] }, opts)).toEqual([]);
  });
});

describe('collectRemovedR2Keys — payload 존재 필드 한정 diff', () => {
  const oldRow = {
    noticeContent: `<img src="${CDN}/survey/old.png">`,
    imageUrl: `${CDN}/survey/keep.png`,
  };

  it('payload 에 있는 필드에서 빠진 키가 수집된다', () => {
    const removed = collectRemovedR2Keys(oldRow, { noticeContent: '<p>이미지 삭제됨</p>' }, opts);
    expect(removed).toEqual(['survey/old.png']);
  });

  it('payload 에 없는 필드는 비교하지 않는다 — 부분 update 오판 금지', () => {
    // imageUrl 이 payload 에 없으므로 keep.png 는 "빠짐"으로 오판되지 않는다
    const removed = collectRemovedR2Keys(oldRow, { title: '제목만 수정' }, opts);
    expect(removed).toEqual([]);
  });

  it('payload 필드값이 undefined 면 부재로 취급한다', () => {
    const removed = collectRemovedR2Keys(oldRow, { noticeContent: undefined }, opts);
    expect(removed).toEqual([]);
  });

  it('payload 필드값이 null 이면 제거로 취급한다', () => {
    const removed = collectRemovedR2Keys(oldRow, { noticeContent: null }, opts);
    expect(removed).toEqual(['survey/old.png']);
  });

  it('같은 키가 새 콘텐츠에 남아 있으면 수집되지 않는다 (다른 필드 경유 포함)', () => {
    const removed = collectRemovedR2Keys(
      { noticeContent: `<img src="${CDN}/survey/old.png">` },
      { noticeContent: '<p>본문에서 뺌</p>', imageUrl: `${CDN}/survey/old.png` },
      opts,
    );
    expect(removed).toEqual([]);
  });
});

describe('diffRemovedR2Keys — 단순 차집합 (구 diffOrphan* 흡수)', () => {
  it('기존에 있고 새 버전에 없는 키 반환', () => {
    expect(diffRemovedR2Keys(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });

  it('빠진 것 없으면 빈 배열, 양쪽 빈 배열도 빈 배열', () => {
    expect(diffRemovedR2Keys(['a'], ['a', 'b'])).toEqual([]);
    expect(diffRemovedR2Keys([], [])).toEqual([]);
  });

  it('old 내 중복은 제거, 대소문자는 구분', () => {
    expect(diffRemovedR2Keys(['k', 'k', 'K'], ['K'])).toEqual(['k']);
  });
});

describe('extractMailContentKeys — bodyHtml + attachments 조합', () => {
  it('본문 이미지 키와 첨부 키를 함께 추출한다', () => {
    const keys = extractMailContentKeys(
      {
        bodyHtml: `<img src="${CDN}/mail/a.webp">`,
        attachments: [
          { key: 'mail-attachment/f.pdf', filename: 'f.pdf', size: 1, mime: 'application/pdf' },
        ],
      },
      opts,
    );
    expect(keys.sort()).toEqual(['mail-attachment/f.pdf', 'mail/a.webp']);
  });

  it('null/undefined 입력은 빈 배열', () => {
    expect(extractMailContentKeys({ bodyHtml: null, attachments: null }, opts)).toEqual([]);
    expect(extractMailContentKeys({}, opts)).toEqual([]);
  });
});
