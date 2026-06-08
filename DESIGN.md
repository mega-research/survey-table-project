# 설문조사 프로그램 — 디자인 시스템

> **시스템 출처 노트.** 이 시스템은 "모노크롬 코어 + 오버사이즈 파스텔 컬러블록"이라는
> 에디토리얼 디자인 언어를 우리 프로젝트의 오리지널 디자인 시스템으로 채택한 것입니다.
> 독점 서체(`figmaSans`/`figmaMono`)나 특정 브랜드의 워드마크·UI는 사용하지 않습니다.
> 서체로 **Wanted Sans**(sans, 한글+라틴) + **JetBrains Mono**(mono)를 사용하며, 워드마크와
> 브랜드 자산은 우리 자체 제작물을 씁니다. 숫자는 항상 `tabular-nums` + `slashed-zero`.

---

## Overview

시스템의 뼈대는 **에디터처럼 깨끗한 흑백 프레임**입니다. 크롬(상단 내비, 본문 타입,
푸터, primary CTA)은 모두 모노크롬입니다. 헤드라인은 가변 sans를 공격적인 음수 자간으로
크게 세팅하고, 본문은 같은 가변 패밀리의 320–340 웨이트 부근, 작은 mono `{typography.eyebrow}` /
`{typography.caption}` 라벨(대문자, 양수 자간)이 섹션 마커 역할을 합니다. 모든 CTA는
pill(`{rounded.pill}`)이며, primary 액션은 어디서나 동일한 검정 `{components.button-primary}` +
흰색 `{components.button-secondary}` 페어입니다.

이 시스템의 정체성은 그 흑백 북엔드 **사이**에서 나옵니다: 페이지가 반복적으로 오버사이즈
파스텔 **컬러블록 섹션**(라임, 라벤더, 크림, 민트, 핑크, 코랄, 딥 네이비)으로 떨어집니다.
콘텐츠 폭 전체를 `{rounded.lg}` 코너 + `{spacing.xxl}` 내부 패딩으로 채우며, 스토리텔링이
여기서 일어납니다. 카드 안의 액센트가 아니라, 한 화면 분량의 세로 공간을 차지하는 거대한
포스터입니다.

**핵심 특성**
- 모노크롬 시스템 코어: `{colors.primary}`(검정) + `{colors.canvas}`(흰색)가 모든 CTA·본문·푸터 링크를 담당.
- 오버사이즈 파스텔 **컬러블록 섹션**(`{colors.block-*}`)이 긴 페이지의 내러티브 리듬을 정의.
- pill이 유일한 버튼 모양 — 텍스트 CTA는 `{rounded.pill}`, 아이콘 버튼은 `{rounded.full}`. 사각 버튼 없음.
- 가변 sans를 미세 웨이트 증분(320, 330, 340, 450, 480, 540, 700)으로 사용 — 단일 보이스가 유연하게 변주.
- 디스플레이 사이즈에 타이트한 음수 자간으로 자신감 있는 에디토리얼 운율.
- mono는 카테고리 라벨/eyebrow/caption 전용 — 항상 대문자, 양수 자간.

> **밀도 구분(중요).** 공개 설문 응답 페이지·랜딩은 **저밀도**(파스텔 컬러블록 + 오버사이즈 타입 + `section`(96) 리듬)로, 빌더·운영 콘솔·결과 대시보드는 **고밀도 도구 UI**(좁은 간격·작은 타입·표 중심·웨이트 위계)로 간다 — 컬러블록과 디스플레이 스케일은 도구 화면에 그대로 적용하지 않는다.

---

## Colors

### Brand & Accent
- **Black** `{colors.primary}` — 시스템 primary. 모든 primary CTA, 헤드라인, 본문, 다크 섹션의 역상 캔버스.
- **White** `{colors.on-primary}` — 검정 표면의 역상 텍스트, secondary pill 버튼의 전경.
- **Magenta Promo** `{colors.accent-magenta}` — 프로모션 인라인 버튼 전용 채도 높은 핑크. 아주 드물게. 섹션 색이 아님.

