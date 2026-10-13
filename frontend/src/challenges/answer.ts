/** Pull the final answer out of a model's free-form output. */

/** Drop visible reasoning blocks some models emit before the answer. */
export function stripThinking(text: string): string {
  return text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "").replace(/^[\s\S]*<\/think>/i, "");
}

/** Last <answer>…</answer>; else last ```answer / last fenced block; else the last non-empty line. */
export function extractAnswer(output: string): string {
  const text = stripThinking(output);
  const tagged = [...text.matchAll(/<answer>([\s\S]*?)<\/answer>/gi)];
  if (tagged.length) return tagged.at(-1)![1]!.trim();
  const open = text.lastIndexOf("<answer>");
  if (open >= 0) return text.slice(open + 8).trim();
  const fences = [...text.matchAll(/```[\w-]*\n([\s\S]*?)```/g)];
  if (fences.length) return fences.at(-1)![1]!.trim();
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "";
}

/** For code answers: prefer an ```js/ts fence (inside <answer> or not). */
export function extractCode(output: string): string {
  const text = stripThinking(output);
  const scope = [...text.matchAll(/<answer>([\s\S]*?)<\/answer>/gi)].at(-1)?.[1] ?? text;
  const fences = [...scope.matchAll(/```(\w*)\n([\s\S]*?)```/g)];
  const js = fences.filter((f) => /^(js|javascript|ts|typescript|)$/i.test(f[1]!));
  if (js.length) return js.at(-1)![2]!;
  if (fences.length) return fences.at(-1)![2]!;
  return scope.trim();
}

export const ANSWER_RULE = "Think it through, then put ONLY your final answer inside <answer></answer> tags at the end.";

/** Prompt line for the move budget. */
export function moveRule(maxMoves: number | undefined): string {
  return maxMoves
    ? `You may use at most ${maxMoves} moves — longer answers count as not solved.`
    : "There is NO move limit. Your sequence must solve it COMPLETELY — give the full solution however long it is (50, 100 or more moves is fine). Do not stop early or give a partial sequence.";
}

/** Verdict for an answer longer than the budget (checked before applying it). */
export function overBudget(used: number, maxMoves: number | undefined) {
  return maxMoves && used > maxMoves
    ? { score: 0, solved: false, note: `used ${used} moves — over the limit of ${maxMoves}`, moves: used }
    : null;
}

/** Optimality score for move sequences: 100 when optimal, less for longer valid solutions. */
export function efficiency(optimal: number, used: number): number {
  if (used <= 0) return optimal === 0 ? 100 : 0;
  return Math.max(50, Math.round((100 * Math.min(optimal, used)) / used));
}
