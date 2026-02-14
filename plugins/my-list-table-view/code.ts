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
  releasedUnwatched: number | null;
  downloadedUnwatched: number | null;
  neededToDownload: number | null;
  episodeStatuses: Array<{
    episode: number;
    state: 'watched' | 'downloaded' | 'missing';
  }> | null;
  hiddenEpisodeStatusCount: number;
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
  | 'unwatched'
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
      unwatched: true,
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
    const isEpDataLoadingState = ctx.state<boolean>(false);
    const errorState = ctx.state<string>('');
    const debugLogsState = ctx.state<string[]>([]);
    const columnVisibilityState = ctx.state<ColumnVisibility>(
      mergedColumnVisibility,
    );
    const coverSizeState = ctx.state<number>(initialCoverSize);
    let refreshRunId = 0;

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
      if (!status) return undefined;

      // we specifically need to do this!!!
      // i dont know why but the data that we get is very unreliable
      // I tried comparing some to like the === "CURRENT" or stuff and it dont match
      // Also have try seeing the raw data from console log and
      // does not see any weird whitepsace or anything
      const s = status.trim().toUpperCase();

      switch (s) {
        case 'CURRENT':
        case 'REPEATING':
          return 'CURRENT';

        case 'COMPLETED':
        case 'PAUSED':
        case 'DROPPED':
        case 'PLANNING':
          return s as TableStatus;

        default:
          // if it dont match whatever man, just move to current
          return 'CURRENT';
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

    function normalizeScoreToTen(score?: number): number | null {
      if (!score) return null;
      const num = Number(score);
      // Some list APIs return score on 100-point scale; normalize to 10-point scale.
      const normalized = num > 10 ? num / 10 : num;
      return Math.round(normalized * 10) / 10;
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
      const releasedUnwatched =
        typeof latestEpisode === 'number'
          ? Math.max(0, latestEpisode - (entry.progress || 0))
          : null;

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
        releasedUnwatched,
        downloadedUnwatched: null,
        neededToDownload: null,
        episodeStatuses: null,
        hiddenEpisodeStatusCount: 0,
        score: normalizeScoreToTen(entry.score),
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

    async function enrichRowsWithDownloadInfo(
      rows: TableRow[],
    ): Promise<TableRow[]> {
      const enrichedRows = await Promise.all(
        rows.map(async (row) => {
          if (row.status !== 'CURRENT') {
            return row;
          }
          if (typeof row.releasedUnwatched !== 'number') {
            return row;
          }

          try {
            const entry = await ctx.anime.getAnimeEntry(row.mediaId);

            const downloadedEpisodeNumbers = new Set<number>();
            for (const episode of entry.episodes || []) {
              if (!episode || !episode.isDownloaded) continue;
              const epNum = Number(
                episode.progressNumber || episode.episodeNumber,
              );
              if (Number.isFinite(epNum) && epNum > 0) {
                downloadedEpisodeNumbers.add(epNum);
              }
            }

            const watchedUntil = Math.max(0, Number(row.progress) || 0);
            const latestKnown =
              typeof row.latestEpisode === 'number' ? row.latestEpisode : null;
            const highestDownloaded = downloadedEpisodeNumbers.size
              ? Math.max(...Array.from(downloadedEpisodeNumbers))
              : 0;
            const maxEpisode = Math.max(
              watchedUntil,
              latestKnown || 0,
              highestDownloaded,
            );
            // count it ourselves because the result might be unreliable
            // in edge cases where the user uses symlink and the will be dupe
            const downloadedUnwatched =
              latestKnown !== null
                ? Array.from(downloadedEpisodeNumbers).filter(
                    (ep) => ep > watchedUntil && ep <= latestKnown,
                  ).length
                : 0;
            const neededToDownload = Math.max(
              0,
              parseInt(String(row.releasedUnwatched)) - downloadedUnwatched,
            );
            const MAX_RENDERED_PILLS = 80;
            const startEpisode =
              maxEpisode > MAX_RENDERED_PILLS
                ? maxEpisode - MAX_RENDERED_PILLS + 1
                : 1;
            const hiddenEpisodeStatusCount =
              maxEpisode > MAX_RENDERED_PILLS
                ? maxEpisode - MAX_RENDERED_PILLS
                : 0;
            const episodeStatuses: Array<{
              episode: number;
              state: 'watched' | 'downloaded' | 'missing';
            }> = [];

            for (
              let episodeNumber = startEpisode;
              episodeNumber <= maxEpisode;
              episodeNumber++
            ) {
              if (episodeNumber <= watchedUntil) {
                episodeStatuses.push({
                  episode: episodeNumber,
                  state: 'watched',
                });
                continue;
              }
              if (downloadedEpisodeNumbers.has(episodeNumber)) {
                episodeStatuses.push({
                  episode: episodeNumber,
                  state: 'downloaded',
                });
                continue;
              }
              if (latestKnown !== null && episodeNumber <= latestKnown) {
                episodeStatuses.push({
                  episode: episodeNumber,
                  state: 'missing',
                });
              }
            }

            return {
              ...row,
              downloadedUnwatched,
              neededToDownload,
              episodeStatuses,
              hiddenEpisodeStatusCount,
            };
          } catch (error) {
            pushDebugLog(
              'download-info:error mediaId=' +
                row.mediaId +
                ' message=' +
                (error instanceof Error ? error.message : String(error)),
            );
            return row;
          }
        }),
      );

      return enrichedRows;
    }

    const refreshRows = async () => {
      const runId = ++refreshRunId;
      pushDebugLog('refreshRows:start');
      loadingState.set(true);
      isEpDataLoadingState.set(false);
      errorState.set('');

      try {
        const loadedRows = loadRows();
        if (runId !== refreshRunId) return;
        rowsState.set(loadedRows);
        pushDebugLog('refreshRows:base-loaded rows=' + loadedRows.length);
        const statusCounts = loadedRows.reduce(
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
            loadedRows.length +
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
        if (runId !== refreshRunId) return;
        rowsState.set([]);
        const message =
          error instanceof Error ? error.message : 'Failed to fetch anime list';
        errorState.set(message);
        pushDebugLog('refreshRows:error ' + message);
        ctx.toast.error('Failed to load anime list');
      } finally {
        if (runId !== refreshRunId) return;
        loadingState.set(false);
        isEpDataLoadingState.set(false);
        pushDebugLog('refreshRows:end loading=false');
      }
    };

    const loadEnrichedEpisodes = async () => {
      const runId = ++refreshRunId;
      pushDebugLog('loadEnrichedEpisodes:start');
      isEpDataLoadingState.set(true);
      errorState.set('');
      try {
        const currentRows = rowsState.get();
        const rows = await enrichRowsWithDownloadInfo(currentRows);
        if (runId !== refreshRunId) return;
        rowsState.set(rows);
        pushDebugLog('loadEnrichedEpisodes:success rows=' + rows.length);
      } catch (error) {
        if (runId !== refreshRunId) return;
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to enrich download status';
        errorState.set(message);
        pushDebugLog('loadEnrichedEpisodes:error ' + message);
        ctx.toast.error('Failed to load download status');
      } finally {
        if (runId !== refreshRunId) return;
        isEpDataLoadingState.set(false);
      }
    };

    panel.channel.sync('rows', rowsState);
    panel.channel.sync('loading', loadingState);
    panel.channel.sync('download-loading', isEpDataLoadingState);
    panel.channel.sync('error', errorState);
    panel.channel.sync('debug-logs', debugLogsState);
    panel.channel.sync('column-visibility', columnVisibilityState);
    panel.channel.sync('cover-size', coverSizeState);

    panel.channel.on('refresh', (payload: any) => {
      pushDebugLog('channel:refresh payload=' + JSON.stringify(payload || {}));
      refreshRows();
    });
    panel.channel.on('load-enriched-episodes', (payload: any) => {
      pushDebugLog(
        'channel:load-enriched-episodes payload=' +
          JSON.stringify(payload || {}),
      );
      loadEnrichedEpisodes();
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

        .filter-bar {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
            border: 1px solid var(--line);
            border-radius: 10px;
            padding: 8px;
            background: rgba(255,255,255,0.03);
        }

        .filter-input {
            border: 1px solid var(--line);
            background: var(--panel-2);
            color: var(--text);
            border-radius: 8px;
            padding: 7px 9px;
            font-size: 12px;
            min-height: 34px;
        }

        .filter-input-score {
            width: 108px;
        }

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
            min-width: 1180px;
            border-collapse: collapse;
            table-layout: fixed;
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

        .th-sort-btn {
            border: 0;
            background: transparent;
            color: inherit;
            text-transform: inherit;
            letter-spacing: inherit;
            font-size: inherit;
            font-weight: 600;
            padding: 0;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .th-sort-btn:hover {
            color: var(--text);
        }

        .th-sort-indicator {
            font-size: 11px;
            color: var(--text);
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
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .title-btn:hover { text-decoration: underline; }

        .title-cell {
            width: 320px;
            min-width: 320px;
            max-width: 320px;
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
            min-width: 100px;
            max-width: 200px;
        }

        .progress-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0px;
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

        .episode-status {
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
            max-width: 400px;
        }

        .episode-status-summary {
            font-size: 11px;
            color: var(--muted);
        }

        .episode-pill-list {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            max-height: 54px;
            overflow-y: auto;
        }

        .episode-status-cell {
            width: 320px;
            min-width: 320px;
            max-width: 320px;
        }

        .col-cover { width: 84px; }
        .col-watched { width: 86px; white-space: nowrap; }
        .col-total { width: 86px; white-space: nowrap; }
        .col-score { width: 86px; white-space: nowrap; }
        .col-status { width: 128px; white-space: nowrap; }
        .col-progress { width: 220px; }
        .col-format { width: 110px; white-space: nowrap; }

        .episode-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            border-radius: 999px;
            border: 1px solid var(--line);
            font-size: 11px;
            line-height: 1;
            padding: 5px 7px;
            background: rgba(255, 255, 255, 0.06);
        }

        .episode-pill--watched {
            background: rgba(22, 163, 74, 0.18);
            border-color: rgba(22, 163, 74, 0.55);
            color: #dcfce7;
        }

        .episode-pill--downloaded {
            background: rgba(14, 165, 233, 0.18);
            border-color: rgba(14, 165, 233, 0.55);
            color: #e0f2fe;
        }

        .episode-pill--missing {
            background: rgba(239, 68, 68, 0.18);
            border-color: rgba(239, 68, 68, 0.55);
            color: #fee2e2;
        }

        .episode-pill-check {
            font-weight: 700;
            font-size: 10px;
        }

        .table-wrap::-webkit-scrollbar,
        .episode-pill-list::-webkit-scrollbar,
        .debug-logs::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }

        .table-wrap::-webkit-scrollbar-track,
        .episode-pill-list::-webkit-scrollbar-track,
        .debug-logs::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.08);
        }

        .table-wrap::-webkit-scrollbar-thumb,
        .episode-pill-list::-webkit-scrollbar-thumb,
        .debug-logs::-webkit-scrollbar-thumb {
            background: rgba(148, 163, 184, 0.6);
            border-radius: 999px;
            border: 2px solid transparent;
            background-clip: content-box;
        }

        .table-wrap::-webkit-scrollbar-thumb:hover,
        .episode-pill-list::-webkit-scrollbar-thumb:hover,
        .debug-logs::-webkit-scrollbar-thumb:hover {
            background: rgba(203, 213, 225, 0.9);
            background-clip: content-box;
        }

        .virtual-row td {
            height: var(--virtual-row-height, 84px);
            max-height: var(--virtual-row-height, 84px);
            overflow: hidden;
        }

        .spacer-row td {
            border-bottom: none;
            padding: 0;
            height: 0;
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
        import { useEffect, useMemo, useRef, useState } from "https://esm.sh/preact@10.19.3/hooks"

        const ENABLE_DEBUG_LOGS_CLIENT = false
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
            { key: "unwatched", label: "Episode Status" },
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
            unwatched: true,
            format: true
        }
        const COVER_SIZE_MIN = 28
        const COVER_SIZE_MAX = 92
        const DEFAULT_COVER_SIZE = 42
        const VIRTUALIZE_AFTER_ROWS = 120
        const OVERSCAN_ROWS = 10

        function clamp(value, min, max) {
            return Math.max(min, Math.min(max, value))
        }

        function formatScore(value) {
            if (typeof value !== "number" || value === 0) return "-"
            return value % 1 === 0 ? String(value) : value.toFixed(1)
        }

        function progressPercent(row) {
            if (typeof row.totalEpisodes === "number" && row.totalEpisodes > 0) {
                return Math.max(0, Math.min(100, Math.round((row.progress / row.totalEpisodes) * 100)))
            }
            return 0
        }

        function compareNullableNumber(a, b) {
            const aNum = typeof a === "number" && Number.isFinite(a) ? a : null
            const bNum = typeof b === "number" && Number.isFinite(b) ? b : null
            if (aNum === null && bNum === null) return 0
            if (aNum === null) return 1
            if (bNum === null) return -1
            if (aNum === bNum) return 0
            return aNum > bNum ? 1 : -1
        }

        function compareText(a, b) {
            return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" })
        }

        function progressSortValue(row) {
            if (typeof row.totalEpisodes === "number" && row.totalEpisodes > 0) {
                return row.progress / row.totalEpisodes
            }
            return null
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
            const [isEpDataLoading, setIsEpDataLoading] = useState(false)
            const [error, setError] = useState("")
            const [rows, setRows] = useState([])
            const [activeTab, setActiveTab] = useState("CURRENT")
            const [columnVisibility, setColumnVisibility] = useState(DEFAULT_COLUMN_VISIBILITY)
            const [coverSize, setCoverSize] = useState(DEFAULT_COVER_SIZE)
            const [debugLogs, setDebugLogs] = useState([])
            const [searchText, setSearchText] = useState("")
            const [formatFilter, setFormatFilter] = useState("")
            const [scoreMinFilter, setScoreMinFilter] = useState("")
            const [scoreMaxFilter, setScoreMaxFilter] = useState("")
            const [episodesMinFilter, setEpisodesMinFilter] = useState("")
            const [episodesMaxFilter, setEpisodesMaxFilter] = useState("")
            const [sortKey, setSortKey] = useState("title")
            const [sortDir, setSortDir] = useState("asc")
            const [scrollTop, setScrollTop] = useState(0)
            const [viewportHeight, setViewportHeight] = useState(700)
            const tableWrapRef = useRef(null)
            const coverSizeDebounceRef = useRef(null)

            const logClient = (message) => {
                if (!ENABLE_DEBUG_LOGS_CLIENT) return
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
                on("download-loading", (value) => {
                    setIsEpDataLoading(Boolean(value))
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

            useEffect(() => {
                const el = tableWrapRef.current
                if (!el) return
                const updateViewport = () => {
                    setViewportHeight(el.clientHeight || 700)
                }
                const onScroll = () => {
                    setScrollTop(el.scrollTop || 0)
                }
                updateViewport()
                onScroll()
                el.addEventListener("scroll", onScroll, { passive: true })
                window.addEventListener("resize", updateViewport)
                let ro = null
                if (typeof ResizeObserver !== "undefined") {
                    ro = new ResizeObserver(() => updateViewport())
                    ro.observe(el)
                }
                return () => {
                    el.removeEventListener("scroll", onScroll)
                    window.removeEventListener("resize", updateViewport)
                    if (ro) ro.disconnect()
                }
            }, [activeTab, rows.length])

            useEffect(() => {
                const el = tableWrapRef.current
                if (!el) return
                el.scrollTop = 0
                setScrollTop(0)
            }, [activeTab])

            useEffect(() => {
                return () => {
                    if (coverSizeDebounceRef.current) {
                        clearTimeout(coverSizeDebounceRef.current)
                    }
                }
            }, [])

            const statusCounts = useMemo(() => {
                const counts = { CURRENT: 0, COMPLETED: 0, PAUSED: 0, DROPPED: 0, PLANNING: 0 }
                rows.forEach((row) => {
                    if (counts[row.status] !== undefined) counts[row.status] += 1
                })
                return counts
            }, [rows])

            const formatOptions = useMemo(() => {
                const set = new Set()
                rows.forEach((row) => {
                    if (row.format) set.add(String(row.format))
                })
                return Array.from(set).sort()
            }, [rows])

            const visibleRows = useMemo(() => {
                const lowerSearch = searchText.trim().toLowerCase()
                const minScore = scoreMinFilter === "" ? null : Number(scoreMinFilter)
                const maxScore = scoreMaxFilter === "" ? null : Number(scoreMaxFilter)
                const minEpisodes = episodesMinFilter === "" ? null : Number(episodesMinFilter)
                const maxEpisodes = episodesMaxFilter === "" ? null : Number(episodesMaxFilter)

                return rows.filter((row) => {
                    if (row.status !== activeTab) return false
                    if (lowerSearch && !String(row.title || "").toLowerCase().includes(lowerSearch)) return false
                    if (formatFilter && String(row.format || "") !== formatFilter) return false
                    if (minScore !== null) {
                        if (typeof row.score !== "number" || row.score < minScore) return false
                    }
                    if (maxScore !== null) {
                        if (typeof row.score !== "number" || row.score > maxScore) return false
                    }
                    if (minEpisodes !== null) {
                        if (typeof row.totalEpisodes !== "number" || row.totalEpisodes < minEpisodes) return false
                    }
                    if (maxEpisodes !== null) {
                        if (typeof row.totalEpisodes !== "number" || row.totalEpisodes > maxEpisodes) return false
                    }
                    return true
                })
            }, [
                rows,
                activeTab,
                searchText,
                formatFilter,
                scoreMinFilter,
                scoreMaxFilter,
                episodesMinFilter,
                episodesMaxFilter
            ])

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

            const onLoadEnrichedEpisodes = () => {
                logClient("load-enriched-episodes clicked")
                send("load-enriched-episodes", { requestedAt: Date.now() })
            }

            const onToggleColumn = (columnKey, visible) => {
                const next = { ...columnVisibility, [columnKey]: visible }
                setColumnVisibility(next)
                send("set-column-visibility", { column: columnKey, visible: visible })
            }

            const onCoverSizeInput = (event) => {
                const nextSize = clamp(Math.round(Number(event.currentTarget.value || DEFAULT_COVER_SIZE)), COVER_SIZE_MIN, COVER_SIZE_MAX)
                setCoverSize(nextSize)
                if (coverSizeDebounceRef.current) clearTimeout(coverSizeDebounceRef.current)
                coverSizeDebounceRef.current = setTimeout(() => {
                    send("set-cover-size", { size: nextSize })
                }, 180)
            }

            const onResetFilters = () => {
                setSearchText("")
                setFormatFilter("")
                setScoreMinFilter("")
                setScoreMaxFilter("")
                setEpisodesMinFilter("")
                setEpisodesMaxFilter("")
            }

            const onSortColumn = (key) => {
                if (sortKey === key) {
                    setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
                    return
                }
                setSortKey(key)
                setSortDir("asc")
            }

            const renderSortableHeader = (key, className, label) => {
                const active = sortKey === key
                const indicator = active ? (sortDir === "asc" ? "▲" : "▼") : ""
                return h(
                    "th",
                    { key: "h-" + key, class: className },
                    h(
                        "button",
                        {
                            class: "th-sort-btn",
                            type: "button",
                            onClick: () => onSortColumn(key),
                            title: "Sort by " + label
                        },
                        [
                            h("span", null, label),
                            indicator ? h("span", { class: "th-sort-indicator" }, indicator) : null
                        ]
                    )
                )
            }

            const sortedRows = useMemo(() => {
                const next = visibleRows.slice()
                const direction = sortDir === "asc" ? 1 : -1
                next.sort((a, b) => {
                    let result = 0
                    if (sortKey === "title") result = compareText(a.title, b.title)
                    else if (sortKey === "watched") result = compareNullableNumber(a.progress, b.progress)
                    else if (sortKey === "total") result = compareNullableNumber(a.totalEpisodes, b.totalEpisodes)
                    else if (sortKey === "score") result = compareNullableNumber(a.score, b.score)
                    else if (sortKey === "progress") {
                        result = compareNullableNumber(progressSortValue(a), progressSortValue(b))
                        if (result === 0) result = compareNullableNumber(a.progress, b.progress)
                    } else if (sortKey === "unwatched") {
                        result = compareNullableNumber(a.downloadedUnwatched, b.downloadedUnwatched)
                    } else if (sortKey === "format") {
                        result = compareText(a.format, b.format)
                    }
                    if (result === 0) {
                        result = compareText(a.title, b.title)
                    }
                    return result * direction
                })
                return next
            }, [visibleRows, sortKey, sortDir])

            const headerCells = []
            const showUnwatchedColumn = columnVisibility.unwatched && activeTab === "CURRENT"
            if (columnVisibility.cover) headerCells.push(h("th", { key: "h-cover", class: "col-cover" }, "Cover"))
            if (columnVisibility.title) headerCells.push(renderSortableHeader("title", "title-cell", "Title"))
            if (columnVisibility.watched) headerCells.push(renderSortableHeader("watched", "col-watched", "Watched"))
            if (columnVisibility.total) headerCells.push(renderSortableHeader("total", "col-total", "Total"))
            if (columnVisibility.score) headerCells.push(renderSortableHeader("score", "col-score", "Score"))
            if (columnVisibility.status) headerCells.push(h("th", { key: "h-status", class: "col-status" }, "Status"))
            if (columnVisibility.progress) headerCells.push(renderSortableHeader("progress", "col-progress", "Progress"))
            if (showUnwatchedColumn) headerCells.push(renderSortableHeader("unwatched", "episode-status-cell", "Episode Status"))
            if (columnVisibility.format) headerCells.push(renderSortableHeader("format", "col-format", "Type / Format"))
            const columnCount = Math.max(1, headerCells.length)
            const virtualRowHeight = showUnwatchedColumn ? 84 : 62
            const shouldVirtualize = sortedRows.length > VIRTUALIZE_AFTER_ROWS
            const virtualStartRaw = shouldVirtualize
                ? Math.max(0, Math.floor(scrollTop / virtualRowHeight) - OVERSCAN_ROWS)
                : 0
            const maxStartIndex = Math.max(0, sortedRows.length - 1)
            const virtualStart = shouldVirtualize
                ? Math.min(maxStartIndex, virtualStartRaw)
                : 0
            const visibleCount = shouldVirtualize
                ? Math.max(1, Math.ceil(viewportHeight / virtualRowHeight) + OVERSCAN_ROWS * 2)
                : sortedRows.length
            const virtualEnd = shouldVirtualize
                ? Math.min(sortedRows.length, virtualStart + visibleCount)
                : sortedRows.length
            const rowsForRender = shouldVirtualize
                ? sortedRows.slice(virtualStart, virtualEnd)
                : sortedRows
            const topSpacerHeight = shouldVirtualize ? virtualStart * virtualRowHeight : 0
            const bottomSpacerHeight = shouldVirtualize ? Math.max(0, (sortedRows.length - virtualEnd) * virtualRowHeight) : 0

            const tableBodyRows = rowsForRender.map((row) => {
                const progressContext = getProgressContext(row)
                const totalText = typeof row.totalEpisodes === "number" ? String(row.totalEpisodes) : "-"
                const hasDownloadContext =
                    typeof row.releasedUnwatched === "number" &&
                    typeof row.downloadedUnwatched === "number" &&
                    typeof row.neededToDownload === "number"

                const coverHeight = Math.round(coverSize * 1.38)
                const cells = []

                if (columnVisibility.cover) {
                    cells.push(
                        h("td", { key: "cover", class: "col-cover" },
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
                if (columnVisibility.watched) cells.push(h("td", { key: "watched", class: "col-watched" }, String(row.progress)))
                if (columnVisibility.total) cells.push(h("td", { key: "total", class: "col-total" }, totalText))
                if (columnVisibility.score) cells.push(h("td", { key: "score", class: "col-score" }, formatScore(row.score)))
                if (columnVisibility.status) {
                    cells.push(h("td", { key: "status", class: "col-status" }, h("span", { class: "badge" }, STATUS_LABELS[row.status] || row.status)))
                }
                if (columnVisibility.progress) {
                    cells.push(
                        h("td", { key: "progress", class: "col-progress" },
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
                if (showUnwatchedColumn) {
                    if (isEpDataLoading && row.status === "CURRENT") {
                        cells.push(h("td", { key: "unwatched" }, "Loading..."))
                    } else if (!hasDownloadContext || !Array.isArray(row.episodeStatuses)) {
                        cells.push(h("td", { key: "unwatched" }, "?"))
                    } else {
                        const pillItems = row.episodeStatuses.map((item) => {
                            const className = "episode-pill episode-pill--" + item.state
                            const children = []
                            if (item.state === "watched") {
                                children.push(h("span", { class: "episode-pill-check", key: "check" }, "✓"))
                            }
                            children.push(h("span", { key: "label" }, "Ep " + item.episode))
                            return h("span", { class: className, key: item.state + "-" + item.episode }, children)
                        })

                        if (row.hiddenEpisodeStatusCount > 0) {
                            pillItems.unshift(
                                h("span", { class: "episode-pill", key: "older-count" }, "+" + row.hiddenEpisodeStatusCount + " older")
                            )
                        }

                        const readyCount = row.downloadedUnwatched
                        const needCount = row.neededToDownload
                        let statusSummary = ""
                        if (readyCount <= 0) {
                            statusSummary =
                                (needCount === 1 ? "1 new ep" : needCount + " new eps") +
                                " to download"
                        } else {
                            statusSummary =
                                readyCount +
                                " " +
                                (readyCount === 1 ? "ep" : "eps") +
                                " ready to watch [" +
                                readyCount +
                                "/" +
                                row.releasedUnwatched +
                                "]"
                            if (needCount > 0) {
                                statusSummary +=
                                    " • " +
                                    (needCount === 1 ? "1 new ep" : needCount + " new eps") +
                                    " to download"
                            }
                        }

                        cells.push(
                            h("td", { key: "unwatched", class: "episode-status-cell" },
                                h("div", { class: "episode-status" }, [
                                    h(
                                        "div",
                                        { class: "episode-status-summary", key: "summary" },
                                        statusSummary
                                    ),
                                    h("div", { class: "episode-pill-list", key: "pills" }, pillItems)
                                ])
                            )
                        )
                    }
                }
                if (columnVisibility.format) cells.push(h("td", { key: "format", class: "col-format" }, row.format || "-"))

                return h(
                    "tr",
                    {
                        key: row.entryId,
                        class: shouldVirtualize ? "virtual-row" : "",
                        style: shouldVirtualize
                            ? { "--virtual-row-height": virtualRowHeight + "px" }
                            : undefined
                    },
                    cells
                )
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

            useEffect(() => {
                const el = tableWrapRef.current
                if (!el) return
                const virtualRowHeight = showUnwatchedColumn ? 84 : 62
                const shouldVirtualize = sortedRows.length > VIRTUALIZE_AFTER_ROWS
                if (!shouldVirtualize) return
                const totalVirtualHeight = sortedRows.length * virtualRowHeight
                const maxScrollTop = Math.max(
                    0,
                    totalVirtualHeight - (el.clientHeight || viewportHeight || 0)
                )
                if (el.scrollTop > maxScrollTop) {
                    el.scrollTop = maxScrollTop
                    setScrollTop(maxScrollTop)
                }
            }, [sortedRows.length, showUnwatchedColumn, viewportHeight])

            useEffect(() => {
                if (activeTab !== "CURRENT" && sortKey === "unwatched") {
                    setSortKey("title")
                    setSortDir("asc")
                }
            }, [activeTab, sortKey])

            let content = null
            if (loading) {
                content = h("div", { class: "state" }, "Loading your anime list...")
            } else if (error) {
                content = h("div", { class: "state error" }, error)
            } else if (sortedRows.length === 0) {
                content = h("div", { class: "state" }, [
                    "No entries in ",
                    h("strong", null, STATUS_LABELS[activeTab] || activeTab),
                    "."
                ])
            } else {
                const tbodyItems = []
                if (topSpacerHeight > 0) {
                    tbodyItems.push(
                        h("tr", { key: "top-spacer", class: "spacer-row", "aria-hidden": "true" }, [
                            h("td", {
                                colSpan: columnCount,
                                style: { height: topSpacerHeight + "px" }
                            })
                        ])
                    )
                }
                Array.prototype.push.apply(tbodyItems, tableBodyRows)
                if (bottomSpacerHeight > 0) {
                    tbodyItems.push(
                        h("tr", { key: "bottom-spacer", class: "spacer-row", "aria-hidden": "true" }, [
                            h("td", {
                                colSpan: columnCount,
                                style: { height: bottomSpacerHeight + "px" }
                            })
                        ])
                    )
                }

                content = h("div", { class: "table-shell" },
                    h("div", { class: "table-wrap", ref: tableWrapRef },
                        h("table", null, [
                            h("thead", null, h("tr", null, headerCells)),
                            h("tbody", null, tbodyItems)
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
                        h("button", { class: "btn", onClick: onLoadEnrichedEpisodes, disabled: loading || isEpDataLoading }, isEpDataLoading ? "Loading Status..." : "Load Episode Status"),
                        h("button", { class: "btn", onClick: onRefresh }, "Refresh")
                    ])
                ]),
                h("div", { class: "filter-bar" }, [
                    h("input", {
                        class: "filter-input",
                        placeholder: "Search title...",
                        value: searchText,
                        onInput: (e) => setSearchText(String(e.currentTarget.value || ""))
                    }),
                    h(
                        "select",
                        {
                            class: "filter-input",
                            value: formatFilter,
                            onChange: (e) => setFormatFilter(String(e.currentTarget.value || ""))
                        },
                        [
                            h("option", { value: "" }, "All formats"),
                            ...formatOptions.map((fmt) => h("option", { value: fmt, key: "fmt-" + fmt }, fmt))
                        ]
                    ),
                    h("input", {
                        class: "filter-input filter-input-score",
                        type: "number",
                        min: "0",
                        max: "10",
                        step: "1",
                        placeholder: "Score min",
                        value: scoreMinFilter,
                        onInput: (e) => setScoreMinFilter(String(e.currentTarget.value || ""))
                    }),
                    h("input", {
                        class: "filter-input filter-input-score",
                        type: "number",
                        min: "0",
                        max: "10",
                        step: "1",
                        placeholder: "Score max",
                        value: scoreMaxFilter,
                        onInput: (e) => setScoreMaxFilter(String(e.currentTarget.value || ""))
                    }),
                    h("input", {
                        class: "filter-input",
                        type: "number",
                        min: "1",
                        step: "1",
                        placeholder: "Episodes min",
                        value: episodesMinFilter,
                        onInput: (e) => setEpisodesMinFilter(String(e.currentTarget.value || ""))
                    }),
                    h("input", {
                        class: "filter-input",
                        type: "number",
                        min: "1",
                        step: "1",
                        placeholder: "Episodes max",
                        value: episodesMaxFilter,
                        onInput: (e) => setEpisodesMaxFilter(String(e.currentTarget.value || ""))
                    }),
                    h("button", { class: "btn", onClick: onResetFilters }, "Reset Filters")
                ]),
                content,
                h("details", { class: "debug-panel" }, [
                    h("summary", null, "Debug logs (" + String(debugLogs.length) + ") | loading=" + String(loading) + " | isEpDataLoading=" + String(isEpDataLoading) + " | rows=" + String(rows.length) + " | activeTab=" + activeTab),
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