### Surface
- **Canvas** `{colors.canvas}` — 기본 배경, 모든 흰색 카드의 바탕.
- **Inverse Canvas** `{colors.inverse-canvas}` — 푸터, 마퀴 스트립, 다크 스토리 섹션.
- **Surface Soft** `{colors.surface-soft}` — 흰 캔버스 위 아이콘 버튼·템플릿 카드·일러스트 타일의 오프화이트 배경.
- **Hairline** `{colors.hairline}` — 폼 인풋·카드·테이블 구분선 1px 보더.
- **Hairline Soft** `{colors.hairline-soft}` — 더 옅은 구분선(테이블 행 구분, 푸터 컬럼 룰).
- **Block 색상** — `{colors.block-lime}` · `{colors.block-lilac}` · `{colors.block-cream}` · `{colors.block-mint}` · `{colors.block-pink}` · `{colors.block-coral}` · `{colors.block-navy}`.

### Text
- **Ink** `{colors.ink}` — 밝은 표면의 모든 헤드라인·본문·caption. 중간 회색 텍스트 역할 없음 — 위계는 **불투명도가 아니라 웨이트**로.
- **Inverse Ink** `{colors.inverse-ink}` — 역상 표면(푸터, 마퀴, 네이비 블록)의 텍스트.
- **On-Inverse Soft** `{colors.on-inverse-soft}` — 다크 섹션 위 원형 아이콘 버튼 표면용 ~16% 흰색.

### Semantic
- **Success Green** `{colors.semantic-success}` — 비교 표 체크마크. 표면이 아니라 글리프 채움.
- **Overlay Scrim** `{colors.overlay-scrim}` — 모달/오버레이 뒤 ~60% 검정.

### 권장 hex (대체 팔레트 근사값)
```
--color-primary:        #0d0d0d;
--color-canvas:         #ffffff;
--color-on-primary:     #ffffff;
--color-accent-magenta: #f24aa0;
--color-inverse-canvas: #0d0d0d;
--color-surface-soft:   #f5f5f4;
--color-hairline:       #e5e5e3;
--color-hairline-soft:  #efefed;
--color-ink:            #0d0d0d;
--color-inverse-ink:    #ffffff;
--color-block-lime:     #d6f25a;
--color-block-lilac:    #d9d2f5;
--color-block-cream:    #f5ead6;
--color-block-mint:     #c6efd9;
--color-block-pink:     #f5d2e3;
--color-block-coral:    #f5b8a0;
--color-block-navy:     #1a1f4d;
--color-success:        #2faa5b;
```

---

## Typography

### Font Family
- **Sans (본문/디스플레이)** — **Wanted Sans** 가변. 스택:
  `"Wanted Sans Variable", "Wanted Sans", -apple-system, "SF Pro Display", system-ui, sans-serif`.
  한글+라틴 모두 커버. 미세 웨이트 증분(320, 330, 340, 450, 480, 540, 700)으로 사용.
  *Wanted Sans는 x-height가 다소 커서 디스플레이 사이즈 line-height를 ~0.02 낮춰 보정.*
- **Mono (라벨/캡션)** — **JetBrains Mono**. 스택: `"JetBrains Mono", "SF Mono", menlo`.
  eyebrow·caption 전용, 항상 대문자 + 양수 자간.

OpenType `kern` 전 역할 활성화.

### Numeric Features (필수)
설문 프로그램은 숫자(응답 수, 비율 %, 점수, 페이지 번호, 날짜)가 표·스텝퍼·결과
대시보드에서 정렬되어야 하므로 **숫자는 항상 다음 두 OpenType 기능을 켠다**:
- **`tnum` (tabular-nums)** — 모든 자릿수가 동일 폭. 표/리스트/카운터에서 숫자가 세로로 정렬됨.
- **`zero` (slashed-zero)** — 0을 사선으로. O/0 혼동 방지(설문 ID·코드·통계값에서 중요).

