import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const SEVERITY_COLORS = {
  critical: [211, 47, 47],
  warning: [245, 124, 0],
  info: [25, 118, 210],
};

function fmt(val, decimals = 1) {
  if (val === null || val === undefined) return "N/A";
  const n = Number(val);
  return isNaN(n) ? "N/A" : n.toFixed(decimals);
}

function fmtPct(val) {
  if (val === null || val === undefined) return "N/A";
  return `${fmt(val, 1)}%`;
}

function fmtDate(ts) {
  if (!ts) return "N/A";
  return new Date(Number(ts)).toLocaleString();
}

/** Escape a value for inclusion in a CSV field, wrapping in quotes if needed. */
function csvField(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

/**
 * Draws a simple line chart inside the PDF document.
 *
 * @param {jsPDF} doc
 * @param {number[]} values  - y-axis data points
 * @param {number} x         - left edge (mm)
 * @param {number} y         - top edge (mm)
 * @param {number} w         - width (mm)
 * @param {number} h         - height (mm)
 * @param {string} label     - y-axis label
 * @param {[r,g,b]} color
 */
function drawLineChart(doc, values, x, y, w, h, label, color = [59, 130, 246]) {
  const valid = values.filter(
    (v) => v !== null && v !== undefined && !isNaN(Number(v)),
  );
  if (valid.length < 2) {
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text("No data", x + w / 2, y + h / 2, { align: "center" });
    return;
  }

  const nums = valid.map(Number);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;

  // Background
  doc.setFillColor(30, 41, 59);
  doc.roundedRect(x, y, w, h, 2, 2, "F");

  // Chart area insets
  const pad = 4;
  const cx = x + pad;
  const cy = y + pad;
  const cw = w - 2 * pad;
  const ch = h - 2 * pad;

  // Draw grid lines
  doc.setDrawColor(55, 65, 81);
  doc.setLineWidth(0.2);
  for (let i = 0; i <= 4; i++) {
    const gy = cy + (ch / 4) * i;
    doc.line(cx, gy, cx + cw, gy);
  }

  // Draw data line
  doc.setDrawColor(...color);
  doc.setLineWidth(0.6);
  const step = cw / (nums.length - 1);
  for (let i = 1; i < nums.length; i++) {
    const x1 = cx + step * (i - 1);
    const y1 = cy + ch - ((nums[i - 1] - min) / range) * ch;
    const x2 = cx + step * i;
    const y2 = cy + ch - ((nums[i] - min) / range) * ch;
    doc.line(x1, y1, x2, y2);
  }

  // Labels
  doc.setFontSize(6);
  doc.setTextColor(156, 163, 175);
  doc.text(label, x + 2, y + 3.5);
  doc.text(fmt(max, 0), x + w - 1, y + pad + 2, { align: "right" });
  doc.text(fmt(min, 0), x + w - 1, y + h - 1.5, { align: "right" });
}

/**
 * generatePDFReport - builds and downloads a PDF report for a target.
 *
 * @param {object} reportData - data returned from GET /api/targets/:id/report
 */
export function generatePDFReport(reportData) {
  const { target, uptime, metrics, ping_results, alerts, generated_at } =
    reportData;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let curY = margin;

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 28, "F");

  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text("n8watch", margin, 12);

  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text("Network Monitoring Report", margin, 19);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Generated: ${new Date(generated_at).toLocaleString()}`,
    pageW - margin,
    12,
    { align: "right" },
  );

  const isUp = target.is_alive;
  doc.setFillColor(
    ...(isUp ? [34, 197, 94] : isUp === 0 ? [239, 68, 68] : [107, 114, 128]),
  );
  doc.circle(pageW - margin - 3, 21, 2.5, "F");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(
    isUp ? "UP" : isUp === 0 ? "DOWN" : "UNKNOWN",
    pageW - margin - 7,
    21.5,
  );

  curY = 36;

  // ── Target Info ───────────────────────────────────────────────────────────
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(target.name, margin, curY);
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  const targetMeta = [
    `${target.ip}`,
    target.group ? `Group: ${target.group}` : null,
    target.interface_alias ? `Interface: ${target.interface_alias}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  doc.text(targetMeta, margin, curY + 5);

  curY += 14;

  // ── Availability Summary Table ────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text("AVAILABILITY", margin, curY);
  curY += 4;

  autoTable(doc, {
    startY: curY,
    margin: { left: margin, right: margin },
    head: [["Period", "Uptime %"]],
    body: [
      ["Last 1 hour", fmtPct(uptime.uptime_1h)],
      ["Last 24 hours", fmtPct(uptime.uptime_24h)],
      ["Last 7 days", fmtPct(uptime.uptime_7d)],
      ["Last 30 days", fmtPct(uptime.uptime_30d)],
      ["Overall", fmtPct(uptime.uptime_overall)],
    ],
    styles: {
      fontSize: 8,
      textColor: [226, 232, 240],
      fillColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [148, 163, 184],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [30, 41, 59] },
    tableLineColor: [55, 65, 81],
    tableLineWidth: 0.2,
  });

  curY = doc.lastAutoTable.finalY + 8;

  // ── Current Metrics ───────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text("CURRENT METRICS", margin, curY);
  curY += 4;

  autoTable(doc, {
    startY: curY,
    margin: { left: margin, right: margin },
    head: [["Metric", "Value"]],
    body: [
      [
        "Avg Latency",
        target.avg_latency !== null && target.avg_latency !== undefined
          ? `${fmt(target.avg_latency)} ms`
          : "N/A",
      ],
      ["Packet Loss", fmtPct(target.packet_loss)],
    ],
    styles: {
      fontSize: 8,
      textColor: [226, 232, 240],
      fillColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [148, 163, 184],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [30, 41, 59] },
    tableLineColor: [55, 65, 81],
    tableLineWidth: 0.2,
  });

  curY = doc.lastAutoTable.finalY + 8;

  // ── Charts ────────────────────────────────────────────────────────────────
  const chartW = (pageW - 2 * margin - 6) / 2;
  const chartH = 30;

  if (metrics && metrics.length > 0) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("LATENCY TREND (24h)", margin, curY);
    curY += 4;

    const latencyValues = metrics.map((m) => m.avg_latency);
    const lossValues = metrics.map((m) => m.packet_loss);

    drawLineChart(
      doc,
      latencyValues,
      margin,
      curY,
      chartW,
      chartH,
      "Avg Latency (ms)",
      [59, 130, 246],
    );
    drawLineChart(
      doc,
      lossValues,
      margin + chartW + 6,
      curY,
      chartW,
      chartH,
      "Packet Loss (%)",
      [239, 68, 68],
    );

    curY += chartH + 8;
  }

  // ── Recent Ping Results ───────────────────────────────────────────────────
  if (ping_results && ping_results.length > 0) {
    // Check if we need a new page
    if (curY > 220) {
      doc.addPage();
      curY = margin;
    }

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("RECENT PING RESULTS (last 50)", margin, curY);
    curY += 4;

    const pingRows = ping_results
      .slice(0, 50)
      .map((r) => [
        fmtDate(r.created_at),
        r.is_alive ? "UP" : "DOWN",
        r.avg_latency !== null ? `${fmt(r.avg_latency)} ms` : "N/A",
        fmtPct(r.packet_loss),
        r.jitter !== null ? `${fmt(r.jitter)} ms` : "N/A",
      ]);

    autoTable(doc, {
      startY: curY,
      margin: { left: margin, right: margin },
      head: [["Time", "Status", "Avg Latency", "Packet Loss", "Jitter"]],
      body: pingRows,
      styles: {
        fontSize: 7,
        textColor: [226, 232, 240],
        fillColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [148, 163, 184],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [30, 41, 59] },
      tableLineColor: [55, 65, 81],
      tableLineWidth: 0.2,
      didParseCell: (data) => {
        if (data.column.index === 1 && data.section === "body") {
          data.cell.styles.textColor =
            data.cell.raw === "UP" ? [34, 197, 94] : [239, 68, 68];
        }
      },
    });

    curY = doc.lastAutoTable.finalY + 8;
  }

  // ── Alerts History ────────────────────────────────────────────────────────
  if (alerts && alerts.length > 0) {
    if (curY > 220) {
      doc.addPage();
      curY = margin;
    }

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("ALERT HISTORY", margin, curY);
    curY += 4;

    const alertRows = alerts.map((a) => [
      fmtDate(a.created_at),
      a.rule_name || "",
      String(a.severity || "").toUpperCase(),
      a.resolved ? "Resolved" : "Active",
    ]);

    autoTable(doc, {
      startY: curY,
      margin: { left: margin, right: margin },
      head: [["Time", "Rule", "Severity", "Status"]],
      body: alertRows,
      styles: {
        fontSize: 7,
        textColor: [226, 232, 240],
        fillColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [148, 163, 184],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [30, 41, 59] },
      tableLineColor: [55, 65, 81],
      tableLineWidth: 0.2,
      didParseCell: (data) => {
        if (data.column.index === 2 && data.section === "body") {
          const sev = String(data.cell.raw).toLowerCase();
          data.cell.styles.textColor = SEVERITY_COLORS[sev] || [226, 232, 240];
          data.cell.styles.fontStyle = "bold";
        }
        if (data.column.index === 3 && data.section === "body") {
          data.cell.styles.textColor =
            data.cell.raw === "Active" ? [239, 68, 68] : [34, 197, 94];
        }
      },
    });
  }

  // ── Footer on all pages ───────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `n8watch · Page ${i} of ${totalPages}`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 6,
      { align: "center" },
    );
  }

  const filename = `${target.name.replace(/\s+/g, "_")}_report_${Date.now()}.pdf`;
  doc.save(filename);
}

