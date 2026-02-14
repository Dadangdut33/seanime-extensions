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

// @ts-ignore
function init() {
  console.log('[Delete Watched Episodes] Plugin loaded');
}

$ui.register(function (ctx) {
  console.log('[Delete Watched Episodes] UI context registered');

  function getOrSetDefault<T>(key: string, defaultValue: T): T {
    const value = $storage.get(key);
    if (!value) {
      $storage.set(key, defaultValue);
      return defaultValue;
    }
    return value;
  }

  // State
  const isScanning = ctx.state(false);
  const isDeleting = ctx.state(false);
  const filesToDelete = ctx.state<FileToDelete[]>([]);
  const totalSize = ctx.state(0);
  const deletionProgress = ctx.state(0);
  const scanError = ctx.state('');
  const deleteError = ctx.state('');
  const currentTab = ctx.state<'main' | 'settings'>('main');

  // Settings state
  const customEpisodeStorePath = ctx.state<string>(
    getOrSetDefault<string | null>('customEpisodeStorePath', null) || '',
  );
  const ignoreLocked = ctx.state<boolean>(
    getOrSetDefault<boolean>('ignoreLocked', true),
  );
  const excludeList = ctx.state<string[]>(
    getOrSetDefault<string[]>('excludeList', []),
  );
  const showFullPath = ctx.state<boolean>(
    getOrSetDefault<boolean>('showFullPath', false),
  );

  // field ref
  const customEpisodeStorePathRef = ctx.fieldRef<string>(
    customEpisodeStorePath.get(),
  );
  const ignoreLockedRef = ctx.fieldRef<boolean>(ignoreLocked.get());
  const showFullPathRef = ctx.fieldRef<boolean>(showFullPath.get());
  const newExcludePathRef = ctx.fieldRef<string>(''); // add new

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
                file.metadata.episode <= entry.progress &&
                // if customEpisodeStorePath is set, only include files that are in that directory
                (customEpisodeStorePath.get()
                  ? file.path.startsWith(customEpisodeStorePath.get())
                  : true) &&
                // check if ignoreLocked is true, then ignore locked files
                (ignoreLocked.get() ? !file.locked : true) &&
                // check if excludeList is not empty, then exclude files that are in the excludeList
                !excludeList.get().some((filter) => {
                  const cleanItem = file.path.toLowerCase().trim();
                  const cleanFilter = filter.toLowerCase().trim();

                  // Check if the item contains the filter string anywhere
                  return cleanItem.includes(cleanFilter);
                }),
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

      // remove dupe, this is for case where maybe the user is using symlink
      // and the file is found multiple times
      const uniqueFiles = foundFiles.filter(
        (file, index) =>
          foundFiles.findIndex((f) => f.path === file.path) === index,
      );

      const totalBytesFound = uniqueFiles.reduce(
        (acc, file) => acc + file.size,
        0,
      );

      // Update UI State
      filesToDelete.set(uniqueFiles);
      totalSize.set(totalBytesFound);

      if (uniqueFiles.length > 0) {
        tray.updateBadge({ number: uniqueFiles.length, intent: 'warning' });
        ctx.toast.info(`Found ${uniqueFiles.length} watched episodes`);
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

  const switchToMainTabHandler = ctx.eventHandler(
    'switch-to-main',
    function () {
      currentTab.set('main');
      tray.update();
    },
  );

  const switchToSettingsTabHandler = ctx.eventHandler(
    'switch-to-settings',
    function () {
      currentTab.set('settings');
      tray.update();
    },
  );

  const saveSettingsHandler = ctx.eventHandler('save-settings', function () {
    $storage.set('ignoreLocked', ignoreLockedRef.current);
    $storage.set('excludeList', excludeList.get());
    $storage.set(
      'customEpisodeStorePath',
      customEpisodeStorePathRef.current.trim(),
    );
    $storage.set('showFullPath', showFullPathRef.current);

    ignoreLocked.set(ignoreLockedRef.current);
    customEpisodeStorePath.set(customEpisodeStorePathRef.current.trim());
    showFullPath.set(showFullPathRef.current);

    ctx.toast.success('Settings saved successfully!');
    tray.update();
  });

  // Render Tray Content
  tray.render(function () {
    // ------------------------------------------------------------------------
    // Style
    // ------------------------------------------------------------------------
    const tabStyle = tray.css(`
      .delep-content-area {
        max-height: 250px;
        overflow: auto;
      }

      .delep-exclude-list-area {
        max-height: 125px;
        overflow: auto;
        background-color: #121212;
        border: 1px solid #3b3b3b;
      }

      .delep-text-muted {
        color: #6b7280;
      }
      
      .delep-text-red {
        color: #ef4444;
      }
    `);

    // ------------------------------------------------------------------------
    // Tab Bar
    // ------------------------------------------------------------------------
    const tabBar = tray.div(
      [
        tray.button({
          label: 'Main',
          intent: currentTab.get() === 'main' ? 'primary' : 'gray-subtle',
          onClick: switchToMainTabHandler,
        }),
        tray.button({
          label: 'Settings',
          intent: currentTab.get() === 'settings' ? 'primary' : 'gray-subtle',
          onClick: switchToSettingsTabHandler,
        }),
      ],
      { className: 'flex gap-2 mb-4' },
    );

    // ------------------------------------------------------------------------
    // Main Tab Content
    // ------------------------------------------------------------------------
    if (currentTab.get() === 'main') {
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
                },
              ),
            ],
            { className: 'flex flex-col gap-1' },
          ),

          tray.button({
            label: isScanning.get() ? 'Scanning...' : 'Scan Library',
            intent: 'primary-subtle',
            disabled: isScanning.get() || isDeleting.get(),
            loading: isScanning.get(),
            onClick: scanHandlerId,
          }),
        ],
        {
          className: 'flex flex-col gap-4',
        },
      );

      const contentItems: any[] = [];

      // Error State
      if (scanError.get()) {
        contentItems.push(
          tray.alert({
            title: 'Error Scanning',
            description: scanError.get(),
            intent: 'alert',
            className: 'mb-4',
          }),
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
                className: 'text-sm delep-text-muted',
              }),
            ],
            {
              className:
                'flex flex-col items-center justify-center h-full py-8 space-y-2 px-2',
            },
          ),
        );
      }
      // Files Found State
      else if (filesToDelete.get().length > 0) {
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
                },
              ),
            ],
            { className: 'flex mb-2 px-2' },
          ),
        );

        const fileList = filesToDelete.get().map(function (file) {
          const nameFromPath =
            $os.platform === 'windows'
              ? file.path.split('\\')
              : file.path.split('/');

          const actualName = showFullPath.get()
            ? file.path
            : (nameFromPath.pop() ?? 'Failed to get anime name');

          return tray.div(
            [
              tray.div(
                [
                  tray.text(
                    '> ' + actualName + ' (' + formatBytes(file.size) + ')',
                  ),
                ],
                { className: 'flex-1' },
              ),
            ],
            {
              className: 'flex justify-between items-center px-2 text-xs',
            },
          );
        });

        contentItems.push(
          tray.stack(fileList, { className: 'flex flex-col overflow-x-auto' }),
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
                  className: 'delep-text-muted text-center',
                },
              ),
            ],
            {
              className:
                'flex flex-col items-center justify-center h-full py-8 space-y-4',
            },
          ),
        );
      }

      const contentArea = tray.stack([
        tray.div(contentItems, {
          className:
            'bg-slate-900 rounded-lg py-4 font-mono text-sm text-emerald-400 border-2 border-emerald-500 my-2 delep-content-area',
        }),
      ]);

      const footerItems: any[] = [];

      if (isDeleting.get()) {
        footerItems.push(
          tray.text(
            'Deleting... ' +
              deletionProgress.get() +
              '/' +
              filesToDelete.get().length,
            {
              className: 'text-sm animate-pulse mr-auto',
            },
          ),
        );
      } else {
        footerItems.push(tray.div([], { className: 'flex-1' }));
      }

      const hasFiles = filesToDelete.get().length > 0;
      const isBusy = isScanning.get() || isDeleting.get();

      footerItems.push(
        tray.button({
          label: 'Cancel',
          intent: 'gray',
          disabled: !hasFiles || isBusy,
          onClick: cancelHandlerId,
        }),
      );

      footerItems.push(
        tray.button({
          label: 'Delete All',
          intent: 'alert',
          disabled: !hasFiles || isBusy,
          onClick: deleteHandlerId,
        }),
      );

      const footer = tray.div(footerItems, {
        className: 'flex items-center gap-2',
      });

      return tray.div([tabBar, header, contentArea, footer]);
    }

    // ------------------------------------------------------------------------
    // Settings Tab Content
    // ------------------------------------------------------------------------
    else {
      const settingsContent = tray.stack(
        [
          tray.div([
            tray.div([
              tray.text(
                'Make sure to save your settings after changing them!',
                {
                  className: 'text-xs delep-text-red text-center',
                },
              ),
            ]),
          ]),
          // Ignore Locked Files
          tray.div([
            tray.div(
              [
                tray.checkbox('Ignore Locked Files', {
                  fieldRef: ignoreLockedRef,
                }),
                tray.text('Skip files that are marked as locked', {
                  className: 'text-xs delep-text-muted',
                }),
              ],
              { className: 'flex flex-col gap-0' },
            ),
          ]),

          // Show Full Path
          tray.div([
            tray.div(
              [
                tray.checkbox('Show Full Path', {
                  fieldRef: showFullPathRef,
                }),
                tray.text('Display full file paths in the file list', {
                  className: 'text-xs delep-text-muted',
                }),
              ],
              { className: 'flex gap-0 flex-col mb-2' },
            ),
          ]),

          // Custom Episode Store Path
          tray.div(
            [
              tray.text('Custom Episode Store Path', {
                className: 'text-sm font-semibold mb-1',
              }),
              tray.text(
                'Filter the scanned files by custom path. Keep in mind that this does not change the actual scanning path as this is only used for filtering.',
                {
                  className: 'text-xs delep-text-muted mb-2',
                },
              ),
              tray.input({
                placeholder: 'e.g., /path/to/episodes',
                fieldRef: customEpisodeStorePathRef,
              }),
            ],
            { className: 'flex flex-col mb-2' },
          ),

          // Exclude List
          tray.div(
            [
              tray.text('Exclude List', {
                className: 'text-sm font-semibold mb-1',
              }),
              tray.text(
                'Anime to exclude from deletion (this will filter the downloaded file name & the check is case-insensitive)',
                {
                  className: 'text-xs delep-text-muted mb-2',
                },
              ),

              // Add new path section
              tray.div(
                [
                  tray.input({
                    placeholder: 'Enter anime to exclude',
                    fieldRef: newExcludePathRef,
                  }),
                  tray.button({
                    label: 'Add',
                    intent: 'primary-subtle',
                    onClick: ctx.eventHandler('add-to-exclude', function () {
                      const path = newExcludePathRef.current.trim();
                      console.log(path);
                      if (path === '') return;

                      if (path && !excludeList.get().includes(path)) {
                        // excludeListRef.current.push(path);
                        excludeList.set([...excludeList.get(), path]);
                        newExcludePathRef.setValue('');
                        tray.update();
                      }
                    }),
                  }),
                ],
                { className: 'flex gap-2' },
              ),

              // Existing paths list
              excludeList.get().length > 0
                ? tray.stack([
                    tray.div(
                      excludeList.get().map(function (path, index) {
                        return tray.div(
                          [
                            tray.text(path, {
                              className: 'text-xs flex-1 truncate',
                            }),
                            tray.button({
                              label: 'Remove',
                              intent: 'alert-subtle',
                              onClick: ctx.eventHandler(
                                `remove-from-exclude-${index}`,
                                function () {
                                  excludeList.set(
                                    excludeList
                                      .get()
                                      .filter((_, i) => i !== index),
                                  );
                                  tray.update();
                                },
                              ),
                              size: 'xs',
                            }),
                          ],
                          {
                            className: 'flex items-center gap-2 p-2',
                          },
                        );
                      }),
                      {
                        className: 'delep-exclude-list-area rounded-lg mt-2',
                      },
                    ),
                  ])
                : tray.text('No anime excluded', {
                    className: 'text-xs delep-text-muted italic',
                  }),
            ],
            { className: 'flex flex-col' },
          ),

          // Save Button
          tray.div(
            [
              tray.button({
                label: 'Save Settings',
                intent: 'primary',
                onClick: saveSettingsHandler,
                className: 'w-full',
              }),
            ],
            { className: 'flex w-full' },
          ),
        ],
        { className: 'flex flex-col gap-6' },
      );

      return tray.div([tabStyle, tabBar, settingsContent]);
    }
  });
});
