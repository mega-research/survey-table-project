---
name: survey-ops
description: 운영 설문 작업 도구. 한글 조사표에서 설문을 새로 조립할 때, 운영(prod) 설문의 문항·문구·표 구조를 스크립트로 고칠 때, SPSS 변수명을 설명·인용할 때, 응답자 화면에 무엇이 보이는지(명단 값·토큰 치환·이월 프리필·「다음」이 막히는 이유) 확인할 때 쓴다.
---

# 운영 설문 작업 도구

`scripts/survey-ops/` 의 명령 여섯과 패치 도우미. 모두 `--env prod` 또는 `--env local` 을 꼭 적는다(기본값 없음). `--env local` 은 `.env.local`(로컬 supabase 54322) → `.env` 순으로 읽고, `pnpm db:isolated <이름>` 의 전용 DB 는 `SURVEY_OPS_DATABASE_URL=<그 URL>` 로 바꿔 끼운다(로컬 주소만 받는다).

## 설문 id 를 모르면 문구로 찾는다

```bash
pnpm survey:find '<문구>' --env prod [--limit 20]
```

문항 제목·설명·코드·보기·표 칸 글자에서 부분 일치로 찾아 설문 id · 문항 id · 코드 · 유형 · 발행 여부 · 응답 수를 낸다.
읽기 전용 트랜잭션이다 — `.env.production` 을 직접 읽어 붙는 임시 스크립트를 쓰지 않는다.

## 구조는 요약으로 본다

```bash
pnpm survey:summary <surveyId> --env prod [--grep '^B']     # 문항당 한 줄
pnpm survey:summary <surveyId> --env prod --detail A3       # 그 문항 하나를 편다
pnpm survey:summary --file .scratch/<설문>/out.json          # 넣기 전 조립 산출물
```

- 한 줄에 쪽 · 문항코드 · 유형과 크기 · 필수 · 칸 유형 수 · 보기 그룹 · 모바일 표시 방식 · 표시 조건(문항·열·행) ·
  열림 조건 수 · 검증 수 · 변수 수 · 제목이 나온다. 설문 하나가 수 KB 다.
- `--detail` 은 열(코드·머리·조건) · 보기 그룹 · 줄마다 칸(유형·필수·열림 조건·단위·계산·모바일 칸 이름) · 제약을 낸다.
  같은 모양이 이어지는 줄은 한 줄로 접는다.
- **구조를 알아보려고 dump JSON 에 임시 스크립트를 쓰지 않는다.** 요약에 없는 것(칸 글자 원문·서식·설문 설정)이
  필요할 때만 dump 를 연다. 요약에 자주 찾는 항목이 없으면 `summary-core.ts` 에 더한다.

## 변수명은 계산해서 인용한다

```bash
pnpm survey:vars <surveyId> --env prod --grep '^Q2_'
pnpm survey:vars <surveyId> --env prod --names              # 문항별 한 줄에 이름만 — 라벨이 필요 없으면 이것
```

내보내기와 같은 함수 사슬로 구조 전체 변수명을 낸다. 사용자에게 변수명을 말할 때는 이 출력을 그대로 옮긴다.
응답에 따라 빠지는 열(안 쓴 벌·열)과 변동 확인 열은 이 목록에 없다.

## 설문을 조립하거나 구조를 고치기 전에 규칙 문서 둘을 읽는다

- 변수명·값·라벨: `docs/agents/survey-variable-rules.md`
- 웹 화면(문항 유형·분기·필수·검증)과 모바일 표시 방식: `docs/agents/survey-screen-rules.md`

둘 다 gitignore 된 `docs/` 아래라 내용 검색에 잡히지 않는다 — 위 경로로 바로 연다. 설문 하나를 끝내며 새로
정한 것은 그 문서의 해당 절에 더하고, 왜 그렇게 정했는가는 ADR 0039·0040·0041 에서 본다.

## 조립했거나 구조를 고쳤으면 점검을 돌린다

```bash
pnpm survey:check --file .scratch/<설문>/out.json [--tsv <경로>]   # 넣기 전 조립 산출물 { survey, groups, questions }
pnpm survey:check <surveyId> --env prod                            # DB 의 저장본 (읽기만)
```

- **오류**는 내보내기·응답이 깨지는 것이다 — 끊긴 표시 조건(없는 문항·없는 보기 저장 키·뒤 문항), 없는 칸을 보는
  수식·열림 조건, 보기 칸 없이 남은 보기 그룹 정의, 변수가 0개인 문항, 복수 선택 응답값 0, 발행 게이트와 같은
  변수명 검증. 하나라도 있으면 종료 코드 1 이라 조립 스크립트가 넣기 전에 건다. 설문마다 `check.ts` 를 복사하지 않는다.
