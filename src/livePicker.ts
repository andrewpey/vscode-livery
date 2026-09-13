import * as vscode from 'vscode';
import { hexToRgb, normalizeHex, rgbToHex } from './color';

const scheme = 'livery-preview';
const instructions = '\n// Hover over the color swatch to pick a color. Preview updates instantly.\n'
  + '// Click Apply above the color to keep it, or Cancel to undo. No saving needed.\n';

export function readPreviewColor(text: string): string | undefined {
  try { return normalizeHex(text.replace(/^[\t ]*\/\/.*$/gm, '').trim()); } catch { return undefined; }
}

// This editable file exists only in memory. Even Ctrl+S never writes it to disk.
export class LivePicker implements vscode.Disposable {
  private readonly uri = vscode.Uri.parse(`${scheme}:/Livery Color`);
  private content: Uint8Array = new TextEncoder().encode('#34845B\n');
  private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly disposables: vscode.Disposable[] = [];
  private session?: {
    document: vscode.TextDocument;
    preview: (hex: string) => Promise<void>;
    apply: (hex: string) => Promise<void>;
    rollback: () => Promise<void>;
  };
  private writes: Promise<void> = Promise.resolve();
  private finishing = false;

  constructor(private readonly report: (error: unknown) => void) {
    this.disposables.push(this.changed, vscode.workspace.registerFileSystemProvider(scheme, {
      onDidChangeFile: this.changed.event,
      stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: this.content.length }),
      readFile: () => this.content,
      writeFile: (_uri, content) => { this.content = content; },
      readDirectory: () => [],
      watch: () => new vscode.Disposable(() => {}),
      createDirectory: () => { throw vscode.FileSystemError.NoPermissions(); },
      delete: () => { throw vscode.FileSystemError.NoPermissions(); },
      rename: () => { throw vscode.FileSystemError.NoPermissions(); }
    }, { isCaseSensitive: true }));
    this.disposables.push(vscode.languages.registerColorProvider({ scheme }, {
      provideDocumentColors: document => {
        const hex = readPreviewColor(document.getText());
        if (!hex) { return []; }
        const match = /^([\t ]*)(#[\da-f]{3}(?:[\da-f]{3})?)[\t ]*\r?$/im.exec(document.getText());
        if (!match) { return []; }
        const start = match.index + match[1].length;
        const range = new vscode.Range(document.positionAt(start), document.positionAt(start + match[2].length));
        const [r, g, b] = hexToRgb(hex);
        return [new vscode.ColorInformation(range, new vscode.Color(r, g, b, 1))];
      },
      provideColorPresentations: (color, { range }) => {
        const hex = rgbToHex([color.red, color.green, color.blue]);
        const presentation = new vscode.ColorPresentation(hex);
        presentation.textEdit = vscode.TextEdit.replace(range, hex);
        return [presentation];
      }
    }));
    this.disposables.push(vscode.languages.registerCodeLensProvider({ scheme }, {
      provideCodeLenses: () => [
        new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), { title: 'Apply', command: 'livery.applyPreview' }),
        new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), { title: 'Cancel', command: 'livery.cancelPreview' })
      ]
    }));
    this.disposables.push(
      vscode.commands.registerCommand('livery.applyPreview', () => this.finish(true).catch(report)),
      vscode.commands.registerCommand('livery.cancelPreview', () => this.cancel().catch(report)),
      vscode.workspace.onDidChangeTextDocument(event => {
        const session = this.session;
        if (!session || this.finishing || event.document !== session.document || !event.contentChanges.length) { return; }
        const hex = readPreviewColor(event.document.getText());
        this.writes = this.writes.then(async () => {
          if (this.session !== session) { return; }
          if (hex) { await session.preview(hex); }
          // Keep the tab clean without touching the filesystem, so closing needs no Save As.
          await session.document.save();
        }).catch(report);
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => {
        if (this.session && !this.finishing && !this.tabs().length) { void this.cancel().catch(report); }
      })
    );
  }

  async open(initial: string, preview: (hex: string) => Promise<void>,
    apply: (hex: string) => Promise<void>, rollback: () => Promise<void>): Promise<void> {
    await this.cancel();
    this.content = new TextEncoder().encode(`${normalizeHex(initial)}\n${instructions}`);
    this.changed.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
    const document = await vscode.workspace.openTextDocument(this.uri);
    // A previously closed document can still be cached by VS Code.
    if (document.getText() !== new TextDecoder().decode(this.content)) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(this.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        new TextDecoder().decode(this.content));
      if (!await vscode.workspace.applyEdit(edit)) { throw new Error('Could not prepare the color preview.'); }
      await document.save();
    }
    this.session = { document, preview, apply, rollback };
    try { await vscode.window.showTextDocument(document, { preview: false }); }
    catch (error) { this.session = undefined; throw error; }
  }

  private tabs(): vscode.Tab[] {
    return vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
      tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === this.uri.toString());
  }

  cancel(): Promise<void> { return this.finish(false); }

  private async finish(apply: boolean): Promise<void> {
    const session = this.session;
    if (!session || this.finishing) { return; }
    const hex = readPreviewColor(session.document.getText());
    if (apply && !hex) { throw new Error('Enter a valid HEX color before applying.'); }
    this.finishing = true;
    try {
      await this.writes;
      if (apply) { await session.apply(hex!); } else { await session.rollback(); }
      this.session = undefined;
      await session.document.save();
      const tabs = this.tabs();
      if (tabs.length) { await vscode.window.tabGroups.close(tabs, true); }
    } finally { this.finishing = false; }
  }

  dispose(): void { for (const disposable of this.disposables) { disposable.dispose(); } }
}
