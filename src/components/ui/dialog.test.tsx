import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from './dialog';

function openDialog(className?: string) {
  render(
    <Dialog open>
      <DialogContent className={className}>
        <DialogTitle>제목</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  return screen.getByRole('dialog');
}

describe('DialogContent 폭', () => {
  it('쓰는 쪽이 준 max-w 가 어느 화면 폭에서든 기본 폭을 대신한다', () => {
    const classes = openDialog('max-w-6xl').className.split(/\s+/);

    expect(classes).toContain('max-w-6xl');
    // 변형 붙은 기본 폭이 남으면 640px 이상에서 max-w-6xl 을 덮어쓴다
    expect(classes.filter((c) => /(^|:)max-w-/.test(c))).toEqual(['max-w-6xl']);
  });

  it('폭을 주지 않으면 화면 여백을 남긴 기본 폭을 쓴다', () => {
    const classes = openDialog().className.split(/\s+/);

    expect(classes.filter((c) => /(^|:)max-w-/.test(c))).toEqual([
      'max-w-[min(28rem,calc(100%-2rem))]',
    ]);
  });
});