```css
/* 전역 유틸 — 숫자가 표/통계/스텝퍼에 들어가는 모든 곳에 적용 */
.tnum,
.stat, .data-table td, .pagination, .stepper, time, .survey-id {
  font-variant-numeric: tabular-nums slashed-zero;
  /* 폴백: */
  font-feature-settings: "tnum" 1, "zero" 1;
}
```
- 본문 산문(긴 문장 속 숫자)은 기본 proportional 유지 가능 — `tnum`은 **표·통계·정렬이 필요한 숫자 전용**.
- `slashed-zero`는 전역으로 켜도 무방(브랜드 톤상 거슬리지 않음).

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `display-xl` | 86px | 340 | 1.00 | -1.72px | 히어로 헤드라인 |
| `display-lg` | 64px | 340 | 1.10 | -0.96px | 섹션 오프너 헤드라인 |
| `headline` | 26px | 540 | 1.35 | -0.26px | 컬러블록 내 스토리 타이틀 |
| `subhead` | 26px | 340 | 1.35 | -0.26px | 헤드라인급 인트로 문단 |
| `card-title` | 24px | 700 | 1.45 | 0 | 카드/티어 타이틀 |
| `body-lg` | 20px | 330 | 1.40 | -0.14px | 리드 본문, 폼 라벨 |
| `body` | 18px | 320 | 1.45 | -0.26px | 기본 본문 |
| `body-sm` | 16px | 330 | 1.45 | -0.14px | 카드 본문, 푸터 링크 |
| `link` | 20px | 480 | 1.40 | -0.10px | 인라인 링크 강조 |
| `button` | 20px | 480 | 1.40 | -0.10px | 모든 pill 버튼 |
| `eyebrow` | 18px | 400 | 1.30 | 0.54px | mono 대문자 eyebrow |
| `caption` | 12px | 400 | 1.00 | 0.60px | mono 대문자 caption, 푸터 컬럼 헤드 |

### Principles
- **본문 위계는 사이즈가 아니라 웨이트로.** 20px/330 문단 옆 20px/480 링크 — 스케일 변화 없이 강조.
- **음수 자간은 사이즈에 비례.** display-xl -1.72px, subhead -0.26px, 본문은 0 근처.
- **mono는 택소노미, 본문 아님.**
- **디스플레이는 타이트(1.00–1.10), 본문은 여유(1.40–1.45) line-height.**

---

## Layout

### Spacing (base 8px)
`hair` 1 · `xxs` 4 · `xs` 8 · `sm` 12 · `md` 16 · `lg` 24 · `xl` 32 · `xxl` 48 · `section` 96 (px)
- 컬러블록 섹션 내부 패딩: `xxl`(48).
- 카드 내부 패딩: `lg`(24).
- 폼 인풋: 12 세로 · 14 가로.
- pill 버튼: 8–10 세로 · 24 가로.
- 주요 섹션 간 세로 리듬: `section`(96).

### Grid & Container
- 최대 콘텐츠 폭 ~1280px, 사이드 거터는 데스크탑 `xxl` → 모바일 `lg`.
- 데스크탑 3·4컬럼 그리드.
- 컬러블록은 컬럼 그리드를 깨고 콘텐츠 폭 전체를 차지, 내부에 단일 에디토리얼 컬럼.

### Whitespace
- 모든 컬러 패널 사이에 흰 캔버스 + `section`(96) 여백을 둬서 블록이 의도적으로 읽히게.
- 블록 내부 타입은 양옆 여백을 넉넉히(블록 폭의 1/4 이상) — 벽이 아니라 포스터처럼.

---

## Elevation

| Level | Treatment | Use |
|---|---|---|
| 0 flat | 그림자·보더 없음 | 컬러블록, 역상 푸터, 히어로 |
| 1 hairline | `{colors.hairline}` 1px 보더 | 카드, 폼 인풋, 테이블 셀 |
| 2 soft | `0 4px 16px rgba(0,0,0,0.06)` | 플로팅 타일, 드롭다운 |
| 3 modal | 강한 그림자 + `overlay-scrim` | 라이트박스 오버레이 |

그림자는 최소화 — 컬러블록 자체가 깊이 장치. 흰 캔버스 → 라임/라벤더/크림 전환이 섹션 구분이다.

---

## Shapes — Border Radius

| Token | Value | Use |
|---|---|---|
| `xs` | 2px | 앵커/링크 장식 코너 |
| `sm` | 6px | 작은 칩, 서브내비 탭 |
| `md` | 8px | 폼 인풋, 리스트, 이미지 프레임 |
| `lg` | 24px | 카드, 컬러블록 섹션, 큰 이미지 컨테이너 |
| `xl` | 32px | 히어로 패널, 오버사이즈 콜아웃 |
| `pill` | 50px | 모든 텍스트 CTA |
| `full` | 9999px | 원형 아이콘 버튼, 체크마크 글리프 |

