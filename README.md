# Workbench

One local web app with three tools:

| Tab | What it does | Where it runs |
|---|---|---|
| **Remove background** | Cuts the subject out of a photo; optional solid background color | In your browser (WebAssembly model) |
| **Convert files** | Images (PNG/JPG/WebP), audio to WAV, CSV and JSON | In your browser |
| **Documents to PDF** | DOCX, XLSX, PPTX, TXT to PDF | On the server, using LibreOffice |

There are no npm dependencies. You need **Node.js 18 or newer**; **LibreOffice** is only needed for the PDF tab.

## Run it

```bash
node server.js
```

Then open the address it prints (http://127.0.0.1:3000). Opening `index.html` directly from disk will not work; use the server.

The terminal tells you whether LibreOffice was found. If it was not, the PDF tab explains what to do, and the other two tabs still work.

### LibreOffice

Download it free from https://www.libreoffice.org/download/download-libreoffice/ (official site only).

If it is installed but not found, set `SOFFICE_BIN` to the full path of `soffice` before starting:

```powershell
# Windows PowerShell
$env:SOFFICE_BIN = "C:\Program Files\LibreOffice\program\soffice.exe"
node server.js
```
```bash
# macOS
SOFFICE_BIN="/Applications/LibreOffice.app/Contents/MacOS/soffice" node server.js
# Linux: sudo apt install libreoffice-writer libreoffice-calc libreoffice-impress
```

You can install LibreOffice while the server is running; click "Check again" on the PDF tab.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `HOST` | 127.0.0.1 | `0.0.0.0` lets other computers connect (see "Hosting") |
| `MAX_FILE_MB` | 25 | Largest file accepted for PDF conversion |
| `CONVERT_TIMEOUT_MS` | 120000 | Stop a conversion that takes longer |
| `SOFFICE_BIN` | soffice | Path to LibreOffice |

## Adding a tool

1. Create `public/js/mytool.js` whose default export is `mount(root)`. It builds its UI inside `root` and may return a cleanup function.
2. Add one line to the `TOOLS` list in `public/js/app.js`.

`public/js/queue.js` provides the file list with per-file convert buttons and downloads; `public/js/shared.js` has the drop zone and helpers.

## Things to know

- **Background removal needs internet the first time.** The library and model (tens of MB) load from a CDN (jsdelivr) and are then cached by the browser. For offline use, host those files yourself.
- **Library license.** The background remover uses `@imgly/background-removal`, which I understand to be AGPL-3.0 with a separate commercial license. Check its license before offering your app publicly or commercially.
- **PDF layout** follows LibreOffice's rendering, which can differ slightly from Microsoft Office, and unavailable fonts are substituted.
- **Browser limits.** Whether WebP encoding or an audio format works depends on the browser.

## Hosting

Built for running on your own computer. Before exposing it to the internet, add login or rate limiting (PDF conversion is CPU-heavy and runs one file at a time), HTTPS through a reverse proxy, and a size limit at the proxy. Uploaded documents are kept in a temporary folder only while they convert and are then deleted.
