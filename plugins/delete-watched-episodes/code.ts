/// <reference path="core.d.ts" />
/// <reference path="app.d.ts" />
/// <reference path="plugin.d.ts" />
/// <reference path="system.d.ts" />

/**
 * Delete Watched Episodes Plugin for Seanime
 *
 * This plugin allows users to delete local files for episodes they have already watched,
 * helping to free up disk space.
 */

interface FileToDelete {
  path: string;
  episode: number | undefined;
  anime: string;
  size: number;
}

function init() {
  console.log('[Delete Watched Episodes] Plugin loaded');
}

$ui.register(function (ctx) {
  console.log('[Delete Watched Episodes] UI context registered');

  // State
  const isScanning = ctx.state(false);
  const isDeleting = ctx.state(false);
  const filesToDelete = ctx.state<FileToDelete[]>([]);
  const totalSize = ctx.state(0);
  const deletionProgress = ctx.state(0);
  const scanError = ctx.state('');
  const deleteError = ctx.state('');

  // Tray
  const tray = ctx.newTray({
    iconUrl:
      'https://raw.githubusercontent.com/dadangdut33/seanime-extensions/refs/heads/master/plugins/delete-watched-episodes/icon.png',
    withContent: true,
    width: '420px',
    minHeight: '200px',
  });

  // Helper to format bytes
  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Scanning logic
  async function scanFiles() {
    isScanning.set(true);
    scanError.set('');
    filesToDelete.set([]);
    totalSize.set(0);

    try {
      const collection = $anilist.getAnimeCollection(false);
      const lists = collection?.MediaListCollection?.lists;

      if (!lists) {
        throw new Error('Failed to fetch anime collection');
      }

      // Flatten all entries across all lists into one array
      const allEntries = lists.flatMap((list) => list.entries || []);

      // Map entries to promises that fetch local file info
      const scanPromises = allEntries.map(async (entry) => {
        if (!entry.media?.id || entry.progress === undefined) return [];

        try {
          const animeEntry = await ctx.anime.getAnimeEntry(entry.media.id);
          if (!animeEntry?.localFiles) return [];

          const currentTitle = entry.media.title?.userPreferred || 'Unknown';

          // Filter for files that match the "watched" criteria
          return animeEntry.localFiles
            .filter(
              (file) =>
                file.metadata?.episode &&
                entry.progress &&
                file.metadata.episode <= entry.progress
            )
            .map((file) => {
              let fileSize = 0;
              try {
                fileSize = $os.stat(file.path).size();
              } catch (e) {
                console.error(`[Scan] Failed to stat ${file.path}:`, e);
              }

              return {
                path: file.path,
                episode: file.metadata?.episode,
                anime: currentTitle,
                size: fileSize,
              };
            });
        } catch (err) {
          console.error(`[Scan] Error fetching entry ${entry.media.id}:`, err);
          return [];
        }
      });

      // Resolve all scans and flatten the results
      const results = await Promise.all(scanPromises);
      const foundFiles = results.flat();
      const totalBytesFound = foundFiles.reduce(
        (acc, file) => acc + file.size,
        0
      );

      // Update UI State
      filesToDelete.set(foundFiles);
      totalSize.set(totalBytesFound);

      if (foundFiles.length > 0) {
        tray.updateBadge({ number: foundFiles.length, intent: 'warning' });
        ctx.toast.info(`Found ${foundFiles.length} watched episodes`);
      } else {
        tray.updateBadge({ number: 0 });
        ctx.toast.info('No watched episodes found');
      }
    } catch (error) {
      console.error('[Delete Watched Episodes] Error:', error);
      scanError.set(error instanceof Error ? error.message : String(error));
    } finally {
      isScanning.set(false);
      tray.update();
    }
  }

  // Deletion logic
  function deleteFiles() {
    if (isDeleting.get()) return;

    isDeleting.set(true);
    deleteError.set('');
    deletionProgress.set(0);

    const files = filesToDelete.get();

    (async function () {
      let deleted = 0,
        failed = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          $os.remove(file.path);
          deleted++;
        } catch (e) {
          console.error('Failed to delete: ' + file.path);
          failed++;
        }
        deletionProgress.set(deleted);
        tray.update();
      }

      isDeleting.set(false);

      // Clear the list and show success
      filesToDelete.set([]);
      totalSize.set(0);
      tray.updateBadge({ number: 0 });

      if (failed > 0) {
        deleteError.set('Failed to delete ' + failed + ' files.');
      } else {
        ctx.toast.success('Successfully deleted ' + deleted + ' files.');
        // tray.close();
        ctx.autoScanner.notify();
        console.log('Auto-scanner notified to check for new files');
        ctx.toast.info('Auto-scanner notified to check for new files');
      }
      tray.update();
    })();
  }

  // Event Handlers
  const scanHandlerId = ctx.eventHandler('scan-files', function () {
    scanFiles();
  });

  const deleteHandlerId = ctx.eventHandler('delete-files', function () {
    deleteFiles();
  });

  const cancelHandlerId = ctx.eventHandler('cancel-delete', function () {
    filesToDelete.set([]);
    totalSize.set(0);
    tray.updateBadge({ number: 0 });
    tray.close();
  });

  // Render Tray Content
  tray.render(function () {
    // ------------------------------------------------------------------------
    // Header Area
    // ------------------------------------------------------------------------
    const header = tray.stack(
      [
        tray.div(
          [
            tray.text('Delete Watched Episodes', {
              className: 'text-lg font-bold',
            }),
            tray.text(
              'Scan and delete local files for episodes you have already watched.',
              {
                className: 'text-xs',
              }
            ),
          ],
          { className: 'flex flex-col gap-1' }
        ),

        tray.button({
          label: isScanning.get() ? 'Scanning...' : 'Scan Library',
          intent: 'primary-subtle',
          disabled: isScanning.get() || isDeleting.get(),
          loading: isScanning.get(), // Use loading prop if supported, otherwise disabled serves
          onClick: scanHandlerId,
        }),
      ],
      {
        className: 'flex flex-col gap-4',
      }
    );

    // ------------------------------------------------------------------------
    // Content Area
    // ------------------------------------------------------------------------
    const contentItems: any[] = [];

    // Error State (High priority)
    if (scanError.get()) {
      contentItems.push(
        tray.alert({
          title: 'Error Scanning',
          description: scanError.get(),
          intent: 'alert',
          className: 'mb-4',
        })
      );
    }

    // Scanning State
    if (isScanning.get()) {
      contentItems.push(
        tray.div(
          [
            tray.text('Scanning your library...', {
              className: 'animate-pulse font-medium',
            }),
            tray.text('This may take a moment.', {
              className: 'text-sm text-[--muted-foreground]',
            }),
          ],
          {
            className:
              'flex flex-col items-center justify-center h-full py-8 space-y-2 px-2',
          }
        )
      );
    }

    // Files Found State
    else if (filesToDelete.get().length > 0) {
      // Summary Header
      contentItems.push(
        tray.div(
          [
            tray.text(
              filesToDelete.get().length +
                ' files found (' +
                formatBytes(totalSize.get()) +
                ')',
              {
                className: 'font-semibold',
              }
            ),
          ],
          { className: 'flex mb-2 px-2' }
        )
      );

      // File List
      const fileList = filesToDelete.get().map(function (file) {
        // we need to use file.path for some reason because i dont know why file.name causes error
        console.log('File to delete');
        console.log(file);
        const nameFromPath =
          $os.platform === 'windows'
            ? file.path.split('\\')
            : file.path.split('/');
        const actualName = nameFromPath.pop() ?? 'Failed to get anime name';
        return tray.div(
          [
            tray.div(
              [
                tray.text(
                  '> ' + actualName + ' (' + formatBytes(file.size) + ')'
                ),
              ],
              { className: 'flex-1' }
            ),
          ],
          {
            className: 'flex justify-between items-center px-2 text-xs',
          }
        );
      });

      contentItems.push(
        tray.stack(fileList, { className: 'flex flex-col overflow-x-auto' })
      );
    }
    // Initial / Empty State
    else {
      contentItems.push(
        tray.div(
          [
            tray.text(
              scanError.get()
                ? 'Try scanning again.'
                : 'Click "Scan Library" to find watched episodes.',
              {
                className: 'text-[--muted-foreground] text-center',
              }
            ),
          ],
          {
            className:
              'flex flex-col items-center justify-center h-full py-8 space-y-4',
          }
        )
      );
    }

    const contentArea = tray.stack([
      tray.css(`
        .delep-content-area {
          max-height: 250px;
          overflow: auto;
        }
      `),
      tray.div(contentItems, {
        className:
          'bg-slate-900 rounded-lg py-4 font-mono text-sm text-emerald-400 border-2 border-emerald-500 my-2 delep-content-area',
      }),
    ]);

    // ------------------------------------------------------------------------
    // Footer Actions
    // ------------------------------------------------------------------------
    const footerItems: any[] = [];

    // Show progress if deleting
    if (isDeleting.get()) {
      footerItems.push(
        tray.text(
          'Deleting... ' +
            deletionProgress.get() +
            '/' +
            filesToDelete.get().length,
          {
            className: 'text-sm animate-pulse mr-auto',
          }
        )
      );
    } else {
      // Spacer to push buttons to right if not deleting
      footerItems.push(tray.div([], { className: 'flex-1' }));
    }

    const hasFiles = filesToDelete.get().length > 0;
    const isBusy = isScanning.get() || isDeleting.get();

    footerItems.push(
      tray.button({
        label: 'Cancel',
        intent: 'gray',
        disabled: !hasFiles || isBusy, // Disabled if no files or busy
        onClick: cancelHandlerId,
      })
    );

    footerItems.push(
      tray.button({
        label: 'Delete All',
        intent: 'alert',
        disabled: !hasFiles || isBusy, // Disabled if no files or busy
        onClick: deleteHandlerId,
      })
    );

    const footer = tray.div(footerItems, {
      className: 'flex items-center gap-2',
    });

    return tray.div([header, contentArea, footer]);
  });
});
