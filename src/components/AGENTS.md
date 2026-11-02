# 공용 UI — src/components

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## shadcn 으로 받기

- `components.json` 의 style 은 `base-vega` 다 — `shadcn add` 는 Base UI(`@base-ui/react`) 판을 받는다. 2026-11-02 에 Radix 판을 전부 걷었다.
- 받은 컴포넌트는 npm `cn`(shadcn 의 clsx + tailwind-merge 대체)을 import 한다. `@/lib/utils` 의 `cn` 도 같은 패키지를 내보내므로 병합 규칙은 한 벌이다.
- **이미 있는 `components/ui` 래퍼는 다시 받지 않는다**(`-o` 금지) — 아래 계약을 지키게 손봐 두어서, 덮어쓰면 쓰는 쪽이 타입 오류 없이 조용히 깨진다. 새 컴포넌트만 받는다.

## ui 래퍼가 지키는 계약

Radix 시절 쓰는 쪽(약 250파일)이 기대하던 모양을 래퍼가 맞춘다.

- **Select**: 자식의 `SelectItem` 에서 value·라벨을 모아 Root 의 `items` 로 넘긴다 — 없으면 Base UI 의 Value 가 라벨 대신 원시 value 를 그린다. 그래서 `SelectItem` 은 Select 의 JSX 안에 둔다(div·그룹 안은 괜찮고, 다른 컴포넌트로 감싸면 못 찾는다). value 는 문자열, `''`·`undefined` 는 고르지 않음(placeholder), `onValueChange` 는 문자열 하나만 받는다. 배치는 트리거 아래 펼침(`alignItemWithTrigger={false}`)이고 높이 상한은 Popup, 스크롤은 목록이다. `select.test.tsx` 가 못박는다.
- **Checkbox·Switch**: 네이티브 `button` 으로 그린다(형제 `<Label htmlFor>` 연결). `onCheckedChange` 는 켜짐 여부 하나만 넘긴다.
- **위치 prop**(`side`·`align`·`sideOffset`·`anchor` 등)은 Content 래퍼가 받아 Positioner 로 넘긴다. 트리거가 아닌 곳에 붙이려면 `anchor` 에 요소 ref·가상 요소를 준다(옛 `PopoverAnchor`).
- 다른 요소로 그리려면 `render`(옛 `asChild`). Trigger 가 button 이 아닌 요소를 그리면 `nativeButton={false}`.
- 메뉴 항목의 선택은 `onClick`(옛 `onSelect`), 누른 뒤 열어 두려면 `closeOnClick={false}`. 닫히는 버튼(`AlertDialogAction`·`DialogClose`)의 닫힘을 막으려면 `e.preventBaseUIHandler()` — `preventDefault()` 는 막지 못한다. Dialog 의 바깥 클릭·Esc 차단은 Root 의 `disablePointerDismissal` 과 `onOpenChange(open, eventDetails)` 의 `reason` + `cancel()`.
- 상태 속성은 Base UI 것이다 — `data-[checked]`·`data-[popup-open]`·`data-[highlighted]`·`data-[active]`, CSS 변수는 `--anchor-width`·`--available-height`·`--transform-origin`.

## 테스트

Base UI 의 메뉴·팝업은 누른 **다음 틱**에 열리고, Dialog 의 첫 포커스도 다음 틱에 옮겨진다. 클릭 직후 `getBy*` 대신 `findBy*` 로 기다리고, Dialog 에 타이핑하기 전에는 포커스가 창 안에 들어왔는지 기다린다(`user-rehire-modal.test.tsx`). Select 는 숨은 `input` 을 함께 그리므로 `querySelector('input')` 로 글자 칸을 찾지 않는다.
