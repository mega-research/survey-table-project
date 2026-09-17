import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Radix Select 에서 항목 하나를 고른다.
 *
 * 네이티브 `<select>` 가 아니라 버튼(role=combobox) + 포털 리스트박스라
 * `userEvent.selectOptions` 가 통하지 않는다. 세 화면(재입사·팀 배정·일괄 배치)이 같은
 * 조작을 하므로 사본을 만들지 않는다.
 *
 * jsdom 의 Pointer Events 빈틈은 tests/setup.dom.ts 가 메운다.
 */
export async function selectOption(
  user: UserEvent,
  triggerName: string | RegExp,
  optionName: string | RegExp,
): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: triggerName }));
  const listbox = await screen.findByRole('listbox');
  await user.click(within(listbox).getByRole('option', { name: optionName }));
}
