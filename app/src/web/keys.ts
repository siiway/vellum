// Whether a keydown belongs to an input method composing text (pinyin and
// the like): its arrows pick a candidate and its Enter commits it. Safari
// sends the Enter that ends a composition after compositionend, marked only
// by keyCode 229.
export function isComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}
