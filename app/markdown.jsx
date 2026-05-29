// Lightweight markdown renderer - no external dependencies.
// Handles: fenced code blocks, headings, bullet lists, ordered lists, tables, bold, italic, inline code, hr.

const INLINE_CODE = {
  background: "#f0f0f1",
  padding: "1px 5px",
  borderRadius: "3px",
  fontFamily: "'SFMono-Regular', Consolas, monospace",
  fontSize: "92%",
};

const CODE_BLOCK = {
  background: "#f6f6f7",
  color: "#202223",
  border: "1px solid #e1e3e5",
  padding: "14px 18px",
  borderRadius: "8px",
  fontSize: "12.5px",
  fontFamily: "'SFMono-Regular', Consolas, monospace",
  overflowX: "auto",
  margin: "10px 0",
  lineHeight: "1.55",
};

const TH_STYLE = {
  background: "#f6f6f7",
  border: "1px solid #e1e3e5",
  padding: "8px 12px",
  fontWeight: 600,
  color: "#202223",
  whiteSpace: "nowrap",
};

const TD_STYLE = {
  border: "1px solid #e1e3e5",
  padding: "7px 12px",
  color: "#202223",
  verticalAlign: "top",
};

function parseTableRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function columnAligns(separatorLine) {
  return separatorLine
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => {
      cell = cell.trim();
      if (cell.startsWith(":") && cell.endsWith(":")) return "center";
      if (cell.endsWith(":")) return "right";
      return "left";
    });
}

function isTableRow(line) {
  return line.startsWith("|") && line.includes("|", 1);
}

function isSeparatorRow(line) {
  return /^\|[-:| ]+\|$/.test(line.trim());
}

function renderInline(text, keyPrefix) {
  const parts = [];
  // matches **bold**, *italic*, `code` - in one pass, picks earliest match
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0;
  let k = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[0].startsWith("**"))
      parts.push(<strong key={`${keyPrefix}-${k++}`}>{m[2]}</strong>);
    else if (m[0].startsWith("*"))
      parts.push(<em key={`${keyPrefix}-${k++}`}>{m[3]}</em>);
    else
      parts.push(
        <code key={`${keyPrefix}-${k++}`} style={INLINE_CODE}>
          {m[4]}
        </code>
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ children }) {
  const text = (children ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return null;

  const elements = [];
  const lines = text.split("\n");
  let i = 0;
  let ek = 0; // element key

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ──────────────────────────────────────────────────
    if (line.startsWith("```")) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing ```
      elements.push(
        <pre key={ek++} style={CODE_BLOCK}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // ── Heading ───────────────────────────────────────────────────────────
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      const level = hm[1].length;
      const size = ["18px", "16px", "15px", "14px", "14px", "13px"][level - 1];
      elements.push(
        <p key={ek++} style={{ fontWeight: 700, fontSize: size, margin: "14px 0 4px" }}>
          {renderInline(hm[2], ek)}
        </p>
      );
      i++;
      continue;
    }

    // ── Table ─────────────────────────────────────────────────────────────
    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const headers = parseTableRow(line);
      const aligns = columnAligns(lines[i + 1]);
      i += 2; // skip header + separator

      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }

      elements.push(
        <div key={ek++} style={{ overflowX: "auto", margin: "10px 0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi} style={{ ...TH_STYLE, textAlign: aligns[hi] ?? "left" }}>
                    {renderInline(h, `th-${ek}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr
                  key={ri}
                  style={{ background: ri % 2 === 1 ? "#fafbfc" : "transparent" }}
                >
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ ...TD_STYLE, textAlign: aligns[ci] ?? "left" }}>
                      {renderInline(cell, `td-${ek}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // ── Unordered list ────────────────────────────────────────────────────
    if (line.match(/^[-*+] /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*+] /)) {
        items.push(lines[i].replace(/^[-*+] /, ""));
        i++;
      }
      elements.push(
        <ul key={ek++} style={{ margin: "6px 0", paddingLeft: "22px", lineHeight: "1.65" }}>
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, `li-${ii}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // ── Ordered list ──────────────────────────────────────────────────────
    if (line.match(/^\d+\. /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={ek++} style={{ margin: "6px 0", paddingLeft: "22px", lineHeight: "1.65" }}>
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, `oli-${ii}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // ── Horizontal rule ───────────────────────────────────────────────────
    if (line.match(/^(---+|\*\*\*+|___+)$/)) {
      elements.push(
        <hr key={ek++} style={{ border: "none", borderTop: "1px solid #e1e3e5", margin: "14px 0" }} />
      );
      i++;
      continue;
    }

    // ── Empty line ────────────────────────────────────────────────────────
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Paragraph ─────────────────────────────────────────────────────────
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].match(/^#{1,6} /) &&
      !lines[i].match(/^[-*+] /) &&
      !lines[i].match(/^\d+\. /) &&
      !lines[i].match(/^(---+|\*\*\*+|___+)$/) &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(
        <p key={ek++} style={{ margin: "4px 0", lineHeight: "1.65" }}>
          {renderInline(paraLines.join(" "), `p-${ek}`)}
        </p>
      );
    }
  }

  return <>{elements}</>;
}