# PDF Translator

Open a PDF, translate selected text instantly in a side panel, or translate the
whole page and read it next to the original.

## Deploy on Vercel

The repository includes a ready-to-import Vercel configuration:

* `static/` is the published website, including the bundled PDF.js assets and
  their license files. Keep the whole `static/vendor/` folder in GitHub.
* `api/translate.py` handles `POST /api/translate`, sharing the local translation
  implementation and streaming paragraphs as NDJSON.
* `api/health.py` handles `GET /api/health`.
* `vercel.json` selects the static output, Python function limits, and response
  headers. No frontend build or third-party Python runtime packages are required.
* `.gitignore` excludes Python caches, local environments, personal PDFs, and
  dictionary exports. `.vercelignore` keeps local service tools and tests out of
  the deployment upload. GitHub Actions runs the regression suite on pushes/PRs.

Push this project folder to GitHub, then import the repository in Vercel:

1. Choose **Other** for the framework preset if Vercel asks.
2. Set **Root Directory** to the directory containing `vercel.json` (repository
   root if you upload this folder as its own repository).
3. Leave the build command empty and use `static` as the output directory;
   these values are already set in `vercel.json`.
4. Deploy. No API keys or additional environment variables are required for
   the current public translation providers.
5. Open the deployed website and translate a selection, then try a translated
   page. Check `/api/health` and function logs if translation fails. Python
   streaming and actual provider access must be checked on the live deployment.

The local `pdftr` service is optional and does not run on Vercel. Translation
caches/queues are temporary and separate for each hosted function instance;
user data is stored in the visitor's browser. Selected text passes through
Vercel to Google/MyMemory; PDFs are not uploaded. Public provider endpoints can
throttle or block hosted traffic, so a successful build does not guarantee their
availability. For a broadly shared deployment, configure Vercel firewall/rate
limits or access protection as appropriate; origin checks are not authentication
and the app currently has no account system or shared rate-limit database.

Your localhost, preview URLs, and production domain each have separate browser
storage. Export a JSON backup from the local app and import it on your final
production domain to move dictionaries and bookmarks. Recent PDF copies and
folder permissions must be selected again. Keep a stable production domain.
Browsers still require explicit user permission to browse local source folders.

