import { describe, it, expect } from 'vitest';
import { createCardFenceParser } from './fence';
import { parseGedoCards, type GedoCard } from './schemas';

/** Drive the streaming parser over a chunk sequence, collecting text + cards. */
function run(chunks: string[]): { text: string; cards: GedoCard[] } {
  const text: string[] = [];
  const cards: GedoCard[] = [];
  const parser = createCardFenceParser({
    onText: (t) => text.push(t),
    onCard: (c) => cards.push(c),
  });
  for (const chunk of chunks) parser.push(chunk);
  parser.flush();
  return { text: text.join(''), cards };
}

const SNAP = '{"card_type":"snapshot","period":"week","stats":[{"label":"完成","value":3}]}';

describe('createCardFenceParser — streaming fence extraction', () => {
  it('A: whole card in one chunk → 1 card, surrounding text preserved', () => {
    const r = run(['你好\n```gedo:card:v1\n' + SNAP + '\n```\n再见']);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].card_type).toBe('snapshot');
    expect(r.text).toContain('你好');
    expect(r.text).toContain('再见');
    expect(r.text).not.toContain('card_type');
  });

  it('B: fence sentinel split across chunks → still 1 card', () => {
    const r = run(['前言...```gedo:card', ':v1\n' + SNAP + '\n```后语']);
    expect(r.cards).toHaveLength(1);
    expect(r.text).toContain('前言');
    expect(r.text).toContain('后语');
  });

  it('C: space (not newline) after sentinel → tolerant, 1 card', () => {
    const r = run(['```gedo:card:v1 ' + SNAP + '```']);
    expect(r.cards).toHaveLength(1);
  });

  it('D: a normal ```js code block is NOT a card, preserved as text', () => {
    const r = run(['代码：\n```js\nconst x = 1;\n```\n完']);
    expect(r.cards).toHaveLength(0);
    expect(r.text).toContain('```js');
    expect(r.text).toContain('const x = 1;');
  });

  it('E: card body split across chunks → 1 card', () => {
    const r = run(['开头\n```gedo:card:v1\n' + SNAP.slice(0, 20), SNAP.slice(20) + '\n```\n尾巴']);
    expect(r.cards).toHaveLength(1);
    expect(r.text).toContain('尾巴');
  });

  it('F: malformed JSON → 0 cards, raw fence reconstructed in text (nothing lost)', () => {
    const r = run(['x\n```gedo:card:v1\n{bad json,}\n```\ny']);
    expect(r.cards).toHaveLength(0);
    expect(r.text).toContain('gedo:card:v1');
    expect(r.text).toContain('{bad json,}');
  });

  it('G: closing ``` on the same line as the JSON end → 1 card', () => {
    const r = run(['```gedo:card:v1\n' + SNAP + '```']);
    expect(r.cards).toHaveLength(1);
  });

  it('flush() emits buffered tail text', () => {
    const text: string[] = [];
    const p = createCardFenceParser({ onText: (t) => text.push(t) });
    p.push('a short tail'); // shorter than the look-ahead keepTail → buffered
    expect(text.join('')).toBe('');
    p.flush();
    expect(text.join('')).toBe('a short tail');
  });
});

describe('streaming parser agrees with the replay parser (parseGedoCards)', () => {
  const inputs = [
    '你好\n```gedo:card:v1\n' + SNAP + '\n```\n再见',
    '```gedo:card:v1 ' + SNAP + '```',        // space variant
    '```gedo:card:v1\n' + SNAP + '```',        // no newline before close
    '纯文字没有卡片',
    '代码：\n```js\ncode\n```',
  ];
  for (const input of inputs) {
    it(`same card count for: ${JSON.stringify(input.slice(0, 26))}…`, () => {
      const stream = run([input]);
      const replay = parseGedoCards(input);
      expect(stream.cards.length).toBe(replay.cards.length);
    });
  }
});
