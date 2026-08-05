/**
 * Splits SQL into top-level statements.
 *
 * A naive split on ';' would tear apart every PL/pgSQL body, so this tracks
 * dollar-quoted blocks ($$ ... $$ and $tag$ ... $tag$), single-quoted strings
 * with their '' escape, double-quoted identifiers, line comments, and nested
 * block comments. Only a semicolon seen outside all of those ends a statement.
 *
 * Shared by `check-sql-syntax.mjs` and `isolate-sql.mjs` so the two tools can
 * never disagree about where a statement begins.
 */
export function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let index = 0;
  let line = 1;
  let startLine = 1;

  const isAtEnd = () => index >= sql.length;

  while (!isAtEnd()) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === '\n') {
      line += 1;
      index += 1;
      continue;
    }

    // Line comment
    if (char === '-' && next === '-') {
      while (!isAtEnd() && sql[index] !== '\n') index += 1;
      continue;
    }

    // Block comment (Postgres allows nesting)
    if (char === '/' && next === '*') {
      let depth = 1;
      index += 2;
      while (!isAtEnd() && depth > 0) {
        if (sql[index] === '\n') line += 1;
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }

    // Single-quoted literal, with '' as the escape
    if (char === "'") {
      index += 1;
      while (!isAtEnd()) {
        if (sql[index] === '\n') line += 1;
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    // Double-quoted identifier
    if (char === '"') {
      index += 1;
      while (!isAtEnd() && sql[index] !== '"') {
        if (sql[index] === '\n') line += 1;
        index += 1;
      }
      index += 1;
      continue;
    }

    // Dollar-quoted body
    if (char === '$') {
      const tagMatch = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index));
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeAt = sql.indexOf(tag, index + tag.length);
        const body = sql.slice(index, closeAt === -1 ? sql.length : closeAt + tag.length);
        line += (body.match(/\n/g) ?? []).length;
        index = closeAt === -1 ? sql.length : closeAt + tag.length;
        continue;
      }
    }

    if (char === ';') {
      const text = sql.slice(start, index + 1);
      if (text.trim().length > 0) statements.push({ text, line: startLine });
      index += 1;
      start = index;
      startLine = line;
      continue;
    }

    index += 1;
  }

  const tail = sql.slice(start);
  if (tail.trim().length > 0) statements.push({ text: tail, line: startLine });

  return statements;
}
