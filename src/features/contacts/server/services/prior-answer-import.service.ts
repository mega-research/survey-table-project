import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactPriorAnswers, contactTargets } from '@/db/schema/contacts';
import { questions as questionsTable, surveys } from '@/db/schema/surveys';
import type { PriorAnswerImportConfig } from '@/db/schema/schema-types';
import { previewExcelGrid } from '@/lib/contacts/excel-parser';
import {
  LABEL_SIMILAR_THRESHOLD,
  labelSimilarity,
  normalizeQuestionCode,
  resolveSlots,
  splitHeaderBlocks,
  suggestBlockMapping,
  type BlockSlot,
  type HeaderBlock,
} from '@/lib/contacts/prior-answer-blocks';
import { buildPriorAnswerRecords } from '@/lib/contacts/prior-answer-import';
import { MAX_UPLOAD_ROWS, validateXlsxFile } from '@/lib/contacts/upload-limits';
import { encryptAnswerValue } from '@/lib/crypto/response-pii';
import { normalizeQuestions } from '@/lib/question';
import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';
import type { Question } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { resolveRankingOptions } from '@/utils/ranking-source';

import type {
  ImportPriorAnswersInput,
  ImportPriorAnswersResult,
  SavePriorAnswerImportConfigInput,
  SuggestPriorAnswerMappingInput,
  SuggestPriorAnswerMappingResult,
} from '../../domain/prior-answers';

/** 찾지 못한 번호 목록 절단 — 화면은 표본만 보여주고 카운트는 전체를 쓴다. */
const MAX_UNMATCHED_SAMPLES = 50;

function ensureXlsx(file: File): void {
  const err = validateXlsxFile(file);
  if (err) throw new Error(err);
}

/**
 * 이 설문의 문항을 임포트 판정에 쓰는 형태로 읽는다.
 * 읽기 경계는 export 파이프라인과 같은 `normalizeQuestions`(preserve) 를 태운다.
 */
async function loadQuestions(surveyId: string): Promise<Question[]> {
  const rows = await db.query.questions.findMany({
    where: eq(questionsTable.surveyId, surveyId),
    orderBy: [questionsTable.order],
  });
  return normalizeQuestions(rows);
}

