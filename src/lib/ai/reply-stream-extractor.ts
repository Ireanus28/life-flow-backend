/**
 * The model is asked to return one JSON object (`{"reply": "...", "tasks": [...], ...}`)
 * so task/reminder/memory extraction stays coherent with the reply in a single
 * call. That JSON arrives as a token stream, so to show the user the reply as
 * it's generated (rather than waiting for the whole object to close), this
 * incrementally locates the "reply" string value inside the raw stream and
 * decodes newly-completed characters as they arrive.
 *
 * Re-parsing the accumulated raw slice on every chunk (instead of manually
 * tracking JSON escape state across chunk boundaries) is deliberate: reply
 * text is short enough that this is cheap, and JSON.parse already handles
 * every escape sequence correctly — a slice ending mid-escape just fails to
 * parse and we wait for more data.
 */
export class ReplyStreamExtractor {
  private buffer = "";
  private replyValueStart = -1;
  private closed = false;
  private lastDecoded = "";

  /** Feed the next raw delta chunk; returns newly-decoded plain-text characters, if any. */
  push(deltaText: string): string {
    if (this.closed) return "";
    this.buffer += deltaText;

    if (this.replyValueStart === -1) {
      const match = /"reply"\s*:\s*"/.exec(this.buffer);
      if (!match) return "";
      this.replyValueStart = match.index + match[0].length;
    }

    let end = this.buffer.length;
    let escaped = false;
    for (let i = this.replyValueStart; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        end = i;
        this.closed = true;
        break;
      }
    }

    const rawSlice = this.buffer.slice(this.replyValueStart, end);
    let decoded: string;
    try {
      decoded = JSON.parse(`"${rawSlice}"`);
    } catch {
      return "";
    }

    const newText = decoded.slice(this.lastDecoded.length);
    this.lastDecoded = decoded;
    return newText;
  }
}