Official references: [Python file-based functions](https://vercel.com/docs/functions/runtimes/python/api-directory),
[Python runtime](https://vercel.com/docs/functions/runtimes/python), and
[Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).

## Run as a service

Install the `pdftr` command and user service once from your desktop terminal:

```
./pdftr install --start
```

No sudo or Python packages are needed. The installer places the command in
`~/.local/bin` and creates `~/.config/systemd/user/pdftr.service`.

```
pdftr                         # Start in background and open the browser
pdftr on                      # Same as start
pdftr off                     # Stop (also: pdftr stop)
pdftr restart                 # Restart and open the browser
pdftr status                  # Service state, login startup setting, and URL
pdftr open                    # Open the already-running reader
pdftr logs                    # Last 50 log lines
pdftr logs --follow --lines 100
pdftr enable                  # Start automatically at login
pdftr disable                 # Turn off login startup
pdftr --help                  # All commands and options
pdftr start --help            # Help for a particular command
```

Options:

* `start` / `on`, `restart`: `--port PORT` and `--no-browser`.
  `pdftr` without a command starts the service; `pdftr --no-browser` works too.
* `logs`: `--follow` / `-f` and `--lines COUNT` / `-n COUNT`. Ctrl+C exits the log
  viewer while the service keeps running.
* `install`: `--bin-dir DIR` (default `~/.local/bin`), `--port PORT`, `--enable`,
  `--start`, and `--no-browser`. Without `--start`, installation does not start
  the service. Without `--enable`, it does not enable login startup.
* `run`: `--port PORT` and `--no-browser`; runs in the foreground without systemd.
  Stop it with Ctrl+C.
* `uninstall`: stops and removes the service and installed command, keeping
  saved browser data, dictionaries, and port configuration.
* Every command supports `--help` / `-h`.

The service remembers its port in `~/.local/state/pdftr/service.env` (initially
8765). To change a running service’s port, use `pdftr restart --port 9000`.
It fails visibly if the port is occupied instead of moving to a different
address. Keep the same port to access your browser’s existing library and
saved dictionaries. Close any older manually launched copy before starting the
service on the same port. The project directory must remain in place.

The command honors `XDG_CONFIG_HOME` and `XDG_STATE_HOME` if set. If `~/.local/bin`
is not on your shell’s PATH, add it or use `~/.local/bin/pdftr` directly.

## Run in the foreground

```
./pdftr run
# Or:
python app.py
```

Needs Python 3.8+ and nothing else (no `pip install`). The browser opens at
http://127.0.0.1:8765/ . Stop with Ctrl+C. Direct app options: `--port 9000`,
`--no-browser`, `--strict-port`, and `--help`. Without `--strict-port`, the direct
app command can choose another free port. Service management requires Linux
with a systemd user session; foreground mode works without it.

## Using it

1. **Open PDF** (or drag a file onto the window, or Ctrl+O). Use **Library**
   to reopen recent PDFs or browse a chosen source folder.
2. Pick the languages at the top. "Detect language" is fine for the source.
3. **Selection panel** (on by default): select any text in the PDF – the
   translation appears in the side panel automatically. Earlier selections are
   kept below it. Click the grey original text to expand it.
4. **Translated page**: use the three buttons
   - *Original* – only the PDF page
   - *Side by side* – PDF page + translated page next to each other
   - *Translated page* – only the translation
   Hover over a translated paragraph to see its original text.
5. Click **☆** next to a translated selection to save it to the current book’s
   dictionary. Click **★** again to remove it. Earlier selections can be starred too.
6. Open **Dictionary** in the toolbar (or **Saved dictionary** in the side panel)
   to see each saved word or phrase with its original and translated text,
   both language names, and a link to its source page. Use **Translate** to
   return to the selection panel.
7. Scroll continuously through the book with the mouse wheel, trackpad, scrollbar,
   or PageUp / PageDown. The page number follows your reading position. Use
   ← / → or enter a page number to jump, and zoom with + / − or "Fit".
   Pages near the viewport render on demand; distant canvas buffers are released.
   Original, side-by-side, and translated views all support continuous scrolling.

## App settings and speech

Click **Settings** in the toolbar. Preferences save automatically in the current
browser and site address; **Reset preferences** keeps your books and dictionary.

* **Speech:** enable/disable playback, choose automatic reading of original,
  translation, or both, and adjust speed and volume. Choose **Voice language**
  first, then a voice for that language. Preferences are saved per language so
  original and translated text use appropriate voices. Use **Test voice**,
  **Refresh voices**, and **Stop speech** to check playback.
* **Copy:** choose translation only, original selection only, or both on separate
  lines. Language labels are optional. Selection and dictionary Copy buttons
  use the same setting.
* **Reading:** enable automatic translation of highlights or use **Translate
  selection** manually. Adjust translated text size, selection-history length,
  remembering the reading page, saving recent PDFs, and saving context with
  new dictionary entries. Disabling saving does not delete existing items.

**If Hear translation is silent:** check **Settings → Speech**. The app waits
for voices to load, selects a voice matching the text language, and reports
missing voices or playback failures. If no voice is available for your language,
install/enable a voice supported by your browser and operating system, then
restart the browser and refresh voices. On Linux this may also require a working
speech-dispatcher setup. Automatic playback can be blocked by the browser; click
**Hear translation** or **Test voice** to initiate playback directly. Browser
speech support and language availability vary; the app does not supply a remote
text-to-speech service.

## PDF Library

Click **Library** in the toolbar:

* **Recently opened:** reopen a PDF directly without finding it again in the
  file picker. Up to 10 PDFs, within 150 MB total, are kept in browser IndexedDB.
  Opening a book again updates its recent entry. Older copies are evicted as
  needed. **Remove** deletes only that recent PDF copy, keeping its dictionary
  and bookmarks.
* **Source folder:** choose a folder and browse its PDFs, including subfolders.
  Search by filename or relative path, then click a PDF to open it. The app
  lists up to 2,000 PDFs to keep large folders manageable.
* Browsers with the directory-access API can remember the folder handle.
  **Reconnect folder** restores permission when needed; **Refresh folder**
  rescans its contents. Other browsers use **Choose files from folder** and
  require choosing the folder again after a reload.

Folder browsing does not copy the entire folder. Only PDFs you open are added
as recent copies. Recent PDFs stay on this computer, use the same browser and
server address/port, and are removed if browser site data is cleared or evicted.
If persistent storage is unavailable or full, newly opened PDFs remain accessible
from the library for the current session. PDFs over 150 MB can still be opened,
but are not retained in the recent list. JSON dictionary backups do not include
these stored PDF copies or folder permissions.

## Reading and vocabulary tools

Open **Dictionary** to use these tools. They add no dependencies or paid services.

* **Search and language filter:** search original words, translations, saved
  context, or book names. Choose **This book** or **All books**.
* **Context:** newly saved selections include an excerpt from their original
  paragraph when PDF text extraction can locate it. Older entries remain usable.
* **Pronunciation:** use **Hear original** or **Hear translation**. Available
  languages and voices depend on your browser and system; an unavailable voice
  displays a message rather than preventing reading.
* **Practice:** practice the visible dictionary entries as shuffled flashcards.
  Reveal each translation, then choose **Remembered** or **Forgot**. Counts are
  saved with each word. Changing filters starts a new practice session.
* **Bookmarks & notes:** save the current page with an optional note. Click its
  page button to return and load the note for editing, then save it again to
  update. Bookmarks remain separate for each book.
* **Back up all books:** download JSON containing dictionaries, context, practice
  counts, book names, and bookmarks. PDFs themselves are not included.
* **Import backup:** restore this app’s JSON backups (up to 5 MB). Existing words
  and notes are kept when the same entry or page already exists.
* **Export list CSV:** export the currently filtered list for spreadsheets or
  flashcard tools. JSON is the format used for restoring data into this app.

These tools use browser storage. Keep JSON backups if you want to move your
vocabulary to another browser or preserve it before clearing browser data.
OCR for scanned documents is not included.

## Notes

* Translation uses Google's public endpoint (MyMemory as a fallback), so you
  must be online. Only selected/page text is sent through the app server to
  translation providers; the PDF stays in your browser.
* The translated page is rebuilt from the page's text (headings and paragraphs),
  not from its layout: tables, columns and images are not reproduced.
* Scanned PDFs (pictures of text) have no selectable text, so nothing can be
  translated – OCR is not included.
* Dictionaries are saved in this browser’s local storage, separately for each
  PDF fingerprint. Reopening or renaming the same PDF restores its saved words;
  clearing browser data removes them. Use the same browser and local server
  address/port to access saved dictionaries. They are not synced across devices.
* PDF rendering by PDF.js (bundled in `static/vendor`, Apache-2.0).

## Translation responsiveness

Page paragraphs appear as their translations finish. Zooming, resizing, or
returning to a page reuses pending work, and identical requests share an
in-progress server translation. Provider work uses four shared workers with a bounded queue. Selected text has
priority over queued page work. Changing pages cancels obsolete requests and
releases queued jobs; provider calls already running may finish and populate
the cache. Streaming updates individual paragraphs without rebuilding the page.
Long paragraphs are split into bounded requests and reassembled for display.
Completed translations remain cached in memory until the app is restarted.
If some paragraphs fail, successful translations stay visible and **Try again**
retries the page using cached successes.

Run the offline regression checks (Node.js is needed only for the frontend check):

```
python -m unittest discover -s tests -v
node tests/test_frontend.cjs
node tests/test_dictionary.cjs
node tests/test_reader.cjs
node tests/test_library.cjs
node tests/test_preferences.cjs
```
