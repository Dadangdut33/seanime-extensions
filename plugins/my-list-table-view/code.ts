/// <reference path="core.d.ts" />
/// <reference path="app.d.ts" />
/// <reference path="plugin.d.ts" />
/// <reference path="system.d.ts" />

type TableStatus = 'CURRENT' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'PLANNING';

interface TableRow {
  entryId: number;
  mediaId: number;
  title: string;
  coverImage: string;
  progress: number;
  latestEpisode: number | null;
  totalEpisodes: number | null;
  score: number | null;
  status: TableStatus;
  format: string;
  siteUrl: string;
}

type ColumnKey =
  | 'cover'
  | 'title'
  | 'watched'
  | 'total'
  | 'score'
  | 'status'
  | 'progress'
  | 'format';

type ColumnVisibility = Record<ColumnKey, boolean>;

// @ts-ignore
function init() {
  $ui.register((ctx) => {
    const COLUMN_VISIBILITY_STORAGE_KEY =
      'my-list-table-view:column-visibility';
    const COVER_SIZE_STORAGE_KEY = 'my-list-table-view:cover-size';
    const COVER_SIZE_MIN = 28;
    const COVER_SIZE_MAX = 92;
    const DEFAULT_COVER_SIZE = 42;
    const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
      cover: true,
      title: true,
      watched: true,
      total: true,
      score: true,
      status: true,
      progress: true,
      format: true,
    };

    const legacyShowFormat = $storage.get<boolean>(
      'my-list-table-view:show-format-column',
    );
    const storedColumnVisibility =
      $storage.get<Partial<ColumnVisibility>>(COLUMN_VISIBILITY_STORAGE_KEY) ||
      {};
    const mergedColumnVisibility: ColumnVisibility = {
      ...DEFAULT_COLUMN_VISIBILITY,
      ...storedColumnVisibility,
    };
    if (
      typeof legacyShowFormat === 'boolean' &&
      !('format' in storedColumnVisibility)
    ) {
      mergedColumnVisibility.format = legacyShowFormat;
    }
    const storedCoverSize = Number(
      $storage.get<number>(COVER_SIZE_STORAGE_KEY) ?? DEFAULT_COVER_SIZE,
    );
    const initialCoverSize = Math.max(
      COVER_SIZE_MIN,
      Math.min(
        COVER_SIZE_MAX,
        Number.isFinite(storedCoverSize) ? storedCoverSize : DEFAULT_COVER_SIZE,
      ),
    );
    const rowsState = ctx.state<TableRow[]>([]);
    const loadingState = ctx.state<boolean>(true);
    const errorState = ctx.state<string>('');
    const debugLogsState = ctx.state<string[]>([]);
    const columnVisibilityState = ctx.state<ColumnVisibility>(
      mergedColumnVisibility,
    );
    const coverSizeState = ctx.state<number>(initialCoverSize);

    const pushDebugLog = (message: string) => {
      const now = new Date();
      const timestamp =
        now.toISOString().slice(11, 19) +
        '.' +
        String(now.getMilliseconds()).padStart(3, '0');
      const logLine = '[' + timestamp + '] ' + message;
      console.log('[my-list-table-view]', logLine);
      debugLogsState.set((prev) => {
        const next = [...prev, logLine];
        if (next.length > 120) return next.slice(next.length - 120);
        return next;
      });
    };

    const panel = ctx.newWebview({
      slot: 'screen',
      fullWidth: true,
      height: '98vh',
      sidebar: {
        label: 'My List Table',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line><line x1="9" y1="10" x2="9" y2="20"></line></svg>`,
      },
    });

    function normalizeStatus(
      status?: $app.AL_MediaListStatus,
    ): TableStatus | undefined {
      switch (status) {
        case 'CURRENT':
        case 'REPEATING':
          return 'CURRENT';

        default:
          return status as TableStatus | undefined;
      }
    }

    function toTitle(media?: $app.AL_BaseAnime): string {
      const title = media?.title;
      return (
        title?.userPreferred ||
        title?.romaji ||
        title?.english ||
        title?.native ||
        `Anime #${media?.id ?? '?'}`
      );
    }

    function toRow(
      entry: $app.AL_AnimeCollection_MediaListCollection_Lists_Entries,
      fallbackStatus?: $app.AL_MediaListStatus,
    ): TableRow | undefined {
      const media = entry.media!;
      if (!media) return undefined;

      const status = normalizeStatus(entry.status || fallbackStatus)!;
      if (!status) return undefined;

      const totalEpisodes = parseInt(String(media.episodes)) || null;
      const nextAiringEpisode = media.nextAiringEpisode?.episode;
      let latestEpisode: number | null = null;
      if (
        typeof nextAiringEpisode === 'number' &&
        Number.isFinite(nextAiringEpisode)
      ) {
        latestEpisode = Math.max(0, nextAiringEpisode - 1);
      } else if (typeof totalEpisodes === 'number') {
        latestEpisode = totalEpisodes;
      }
      if (
        typeof latestEpisode === 'number' &&
        typeof totalEpisodes === 'number'
      ) {
        latestEpisode = Math.min(latestEpisode, totalEpisodes);
      }

      return {
        entryId: entry.id,
        mediaId: media.id,
        title: toTitle(media),
        coverImage:
          media.coverImage?.large ||
          media.coverImage?.medium ||
          media.coverImage?.extraLarge ||
          '',
        progress: entry.progress || 0,
        latestEpisode,
        totalEpisodes,
        score: parseInt(String(entry.score)) || null,
        status,
        format: media.format || '-',
        siteUrl: media.siteUrl || `https://anilist.co/anime/${media.id}`,
      };
    }

    function loadRows(): TableRow[] {
      const collection = $anilist.getAnimeCollection(false);
      const lists = collection.MediaListCollection?.lists || [];
      const rows: TableRow[] = [];

      for (const list of lists) {
        const entries = list.entries || [];
        for (const entry of entries) {
          const row = toRow(entry, list.status);
          if (!row) continue;
          rows.push(row);
        }
      }

      rows.sort((a, b) => a.title.localeCompare(b.title));
      return rows;
    }

    const refreshRows = () => {
      pushDebugLog('refreshRows:start');
      loadingState.set(true);
      errorState.set('');

      try {
        const rows = loadRows();
        rowsState.set(rows);
        const statusCounts = rows.reduce(
          (acc, row) => {
            acc[row.status] += 1;
            return acc;
          },
          {
            CURRENT: 0,
            COMPLETED: 0,
            PAUSED: 0,
            DROPPED: 0,
            PLANNING: 0,
          } as Record<TableStatus, number>,
        );
        pushDebugLog(
          'refreshRows:success rows=' +
            rows.length +
            ' current=' +
            statusCounts.CURRENT +
            ' completed=' +
            statusCounts.COMPLETED +
            ' paused=' +
            statusCounts.PAUSED +
            ' dropped=' +
            statusCounts.DROPPED +
            ' planning=' +
            statusCounts.PLANNING,
        );
      } catch (error) {
        rowsState.set([]);
        const message =
          error instanceof Error ? error.message : 'Failed to fetch anime list';
        errorState.set(message);
        pushDebugLog('refreshRows:error ' + message);
        ctx.toast.error('Failed to load anime list');
      } finally {
        loadingState.set(false);
        pushDebugLog('refreshRows:end loading=false');
      }
    };

    panel.channel.sync('rows', rowsState);
    panel.channel.sync('loading', loadingState);
    panel.channel.sync('error', errorState);
    panel.channel.sync('debug-logs', debugLogsState);
    panel.channel.sync('column-visibility', columnVisibilityState);
    panel.channel.sync('cover-size', coverSizeState);

    panel.channel.on('refresh', (payload: any) => {
      pushDebugLog('channel:refresh payload=' + JSON.stringify(payload || {}));
      refreshRows();
    });

    panel.channel.on('open-anime', (payload: { mediaId?: number }) => {
      if (!payload || typeof payload.mediaId !== 'number') return;
      pushDebugLog('channel:open-anime mediaId=' + payload.mediaId);
      ctx.screen.navigateTo('/entry', { 'id': String(payload.mediaId) });
    });

    panel.channel.on(
      'set-column-visibility',
      (payload: { column?: ColumnKey; visible?: boolean }) => {
        if (
          !payload ||
          !payload.column ||
          !(payload.column in DEFAULT_COLUMN_VISIBILITY)
        )
          return;
        const column = payload.column;
        const visible = Boolean(payload.visible);
        columnVisibilityState.set((prev) => {
          const next = { ...prev, [column]: visible };
          $storage.set(COLUMN_VISIBILITY_STORAGE_KEY, next);
          return next;
        });
        pushDebugLog(
          'channel:set-column-visibility column=' +
            String(column) +
            ' visible=' +
            String(visible),
        );
      },
    );

    panel.channel.on('set-cover-size', (payload: { size?: number }) => {
      const size = Number(payload && payload.size);
      if (!Number.isFinite(size)) return;
      const nextSize = Math.max(
        COVER_SIZE_MIN,
        Math.min(COVER_SIZE_MAX, Math.round(size)),
      );
      coverSizeState.set(nextSize);
      $storage.set(COVER_SIZE_STORAGE_KEY, nextSize);
      pushDebugLog('channel:set-cover-size size=' + String(nextSize));
    });

    panel.setContent(
      () => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My List Table</title>
    <style>
        :root {
            color-scheme: dark;
            --bg: #0b1220;
            --panel: #111a2d;
            --panel-2: #0f172a;
            --line: rgba(255, 255, 255, 0.1);
            --line-soft: rgba(255, 255, 255, 0.06);
            --text: #e5e7eb;
            --muted: #94a3b8;
            --accent: #22c55e;
            --accent-soft: rgba(34, 197, 94, 0.2);
        }

        * { box-sizing: border-box; }

        html, body, #app {
            margin: 0;
            padding: 0;
            height: 100%;
            overflow: hidden;
        }

        body {
            color: var(--text);
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            overflow: hidden;
        }

        .layout {
            background: radial-gradient(circle at top right, #1e293b 0%, var(--bg) 45%, #05070f 100%);
            margin-right: 0 auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            height: 100%;
            overflow: hidden;
        }

        .toolbar {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            position: relative;
            z-index: 20;
            background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
            border: 1px solid var(--line);
            border-radius: 12px;
            padding: 12px;
            backdrop-filter: blur(6px);
        }

        .tabs { display: flex; gap: 8px; flex-wrap: wrap; }

        .tab {
            border: 1px solid var(--line);
            background: var(--panel-2);
            color: var(--text);
            border-radius: 999px;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 13px;
        }

        .tab.active { border-color: var(--accent); background: var(--accent-soft); }

        .toolbar-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

        .btn {
            border: 1px solid var(--line);
            background: var(--panel-2);
            color: var(--text);
            border-radius: 8px;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 13px;
        }

        .column-menu {
            position: relative;
            z-index: 30;
        }

        .column-menu > summary {
            list-style: none;
            border: 1px solid var(--line);
            background: var(--panel-2);
            color: var(--text);
            border-radius: 8px;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 13px;
            user-select: none;
        }

        .column-menu > summary::-webkit-details-marker { display: none; }

        .column-menu-content {
            position: absolute;
            right: 0;
            top: calc(100% + 6px);
            z-index: 999;
            width: 260px;
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid var(--line);
            border-radius: 10px;
            background: rgba(15, 23, 42, 0.97);
            padding: 10px;
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
        }

        .column-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
            font-size: 12px;
        }

        .column-item:last-child { margin-bottom: 0; }

        .cover-size-control {
            display: flex;
            align-items: center;
            gap: 8px;
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 6px 8px;
            background: var(--panel-2);
        }

        .cover-size-control input[type="range"] {
            width: 120px;
        }

        .cover-size-label {
            min-width: 44px;
            text-align: right;
            font-size: 12px;
            color: var(--muted);
        }

        .state {
            border: 1px dashed var(--line);
            border-radius: 12px;
            background: rgba(255,255,255,0.02);
            padding: 24px;
            text-align: center;
            color: var(--muted);
        }

        .state.error {
            border-color: rgba(239, 68, 68, 0.45);
            color: #fecaca;
            background: rgba(127, 29, 29, 0.15);
        }

        .table-shell {
            max-height: 80%;
            border: 1px solid var(--line);
            border-radius: 12px;
            overflow: hidden;
            background: rgba(2, 6, 23, 0.65);
        }

        .table-wrap {
            max-height: 100%;
            overflow-x: auto;
            overflow-y: scroll;
            scrollbar-gutter: stable both-edges;
        }

        table {
            width: 100%;
            min-width: 920px;
            border-collapse: collapse;
        }

        thead {
          z-index: 5;
        }

        thead th {
            position: sticky;
            top: 0;
            z-index: 5;
            text-align: left;
            font-size: 12px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: var(--muted);
            padding: 10px 12px;
            background: #0a1120;
            border-bottom: 1px solid var(--line);
        }

        tbody td {
            padding: 10px 12px;
            border-bottom: 1px solid var(--line-soft);
            vertical-align: middle;
            font-size: 13px;
        }

        tbody tr:hover { background: rgba(255, 255, 255, 0.02); }

        .cover {
            width: 42px;
            height: 58px;
            border-radius: 6px;
            object-fit: cover;
            border: 1px solid var(--line);
            background: rgba(255, 255, 255, 0.08);
        }

        .title-btn {
            border: 0;
            background: transparent;
            color: #bfdbfe;
            padding: 0;
            margin: 0;
            display: block;
            width: 100%;
            cursor: pointer;
            text-align: left;
            font-size: 13px;
            line-height: 1.4;
            white-space: normal;
            overflow-wrap: anywhere;
            word-break: break-word;
        }

        .title-btn:hover { text-decoration: underline; }

        .title-cell {
            width: 360px;
            max-width: 360px;
        }

        .muted { color: var(--muted); }

        .badge {
            display: inline-flex;
            align-items: center;
            border: 1px solid var(--line);
            border-radius: 999px;
            padding: 4px 8px;
            font-size: 11px;
            color: var(--text);
            background: rgba(255, 255, 255, 0.03);
        }

        .progress {
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 170px;
        }

        .progress-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
            margin-right: 8px;
        }

        .progress-meta {
            font-size: 11px;
            color: var(--muted);
            white-space: nowrap;
        }

        .progress-track {
            position: relative;
            width: 128px;
            height: 6px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.12);
            overflow: hidden;
        }

        .progress-released {
            position: absolute;
            inset: 0 auto 0 0;
            height: 100%;
            background: linear-gradient(90deg, #0ea5e9, #38bdf8);
            opacity: 0.85;
        }

        .progress-fill {
            position: absolute;
            inset: 0 auto 0 0;
            height: 100%;
            background: linear-gradient(90deg, #16a34a, #84cc16);
            z-index: 2;
        }

        .debug-panel {
            border: 1px solid var(--line);
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.02);
            padding: 10px;
        }

        .debug-panel summary {
            cursor: pointer;
            color: var(--muted);
            font-size: 12px;
            user-select: none;
        }

        .debug-logs {
            margin: 8px 0 0 0;
            max-height: 150px;
            overflow-x: hidden;
            overflow-y: scroll;
            scrollbar-gutter: stable;
            padding: 8px;
            border-radius: 8px;
            border: 1px solid var(--line-soft);
            background: rgba(15, 23, 42, 0.7);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            font-size: 11px;
            line-height: 1.4;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .table-wrap::-webkit-scrollbar,
        .debug-logs::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }

        .table-wrap::-webkit-scrollbar-track,
        .debug-logs::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.08);
        }

        .table-wrap::-webkit-scrollbar-thumb,
        .debug-logs::-webkit-scrollbar-thumb {
            background: rgba(148, 163, 184, 0.6);
            border-radius: 999px;
            border: 2px solid transparent;
            background-clip: content-box;
        }

        .table-wrap::-webkit-scrollbar-thumb:hover,
        .debug-logs::-webkit-scrollbar-thumb:hover {
            background: rgba(203, 213, 225, 0.9);
            background-clip: content-box;
        }

        @media (max-width: 900px) {
            .layout { padding: 10px; }
            .toolbar { padding: 10px; }
        }
    </style>
