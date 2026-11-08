export interface IssueComment {
  author: string;
  body: string;
  createdAt: string; // ISO
}

export type Approval = { kind: 'approve' } | { kind: 'revise'; text: string };

// Devuelve el último comando válido del aprobador posterior a `since`.
// Solo cuenta si el comentario empieza por el comando.
export function parseApproval(comments: IssueComment[], since: string, login: string): Approval | null {
  const sinceMs = Date.parse(since);
  let result: Approval | null = null;
  const sorted = [...comments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const c of sorted) {
    if (Date.parse(c.createdAt) <= sinceMs) continue;
    if (c.author.toLowerCase() !== login.toLowerCase()) continue;
    const body = c.body.trim();
    if (/^\/approve\b/.test(body)) {
      result = { kind: 'approve' };
      continue;
    }
    const m = /^\/revise\b\s*([\s\S]*)$/.exec(body);
    if (m && m[1].trim()) result = { kind: 'revise', text: m[1].trim() };
  }
  return result;
}