/**
 * generateCSVReport - builds and downloads a CSV report from the report data.
 *
 * @param {object} reportData - data returned from GET /api/targets/:id/report
 */
export function generateCSVReport(reportData) {
  const { target, uptime, ping_results, alerts, generated_at } = reportData;

  const lines = [];

  // Header metadata
  lines.push(`# n8watch Report`);
  lines.push(`# Generated At,${generated_at}`);
  lines.push(`# Target,${target.name}`);
  lines.push(`# IP,${target.ip}`);
  lines.push(`# Group,${target.group || ""}`);
  if (target.interface_alias) {
    lines.push(
      `# Interface,${target.interface_alias}${target.interface ? ` (${target.interface})` : ""}`,
    );
  }
  lines.push("");

  // Availability
  lines.push("## Availability");
  lines.push("Period,Uptime %");
  lines.push(`Last 1 hour,${uptime.uptime_1h ?? ""}`);
  lines.push(`Last 24 hours,${uptime.uptime_24h ?? ""}`);
  lines.push(`Last 7 days,${uptime.uptime_7d ?? ""}`);
  lines.push(`Last 30 days,${uptime.uptime_30d ?? ""}`);
  lines.push(`Overall,${uptime.uptime_overall ?? ""}`);
  lines.push("");

  // Ping results
  if (ping_results && ping_results.length > 0) {
    lines.push("## Ping Results");
    lines.push(
      "Time,Status,Avg Latency (ms),Min Latency (ms),Max Latency (ms),Jitter (ms),Packet Loss (%),Packets Sent,Packets Received",
    );
    for (const r of ping_results) {
      lines.push(
        [
          new Date(Number(r.created_at)).toISOString(),
          r.is_alive ? "UP" : "DOWN",
          r.avg_latency ?? "",
          r.min_latency ?? "",
          r.max_latency ?? "",
          r.jitter ?? "",
          r.packet_loss ?? "",
          r.packets_sent ?? "",
          r.packets_received ?? "",
        ].join(","),
      );
    }
    lines.push("");
  }

  // Alerts
  if (alerts && alerts.length > 0) {
    lines.push("## Alerts");
    lines.push("Time,Rule,Severity,Condition,Status,Resolved At");
    for (const a of alerts) {
      lines.push(
        [
          new Date(Number(a.created_at)).toISOString(),
          csvField(a.rule_name),
          a.severity || "",
          csvField(a.condition),
          a.resolved ? "Resolved" : "Active",
          a.resolved_at ? new Date(Number(a.resolved_at)).toISOString() : "",
        ].join(","),
      );
    }
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${target.name.replace(/\s+/g, "_")}_report_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── ISP-facing Availability Report (PDF) ───────────────────────────────────────

/** Local "YYYY-MM-DD HH:MM:SS" timestamp. */
function fmtTs(ms) {
  if (!ms) return "N/A";
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return "N/A";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Human duration from ms, e.g. "1h 4m 20s". */
function fmtDuration(ms) {
  if (!ms || ms < 0) return "0s";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h ? `${h}h` : null, h || m ? `${m}m` : null, `${sec}s`].filter(Boolean).join(" ");
}

/** Light-theme latency trend chart drawn with jsPDF primitives (no DOM needed). */
function drawLatencyTrend(doc, series, x, y, w, h, threshold) {
  doc.setFillColor(249, 250, 251);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, "FD");

  const pad = 6;
  const cx = x + pad, cy = y + pad, cw = w - 2 * pad, ch = h - 2 * pad;
  const pts = series || [];
  const vals = pts.map((p) => p.avg_latency).filter((v) => v != null && !isNaN(v));
  if (vals.length < 2) {
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text("No latency data for this period", x + w / 2, y + h / 2, { align: "center" });
    return;
  }
  const maxV = (Math.max(Math.max(...vals), threshold) * 1.1) || 1;
  const range = maxV || 1;

  // grid + y labels
  doc.setFontSize(6);
  for (let i = 0; i <= 4; i++) {
    const gy = cy + (ch / 4) * i;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.15);
    doc.line(cx, gy, cx + cw, gy);
    doc.setTextColor(148, 163, 184);
    doc.text(String(Math.round(maxV - (range / 4) * i)), x + 1.5, gy + 1.5);
  }

  // threshold line (amber, dashed if supported)
  const ty = cy + ch - (threshold / range) * ch;
  if (ty >= cy && ty <= cy + ch) {
    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(0.3);
    if (doc.setLineDashPattern) doc.setLineDashPattern([1, 1], 0);
    doc.line(cx, ty, cx + cw, ty);
    if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);
  }

  // latency line (blue), breaking on null (down)
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.5);
  const step = cw / (pts.length - 1 || 1);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].avg_latency, b = pts[i].avg_latency;
    if (a == null || b == null) continue;
    doc.line(cx + step * (i - 1), cy + ch - (a / range) * ch, cx + step * i, cy + ch - (b / range) * ch);
  }

  // red ticks at the baseline where the host was down
  doc.setDrawColor(239, 68, 68);
  doc.setLineWidth(0.8);
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].avg_latency == null) {
      const px = cx + step * i;
      doc.line(px, cy + ch, px, cy + ch - 2.5);
    }
  }
}

