/**
 * Streaming parser for ```gedo:card:v1 fences.
 *
 * Feed decoded text chunks via push(); it emits plain text through onText and
 * completed cards through onCard, buffering across chunk boundaries. Call
 * flush() once at stream end to emit any buffered tail text.
 *
 * Uses the same fence sentinels as the whole-string replay parser in
 * schemas.ts::parseGedoCards, so a live stream and a post-refresh reload
 * recognise fences identically (the sentinel may be followed by a newline OR
 * any whitespace before the JSON body — cardAccum is trimmed before parse).
 *
 * Extracted from apiClient.chatStream so the logic is unit-testable
 * (lib/genui/fence.test.ts) instead of being buried in a live streaming method.
 */
import { CARD_FENCE_OPEN, CARD_FENCE_CLOSE, type GedoCard } from './schemas';

export interface FenceParserCallbacks {
  onText?: (text: string) => void;
  onCard?: (card: GedoCard) => void;
}

export interface CardFenceParser {
  /** Feed one decoded text chunk. */
  push(chunk: string): void;
  /** Emit any buffered tail text (call once at stream end). */
  flush(): void;
}

export function createCardFenceParser(callbacks: FenceParserCallbacks): CardFenceParser {
  const FENCE_OPEN = CARD_FENCE_OPEN;   // '```gedo:card:v1'
  const FENCE_CLOSE = CARD_FENCE_CLOSE; // '```'
  let textAccum = '';   // text not yet emitted
  let inCard = false;
  let cardAccum = '';   // JSON body accumulating inside a fence

  // Emit the safe prefix of textAccum, keeping a short tail as look-ahead so a
  // fence sentinel split across chunk boundaries isn't missed mid-parse.
  const flushText = (keepTail = 20) => {
    if (!callbacks.onText) return;
    const safe = textAccum.length > keepTail ? textAccum.slice(0, textAccum.length - keepTail) : '';
    if (safe) { callbacks.onText(safe); textAccum = textAccum.slice(safe.length); }
  };

  const push = (chunk: string) => {
    textAccum += chunk;
    while (true) {
      if (!inCard) {
        const fIdx = textAccum.indexOf(FENCE_OPEN);
        if (fIdx === -1) { flushText(FENCE_OPEN.length); break; }
        // Emit any text before the fence, then enter card-accumulation mode.
        if (fIdx > 0) callbacks.onText?.(textAccum.slice(0, fIdx));
        textAccum = textAccum.slice(fIdx + FENCE_OPEN.length);
        inCard = true;
        cardAccum = '';
      } else {
        const cIdx = textAccum.indexOf(FENCE_CLOSE);
        if (cIdx === -1) { cardAccum += textAccum; textAccum = ''; break; }
        cardAccum += textAccum.slice(0, cIdx);
        textAccum = textAccum.slice(cIdx + FENCE_CLOSE.length);
        inCard = false;
        // Parse and emit the card; on malformed JSON fall back to the raw fence
        // text (reconstructed faithfully) so nothing is silently lost.
        try {
          callbacks.onCard?.(JSON.parse(cardAccum.trim()) as GedoCard);
        } catch {
          callbacks.onText?.(FENCE_OPEN + cardAccum + FENCE_CLOSE);
        }
        cardAccum = '';
      }
    }
  };

  const flush = () => {
    if (textAccum) { callbacks.onText?.(textAccum); textAccum = ''; }
  };

  return { push, flush };
}