/** 값 이어주기 드롭다운에 쓸 이 문항의 선택지. 표 문항은 칸마다 달라 여기서 내지 않는다. */
function importableOptions(question: Question): Array<{ value: string; label: string }> {
  // 표 문항은 칸마다 선택지가 다르다 — 값 이어주기 후보로는 모든 칸의 선택지를 합쳐 낸다.
  // 실제 대응은 그 칸의 선택지 안에서만 성립하므로(findOptionByLabel), 합집합은 후보
  // 목록일 뿐 잘못된 칸에 값을 넣지 않는다.
  if (question.type === 'table') {
    const seen = new Map<string, string>();
    for (const row of question.tableRowsData ?? []) {
      for (const cell of row.cells ?? []) {
        const cellOpts =
          cell.type === 'checkbox'
            ? (cell.checkboxOptions ?? [])
            : cell.type === 'radio'
              ? (cell.radioOptions ?? [])
              : cell.type === 'select'
                ? (cell.selectOptions ?? [])
                : [];
        for (const option of cellOpts) {
          const value = option.value ?? option.id;
          if (!seen.has(value)) seen.set(value, option.label ?? value);
        }
      }
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }
  const options =
    question.type === 'ranking' ? resolveRankingOptions(question) : resolveChoiceOptions(question);
  return options.map((option) => ({
    value: option.value ?? option.id,
    label: option.label ?? option.value ?? option.id,
  }));
}

/** 확정 설정을 읽기 경계에서 정규화한다 (JSONB 드리프트 관례). */
function normalizeImportConfig(raw: unknown): PriorAnswerImportConfig {
  const empty: PriorAnswerImportConfig = { blockMappings: {}, valueAliases: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const source = raw as Partial<PriorAnswerImportConfig>;
  const blockMappings: PriorAnswerImportConfig['blockMappings'] = {};
  for (const [code, entry] of Object.entries(source.blockMappings ?? {})) {
    // 문자열만 저장하던 형태도 읽어준다 — 라벨은 비어 있는 것으로 본다.
    if (typeof entry === 'string' && entry) {
      blockMappings[code] = { questionId: entry, label: '' };
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const { questionId, label } = entry as { questionId?: unknown; label?: unknown };
    if (typeof questionId !== 'string' || !questionId) continue;
    blockMappings[code] = { questionId, label: typeof label === 'string' ? label : '' };
  }
  const valueAliases: Record<string, Record<string, string>> = {};
  for (const [questionId, aliases] of Object.entries(source.valueAliases ?? {})) {
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) continue;
    const kept: Record<string, string> = {};
    for (const [rawValue, stored] of Object.entries(aliases)) {
      if (typeof stored === 'string' && stored) kept[rawValue] = stored;
    }
    if (Object.keys(kept).length > 0) valueAliases[questionId] = kept;
  }
  return { blockMappings, valueAliases };
}

/** 이 설문에 보관된 확정 설정. 없으면 빈 설정. */
async function loadImportConfig(surveyId: string): Promise<PriorAnswerImportConfig> {
  const [row] = await db
    .select({ config: surveys.priorAnswerImportConfig })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  return normalizeImportConfig(row?.config);
}

/**
 * 확정 매핑·값 대응을 보관한다. 다시 올릴 때 그대로 재사용된다.
 *
 * **병합이다.** 통째로 덮으면 이번 파일에 없는 블록·문항의 확정이 함께 사라진다 —
 * 191개 매핑을 여러 번에 걸쳐 맞추는 것이 정상 경로라 그 소실이 곧 기능 상실이다.
 */
export async function savePriorAnswerImportConfig(
  input: SavePriorAnswerImportConfigInput,
): Promise<{ ok: true }> {
  const existing = await loadImportConfig(input.surveyId);
  const incoming = normalizeImportConfig({
    blockMappings: input.blockMappings,
    valueAliases: input.valueAliases,
  });

  const merged: PriorAnswerImportConfig = {
    blockMappings: { ...existing.blockMappings, ...incoming.blockMappings },
    valueAliases: { ...existing.valueAliases },
  };
  for (const [questionId, aliases] of Object.entries(incoming.valueAliases)) {
    merged.valueAliases[questionId] = { ...merged.valueAliases[questionId], ...aliases };
  }

  const [updated] = await db
    .update(surveys)
    .set({ priorAnswerImportConfig: merged, updatedAt: new Date() })
    .where(eq(surveys.id, input.surveyId))
    .returning({ id: surveys.id });
  if (!updated) throw new Error('설문을 찾을 수 없습니다.');
  return { ok: true };
}

/** 보관된 대응 위에 이번 요청의 대응을 얹는다. */
function mergeAliases(
  saved: Record<string, Record<string, string>>,
  incoming: Record<string, Record<string, string>> | undefined,
): Record<string, Record<string, string>> {
  if (!incoming) return saved;
  const merged: Record<string, Record<string, string>> = { ...saved };
  for (const [questionId, aliases] of Object.entries(incoming)) {
    merged[questionId] = { ...merged[questionId], ...aliases };
  }
  return merged;
}

/** 블록 컬럼 배정을 담당자가 읽을 수 있는 한 줄로 만든다. */
function describeSlots(question: Question | undefined, slots: readonly BlockSlot[]): string[] {
  const cellLabelById = new Map<string, string>();
  for (const row of question?.tableRowsData ?? []) {
    for (const cell of row.cells ?? []) {
      cellLabelById.set(cell.id, cell.exportLabel || row.label || cell.content || cell.id);
    }
  }
  const optionLabelByValue = new Map(
    question ? importableOptions(question).map((o) => [o.value, o.label]) : [],
  );
  return slots.map((slot) => {
    switch (slot.kind) {
      case 'single':
        return '문항 값';
      case 'table-cell':
        return cellLabelById.get(slot.cellId) ?? slot.cellId;
      case 'checkbox-option':
        return optionLabelByValue.get(slot.optionValue) ?? slot.optionValue;
      case 'ranking-rank':
        return `${slot.rank}순위`;
      default:
        return '배정 안 됨';
    }
  });
}

/** 이 문항 값이 저장 시 암호화되는가 — 스키마 행의 boolean 을 읽기 경계에서 정규화한다. */
function isPiiQuestion(question: Question): boolean {
  return (question as { piiEncrypted?: boolean }).piiEncrypted === true;
}

/**
 * 시트/헤더 행을 고른 뒤의 매핑 제안.
 *
 * 명단 업로드와 **다른 경로**다 — 매핑은 문항이 존재해야 가능하므로 시점이 다르고,
 * 명단 업로드의 replace 모드는 조사 대상을 지우고 다시 넣어 개별 링크를 재발급한다.
 */
export async function suggestPriorAnswerImportMapping(
  input: SuggestPriorAnswerMappingInput,
): Promise<SuggestPriorAnswerMappingResult> {
  ensureXlsx(input.file);
  const buffer = await input.file.arrayBuffer();
  const headerRowCount = input.headerRowCount ?? 1;
  const preview = await previewExcelGrid(buffer, {
    sheetName: input.sheetName ?? '',
    headerRowCount,
    maxRows: 5,
  });

  const [questions, config] = await Promise.all([
    loadQuestions(input.surveyId),
    loadImportConfig(input.surveyId),
  ]);
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const blocks = splitHeaderBlocks(preview.headerRows, preview.codeRowMerged);
  const suggestions = suggestBlockMapping(blocks, questions);

  return {
    sheetNames: preview.sheetNames,
    headerRows: preview.headerRows,
    rows: preview.rows,
    totalRows: preview.totalRows,
    blocks: suggestions.map((s) => {
      // 지난 확정이 있으면 자동 제안보다 우선한다 — 담당자가 이미 판단한 것을 매번
      // 다시 고치게 하지 않는다.
      //
      // 단, 확정 시점의 문항 내용과 이번 파일의 문항 내용이 어긋나면 되살리지 않는다.
      // 코드만 보고 되살리면 파트가 재편돼 코드가 밀린 파일에서 지난 확정이 그대로
      // 부활해 "코드는 같은데 내용이 다르다" 경고가 사라진다 — 이 티켓이 막으려는 사고다.
      const saved = config.blockMappings[normalizeQuestionCode(s.block.code)];
      const savedStillValid =
        saved !== undefined &&
        (!saved.label ||
          !s.block.label ||
          labelSimilarity(saved.label, s.block.label) >= LABEL_SIMILAR_THRESHOLD);
      const savedQuestion = savedStillValid && saved ? questionById.get(saved.questionId) : undefined;
      const questionId = savedQuestion?.id ?? s.questionId;
      const question = savedQuestion ?? (s.questionId ? questionById.get(s.questionId) : undefined);
      const slots = savedQuestion ? resolveSlots(savedQuestion, s.block) : s.slots;
      return {
        code: s.block.code,
        label: s.block.label,
        part: s.block.part,
        columnIndexes: s.block.columnIndexes,
        detailLabels: s.block.detailLabels,
        questionId,
        matchedBy: savedQuestion ? null : s.matchedBy,
        verdict: savedQuestion ? ('auto' as const) : s.verdict,
        conflictQuestionId: savedQuestion ? null : (s.conflictQuestionId ?? null),
        fromSavedConfig: Boolean(savedQuestion),
        slotLabels: describeSlots(question, slots),
        unmatchedSlots: slots.filter((slot) => slot.kind === 'unmatched').length,
      };
    }),
    // 안내문은 답이 없는 유형이라 매핑 선택지에 두지 않는다.
    questions: questions
      .filter((q) => q.type !== 'notice')
      .map((q) => ({
      id: q.id,
        questionCode: q.questionCode ?? null,
        title: q.title,
        type: q.type,
        options: importableOptions(q),
      })),
    savedValueAliases: config.valueAliases,
  };
}

/**
 * 이월 응답 적재. `dryRun` 이면 계산만 하고 쓰지 않는다 (실행 전 미리보기).
 *
 * 조사 대상은 설문별 자동 발번 번호(resid)로 찾고, 파티션은 조사 대상의 것을 따른다 —
 * 이월 응답에 별도 파티션 축을 만들지 않는다.
 *
 * 재업로드는 정상 경로다. 조사 대상당 한 행이므로 통째로 교체하고(onConflict update),
 * 개별 링크와 이미 수집된 응답은 건드리지 않는다.
 */
export async function importPriorAnswers(
  input: ImportPriorAnswersInput,
): Promise<ImportPriorAnswersResult> {
  ensureXlsx(input.file);
  const buffer = await input.file.arrayBuffer();
  // maxRows 를 주지 않으면 전량이다 — 헤더와 데이터를 한 번의 파싱으로 함께 얻는다.
  const preview = await previewExcelGrid(buffer, {
    sheetName: input.sheetName,
    headerRowCount: input.headerRowCount,
  });
  const rows = preview.rows;
  if (rows.length > MAX_UPLOAD_ROWS) {
    throw new Error(`한 번에 올릴 수 있는 행은 ${MAX_UPLOAD_ROWS.toLocaleString()}건입니다.`);
  }

  const [questions, config] = await Promise.all([
    loadQuestions(input.surveyId),
    loadImportConfig(input.surveyId),
  ]);
  // 자리 배정은 서버가 다시 계산한다 — 클라이언트는 블록↔문항 확정만 보낸다.
  // 화면이 본 것과 같은 헤더에서 같은 규칙으로 뽑아야 미리보기와 적재가 어긋나지 않는다.
  const blocks = splitHeaderBlocks(preview.headerRows, preview.codeRowMerged);
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const assignments = blocks.flatMap((block, index) => {
    const questionId = input.mapping[String(index)];
    if (!questionId) return [];
    const question = questionById.get(questionId);
    if (!question) return [];
    // 자리 배정은 자동 제안과 같은 규칙(resolveSlots)으로 직접 계산한다.
    // 제안 경로로 되돌리면 사람이 코드가 다른 문항을 고른 순간 전 칸이 미배정이 된다.
    return [{ block: block as HeaderBlock, questionId, slots: resolveSlots(question, block) }];
  });

  const parsed = buildPriorAnswerRecords({
    rows,
    residColumnIndex: input.residColumnIndex,
    assignments,
    questions,
    // 이번 화면에서 이어준 대응이 보관된 것보다 우선한다 — 미리보기가 저장 없이도
    // 결과에 반영돼야 담당자가 고치고 바로 다시 볼 수 있다.
    valueAliases: mergeAliases(config.valueAliases, input.valueAliases),
  });

  const scope = await loadOperationsDataScope(input.surveyId);
  const isTest = scope === 'test';

  // resid 는 정수 컬럼이다. 숫자가 아닌 값은 조회에 넣지 않고 미매칭으로 남긴다.
  // buildPriorAnswerRecords 가 이미 정수 문자열로 정규화했으므로 여기서는 형태만 본다.
  const residNumbers = new Map<string, number>();
  for (const record of parsed.records) {
    if (!/^[+-]?\d+$/.test(record.resid)) continue;
    const n = Number(record.resid);
    if (Number.isSafeInteger(n)) residNumbers.set(record.resid, n);
  }

  const targetIdByResid = new Map<number, string>();
  if (residNumbers.size > 0) {
    const targets = await db
      .select({ id: contactTargets.id, resid: contactTargets.resid })
      .from(contactTargets)
      .where(
        and(
          eq(contactTargets.surveyId, input.surveyId),
          eq(contactTargets.isTest, isTest),
          inArray(contactTargets.resid, [...residNumbers.values()]),
        ),
      );
    for (const target of targets) targetIdByResid.set(target.resid, target.id);
  }

  // PII 문항 값은 저장 직전 암호화한다 — 이월 응답은 응답 저장 형태와 동형이라
  // 조회 경계(lookupPriorAnswers)가 같은 규칙으로 복호화한다.
  const piiQuestionIds = new Set(questions.filter(isPiiQuestion).map((q) => q.id));

  const matchedRows: Array<{ contactTargetId: string; answers: Record<string, unknown> }> = [];
  const unmatchedResids: string[] = [];
  for (const record of parsed.records) {
    const n = residNumbers.get(record.resid);
    const contactTargetId = n === undefined ? undefined : targetIdByResid.get(n);
    if (!contactTargetId) {
      unmatchedResids.push(record.resid);
      continue;
    }
    const answers: Record<string, unknown> = {};
    for (const [questionId, value] of Object.entries(record.answers)) {
      answers[questionId] = piiQuestionIds.has(questionId) ? encryptAnswerValue(value) : value;
    }
    matchedRows.push({ contactTargetId, answers });
  }

  if (!input.dryRun && matchedRows.length > 0) {
    // 조사 대상당 한 행 — 다시 올리면 통째로 교체된다. 이전 임포트의 잔여 값이 남지 않는다.
    //
    // 한 배치에 같은 contactTargetId 가 두 번 실리면 PG 가 ON CONFLICT DO UPDATE 를
    // 거부해(21000) 적재 전체가 죽는다. resid 는 buildPriorAnswerRecords 가 이미 정수로
    // 정규화해 한 대상당 한 행이지만, 조회 결과가 뒤틀려도 살아남도록 여기서 한 번 더 접는다.
    const byTarget = new Map(matchedRows.map((row) => [row.contactTargetId, row]));
    await db.transaction(async (tx) => {
      await tx
        .insert(contactPriorAnswers)
        .values([...byTarget.values()])
        .onConflictDoUpdate({
          target: contactPriorAnswers.contactTargetId,
          set: {
            answers: sql`excluded.answers`,
            updatedAt: new Date(),
          },
        });
    });
  }

  const mappedQuestionIds = new Set(Object.values(input.mapping));
  const filledQuestionIds = new Set<string>();
  for (const record of parsed.records) {
    for (const questionId of Object.keys(record.answers)) filledQuestionIds.add(questionId);
  }
  const unmappedColumns = blocks
    .filter((_, index) => !input.mapping[String(index)])
    .map((block) => block.code);

  return {
    parsedTargets: parsed.records.length,
    matched: matchedRows.length,
    unmatched: unmatchedResids.length,
    unmatchedResids: unmatchedResids.slice(0, MAX_UNMATCHED_SAMPLES),
    emptyResidRows: parsed.emptyResidRows,
    duplicateResidRows: parsed.duplicateResidRows,
    unmappedColumns,
    questionsWithoutValues: [...mappedQuestionIds].filter((id) => !filledQuestionIds.has(id)),
    unsupportedQuestionIds: parsed.unsupportedQuestionIds,
    optionMismatches: parsed.optionMismatches,
  };
}

/** 이월 응답이 이미 붙어 있는 조사 대상 수 — 재업로드 안내용. */
export async function countPriorAnswerTargets(
  surveyId: string,
  isTest: boolean,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contactPriorAnswers)
    .innerJoin(contactTargets, eq(contactPriorAnswers.contactTargetId, contactTargets.id))
    .where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, isTest)));
  return row?.count ?? 0;
}