</head>
<body>
    <div id="app"></div>

    <script type="module">
        import { h, render } from "https://esm.sh/preact@10.19.3"
        import { useEffect, useMemo, useState } from "https://esm.sh/preact@10.19.3/hooks"

        const ENABLE_DEBUG_LOGS = true
        const STATUS_LABELS = {
            CURRENT: "Currently Watching",
            COMPLETED: "Completed",
            PAUSED: "On Hold",
            DROPPED: "Dropped",
            PLANNING: "Plan to Watch"
        }
        const STATUS_ORDER = ["CURRENT", "COMPLETED", "PAUSED", "DROPPED", "PLANNING"]
        const COLUMN_META = [
            { key: "cover", label: "Cover Image" },
            { key: "title", label: "Title" },
            { key: "watched", label: "Episodes Watched" },
            { key: "total", label: "Total Episodes" },
            { key: "score", label: "Score" },
            { key: "status", label: "Status" },
            { key: "progress", label: "Progress" },
            { key: "format", label: "Type / Format" }
        ]
        const DEFAULT_COLUMN_VISIBILITY = {
            cover: true,
            title: true,
            watched: true,
            total: true,
            score: true,
            status: true,
            progress: true,
            format: true
        }
        const COVER_SIZE_MIN = 28
        const COVER_SIZE_MAX = 92
        const DEFAULT_COVER_SIZE = 42

        function clamp(value, min, max) {
            return Math.max(min, Math.min(max, value))
        }

        function formatScore(value) {
            if (typeof value !== "number") return "-"
            return value % 1 === 0 ? String(value) : value.toFixed(1)
        }

        function progressPercent(row) {
            if (typeof row.totalEpisodes === "number" && row.totalEpisodes > 0) {
                return Math.max(0, Math.min(100, Math.round((row.progress / row.totalEpisodes) * 100)))
            }
            return 0
        }

        function getProgressContext(row) {
            const watched = Number(row.progress) || 0
            const total = typeof row.totalEpisodes === "number" && row.totalEpisodes > 0 ? row.totalEpisodes : null
            const latestRaw = typeof row.latestEpisode === "number" && row.latestEpisode >= 0 ? row.latestEpisode : null
            const latest = latestRaw === null ? total : (total === null ? latestRaw : Math.min(latestRaw, total))

            const denominator = total || (latest && latest > 0 ? latest : Math.max(watched, 1))
            const watchedClamped = Math.min(Math.max(0, watched), denominator)
            const releasedClamped = latest === null ? watchedClamped : Math.min(Math.max(0, latest), denominator)

            const watchedPercent = Math.max(0, Math.min(100, Math.round((watchedClamped / denominator) * 100)))
            const releasedPercent = Math.max(0, Math.min(100, Math.round((releasedClamped / denominator) * 100)))
            const summary = "Watched " + watched + (latest !== null ? " • Latest " + latest : "") + (total !== null ? " • Total " + total : "")

            return {
                totalIsNull: total === null,
                watchedPercent: watchedPercent,
                releasedPercent: releasedPercent,
                summary: summary
            }
        }

        function App() {
            const [loading, setLoading] = useState(true)
            const [error, setError] = useState("")
            const [rows, setRows] = useState([])
            const [activeTab, setActiveTab] = useState("CURRENT")
            const [columnVisibility, setColumnVisibility] = useState(DEFAULT_COLUMN_VISIBILITY)
            const [coverSize, setCoverSize] = useState(DEFAULT_COVER_SIZE)
            const [debugLogs, setDebugLogs] = useState([])

            const logClient = (message) => {
                if (!ENABLE_DEBUG_LOGS) return
                const now = new Date()
                let ms = String(now.getMilliseconds())
                if (ms.length < 3) ms = ("00" + ms).slice(-3)
                const line = "[" + now.toISOString().slice(11, 19) + "." + ms + "] ui: " + message
                setDebugLogs((prev) => prev.concat([line]).slice(-120))
                if (typeof console !== "undefined" && typeof console.log === "function") {
                    console.log("[my-list-table-view]", line)
                }
            }

            useEffect(() => {
                if (!window.webview) {
                    logClient("window.webview bridge not available")
                    return
                }
                logClient("webview bridge detected")

                const unsubs = []
                const on = (eventName, handler) => {
                    const unsub = window.webview.on(eventName, handler)
                    if (typeof unsub === "function") unsubs.push(unsub)
                }

                on("rows", (newRows) => {
                    setRows(Array.isArray(newRows) ? newRows : [])
                })
                on("loading", (value) => {
                    setLoading(Boolean(value))
                })
                on("error", (value) => {
                    setError(value ? String(value) : "")
                })
                on("column-visibility", (value) => {
                    if (value && typeof value === "object") {
                        setColumnVisibility({ ...DEFAULT_COLUMN_VISIBILITY, ...value })
                    }
                })
                on("cover-size", (value) => {
                    const next = Number(value)
                    if (Number.isFinite(next)) setCoverSize(clamp(Math.round(next), COVER_SIZE_MIN, COVER_SIZE_MAX))
                })
                on("debug-logs", (logs) => {
                    setDebugLogs(Array.isArray(logs) ? logs : [])
                })

                return () => {
                    unsubs.forEach((fn) => {
                        try { fn() } catch (_) {}
                    })
                }
            }, [])

            const statusCounts = useMemo(() => {
                const counts = { CURRENT: 0, COMPLETED: 0, PAUSED: 0, DROPPED: 0, PLANNING: 0 }
                rows.forEach((row) => {
                    if (counts[row.status] !== undefined) counts[row.status] += 1
                })
                return counts
            }, [rows])

            const visibleRows = useMemo(() => {
                return rows.filter((row) => row.status === activeTab)
            }, [rows, activeTab])

            const send = (eventName, payload) => {
                if (window.webview && typeof window.webview.send === "function") {
                    window.webview.send(eventName, payload)
                }
            }

            const onRefresh = () => {
                setLoading(true)
                logClient("refresh-button clicked")
                send("refresh", { requestedAt: Date.now() })
            }

            const onToggleColumn = (columnKey, visible) => {
                const next = { ...columnVisibility, [columnKey]: visible }
                setColumnVisibility(next)
                send("set-column-visibility", { column: columnKey, visible: visible })
            }

            const onCoverSizeInput = (event) => {
                const nextSize = clamp(Math.round(Number(event.currentTarget.value || DEFAULT_COVER_SIZE)), COVER_SIZE_MIN, COVER_SIZE_MAX)
                setCoverSize(nextSize)
                send("set-cover-size", { size: nextSize })
            }

            const headerCells = []
            if (columnVisibility.cover) headerCells.push(h("th", { key: "h-cover" }, "Cover"))
            if (columnVisibility.title) headerCells.push(h("th", { key: "h-title" }, "Title"))
            if (columnVisibility.watched) headerCells.push(h("th", { key: "h-watched" }, "Watched"))
            if (columnVisibility.total) headerCells.push(h("th", { key: "h-total" }, "Total"))
            if (columnVisibility.score) headerCells.push(h("th", { key: "h-score" }, "Score"))
            if (columnVisibility.status) headerCells.push(h("th", { key: "h-status" }, "Status"))
            if (columnVisibility.progress) headerCells.push(h("th", { key: "h-progress" }, "Progress"))
            if (columnVisibility.format) headerCells.push(h("th", { key: "h-format" }, "Type / Format"))
                const tableBodyRows = visibleRows.map((row) => {
                const progressContext = getProgressContext(row)
                const totalText = typeof row.totalEpisodes === "number" ? String(row.totalEpisodes) : "-"
                const coverHeight = Math.round(coverSize * 1.38)
                const cells = []

                if (columnVisibility.cover) {
                    cells.push(
                        h("td", { key: "cover" },
                            h("img", {
                                class: "cover",
                                src: row.coverImage || "",
                                alt: row.title || "",
                                loading: "lazy",
                                style: { width: coverSize + "px", height: coverHeight + "px" }
                            })
                        )
                    )
                }
                if (columnVisibility.title) {
                    cells.push(
                        h("td", { key: "title", class: "title-cell" },
                            h("button", {
                                class: "title-btn",
                                onClick: () => send("open-anime", { mediaId: row.mediaId })
                            }, row.title)
                        )
                    )
                }
                if (columnVisibility.watched) cells.push(h("td", { key: "watched" }, String(row.progress)))
                if (columnVisibility.total) cells.push(h("td", { key: "total" }, totalText))
                if (columnVisibility.score) cells.push(h("td", { key: "score" }, formatScore(row.score)))
                if (columnVisibility.status) {
                    cells.push(h("td", { key: "status" }, h("span", { class: "badge" }, STATUS_LABELS[row.status] || row.status)))
                }
                if (columnVisibility.progress) {
                    cells.push(
                        h("td", { key: "progress" },
                            h("div", { class: "progress" }, [
                                h("div", { class: "progress-top" }, [
                                    h("div", { class: "progress-track" }, [
                                        h("div", { class: "progress-released", style: { width: progressContext.releasedPercent + "%" } }),
                                        h("div", { class: "progress-fill", style: { width: progressContext.watchedPercent + "%" } })
                                    ]),
                                    h("span", { class: "muted" },   progressContext.totalIsNull ? "-" : progressContext.watchedPercent + "%")
                                ]),
                                h("span", { class: "progress-meta" }, progressContext.summary)
                            ])
                        )
                    )
                }
                if (columnVisibility.format) cells.push(h("td", { key: "format" }, row.format || "-"))

                return h("tr", { key: row.entryId }, cells)
            })

            const tabs = STATUS_ORDER.map((status) =>
                h("button", {
                    key: status,
                    class: "tab " + (activeTab === status ? "active" : ""),
                    onClick: () => setActiveTab(status)
                }, (STATUS_LABELS[status] || status) + " (" + String(statusCounts[status] || 0) + ")")
            )

            const columnOptions = COLUMN_META.map((item) =>
                h("label", { class: "column-item", key: item.key }, [
                    h("input", {
                        type: "checkbox",
                        checked: Boolean(columnVisibility[item.key]),
                        onChange: (event) => onToggleColumn(item.key, Boolean(event.currentTarget.checked))
                    }),
                    h("span", null, item.label)
                ])
            )

            let content = null
            if (loading) {
                content = h("div", { class: "state" }, "Loading your anime list...")
            } else if (error) {
                content = h("div", { class: "state error" }, error)
            } else if (visibleRows.length === 0) {
                content = h("div", { class: "state" }, [
                    "No entries in ",
                    h("strong", null, STATUS_LABELS[activeTab] || activeTab),
                    "."
                ])
            } else {
                content = h("div", { class: "table-shell" },
                    h("div", { class: "table-wrap" },
                        h("table", null, [
                            h("thead", null, h("tr", null, headerCells)),
                            h("tbody", null, tableBodyRows)
                        ])
                    )
                )
            }

            return h("div", { class: "layout" }, [
                h("div", { class: "toolbar" }, [
                    h("div", { class: "tabs" }, tabs),
                    h("div", { class: "toolbar-actions" }, [
                        h("div", { class: "cover-size-control" }, [
                            h("span", { class: "muted" }, "Cover"),
                            h("input", {
                                type: "range",
                                min: String(COVER_SIZE_MIN),
                                max: String(COVER_SIZE_MAX),
                                step: "1",
                                value: String(coverSize),
                                onInput: onCoverSizeInput
                            }),
                            h("span", { class: "cover-size-label" }, coverSize + "px")
                        ]),
                        h("details", { class: "column-menu" }, [
                            h("summary", null, "Columns"),
                            h("div", { class: "column-menu-content" }, columnOptions)
                        ]),
                        h("button", { class: "btn", onClick: onRefresh }, "Refresh")
                    ])
                ]),
                content,
                h("details", { class: "debug-panel" }, [
                    h("summary", null, "Debug logs (" + String(debugLogs.length) + ") | loading=" + String(loading) + " | rows=" + String(rows.length) + " | activeTab=" + activeTab),
                    h("div", { class: "debug-logs" }, debugLogs.length ? debugLogs.join("\\n") : "No debug logs yet.")
                ])
            ])
        }

        render(h(App, null), document.getElementById("app"))
    </script>
</body>
</html>
`,
    );

    pushDebugLog('plugin:init calling initial refresh');
    refreshRows();
  });
}

init();
