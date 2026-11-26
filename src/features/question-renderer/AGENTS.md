# 질문 렌더러

> 루트 `AGENTS.md` 와 `src/features/AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 화면 폭에 맞춰 표 줄이기

- **화면 폭에 맞춰 표 줄이기**: `fitTableToWidth` — 표를 그리는 문항 공용, 기본 꺼짐(문항별 opt-in, 2026-10-29). 표 열 폭은 원래 px 고정이라 카드가 좁아져도(태블릿 세로 등) 표는 그대로 넘쳐 가로 스크롤이 된다. 켜면 **패드 폭(창 폭 768~1023px)에서만** 열 폭을 비율(`minmax(0, Nfr)`)로 바꿔 화면에 맞춰 줄이고 지정 총폭을 넘지 않는다. 데스크톱(1024px 이상 — 가로로 눕힌 패드 포함)은 켜 두어도 지정한 px 그대로라 창이 좁으면 가로 스크롤이고, 휴대폰은 모바일 표시 방식을 따른다(2026-11-24 — 그전에는 모바일이 아니면 늘 줄여, 저작자가 넣은 열 폭이 창 폭에 따라 비율로 바뀌었다). 판정은 `question-renderer/hooks/use-fit-table-to-width` 하나다. 줄인 화면에서는 좌측 고정 열을 쓰지 않는다(넘치지 않고, px 누적 오프셋이 줄어든 열과 어긋난다). 칸 안 보기 N열 그리드는 표 본문 표식(`fitTableMarker` → `data-fit-table`, globals.css)으로 풀린다 — 보기 한 칸이 1/N 폭이되 글자 폭보다 좁아지지 않아, 넉넉하면 그리드 자리 그대로·모자라면 보기째로 다음 줄이다(패드에서 글자가 칸 안에서 꺾였다). 오른쪽 끝선은 마지막 칸이 그리고(컨테이너 오른쪽 선을 빼 이중선을 없앴다) 칸을 둥근 모서리 안으로 잘라(`overflow: clip`) 네 모서리가 같은 둥근 모양이다. 헤더·본문·가상화 본문이 같은 폭 스타일을 써야 열이 어긋나지 않으므로 grid 폭은 `table-grid-utils` 의 `resolveTableGridSizing` 하나로 낸다. 「화면 너비」(`forceWideLayout`)는 카드의 최대 폭일 뿐 표 폭과 무관하다. 태블릿 기준 폭: md 이상에서 표가 쓸 수 있는 폭 ≈ 화면 폭 − 180px(페이지 48 · 문항 카드 64 · 문항 16 · 표 카드 안쪽 48 · 테두리) — 원본 표 모드가 시작되는 768px 에서 약 588px. 숫자로 맞추기보다 이 옵션을 켜는 편이 확실하다(2026-10-29 만족도 조사에서 130px 로 잘못 잡아 680px 표가 넘쳤다).

## 모바일 원본 표 조각의 설정

> **제목 아래 입력칸** (`cell.mobileBelowRowTitle`, input 셀, 2026-11-20): 모바일 「행별 원본」·「행별 척도」에서 그 줄 조각의 응답 칸이 전부 이 표식을 켠 입력 칸이면 원본 표 조각 대신 행 제목 아래 화면 폭으로 그린다(척도 표 맨 아래 서술형 줄). 판정은 `features/question-renderer/utils/mobile-row-wise-original.ts` 의 `collectBelowTitleCells` 하나이고 두 호스트(표 문항·보기 소스 표)가 같은 시트로 그린다. 빌더 화면은 없고 스크립트로 적는다(칸 필드 정책 `kept`). 상세 CONTEXT.md 「제목 아래 입력칸」.

> **조각 좌우 반전 · 조각 한 화면 칸 수** (`mobileDrilldownReverseColumns` · `mobileDrilldownColumnsPerView`, 문항 컬럼 0174): 원본 행 상세 설정의 나머지 둘. **좁은 화면에서 한 행을 통째로 그리는 원본 표 조각**(「행별 원본 문항 보기」 · 「선택 행 원본 보기」, 「행별 척도」의 막대 없는 행)에만 적용하고, PC·패드 표 · 넓은 화면의 행 단위 배치 · 원본 한 줄 조각 · 척도 막대·슬라이더에는 적용하지 않는다 — 같은 조각 컴포넌트를 쓰므로 호스트가 `pieceSettings` 를 넘기는지로 가른다. 판정은 `features/question-renderer/utils/mobile-piece-arrangement.ts` 하나(반전 · 「평균에서 제외」 고정 칸 · 경계를 따라가는 세로선 숨김 · 폴백 사유 · 칸 수 대상 · 머리 글자 넘김 방향)이고 그리기 직전에 부른다 — 척도 막대·슬라이더의 머리 읽기와 행 제목 판정은 뒤집기 전 조각을 읽는다. 칸 폭은 자리 폭을 그리기 전에 재서 내고(`useElementWidthBeforePaint`), 칸이 44px 보다 좁아지는 폰에서는 칸 수를 줄인다(320px 폰은 6칸 → 5칸). 표 문항은 칸 수를 켠 문항에서만 좁은 화면의 표 카드 좌우 여백을 걷어 보기 소스 표와 자리 폭을 맞춘다. 응답 키는 칸 id 라 저장·검증·내보내기는 무변경이다. 칸 수 범위(3~6)는 `@/types/mobile-table-display` 가 SSOT 이고 스키마 check·마이그레이션과의 대조는 `tests/repo/mobile-piece-columns-per-view-column.test.ts`. 빌더 경고는 `survey-builder/lib/mobile-piece-diagnostics` 가 같은 판정을 부른다. 상세는 그 모듈 머리 주석.

## 보기 모양과 척도 슬라이더

보기 그룹 한 섹션의 **보기 모양은 넷 중 하나**다 — 세로 타일(기본) · 원본 한 줄(`mobileOriginalLine`) · 척도 막대(`mobileScaleBar`) · 척도 슬라이더(`scaleSlider`). 보기 그룹 JSONB 의 세 필드이고 서로 배타이며, 읽기·쓰기는 `question-renderer/utils/choice-group-mobile-view` 하나다(둘 이상 적힌 값은 슬라이더 → 막대 → 원본 한 줄 → 타일 순으로 하나만 읽힌다). 앞의 셋은 모바일 「행 단위 그룹 카드」·「행별 척도」에서만 읽고, **척도 슬라이더는 웹과 모바일 둘 다에 적용한다**(2026-11-24, CONTEXT.md 「척도 슬라이더」) — 타입·파일 이름의 `Mobile` 은 셋만 있던 때의 이름이다.

- **켜는 설정은 둘이고 표마다 하나만 읽는다**: radio 보기 그룹의 `ChoiceGroup.scaleSlider`(JSONB), 문항의 `Question.scaleSlider`(컬럼, 0173). 값은 슬라이더 방향(어휘 `@/types/scale-slider`) — 있으면 켜진 것이고 그 값이 긍정 방향이다. 문항 설정은 보통 라디오 문항과, 라디오·체크박스 그룹이 하나도 없는 라디오 보기 소스 표만 읽는다 — 어느 표가 읽는지는 `canChoiceTableUseQuestionScaleSlider` 한 곳이 정하고 응답 호스트와 빌더 스위치가 같이 쓴다(서버는 유형과 무관하게 저장한다). 빌더 스토어에는 「끄기」로 null 이 오므로 켜졌는지는 `isScaleSliderDirection` 으로 본다(`=== undefined` 금지). 발행 스냅샷에 실려 재발행해야 실응답 화면에 반영된다.
- **그릴지의 판정은 투영이다**: 표는 `question-renderer/utils/scale-slider` 의 `projectScaleSlider`, 보통 라디오 문항은 `utils/radio-option-scale-slider` 의 `projectRadioQuestionScaleSlider`(같은 모델·같은 폴백 어휘). 헤더 읽기는 척도 막대와 함께 쓰는 코어 `utils/scale-header-reading` 이고 막대 투영(12칸 상한)의 출력은 그대로다. 눈금은 2~13개, 「평균에서 제외」(`excludeFromMean`) 보기는 눈금이 아니라 척도 밖 보기(체크)다.
- **표 배치 판정은 한 곳**: `utils/scale-slider-table-layout` 의 `resolveScaleSliderTableLayout`. 호스트는 그 결과를 실은 `resolveRenderedTableDisplay` 의 `activeMode`(지금 실제로 그려지는 표시 방식) 하나만 견준다 — 저작한 `mobileTableDisplayMode` 를 직접 견주면 슬라이더가 배치를 가져간 동안 옛 방식의 전용 장치가 샌다(호스트 밖에서는 `resolveChoiceTableRenderedDisplay`). 슬라이더로 그려지는 행이 있으면 넓은 화면도 표 대신 행 단위 배치이고, 좁은 화면은 「행 단위 그룹 카드」만 그 카드 안에서·그 밖은 고른 표시 방식과 무관하게 「행별 척도」처럼 그린다. 없으면(설정이 없거나 모든 행이 폴백) 지금과 같다. 그려지는 행은 응답이 아니라 표의 구조로 본다(`tableHasScaleSliderRow`) — 빌더 안내가 같은 함수를 부른다. 넓은 화면의 행 단위 배치는 슬라이더가 아닌 보기 그룹을 원본 표 조각으로 왼쪽에 붙여 그리고, 글자 입력칸뿐인 조각은 열 이름 + 넓은 입력칸으로 풀며(`resolveWideTextInputFields`), 격자 전용 장치(좌측 고정 열 · 화면 폭에 맞춰 표 줄이기 · 표 아래 상세 기재 · 머리글 입력칸)는 적용하지 않는다.
- **슬라이더를 그리는 호출부만 슬라이더 투영을 부른다**: 행 배치 `projectRowSliderLayout`·`projectRowWiseSliderLayouts`(`utils/row-scale-bars`), 그룹 카드 섹션 `projectChoiceGroupSectionViewWithSlider`(`utils/choice-group-section-view`). 옛 함수(`projectRowScaleLayout`·`projectChoiceGroupSectionView`)는 그대로이고 슬라이더 그룹을 원본 한 줄로 낸다 — 조각 종류를 타입으로 갈라, 그릴 줄 모르는 호출부가 슬라이더 조각을 받지 않는다.
- **컴포넌트는 그리기만 한다**(`question-renderer/scale-slider.tsx`): 고르기·다시 눌러 풀기는 호스트의 기존 토글(`onToggleChoice`)이라 응답 키·저장 모양·검증·내보내기·척도 평균이 달라질 수 없고, 끄는 동안에는 콜백을 부르지 않아 스친 눈금 때문에 숨은 답이 지워지지 않는다. 호스트는 셋 — 표 문항(`table-choice-group-scale-slider`), 보기 소스 표(`choice-table-response`), 보통 라디오 문항(`radio-question-scale-slider` — 응답 화면과 빌더 미리보기 카드 공용). 새 호스트는 화면에 보이는 제목 요소의 id 를 `ariaLabelledBy` 로 넘긴다(문서에 없는 id 면 이름 없는 묶음이 된다). 포인터·키보드·비활성·낭독 이름·좁은 화면 규칙은 그 파일 머리 주석이 정본이다.
- **빌더**: 그룹은 보기 칸 편집의 「보기 모양」, 문항은 기본 탭의 스위치(`question-edit/question-scale-slider-fields`)다. 폴백 경고는 `survey-builder/lib/scale-slider-diagnostics` 가 응답 화면과 같은 판정을 불러 두 자리에 내고, 모바일 표시 방식 옆 안내도 같은 표 배치 판정을 부른다 — 규칙을 빌더에 다시 쓰면 경고와 화면이 갈린다.

## 그 밖의 렌더 규칙

- **금액 읽기**: 숫자 칸 입력란 아래 읽기(`numberFormat.unit`·`unitSuffix`)는 현재 언어를 따른다 — `utils/number-format` 의 `formatUnitReading(raw, unit, suffix, locale)`(훅 `use-formatted-numeric-input` 이 부른다). 한국어는 기존 `formatKoreanUnitReading` 그대로(「1,500만원」), 中文은 万·亿 로 끊고 묶음 안은 숫자 그대로(「111万1111元」), English 는 백만 이상을 million·billion·trillion 소수 둘째 자리까지(「1.11 million USD」, 어절 앞 띄움), Tiếng Việt 는 영어와 같은 규칙에 낱말만 triệu·tỷ·nghìn tỷ. 만(영어·베트남어는 백만) 미만은 콤마 숫자 + 어절. 중·영판 금액 칸은 `unit: 'one'` + 통화 어절을 준다.

> **이미지 크게 보기**: 설정 없는 기본 기능(표 이미지 · 순위형 보기 이미지 · 안내문·설명 본문 이미지). 표 이미지는 `TableImageEnlargeProvider` 안에서만 켜진다(빌더 편집 표는 밖). 창은 휴대폰 뒤로 가기로 닫히도록 방문 기록 칸을 하나 쌓는다 — 페이지 위에 칸을 쌓는 기능을 새로 만들면 지금 칸(`stepIndex` 포함)을 이어 쌓는 같은 방식을 따를 것. 상세는 `image-enlarge.ts` 머리 주석.

## 용어집에서 옮긴 상세

용어의 뜻은 CONTEXT.md 에 있고, 여기는 그 항목에 붙어 있던 규칙의 상세다.

### 문항 접어 두기

**문항 접어 두기**(`Question.collapseButtonLabel`, 0154): 문항 공통 설정 — 버튼 글자를 적으면 응답 화면에서 그 문항 자리에 붙임 파일 모양의 버튼(글자 + 시스템 글자 「펼쳐 보기」·「접기」, 붙이면 클립 아이콘)만 보이고, 누르면 문항 전체(제목·설명·입력)가 버튼 아래에 펼쳐지며 다시 누르면 접힌다(유가공업 문1 아래 「제품 품목 코드표」). 비우거나 공백뿐이면 꺼짐 = 기존 화면. 펼침은 저장하지 않는다(페이지를 다시 그리면 접힌 채). 보이기만 바꿔 검증·저장·내보내기는 무변경이고 — 그래서 **접힌 동안에도 문항을 그려 두고 `hidden` 으로 숨긴다**(그리지 않으면 명단 값·빈값 기본치 자동 채움이 돌지 않아 그 값을 읽는 후속 조건까지 달라진다) — **검증 문제(필수 강조·이슈·변동 확인)가 있으면 접힌 채로 두지 않고 펼치며 고친 뒤에도 펼친 채로 둔다** — 막힌 이유가 접힌 문항 안에 숨으면 안 된다. 판정 `GroupStepItem` 의 `resolveCollapsedQuestionOpen`. 응답 흐름(응답 화면·테스트 링크·관리자 미리보기)만 접고 빌더 미리보기 카드는 저작 화면이라 접지 않는다. 버튼 글자는 저작자 문구라 번역하지 않고 토큰만 푼다. **앞 문항 설명 밑에 붙이기**(`collapseAttachToPrevious`, 0155)를 켜면 버튼이 제자리가 아니라 같은 페이지에서 바로 앞에 그려지는 문항의 설명과 입력 사이에 글자 버튼으로 들어가고 그 자리에서 펼쳐진다(유가공업 문1 설명 밑 「[붙임] 제품 품목 코드표」) — 문항 id 로 잇지 않고 「바로 앞」으로 정해 복제·보관함에서 연결이 깨지지 않는다. 앞에 그릴 문항이 없으면(페이지 첫 문항, 앞 문항이 조건으로 숨음) 제자리에 그린다. 판정 `survey-response/lib/attached-questions` 의 `groupAttachedItems`. 안내문 HTML `<details>` 로 하지 않은 이유 — sanitize 가 지우고 빌더 편집기가 다시 저장하면 사라지며, 표가 안내문 안에 들어가 모바일에서 찌그러진다(표 문항은 모바일 표시 방식을 그대로 쓴다).

### 고친 프리필 따로 내보내기

**고친 프리필 따로 내보내기**(`TableCell.exportPrefillEdit`, 2026-11-05): 고칠 수 있는 프리필 칸에 켜면 내보내기(Raw·분할·.sav)에 원 변수 바로 옆 `<변수>_upd` 열(라벨 「(수정값)」, String)이 서고, 응답자가 **명단 값과 다르게 낸** 응답에서만 그 값이 실린다 — 원 변수는 늘 응답 값이다(유가공업 SQ1 사업체 전화번호 — 웹 버전의 「수정 전화번호」). 판정은 **저장 때** 한다: 응답 확정(`answer-finalization` 의 `withPrefillEdits`, 완료 제출·관리자 수정)이 응답 화면과 같은 명단 값(개인정보 열 포함)으로 템플릿을 풀어 **칸 형식의 같은 값 기준**(번호 형식은 숫자만 · 날짜는 연·월·일 · 숫자 칸은 쉼표를 뺀 수 · 그 밖은 앞뒤 공백을 걷은 글자 — 응답 화면이 제출 직전 형식 칸을 정돈하므로 글자 그대로 견주면 손대지 않은 번호도 고친 것이 된다)으로 비교해, 다른 칸 id 를 루트 사이드카 `__prefillEdits__`(`{문항 id: 칸 id[]}`, 값은 싣지 않는다 — `utils/prefill-edits-sidecar`)에 적는다. 내보낼 때 명단과 비교하지 않는 이유 — 담당자가 나중에 명단 값을 응답자가 알려 준 값으로 고치면 「고쳤다」가 사라진다. 응답자가 보낸 표식은 믿지 않고 덮어쓰며, 스냅샷이 없으면 지운다. 값이 빈 칸은 고친 것으로 보지 않는다(실을 값이 없다). 진행 중·이탈 응답은 확정 전이라 `_upd` 가 비어 있다(값 자체는 원 변수에). 관리자 수정은 그때의 명단 값으로 다시 판정한다.
