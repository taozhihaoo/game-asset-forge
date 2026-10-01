/**
 * HTML report rendering for the analyze command (V2 Feature 8).
 * Presentation lives in the CLI layer — core only produces report data.
 * Deterministic: pure string building from the report, no timestamps.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

interface ReportLike {
  readonly version: number;
  readonly summary: {
    readonly assets: number;
    readonly warnings: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly info: number;
  };
  readonly issues: readonly {
    readonly asset: string;
    readonly warnings: readonly {
      readonly rule: string;
      readonly severity: string;
      readonly message: string;
      readonly suggestion: string;
    }[];
  }[];
  readonly errors?: readonly { readonly source: string; readonly error: string }[];
}

export function renderQualityReportHtml(report: ReportLike): string {
  const { summary } = report;
  const sections: string[] = [];
  for (const entry of report.issues) {
    const asset = escapeHtml(entry.asset);
    const rows: string[] = [];
    if (entry.warnings.length === 0) {
      rows.push('<li class="ok">✓ Good</li>');
    }
    for (const warning of entry.warnings) {
      rows.push(
        `<li class="severity-${escapeHtml(warning.severity)}">` +
          `<span class="badge">${escapeHtml(warning.severity)}</span> ` +
          `<code>${escapeHtml(warning.rule)}</code> — ${escapeHtml(warning.message)}` +
          (warning.suggestion === '' ? '' : ` <em>${escapeHtml(warning.suggestion)}</em>`) +
          '</li>',
      );
    }
    sections.push(`<section class="asset"><h2>${asset}</h2><ul>${rows.join('')}</ul></section>`);
  }

  const errorRows = (report.errors ?? []).map(
    (error) =>
      `<li class="severity-high"><span class="badge">error</span> ${escapeHtml(error.source)} — ${escapeHtml(error.error)}</li>`,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Asset Quality Report</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #17181c; color: #d8dbe2; margin: 24px; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin: 4px 0; }
  .summary { color: #8a8f9c; }
  .summary b { color: #d8dbe2; }
  .asset { background: #1f2127; border: 1px solid #2c2f38; border-radius: 6px; padding: 8px 14px; margin: 12px 0; }
  ul { list-style: none; padding: 0; margin: 6px 0; }
  li { padding: 3px 0; }
  .badge { display: inline-block; min-width: 52px; text-align: center; border-radius: 4px; padding: 1px 6px;
           background: #2a2d36; font-size: 11px; text-transform: uppercase; }
  .severity-high .badge { color: #ff6b6b; border: 1px solid #ff6b6b; }
  .severity-medium .badge { color: #ffb84a; border: 1px solid #ffb84a; }
  .severity-low .badge { color: #41c7ff; border: 1px solid #41c7ff; }
  .severity-info .badge { color: #8a8f9c; border: 1px solid #8a8f9c; }
  .ok { color: #6bd66b; }
  em { color: #8a8f9c; }
  code { color: #41c7ff; }
</style>
</head>
<body>
<h1>Asset Quality Report</h1>
<p class="summary">Assets: <b>${summary.assets}</b> · Warnings: <b>${summary.warnings}</b>
 (high <b>${summary.high}</b>, medium <b>${summary.medium}</b>, low <b>${summary.low}</b>, info <b>${summary.info}</b>)
 · Report schema version: <b>${report.version}</b></p>
${errorRows.length > 0 ? `<section class="asset"><h2>Errors</h2><ul>${errorRows.join('')}</ul></section>` : ''}
${sections.join('\n')}
</body>
</html>
`;
}
