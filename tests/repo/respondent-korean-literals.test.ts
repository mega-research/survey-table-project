import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * 응답 화면 두 묶음(question-renderer · survey-response)에 남은 한국어 글자의 목록 대조
 * (CONTEXT.md 「다국어 설문」 — 시스템 글자는 사전 `utils/system-strings` 가 현재 언어로 낸다).
 *
 * 다국어 설문의 응답자에게 한국어 시스템 글자가 새지 않게 하려는 가드다. 새 한국어 글자를 응답
 * 화면에 넣으면 여기서 걸린다 — 사전에 키를 더해 `systemText` 로 그리거나, 응답자가 보지 않는
 * 글자라면 아래 목록에 사유 묶음과 함께 적는다. 목록에만 남고 소스에서 사라진 글자도 실패시켜
 * 목록이 실제와 어긋나지 않게 한다.
 *
 * 판정은 문법 트리로 한다 — 주석은 트리에 없고, `console.*`·`logger.*`·`new Error(…)` 인자는 건너뛴다.
 * 문자열·템플릿·JSX 글자 중 한글이 든 것만 앞뒤 공백을 걷어 비교한다. 템플릿은 조각으로 쪼개지 않고
 * 끼운 값 자리를 `${}` 로 적은 한 문장으로 본다 — 「개」 같은 한 글자 조각을 목록에 두면 같은 파일의
 * 새 문장이 그 조각을 빌려 빠져나간다.
 */

const ROOTS = ['src/features/question-renderer', 'src/features/survey-response'];
const HANGUL = /[가-힣]/;

/** 저작 미완성 표시 — 보기·이미지·라벨을 비운 채 발행했을 때만 보인다. 빌더 미리보기에서 고친다. */
const AUTHORING_GAPS: Record<string, readonly string[]> = {
  'question-renderer/cells/checkbox-cell.tsx': ['체크박스 없음', '(라벨 없음)'],
  'question-renderer/cells/choice-opt-cell.tsx': ['(라벨 없음)'],
  'question-renderer/cells/image-cell.tsx': ['이미지 없음'],
  'question-renderer/cells/preview-cell.tsx': [
    '체크박스 없음',
    '라디오 버튼 없음',
    '선택 옵션 없음',
    '이미지 없음',
    '동영상 없음',
  ],
  'question-renderer/cells/radio-cell.tsx': ['라디오 버튼 없음', '(라벨 없음)'],
  'question-renderer/cells/ranking-cell.tsx': ['순위 옵션 없음'],
  'question-renderer/cells/select-cell.tsx': ['선택 옵션 없음'],
  'question-renderer/cells/video-cell.tsx': ['동영상 없음'],
  'question-renderer/choice-table-response.tsx': ['(라벨 없음)'],
  // 행·그룹 라벨을 비웠을 때의 「그룹 N」「항목 N」
  'question-renderer/hooks/use-row-groups.ts': ['그룹 ${}', '항목 ${}'],
  'question-renderer/mobile-row-card.tsx': ['항목 ${}'],
  'question-renderer/interactive-table-response.tsx': ['테이블 질문이 구성되지 않았습니다'],
  'question-renderer/ranking-question.tsx': [
    '설명 테이블에 "순위 옵션" 셀이 없습니다. 빌더에서 옵션으로 쓸 셀의 타입을 "순위 옵션"으로 설정하세요.',
    '선택지가 없습니다.',
    '(라벨 없음)',
  ],
  'question-renderer/survey-response-header.tsx': ['로고'],
  'question-renderer/table-preview.tsx': [
    '테이블을 구성해주세요',
    '열과 행을 추가하여 테이블을 만들어보세요',
  ],
  'question-renderer/utils/mobile-original-row.ts': ['(라벨 없음)'],
  'survey-response/question-input.tsx': [
    '다단계 선택이 구성되지 않았습니다.',
    '테이블이 구성되지 않았습니다.',
    '지원하지 않는 질문 유형입니다.',
    '(라벨 없음)',
  ],
};

/** 화면에 그대로 나가지 않는 표식·비교 값 — 화면 글자는 사전이 현재 언어로 바꿔 그린다. */
const MARKERS: Record<string, readonly string[]> = {
  // 저작자 라벨의 「… 단위」 짝 판정
  'question-renderer/utils/mobile-card-options.ts': ['단위'],
  // 저작자 검증 문구의 자리표시자 이름(저작자가 한국어로 적는다)
  'survey-response/lib/numeric-validation.ts': ['{현재값}', '{기준값}'],
  // 서버 오류 문장과의 비교
  'survey-response/hooks/use-duplicate-guard.ts': ['테스트 링크가 더 이상 유효하지 않습니다'],
  // 언어 바꾸기 버튼 — 이미 세 언어다
  'survey-response/survey-response-flow.tsx': ['언어 변경 · 语言 · Language'],
};

