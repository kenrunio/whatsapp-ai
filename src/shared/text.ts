// Text rules shared by the main process and the WhatsApp page.

/**
 * The {…} instructions in a text, in order. An instruction ends on the same line; `{?}` and
 * `{}` are not instructions, nor is anything containing another `{`. Square brackets are
 * ordinary text. (ClassicMail's ai::compose::instructions, without mail-merge fields.)
 */
export function instructions(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const rest = text.slice(open + 1);
    const m = rest.search(/[}\n]/);
    if (m >= 0 && rest[m] === "}") {
      const inner = rest.slice(0, m).trim();
      if (inner && inner !== "?" && !inner.includes("{")) out.push(inner);
      i = open + 1 + m + 1;
    } else {
      i = open + 1;
    }
  }
  return out;
}

export const hasInstructions = (text: string): boolean => instructions(text).length > 0;
