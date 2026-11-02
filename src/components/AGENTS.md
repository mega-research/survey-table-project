# 공용 UI — src/components

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## shadcn 으로 받기

- `components.json` 의 style 은 `base-vega` 다 — `shadcn add` 는 Base UI(`@base-ui/react`) 공식 판을 받는다.
- `ui/` 의 Base UI 부품(alert-dialog·button·checkbox·collapsible·combobox·dialog·dropdown-menu·input-group·label·navigation-menu·popover·select·switch·tabs·tooltip)은 **공식 판 원본 그대로**다(2026-11-02). 고쳐 쓰지 말고 쓰는 쪽에서 공식 API 를 따른다. `input`·`textarea`·`badge`·`card` 는 이 레포 것이라 받지 않는다(combobox 가 받아 오려 하면 덮어쓰지 말 것).
- **원본에서 바꾼 곳은 하나** — `popover.tsx` 의 `PopoverContent` 가 `anchor` 를 받는다(공식 combobox 와 같은 모양, 설문 카드·태그 편집이 쓴다). 다시 받아 덮어쓰면 이 줄이 사라지고 tsc 가 그 두 곳을 호명한다.
- 받은 파일은 npm `cn` 을 import 한다. `@/lib/utils` 의 `cn` 도 같은 패키지를 내보내 병합 규칙은 한 벌이다. 스타일은 `globals.css` 의 `tw-animate-css`·`shadcn/tailwind.css` import 와 shadcn 테마 토큰(`--primary` 등)에 기댄다.

## 쓰는 쪽이 지킬 공식 규칙

- **Select**: Root 에 `items`(`{ value, label }[]`)를 넘겨야 트리거에 라벨이 보인다 — 없으면 원시 value(id 등)가 보인다. 고르지 않음은 `null`(빈 문자열은 값으로 쳐서 placeholder 가 안 나온다)이라 `value={x || null}`, `onValueChange` 는 `null` 을 걸러 받는다. `SelectLabel` 은 `SelectGroup` 안에서만 쓴다.
- **Menu**: 선택은 `onClick`, 누른 뒤 열어 두려면 `closeOnClick={false}`. `DropdownMenuLabel` 은 `DropdownMenuGroup` 안에서만 쓴다 — 밖이면 「MenuGroupContext is missing」 런타임 오류다(타입은 통과).
- **AlertDialog**: `AlertDialogAction` 은 닫지 않는 버튼이다 — 처리가 끝나면 쓰는 쪽이 `open` 을 내린다(실패하면 창이 남는다). `AlertDialogCancel` 만 닫는다.
- **Dialog**: 바깥 클릭·Esc 차단은 Root 의 `disablePointerDismissal` 과 `onOpenChange(open, eventDetails)` 의 `reason` + `cancel()`.
- **render**: 다른 요소로 그리려면 `render`(옛 `asChild`). 그리는 요소가 `button` 이 아니면(Link·a·div) `nativeButton={false}` — `Button` 도 Base UI Button 이라 같다.
- **Checkbox·Switch**: span(`role=checkbox|switch`) + 숨은 input 이다. 콜백은 `(checked, eventDetails)`. 형제 `<Label htmlFor>` 는 숨은 input 에 이어져 누르면 켜진다.
- 상태 속성은 Base UI 것이다 — `data-checked`·`data-popup-open`·`data-highlighted`·`data-active`, CSS 변수는 `--anchor-width`·`--available-height`·`--transform-origin`.

## 테스트

- 메뉴·팝업은 누른 **다음 틱**에 열리고 Dialog 의 첫 포커스도 다음 틱에 옮겨진다 — 클릭 직후 `getBy*` 대신 `findBy*`, Dialog 에 타이핑하기 전에는 포커스가 창 안에 든 것을 기다린다(`user-rehire-modal.test.tsx`).
- 숨은 input 때문에 토글은 `getByLabelText` 가 둘을 찾는다 — `getByRole('switch'|'checkbox', { name })` 로 찾고, 비활성은 `toBeDisabled` 대신 `aria-disabled`. Select 옆에서 `querySelector('input')` 로 글자 칸을 찾지 않는다.
- 콜백 단언은 둘째 인자를 열어 둔다 — `toHaveBeenCalledWith(true, expect.anything())`.
