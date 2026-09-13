# Livery

A small VS Code extension that gives each project its own status bar color. Your chosen RGB background is used **exactly**: `#FFFF00` stays `#FFFF00`. Foreground and hover are generated automatically. No runtime dependencies.

## Use

Open a folder or `.code-workspace`, then run a command from the Command Palette:

- **Livery: Choose Color** — choose Green, Teal, Cyan, Blue, Indigo, Purple, Magenta, Red, Orange, Amber, Yellow, or Olive. Each entry shows its HEX value; the current preset or custom color is marked. Each preset has an SVG color swatch filled with its exact HEX value.
- **Custom Color...** — opens an in-memory Livery Color tab with a HEX value and the native color picker. Editing the value previews the status bar immediately, without Ctrl+S. Apply above the value commits the color; Cancel or closing the tab restores the original appearance. Invalid or incomplete HEX input leaves the last valid preview visible. The document is never written to disk.
- **Livery: Random Color** — generates an RGB color, avoiding very dark colors and perceptually similar selections when practical.
- **Livery: Reset** — removes the three managed workspace color tokens and the base setting; other settings survive. User/theme defaults become visible again.

Custom selection uses a document color provider and an editable in-memory filesystem, with no webview. Color decorators must be enabled; Apply Preview and Cancel Preview are also available in the Command Palette if CodeLens is disabled. Changes are previewed when the native picker edits the HEX text; whether this happens during dragging or on mouse release depends on VS Code. Preview writes the three workspace color tokens temporarily, while the base setting changes only on Apply.

## Settings and colors

Moving through presets in QuickPick previews the status bar immediately. Enter confirms the color; Escape or closing the list restores the original three workspace token values. Focusing Custom Color also restores the original appearance before opening its picker on confirmation. Preview temporarily writes workspace color customizations, but `livery.baseColor` changes only on confirmation. Unrelated color settings are preserved during rollback.

`livery.baseColor` is read and written at **Workspace** scope. Folder projects store it in `.vscode/settings.json`; multi-root projects store it in the `.code-workspace` settings. Commands never write User settings, and User-level base colors are ignored. VS Code's `window` setting scope allows workspace configuration but cannot hide the setting from the User settings UI.

Only these entries in workspace `workbench.colorCustomizations` are managed:

```json
{
  "livery.baseColor": "#FFFF00",
  "workbench.colorCustomizations": {
    "statusBar.background": "#FFFF00",
    "statusBar.foreground": "#171709",
    "statusBarItem.hoverBackground": "#E4E400"
  }
}
```

The extension merges into the existing workspace object and preserves unrelated entries, including nested theme overrides. It does not copy User settings into the workspace. Malformed customization objects are reported and left untouched. Reset removes managed values rather than restoring previous values of those same keys.

Foreground selection compares WCAG contrast for near-black and near-white, falling back to black or white when needed to reach 4.5:1 against the base. The foreground then receives a restrained OKLCH tint from the base hue, adjusting lightness and reducing chroma until it preserves at least 85% of neutral contrast and at least 4.5:1. Neutral backgrounds keep neutral text. For example, #344D42 produces #D0E8DD text (7.12:1 contrast). Hover shifts OKLCH lightness, keeping hue and reducing chroma only to fit sRGB. Near-black colors receive a larger lightness step so hover stays visible. Color conversion follows [Björn Ottosson's Oklab matrices](https://bottosson.github.io/posts/oklab/).

Colors are theme-independent. Manual edits to the workspace base setting synchronize immediately; removing it or setting it to an empty string clears the three managed tokens. Activation synchronizes an existing base after startup. No reload is needed for changes.

Existing theme-specific overrides for these tokens can take precedence; the extension deliberately preserves those nested objects. Debugging and status items with their own warning/error/remote colors can also override the normal status bar appearance because their separate tokens are not modified.

## Development and verification

```sh
npm install
npm run typecheck
npm run build
npm test
```

Press F5 to launch an Extension Development Host. Open a folder there, run Choose Color, test Custom Color, editing through its native swatch without saving, Apply/Cancel, closing the tab, and invalid HEX, and check the status bar without reloading. Repeat with a multi-root `.code-workspace`; confirm settings land in its `settings` object. Add unrelated color entries before testing Reset.

Automated tests cover all eight requested sample colors, hue/lightness behavior, HEX validation, conversion round trips and AA foreground contrast over 4,096 RGB samples. A mocked VS Code host checks workspace targets, preservation, reset, startup/manual synchronization, invalid settings, and no-workspace behavior. These mocks do not constitute visual or real Extension Development Host verification.