/** 빌더·관리자 화면만 보는 문장 — 관리자 화면은 한국어로 둔다. */
const ADMIN_ONLY: Record<string, readonly string[]> = {
  // 빌더 설정 카드의 기본값 placeholder · 묶음 검증 문구
  'question-renderer/utils/staged-rows.ts': [
    '행 추가',
    '묶을 행을 하나 이상 지정해야 합니다.',
    '표에 없는 행이 지정되었습니다.',
    '묶음은 붙어 있는 행이어야 합니다.',
    '처음 보이는 행 수는 1 이상 ${} 이하여야 합니다 — 묶음 행 수보다 작아야 열 행이 남습니다.',
    '행 반복 블록의 행은 묶음에 넣을 수 없습니다.',
    '동적 행 그룹에 속한 행은 묶음에 넣을 수 없습니다.',
    '표시 조건이 걸린 행은 묶음에 넣을 수 없습니다.',
    '보기 옵션·순위 옵션 셀이 든 행은 묶음에 넣을 수 없습니다.',
  ],
  // 표 분류의 진단 사유(디버그)
  'question-renderer/utils/classify-table.ts': [
    '값 열 ${}개를 행마다 채움',
    '입력 1칸이 값 열 ${}개를 colspan 병합',
    '값 열 1개 · 단독 입력',
    '값 열 1개 · 반복 항목 ${}개',
  ],
  // 조사표 앵커 편집기의 라벨
  'question-renderer/utils/anchor-outline.ts': ['(제목 없음)', '그룹 없음'],
  // 관리자 응답 수정의 완화 안내
  'survey-response/lib/admin-edit-required-relax.ts': [
    '빈 필수 응답 ${}개',
    '형식·품질 조건에 맞지 않는 값 ${}개',
    "${} — '다음 →' 한 번 더 누르면 그대로 넘어갑니다",
  ],
  // 조사표 열기 실패 진단 — 운영자가 원인(저장소 CORS)을 찾는 문장
  'question-renderer/pdf-page-view.tsx': [
    '페이지를 그리지 못했습니다.',
    '조사표를 불러오지 못했습니다. 파일 저장소가 이 주소에서의 읽기를 허용하지 않는 상태일 수 있습니다 (저장소 CORS 설정).',
    '조사표를 불러오지 못했습니다.',
  ],
};

/** 설문을 읽기 전이라 언어를 모르는 자리 — 한국어 그대로(05 결정). */
const BEFORE_SURVEY: Record<string, readonly string[]> = {
  'survey-response/hooks/use-survey-loader.ts': [
    '요청하신 설문을 찾을 수 없습니다.',
    '미리보기 설문 데이터를 찾을 수 없습니다.',
    '이 설문은 비공개 설문입니다. 올바른 링크로 접근해주세요.',
    '설문을 불러오는 중 오류가 발생했습니다.',
  ],
  'survey-response/survey-response-screens.tsx': [
    '비공개',
    '접근이 제한된 설문입니다',
    '설문을 찾을 수 없습니다',
    '요청하신 설문이 존재하지 않거나 삭제되었습니다.',
    '홈으로 돌아가기',
    '아직 질문이 없습니다',
    '이 설문에는 아직 질문이 등록되지 않았습니다.',
  ],
};

function mergeLists(...lists: Record<string, readonly string[]>[]): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  for (const list of lists) {
    for (const [file, texts] of Object.entries(list)) {
      const set = merged.get(file) ?? new Set<string>();
      texts.forEach((text) => set.add(text));
      merged.set(file, set);
    }
  }
  return merged;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function isSkippedCall(node: ts.Node, source: ts.SourceFile): boolean {
  if (ts.isCallExpression(node)) return /^(console|logger)\./.test(node.expression.getText(source));
  return ts.isNewExpression(node) && node.expression.getText(source) === 'Error';
}

function hangulLiterals(path: string): Set<string> {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if (isSkippedCall(node, source)) return;
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => `\${}${span.literal.text}`)]
        .join('')
        .trim();
      if (HANGUL.test(text)) found.add(text);
      node.templateSpans.forEach((span) => visit(span.expression));
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      const text = node.text.trim();
      if (HANGUL.test(text)) found.add(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('응답 화면에 남은 한국어 글자 (다국어 설문)', () => {
  const allowed = mergeLists(AUTHORING_GAPS, MARKERS, ADMIN_ONLY, BEFORE_SURVEY);
  const featuresRoot = join(process.cwd(), 'src/features');
  const scanned = new Map<string, Set<string>>();
  for (const root of ROOTS) {
    for (const path of walk(join(process.cwd(), root))) {
      const literals = hangulLiterals(path);
      if (literals.size > 0) scanned.set(relative(featuresRoot, path), literals);
    }
  }

  it('목록에 없는 한국어 글자가 없다 — 응답자에게 보이면 사전(systemText)으로 옮긴다', () => {
    const unlisted = [...scanned].flatMap(([file, literals]) =>
      [...literals]
        .filter((text) => !allowed.get(file)?.has(text))
        .map((text) => `${file}: ${text}`),
    );
    expect(
      unlisted,
      `응답 화면에 새 한국어 글자가 있다. 응답자가 보면 utils/system-strings 에 키를 더해 그리고, 보지 않으면 이 목록에 사유와 함께 적는다:\n${unlisted.join('\n')}`,
    ).toEqual([]);
  });

  it('목록의 글자가 모두 소스에 아직 있다 — 사라진 글자는 목록에서 지운다', () => {
    const stale = [...allowed].flatMap(([file, texts]) =>
      [...texts].filter((text) => !scanned.get(file)?.has(text)).map((text) => `${file}: ${text}`),
    );
    expect(stale, `목록에만 남은 글자:\n${stale.join('\n')}`).toEqual([]);
  });
});
