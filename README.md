# WebStorage → LocalStorage Converter for Construct 2

Converts a Construct 2 `.capx` using the WebStorage plugin into one using LocalStorage. Runs entirely in the browser — nothing is uploaded.

- Live: https://mkrm0000.github.io/webstorage-to-localstorage-converter-capx-c2/
- Source: https://github.com/mkrm0000/webstorage-to-localstorage-converter-capx-c2

## Usage

1. Open the live page.
2. Drop a `.capx` file.
3. Wait for the log, then click Download.
4. Open the result in Construct 2 and review any WARN lines.

No build step. Serve `index.html`, `style.css`, `capx-to-capx-converter.js` from any static server. JSZip comes from cdnjs.

## What it does

- `project.caproj`: WebStorage plugin becomes LocalStorage; object type and global instance renamed or reused.
- Event sheets: `LocalValue()` → `LocalStorage.ItemValue`; `Set (local|session) value` → `Set item`; `Key exists` → `On item exists` trigger with `Check item exists` action added where needed.
- Untouched sheets are left byte-for-byte. Output matches Construct 2's XML style.

## Known limitations

Reported as WARN lines, not converted:

- `Remove local value` and `Clear local storage` — removed (ACE ids unverified).
- Top-level `Key exists` — trigger emitted without check action; add manually.
- Mixed `OR` blocks with a storage condition — become `AND`.
- Parent object picking — lost inside the async trigger.
- `SessionValue` — mapped to `ItemValue`.
- Read-only events — split into an `On item exists` block, runs one tick later.

## Files

- `index.html` — UI shell, loads JSZip and converter.
- `style.css` — styles.
- `capx-to-capx-converter.js` — converter (zip I/O, event walking, XML writer, log/UI).

## Contributing

Fill in the missing LocalStorage ACE ids in `capx-to-capx-converter.js`:

    removeItem: null,  // id + name
    clear:      null   // id + name

Open an issue with your log's WARN lines and a redacted event snippet.

## License

None included. Open an issue to clarify before reuse.

## Disclaimer

Best-effort mechanical rewrite. Always playtest the output before shipping.