- 이미지 프레임은 `md`(8px). 아바타 원형은 마케팅 표면에 사용 안 함.

---

## Components

### Buttons
- **button-primary** — 검정 pill. 배경 `primary`, 텍스트 `on-primary`, `typography.button`, 패딩 10/20, `rounded.pill`.
- **button-secondary** — 흰 pill + 검정 텍스트. 배경 `canvas`, 텍스트 `ink`, 패딩 8/18/10(비대칭), `rounded.pill`, 보더 없음.
- **button-tertiary-text** — 텍스트 링크형 히트타겟. `typography.link`, `rounded.full`, 패딩 xs/sm.
- **button-icon-circular** — 40px 원형. 배경 `surface-soft`, 텍스트 `ink`, `rounded.full`.
- **button-icon-circular-inverse** — 다크 표면용. 배경 `on-inverse-soft`(반투명 흰), 텍스트 `inverse-ink`.
- **button-magenta-promo** — 프로모 전용 핑크 pill. 배경 `accent-magenta`, 텍스트 `on-primary`. 페이지당 1개.

### Tabs / Toggle
- **tab-default** — 배경 `canvas`, 텍스트 `ink`, `rounded.pill`.
- **tab-selected** — 배경 `primary`, 텍스트 `on-primary` (= button-primary 표면). "선택 = primary 표면".

### Inputs
- **text-input** — 배경 `canvas`, 텍스트 `ink`, `typography.body`, `rounded.md`, 패딩 12/14.
- **focus** — 표면 유지, fill 변경이 아니라 ring으로 표현.

### Cards
- **card** — 배경 `canvas`, `rounded.lg`, 패딩 `lg`, `hairline` 보더(그림자 대신).
- **template-card** — 배경 `surface-soft`, `typography.body-sm`, `rounded.md`, 패딩 `md`.
- **feature-tile** — 배경 `surface-soft`, `typography.eyebrow`, `rounded.md`, 패딩 `lg`.

### Color-Block Section (시그니처)
콘텐츠 폭 전체 패널, `rounded.lg` 코너, `xxl` 내부 패딩.
- **default(lime)** — 배경 `block-lime`, 텍스트 `ink`, `typography.subhead`.
- **lilac / cream / mint / pink / coral** — 동일 구조, 각 `block-*` 표면.
- **navy** — 배경 `block-navy`, 텍스트 `inverse-ink`. 푸터 위 유일한 역상 블록.

### Navigation
- **top-nav** — 스티키 흰 바, 높이 56px. 좌측 워드마크, 우측 secondary+primary pill 페어. 960px 이하 햄버거.
- **marquee-strip** — 내비 아래 얇은 검정 리본(높이 36px), 흰 텍스트.

### Footer
- **footer** — 흰 캔버스 위 밀집 링크 그리드, 좌상단 워드마크. `typography.caption` 컬럼 헤드, 패딩 `section` 상하 · `xl` 좌우.

---

## Do's & Don'ts

**Do**
- `primary`(검정)는 진짜 primary CTA와 선택 상태에만. 장식 액센트로 쓰지 말 것.
- 스토리 섹션엔 `block-*` 중 **하나**만 골라 콘텐츠 폭 전체 + `rounded.lg` + `xxl` 패딩.
- 타입은 가변 sans 웨이트(320/330/340/480/540/700)에서만 골라 위계 표현.
- mono는 eyebrow/caption만, 항상 대문자.
- 모든 CTA는 pill, 아이콘 버튼은 원형.
- 컬러블록 사이엔 항상 흰 캔버스로 복귀.

**Don't**
- 중간 회색 텍스트 금지 — 위계는 웨이트로.
- 컬러블록에 드롭섀도 금지 — 색이 깊이.
- `block-*` + `accent-magenta` 외 새 액센트 색 금지.
- 한 화면에 컬러블록 2개 이상 동시에 보이지 않게.
- CTA를 사각으로 만들지 말 것.
- mono를 본문에 쓰지 말 것.

---

