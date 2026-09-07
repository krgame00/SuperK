# Extend the existing system to the manga reading website

The Chrome extension will display translated pages on the original manga website and open the full SuperK workspace when detailed editing is needed. The user accepts keeping the existing SuperK system running; standalone operation without that system is outside the initial release. The first release prioritizes parity of translation and cleaning results rather than reproducing every editing, project-management, and export tool inside the extension.

This scope was confirmed in the first design interview round. It keeps the existing workspace available for detailed work while focusing the extension on reading.

In the second round, the user confirmed that the extension uses SuperK's settings, processes one explicitly selected image at a time, and retains results for later visits with a delete action. Cleaning failure stops that image and offers retry rather than silently substituting white rectangles. Opening an image for editing appends it to the existing workspace instead of creating an independent project. These choices prioritize consistent results, preserve existing workspace pages, and avoid repeat translation merely because the reader reloads a page.

In the final interview round, the user chose to preserve saved reading results after settings changes until explicit retranslation, and to publish editor changes only through a "Send back to reading view" action. This avoids unintended repeat translation and prevents unfinished edits from changing the reading copy. The product decisions are recorded; implementation awaits the final shared-understanding confirmation.
