# WebStorage → LocalStorage Converter for Construct 2

A browser-based tool that converts a Construct 2 `.capx` project using the WebStorage plugin into one using LocalStorage. It patches the project file and every event sheet inside the zip. Nothing is uploaded — all processing happens in your browser.

- Live app: https://mkrm0000.github.io/webstorage-to-localstorage-converter-capx-c2/
- Source: https://github.com/mkrm0000/webstorage-to-localstorage-converter-capx-c2

## Usage

1. Open the live page.
2. Drop a `.capx` file onto the drop zone, or click to choose one.
3. Wait for the log to finish.
4. Click Download to get `<name>_LocalStorage.capx`.
5. Open the result in Construct 2 and review any WARN lines in the log.

To run locally, serve `index.html`, `style.css` and `capx-to-capx-converter.js` from any static server. There is no build step. JSZip is loaded from cdnjs.

## What it changes

- In `project.caproj`, the WebStorage plugin entry becomes LocalStorage. The object type and its global instance are renamed, or replaced by an existing LocalStorage object if one is present.
- In each event sheet XML:
  - `WebStorage.LocalValue("key")` becomes `LocalStorage.ItemValue`.
  - `Set local value` and `Set session value` become `Set item`.
  - `WebStorage.Key exists` conditions are converted into `On item exists` triggers, with a `Check item exists` action added where needed.
- Sheets that do not reference WebStorage are left untouched. The zip is repacked in Construct 2's XML style (4-space indent, CRLF, UTF-8 BOM).

## What it does not change

These cases are reported as WARN lines in the log and left for you to fix:

- `Remove local value` and `Clear local storage` actions are removed, because their LocalStorage ACE ids have not been verified. See Contributing below.
- A `Key exists` condition at the top of a sheet produces a trigger without a check action; add it manually.
- Mixed `OR` blocks containing a storage condition become `AND`.
- Object picking in the parent event does not carry over into the async `On item exists` trigger.
- `SessionValue` is mapped to `ItemValue`, since LocalStorage has no session equivalent.
- Events that only read a stored value are moved into an `On item exists` block, which runs one tick later than the original. Review anything that relied on the value being available immediately.

## Files

| File | Role |
|---|---|
| `index.html` | UI shell, loads JSZip and the converter. |
| `style.css` | Styling for the drop zone, status badge and log. |
| `capx-to-capx-converter.js` | The converter itself: zip I/O, event-tree walking, XML serialization, log/UI wiring. Exposes `walk`, `toXml`, `kid` and `kids` for Node testing. |

## Deploying

Any static host works. For GitHub Pages, push the three files to a branch and set Settings → Pages → Deploy from branch → root. No configuration or secrets are needed.

## Contributing

The most useful contribution is filling in the verified LocalStorage ACE ids for the actions currently dropped. In `capx-to-capx-converter.js`:

    const LS = {
      setItem:    { id: '0', name: 'Set item' },
      checkItem:  { id: '3', name: 'Check item exists' },
      onExists:   { id: '0', name: 'On item exists' },
      removeItem: null,   // fill in id + name
      clear:      null    // fill in id + name
    };

If you can open a Construct 2 project with LocalStorage and find the real ids for "Remove item" and "Clear storage", those two actions will convert automatically once the map is updated.

Other welcome fixes: better handling of `OR` blocks, and support for additional WebStorage expressions.

When reporting a bug, include the WARN lines from your log and a redacted snippet of the affected event.

## License

No license file is included. Open an issue if you need a specific license clarified before reuse.

## Disclaimer

This is a best-effort migrator that performs mechanical rewrites only. Always open the output in Construct 2 and playtest before shipping. Your `.capx` never leaves the browser.