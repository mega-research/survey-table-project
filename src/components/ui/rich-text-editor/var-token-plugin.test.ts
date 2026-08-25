import { describe, expect, it } from 'vitest';

import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';

import {
  mailVarTokenPlugin,
  scanTokenRanges,
} from '@/components/ui/rich-text-editor/var-token-plugin';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
  },
  marks: {},
});

function makeDoc(text: string) {
  return schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]);
}

describe('scanTokenRanges', () => {
  it('단일 토큰 위치 반환', () => {
    const doc = makeDoc('hi {{name}}');
    const ranges = scanTokenRanges(doc);
    expect(ranges).toEqual([{ from: 4, to: 12 }]);
  });

  it('여러 토큰 모두 반환', () => {
    const doc = makeDoc('{{a}} {{b}}');
    const ranges = scanTokenRanges(doc);
    expect(ranges.length).toBe(2);
  });

  it('토큰 없으면 빈 배열', () => {
    const doc = makeDoc('plain text');
    expect(scanTokenRanges(doc)).toEqual([]);
  });

  it('잘못된 형태({{만) 는 매칭 X', () => {
    const doc = makeDoc('{{ broken');
    expect(scanTokenRanges(doc)).toEqual([]);
  });
});

describe('mailVarTokenPlugin', () => {
  it('초기 doc 의 토큰을 Decoration 으로 마킹', () => {
    const doc = makeDoc('hi {{x}}');
    const state = EditorState.create({ doc, plugins: [mailVarTokenPlugin] });
    const deco = mailVarTokenPlugin.getState(state);
    expect(deco).toBeDefined();
    expect(deco!.find().length).toBe(1);
  });
});
