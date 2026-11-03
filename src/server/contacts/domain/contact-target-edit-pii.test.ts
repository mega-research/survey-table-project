import { describe, expect, it } from 'vitest';

import type { ContactColumnScheme } from '@/shared/contracts/contacts';

import { type StoredPiiPlain, diffContactTargetPii } from './contact-target-edit';

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: '지역', label: '지역', source: 'attrs.지역', order: 1 },
    {
      key: '대표자',
      label: '대표자 휴대폰번호',
      source: 'pii.대표자',
      order: 2,
      piiType: 'mobile',
    },
    { key: '메일', label: '담당자 이메일', source: 'pii.메일', order: 3, piiType: 'email' },
  ],
};

function stored(entries: Record<string, StoredPiiPlain>): Map<string, StoredPiiPlain> {
  return new Map(Object.entries(entries));
}

describe('diffContactTargetPii — 개인정보 열 저장의 변경 목록', () => {
  it('지금 행 없음 + 새 값은 입력, 다른 값은 변경, 새 값 없음은 삭제다', () => {
    const changes = diffContactTargetPii(
      stored({ 대표자: { plain: '010-1111-2222' }, 메일: { plain: 'a@b.co' } }),
      [
        { columnKey: '대표자', next: '010-3333-4444' },
        { columnKey: '메일', next: null },
        { columnKey: '새열', next: '홍길동' },
      ],
      scheme,
    );
    expect(changes).toEqual([
      { kind: 'pii', key: '대표자', label: '대표자 휴대폰번호', op: 'changed' },
      { kind: 'pii', key: '메일', label: '담당자 이메일', op: 'cleared' },
      { kind: 'pii', key: '새열', label: '새열', op: 'set' },
    ]);
  });

  it('같은 값과 없는 행을 비우는 것은 변경이 아니다', () => {
    expect(
      diffContactTargetPii(
        stored({ 대표자: { plain: '010-1111-2222' } }),
        [
          { columnKey: '대표자', next: '010-1111-2222' },
          { columnKey: '메일', next: null },
        ],
        scheme,
      ),
    ).toEqual([]);
  });

  it('복호화에 실패한 열은 같은 값을 보내도 변경, 비우면 삭제다', () => {
    const failed = stored({ 대표자: { failed: true }, 메일: { failed: true } });
    expect(
      diffContactTargetPii(
        failed,
        [
          { columnKey: '대표자', next: '010-1111-2222' },
          { columnKey: '메일', next: null },
        ],
        scheme,
      ),
    ).toEqual([
      { kind: 'pii', key: '대표자', label: '대표자 휴대폰번호', op: 'changed' },
      { kind: 'pii', key: '메일', label: '담당자 이메일', op: 'cleared' },
    ]);
  });

  it('같은 열이 두 번 오면 실제로 저장되는 마지막 값으로 판정한다', () => {
    expect(
      diffContactTargetPii(
        stored({ 대표자: { plain: '010-1111-2222' } }),
        [
          { columnKey: '대표자', next: '010-9999-9999' },
          { columnKey: '대표자', next: '010-1111-2222' },
        ],
        scheme,
      ),
    ).toEqual([]);
  });

  it('결과 어디에도 값이 실리지 않는다', () => {
    const changes = diffContactTargetPii(
      stored({ 대표자: { plain: '010-1111-2222' } }),
      [{ columnKey: '대표자', next: '010-3333-4444' }],
      null,
    );
    const serialized = JSON.stringify(changes);
    expect(serialized).not.toContain('1111');
    expect(serialized).not.toContain('3333');
    expect(changes).toEqual([{ kind: 'pii', key: '대표자', label: '대표자', op: 'changed' }]);
  });
});
