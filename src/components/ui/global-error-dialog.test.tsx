import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { GlobalErrorDialog } from '@/components/ui/global-error-dialog';
import { useErrorDialogStore } from '@/stores/error-dialog-store';

// jsdom 에서 Radix UI 포인터 API가 없어 에러가 발생하므로 최소 스텁 주입.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

beforeEach(() => {
  // 테스트 간 zustand 상태 격리
  useErrorDialogStore.setState({ open: false, title: '', description: undefined, issues: undefined });
});

describe('GlobalErrorDialog', () => {
  it('issues 목록을 변수명-질문-사유 행으로 렌더한다', async () => {
    render(<GlobalErrorDialog />);
    act(() => {
      useErrorDialogStore.getState().show({
        title: 'SPSS 변수명 오류로 배포가 중단되었습니다',
        issues: [
          { varName: 'Q1-1', questionText: '전시회 참가 횟수', reason: '허용되지 않는 문자' },
          { varName: 'q1_1', questionText: '참가 형태', reason: "변수명이 'Q1_1'와 중복됩니다." },
        ],
      });
    });
    expect(await screen.findByText('SPSS 변수명 오류로 배포가 중단되었습니다')).toBeInTheDocument();
    expect(screen.getByText('Q1-1')).toBeInTheDocument();
    expect(screen.getByText('전시회 참가 횟수')).toBeInTheDocument();
    expect(screen.getByText('허용되지 않는 문자')).toBeInTheDocument();
  });

  it('description만 있는 에러도 표시한다', async () => {
    render(<GlobalErrorDialog />);
    act(() => {
      useErrorDialogStore.getState().show({
        title: '저장 실패',
        description: '네트워크 오류가 발생했습니다.',
      });
    });
    expect(await screen.findByText('네트워크 오류가 발생했습니다.')).toBeInTheDocument();
  });

  it('확인 버튼이 다이얼로그를 닫는다', async () => {
    render(<GlobalErrorDialog />);
    act(() => {
      useErrorDialogStore.getState().show({ title: '오류' });
    });
    const confirmButton = await screen.findByRole('button', { name: '확인' });
    act(() => {
      confirmButton.click();
    });
    expect(useErrorDialogStore.getState().open).toBe(false);
  });
});

describe('GlobalErrorDialog - 연속 호출 상태 잔류 방지', () => {
  it('issues 있는 에러 후 issues 없는 에러를 띄우면 이전 목록이 사라진다', async () => {
    render(<GlobalErrorDialog />);
    act(() => {
      useErrorDialogStore.getState().show({
        title: '변수명 오류',
        issues: [{ varName: 'Q1-1', questionText: '질문', reason: '허용되지 않는 문자' }],
      });
    });
    expect(await screen.findByText('Q1-1')).toBeInTheDocument();

    act(() => {
      useErrorDialogStore.getState().show({ title: '저장 실패' });
    });
    expect(await screen.findByText('저장 실패')).toBeInTheDocument();
    expect(screen.queryByText('Q1-1')).not.toBeInTheDocument();
  });
});
