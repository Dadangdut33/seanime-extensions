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
  episode: number;
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
  function scanFiles() {
    isScanning.set(true);
    scanError.set('');
    filesToDelete.set([]);
    totalSize.set(0);

    // Use async processing
    (async function () {
      try {
        // Get the anime collection from AniList
        const collection = $anilist.getAnimeCollection(false);

        if (
          !collection ||
          !collection.MediaListCollection ||
          !collection.MediaListCollection.lists
        ) {
          scanError.set('Failed to fetch anime collection');
          isScanning.set(false);
          return;
        }

        const foundFiles: FileToDelete[] = [];
        const promises: Promise<void>[] = [];
        let totalBytesFound = 0;

        // Iterate through all lists in the collection
        const lists = collection.MediaListCollection.lists;
        for (let i = 0; i < lists.length; i++) {
          const list = lists[i];
          if (!list.entries) continue;

          // Iterate through entries in each list
          for (let j = 0; j < list.entries.length; j++) {
            const entry = list.entries[j];

            if (!entry.media || !entry.progress) continue;

            const mediaId = entry.media.id;
            const progress = entry.progress;
            const animeTitle = entry.media?.title?.userPreferred || 'Unknown';

            // Create a promise for each anime entry fetch
            const promise = ctx.anime
              .getAnimeEntry(mediaId)
              .then(
                (function (currentProgress, currentTitle) {
                  return function (animeEntry) {
                    if (!animeEntry || !animeEntry.localFiles) {
                      return;
                    }

                    // Find watched episodes
                    for (let k = 0; k < animeEntry.localFiles.length; k++) {
                      const localFile = animeEntry.localFiles[k];

                      // Check if this episode has been watched
                      if (localFile.metadata && localFile.metadata.episode) {
                        const episodeNumber = localFile.metadata.episode;

                        if (episodeNumber <= currentProgress) {
                          // This episode has been watched
                          // Get file size using $os.stat
                          let fileSize = 0;
                          try {
                            const fileInfo = $os.stat(localFile.path);
                            fileSize = fileInfo.size();
                          } catch (e) {
                            // Ignore error
                          }

                          foundFiles.push({
                            path: localFile.path,
                            episode: episodeNumber,
                            anime: currentTitle,
                            size: fileSize,
                          });

                          totalBytesFound += fileSize;
                        }
                      }
                    }
                  };
                })(progress, animeTitle)
              )
              .catch(function (error) {
                // Ignore errors
              });

            promises.push(promise);
          }
        }

        // Wait for all promises to resolve
        await Promise.all(promises);

        filesToDelete.set(foundFiles);
        totalSize.set(totalBytesFound);

        // Update badge
        if (foundFiles.length > 0) {
          tray.updateBadge({ number: foundFiles.length, intent: 'warning' });
        } else {
          tray.updateBadge({ number: 0 }); // Clear badge
        }
      } catch (error) {
        console.error('[Delete Watched Episodes] Error: ' + error);
        scanError.set('Error: ' + error);
      } finally {
        isScanning.set(false);
        tray.update(); // Re-render
      }
    })();
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

        // // Artificial delay for visual feedback if needed, but safer not to block too much
        // await new Promise((resolve) => setTimeout(resolve, 50));
      }

      isDeleting.set(false);

      // Final update - rescan or clear list?
      // Let's clear the list and show success
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
        const nameFromPath = file.path.split('\\');
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