- **알림**은 조립 규칙과 다른 곳이다 — 값 라벨 120바이트, 순위 전부 필수, 기타 내용 필수, 금액 칸 단위, 열 방향
  그룹 필수, 저장 키 ≠ 응답값 등. 일부러 그랬으면 둔다. 사용자에게는 알림 목록을 그대로 보이고 어느 것을 둘지 묻는다.
- 빌더에서 문항 유형을 바꿨거나 패치로 구조를 고친 뒤에도 돌린다 — 유형을 바꾸면 그 문항을 보던 조건이 끊긴다.
- 점검을 더하거나 고칠 때는 `check-core.ts` 와 `tests/repo/survey-ops-check.test.ts` 를 같이 고친다. 규칙의 출처는
  아래 두 문서다.

## 응답자 화면은 그려서 확인한다

```bash
pnpm survey:dump <surveyId> --env prod [--published] [--test] [--resid N]
pnpm survey:render .scratch/survey-ops/dumps/<파일>.json [--mobile] [--next N] [--answers <json>] [--click <칸 id>[,…]]
```

- `dump` 는 관리자 「설문 보기」와 같은 로더로 설문·명단 값·이월 응답을 받는다. 기본은 저장본이라
  화면을 연 것처럼 테스트 버전 행이 생길 수 있다 — 아무것도 쓰지 않으려면 `--published`(배포본).
- `render` 는 「설문 보기」와 같은 컴포넌트로 jsdom 에 그려 보이는 글자·입력값·선택 상태를 찍는다.
  `--next N` 은 「다음」을 누르고, 막히면 새로 뜬 오류 문구만 찍는다. CSS 는 계산하지 않는다.
- `--answers` 는 처음부터 깔아 둘 응답 JSON — 문항 코드(또는 id)를 키로, 값은 저장 모양 그대로(표는 칸 id → 값). 필수 쪽을 넘겨 뒤쪽 쪽을 볼 때 쓴다.
- `--click` 은 「다음」을 다 누른 뒤 그 쪽에서 표 칸의 체크박스·라디오를 순서대로 누르고, 상태가 바뀐 선택 칸을
  칸 이름·id 로 찍는다. 따라 선택·단독 선택처럼 「누르면 다른 칸이 바뀌는」 설정을 패치로 넣었으면 저장된 것만
  확인하지 말고 이것으로 동작까지 본다.
- 「새로고침하면 보인다」 같은 답은 render 출력으로 확인한 뒤에 한다.
- dump 파일에는 그 대상의 명단 평문이 있다. 사용자에게 파일 내용을 옮기지 말고 필요한 줄만 인용한다.
  7일 지난 dump 는 다음 dump 때 지워진다.

## 설문 고치기는 도우미로

`.scratch/<작업>/` 에 바꿀 내용만 쓴다.

```ts
import { runSurveyPatch } from '../../scripts/survey-ops/patch';

runSurveyPatch({
  surveyId: '…',
  title: '문2 설명 둘째 줄',
  apply: async ({ tx, schema, eq, before }) => {
    const q = before.questionRows.find((r) => r.questionCode === 'Q2');
    if (!q?.description?.includes(OLD)) throw new Error('원문이 다름'); // 원문 대조로 멱등하게
    await tx
      .update(schema.questions)
      .set({ description: q.description.replace(OLD, NEW) })
      .where(eq(schema.questions.id, q.id));
  },
});
```

```bash
pnpm exec tsx --tsconfig tsconfig.scripts.json .scratch/<작업>/<파일>.ts --env prod            # 시험 실행
pnpm exec tsx --tsconfig tsconfig.scripts.json .scratch/<작업>/<파일>.ts --env prod --commit   # 반영
```

- 한 트랜잭션에서 설문 행을 잠그고, 고치기 전후 변수명을 비교해 출력한다. 기본은 시험 실행(되돌림).
- 없어지는 변수명이 있으면 되돌린다. 사용자에게 바뀌는 이름을 보여 주고 동의를 받은 뒤 `--allow-var-changes`.
- 커밋 뒤 사용자에게 알릴 것: 실제 응답자 화면은 다시 발행해야 바뀐다. 빌더 탭이 열려 있으면
  새로고침 뒤 저장해야 옛 탭이 이 수정을 덮지 않는다.
- 도우미는 행을 잠그고 비교만 한다. 표 구조를 바꿀 때 행 반복 펼치기·발번 같은 앱 규칙은 앱 함수
  (`@/lib/question/row-repeat` 등)를 불러 맞춘다.
