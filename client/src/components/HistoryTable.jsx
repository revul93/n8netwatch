import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { ArrowUpDown, Download, FileText } from 'lucide-react';
import { cn, formatMs, formatPercent } from '../lib/utils';
import { getExportUrl, getLogReportData, getBrandingLogo, getReportConfig } from '../lib/api';
import { generateISPReport } from '../lib/reportGenerator';

const PAGE_SIZE = 50;

function SortButton({ label, field, sort, onSort }) {
  const active = sort.field === field;
  return (
    <button
      onClick={() => onSort(field)}
      className={cn('flex items-center gap-1 text-xs font-medium uppercase tracking-wider', active ? 'text-blue-400' : 'text-gray-500')}
    >
      {label}
      <ArrowUpDown size={12} className={active ? 'text-blue-400' : 'text-gray-600'} />
    </button>
  );
}

export default function HistoryTable({ rows = [], targets = [], filters = {} }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ field: 'created_at', dir: 'desc' });

  function handleSort(field) {
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
    setPage(1);
  }

  const targetMap = useMemo(() => {
    const m = {};
    targets.forEach(t => { m[t.id] = t; });
    return m;
  }, [targets]);

  const filtered = useMemo(() => {
    let data = [...rows];
    const s = filters.search?.toLowerCase();
    if (s) {
      data = data.filter(r => {
        const t = targetMap[r.target_id];
        return (t?.name || '').toLowerCase().includes(s) || (t?.host || '').toLowerCase().includes(s);
      });
    }
    if (filters.targetId) {
      data = data.filter(r => String(r.target_id) === String(filters.targetId));
    }
    // sort
    data.sort((a, b) => {
      let va = a[sort.field], vb = b[sort.field];
      if (sort.field === 'created_at') {
        va = typeof va === 'number' ? va : new Date(va).getTime();
        vb = typeof vb === 'number' ? vb : new Date(vb).getTime();
      }
      if (va == null) return 1;
      if (vb == null) return -1;
      return sort.dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
    return data;
  }, [rows, filters, sort, targetMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function formatTs(ts) {
    try { return format(new Date(ts), 'MMM d, HH:mm:ss'); } catch { return ts || '—'; }
  }

  const exportUrl = filters.targetId
    ? getExportUrl(filters.targetId, filters.from || undefined, filters.to || undefined)
    : null;

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  async function handleExportPdf() {
    if (!filters.targetId) return;
    setPdfLoading(true);
    setPdfError('');
    try {
      const [cfg, logoDataUrl] = await Promise.all([
        getReportConfig().catch(() => null),
        getBrandingLogo().catch(() => null),
      ]);
      const rc = cfg || {};
      const data = await getLogReportData(
        filters.targetId,
        filters.from || undefined,
        filters.to || undefined,
        {
          latencyThreshold: rc.latency_threshold,
          jitterThreshold: rc.jitter_threshold,
          outagesOnly: rc.outages_only,
          includeLog: rc.detailed_log !== false,
        },
      );
      generateISPReport(data, { logoDataUrl });
    } catch (e) {
      setPdfError(e.message || 'Failed to generate report');
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-gray-200">
          Results <span className="text-gray-500 font-normal">({filtered.length})</span>
        </h3>
        {filters.targetId && (
          <div className="flex items-center gap-2">
            {pdfError && <span className="text-xs text-red-400">{pdfError}</span>}
            <button
              onClick={handleExportPdf}
              disabled={pdfLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-60 rounded-lg text-xs text-white transition-colors"
              title="Download a branded PDF availability report for this target and time range"
            >
              <FileText size={13} />
              {pdfLoading ? 'Generating…' : 'Export PDF'}
            </button>
            {exportUrl && (
              <a
                href={exportUrl}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-white transition-colors"
              >
                <Download size={13} />
                Export CSV
              </a>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-2">
                <SortButton label="Timestamp" field="created_at" sort={sort} onSort={handleSort} />
              </th>
              <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500">Host</th>
              <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500">IP</th>
              <th className="text-left px-4 py-2">
                <SortButton label="Status" field="is_alive" sort={sort} onSort={handleSort} />
              </th>
              <th className="text-right px-4 py-2">
                <SortButton label="Min" field="min_latency" sort={sort} onSort={handleSort} />
              </th>
              <th className="text-right px-4 py-2">
                <SortButton label="Avg" field="avg_latency" sort={sort} onSort={handleSort} />
              </th>
              <th className="text-right px-4 py-2">
                <SortButton label="Max" field="max_latency" sort={sort} onSort={handleSort} />
              </th>
              <th className="text-right px-4 py-2">
                <SortButton label="Jitter" field="jitter" sort={sort} onSort={handleSort} />
              </th>
              <th className="text-right px-4 py-2">
                <SortButton label="Loss" field="packet_loss" sort={sort} onSort={handleSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-10 text-gray-500">No records found.</td>
              </tr>
            )}
            {pageRows.map((row, i) => {
              const target = targetMap[row.target_id];
              return (
                <tr key={row.id ?? i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">{formatTs(row.created_at)}</td>
                  <td className="px-4 py-2 text-sm text-white whitespace-nowrap">{target?.name || row.target_id}</td>
                  <td className="px-4 py-2 text-xs text-gray-400 font-mono whitespace-nowrap">{target?.ip || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-xs font-medium',
                      row.is_alive ? 'text-green-400' : 'text-red-400'
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', row.is_alive ? 'bg-green-400' : 'bg-red-400')} />
                      {row.is_alive ? 'Up' : 'Down'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-gray-400">{formatMs(row.min_latency)}</td>
                  <td className="px-4 py-2 text-right text-xs text-white font-medium">{formatMs(row.avg_latency)}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-400">{formatMs(row.max_latency)}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-400">{formatMs(row.jitter)}</td>
                  <td className={cn('px-4 py-2 text-right text-xs font-medium', row.packet_loss > 0 ? 'text-yellow-400' : 'text-gray-400')}>
                    {formatPercent(row.packet_loss)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
          <span className="text-xs text-gray-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