## Responsive
- **Breakpoints**: 1920 / 1440 / 1400 / 1280 / 960(태블릿, 햄버거) / 768(블록 풀블리드) / 560(display-xl 86→48px, pill 풀폭) / 559(푸터 1컬럼).
- **Touch**: pill 최소 44px 높이, 원형 아이콘 40→44px, 폼 인풋 48px.
- **Color-block**: 768px 이하에서 코너 제거 + 뷰포트 풀블리드(포스터 효과).

---

## Tailwind v4 매핑 (구현 노트)

> v4는 `tailwind.config.js`가 아니라 CSS의 `@theme`에 토큰을 선언하면 그대로 유틸리티가 된다.
> 아래 토큰을 globals.css에 한 번 선언해두면 `bg-canvas`, `text-ink`, `rounded-pill`,
> `font-weight-*` 등으로 바로 쓸 수 있다. **never inline hex — 토큰 유틸만 사용.**

```css
@import "tailwindcss";

@theme {
  /* Fonts */
  --font-sans: "Wanted Sans Variable", "Wanted Sans", -apple-system, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", menlo, monospace;

  /* 미세 웨이트 래더 (Tailwind 기본엔 없음 → font-w320 … font-w700) */
  --font-weight-w320: 320;  --font-weight-w330: 330;  --font-weight-w340: 340;
  --font-weight-w450: 450;  --font-weight-w480: 480;  --font-weight-w540: 540;
  --font-weight-w700: 700;

  /* Colors */
  --color-primary: #0d0d0d;          --color-canvas: #ffffff;
  --color-on-primary: #ffffff;       --color-ink: #0d0d0d;
  --color-inverse-canvas: #0d0d0d;   --color-inverse-ink: #ffffff;
  --color-surface-soft: #f5f5f4;
  --color-hairline: #e5e5e3;         --color-hairline-soft: #efefed;
  --color-accent-magenta: #f24aa0;   --color-success: #2faa5b;
  --color-block-lime: #d6f25a;  --color-block-lilac: #d9d2f5;  --color-block-cream: #f5ead6;
  --color-block-mint: #c6efd9;  --color-block-pink: #f5d2e3;   --color-block-coral: #f5b8a0;
  --color-block-navy: #1a1f4d;

  /* Radius — pill만 커스텀, rounded-full은 기본 제공 */
  --radius-xs: 2px;  --radius-sm: 6px;  --radius-md: 8px;
  --radius-lg: 24px; --radius-xl: 32px; --radius-pill: 50px;
}
```

**기본 매핑으로 충분한 것 (선언 불필요)**
- **Spacing**: 8px 스케일이 Tailwind 기본 `--spacing`(4px)에 그대로 떨어진다 — `xs`8=`p-2`, `sm`12=`p-3`, `md`16=`p-4`, `lg`24=`p-6`, `xl`32=`p-8`, `xxl`48=`p-12`, `section`96=`p-24`.
- **숫자 기능**: `tabular-nums`, `slashed-zero` 유틸이 v4 내장 → 표·통계·스텝퍼에 `class="tabular-nums slashed-zero"`. 전역으로 깔려면 `@layer base`의 `body`에 두 유틸을 직접.

**유틸로 안 떨어져서 arbitrary value를 쓰는 것**
- **음수 자간**: 트래킹 토큰을 따로 안 만든다면 `tracking-[-1.72px]`(display-xl) … `tracking-[-0.26px]`(body)처럼 arbitrary value. mono eyebrow/caption은 양수 `tracking-[0.54px]`.
- **타입 스케일**: `text-[86px]/[1.0]` 식으로 size/line-height를 arbitrary로 묶거나, 자주 쓰면 `--text-display-xl` 등 `@theme`에 추가해 `text-display-xl`로.

**주의**
- `font-medium`(500) 쓰지 말 것 — 래더는 320/330/340/450/480/540/700, **500은 의도적 부재**. 대신 `font-w480` 등.
- pill 버튼은 `rounded-pill`, 아이콘 버튼은 `rounded-full`. `rounded-lg`(8px 기본값과 다름!) 같은 Tailwind 기본 radius 유틸은 우리 `--radius-lg`(24px)로 덮이니 토큰 의도대로 쓰면 된다.