/** Draw the n8watch mark (the blue radar favicon) as vectors at (x,y), size mm. */
function drawN8Mark(doc, x, y, size) {
  const s = size, u = s / 32; // favicon is a 32x32 viewBox
  doc.setFillColor(37, 99, 235);
  doc.roundedRect(x, y, s, s, s / 4, s / 4, "F");
  const cx = x + s / 2, cy = y + s / 2;
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(2 * u);
  doc.circle(cx, cy, 6 * u, "S");        // radar ring
  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, 2 * u, "F");         // center dot
  doc.setLineCap("round");
  doc.line(cx, y + 4 * u, cx, y + 8 * u);          // top tick
  doc.line(cx, y + 24 * u, cx, y + 28 * u);        // bottom tick
  doc.line(x + 4 * u, cy, x + 8 * u, cy);          // left tick
  doc.line(x + 24 * u, cy, x + 28 * u, cy);        // right tick
  doc.setLineCap("butt");
}

/**
 * buildISPReportDoc — build (but do not save) the availability report PDF.
 * Returns the jsPDF doc so callers can save() (browser) or output() (tests).
 *
 * @param {object} data  from GET /api/targets/:id/log-report
 * @param {object} opts  { logoDataUrl, companyName }
 */
export function buildISPReportDoc(data, opts = {}) {
  const { target, period, summary, events = [], series = [], latency_threshold = 100, jitter_threshold = 0, outages_only = false, generated_at, events_truncated, log = [], log_total = 0, log_truncated = false } = data;
  const { logoDataUrl = null, companyName = "" } = opts;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = margin;

  // ── Header ──────────────────────────────────────────────────────────────────
  let headerBottom = y + 6;
  let logoBottom = y; // where the company logo ends (top if none)
  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl);
      const maxW = 55, maxH = 18;
      const r = Math.min(maxW / props.width, maxH / props.height);
      const lw = props.width * r, lh = props.height * r;
      const fmtType = /^data:image\/png/i.test(logoDataUrl) ? "PNG" : "JPEG";
      doc.addImage(logoDataUrl, fmtType, margin, y, lw, lh);
      logoBottom = y + lh;
      headerBottom = Math.max(headerBottom, logoBottom);
    } catch { /* invalid logo — skip */ }
  }

  // n8watch product branding (vector mark + wordmark) below the company logo
  const brandY = logoDataUrl ? logoBottom + 3 : y;
  const markSize = 8;
  drawN8Mark(doc, margin, brandY, markSize);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(37, 99, 235);
  doc.text("n8watch", margin + markSize + 2.5, brandY + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text("Network Monitoring", margin + markSize + 2.5, brandY + 8.6);
  headerBottom = Math.max(headerBottom, brandY + markSize);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("Network Availability Report", pageW - margin, y + 6, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  let hy = y + 12;
  if (companyName) { doc.text(companyName, pageW - margin, hy, { align: "right" }); hy += 5; }
  doc.text(`Generated: ${fmtTs(generated_at)}`, pageW - margin, hy, { align: "right" });
  headerBottom = Math.max(headerBottom, hy);
  y = headerBottom + 5;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  // ── Report metadata ───────────────────────────────────────────────────────────
  const meta = [
    ["Target", target.name],
    ["Target IP", target.ip],
    ["Source IP", target.source_ip || "—"],
    ["ISP / Group", target.group || "—"],
    ["Interface", target.interface_alias || "—"],
    ["Reporting period", `${fmtTs(period.from)}  to  ${fmtTs(period.to)}`],
  ];
  doc.setFontSize(9);
  meta.forEach(([k, v]) => {
    doc.setTextColor(100, 116, 139);
    doc.text(`${k}:`, margin, y);
    doc.setTextColor(15, 23, 42);
    doc.text(String(v), margin + 36, y);
    y += 5.5;
  });
  y += 3;

  // ── Summary ─────────────────────────────────────────────────────────────────
  const s = summary || {};
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: "grid",
    body: [
      ["Uptime", s.uptime_pct != null ? `${fmt(s.uptime_pct, 2)}%` : "N/A", "Samples", String(s.samples ?? 0)],
      ["Average latency", s.avg_latency != null ? `${fmt(s.avg_latency)} ms` : "N/A", "Packet loss", s.packet_loss_pct != null ? `${fmt(s.packet_loss_pct, 2)}%` : "N/A"],
      ["Min / Max latency", `${fmt(s.min_latency)} / ${fmt(s.max_latency)} ms`, "Avg jitter", s.avg_jitter != null ? `${fmt(s.avg_jitter)} ms` : "N/A"],
      ["Down samples", String(s.down ?? 0), "Longest outage", fmtDuration(s.longest_outage_ms)],
      ["Outages", String(s.outage_count ?? 0), "Degraded periods", String(s.degraded_count ?? 0)],
      ["Minor blips", String(s.minor_count ?? 0), "", ""],
    ],
    styles: { fontSize: 8.5, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.15, cellPadding: 1.6 },
    columnStyles: {
      0: { fontStyle: "bold", textColor: [100, 116, 139], cellWidth: 38 },
      1: { cellWidth: 52 },
      2: { fontStyle: "bold", textColor: [100, 116, 139], cellWidth: 38 },
    },
  });
  y = doc.lastAutoTable.finalY + 8;

  // ── Latency trend ─────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text("LATENCY TREND", margin, y);
  doc.setFont("helvetica", "normal");
  y += 3;
  drawLatencyTrend(doc, series, margin, y, pageW - 2 * margin, 40, latency_threshold);
  y += 46;

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  let noteLines;
  if (outages_only) {
    noteLines = [
      "Highlight criteria - Outage: host unreachable / 100% packet loss.   Degradation analysis is disabled (outages-only mode).",
    ];
  } else {
    const degradedCriteria =
      `latency > ${latency_threshold} ms or packet loss > 0%` +
      (jitter_threshold > 0 ? ` or jitter > ${jitter_threshold} ms` : "");
    const minorNote = s.minor_count
      ? ` ${s.minor_count} minor blip${s.minor_count === 1 ? "" : "s"} (brief single spikes) are counted in the summary above but omitted from the table.`
      : "";
    noteLines = [
      `Highlight criteria - Outage: host unreachable / 100% packet loss.   Degraded: ${degradedCriteria}.`,
      `The table lists significant events only: outages, degradation lasting >= 2 min, packet loss >= 5%, or latency >= ${fmt(latency_threshold * 1.5, 0)} ms.${minorNote}`,
    ];
  }
  noteLines.forEach((ln) => {
    const wrapped = doc.splitTextToSize(ln, pageW - 2 * margin);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 3.4;
  });
  y += 3;

  // ── Availability events ─────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text("AVAILABILITY EVENTS", margin, y);
  doc.setFont("helvetica", "normal");
  y += 3;

  if (!events.length) {
    doc.setFontSize(9);
    doc.setTextColor(22, 163, 74);
    doc.text("No availability issues recorded during this period.", margin, y + 4);
  } else {
    const types = events.map((e) => e.type);
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Start", "End", "Duration", "Type", "Worst latency", "Max loss", "Samples"]],
      body: events.map((e) => [
        fmtTs(e.start), fmtTs(e.end), fmtDuration(e.duration_ms), e.type,
        e.worst_latency ? `${fmt(e.worst_latency)} ms` : "—",
        e.max_loss != null ? `${fmt(e.max_loss, 0)}%` : "—",
        String(e.samples),
      ]),
      styles: { fontSize: 7.5, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.15, cellPadding: 1.4 },
      headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: "bold" },
      didParseCell: (d) => {
        if (d.section !== "body") return;
        const t = types[d.row.index];
        d.cell.styles.fillColor = t === "Outage" ? [254, 226, 226] : [254, 243, 199];
        if (d.column.index === 3) {
          d.cell.styles.textColor = t === "Outage" ? [185, 28, 28] : [180, 83, 9];
          d.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = doc.lastAutoTable.finalY + 6;
    if (events_truncated) {
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text("Note: event list truncated; narrow the reporting window for full detail. Complete raw log is available via CSV export.", margin, y);
    }
  }

  // ── Detailed log (every sample in the period) ─────────────────────────────────
  if (log.length) {
    doc.addPage();
    y = margin;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("DETAILED LOG", margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      log_truncated
        ? `Showing first ${log.length.toLocaleString()} of ${log_total.toLocaleString()} samples. Use CSV export for the complete log.`
        : `${log.length.toLocaleString()} sample${log.length === 1 ? "" : "s"} in period.`,
      margin + 32, y,
    );
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Timestamp", "Status", "Min", "Avg", "Max", "Jitter", "Loss"]],
      body: log.map((r) => [
        fmtTs(r.ts),
        r.alive ? "Up" : "Down",
        r.min != null ? fmt(r.min) : "—",
        r.avg != null ? fmt(r.avg) : "—",
        r.max != null ? fmt(r.max) : "—",
        r.jitter != null ? fmt(r.jitter) : "—",
        r.loss != null ? `${fmt(r.loss, 0)}%` : "—",
      ]),
      styles: { fontSize: 6.8, textColor: [30, 41, 59], lineColor: [237, 242, 247], lineWidth: 0.1, cellPadding: 0.9 },
      headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: "bold" },
      columnStyles: {
        2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" },
        5: { halign: "right" }, 6: { halign: "right" },
      },
      didParseCell: (d) => {
        if (d.section !== "body") return;
        const r = log[d.row.index];
        if (!r) return;
        if (!r.alive) {
          if (d.column.index === 1) { d.cell.styles.textColor = [185, 28, 28]; d.cell.styles.fontStyle = "bold"; }
          d.cell.styles.fillColor = [254, 235, 235];
        } else if (
          (r.loss || 0) > 0 ||
          (r.avg != null && r.avg > latency_threshold) ||
          (jitter_threshold > 0 && r.jitter != null && r.jitter > jitter_threshold)
        ) {
          d.cell.styles.fillColor = [255, 250, 235];
          if (d.column.index === 6 && (r.loss || 0) > 0) d.cell.styles.textColor = [180, 83, 9];
          if (d.column.index === 3 && r.avg > latency_threshold) d.cell.styles.textColor = [180, 83, 9];
          if (d.column.index === 5 && jitter_threshold > 0 && r.jitter > jitter_threshold) d.cell.styles.textColor = [180, 83, 9];
        }
      },
    });
  }

  // ── Footer on every page ──────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${companyName ? companyName + " · " : ""}n8watch · Generated ${fmtTs(generated_at)} · Page ${i} of ${totalPages}`,
      pageW / 2, pageH - 6, { align: "center" },
    );
  }

  return doc;
}

/** Build and download the ISP availability report PDF (browser). */
export function generateISPReport(data, opts = {}) {
  const doc = buildISPReportDoc(data, opts);
  const name = (data?.target?.name || "target").replace(/\s+/g, "_");
  doc.save(`${name}_availability_report_${Date.now()}.pdf`);
}
