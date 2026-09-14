import * as vscode from 'vscode';
import { deriveColors, normalizeHex, randomColor } from './color';
import { LivePicker } from './livePicker';

const palette = [
  ['Green', '#34845B'], ['Teal', '#168577'], ['Cyan', '#36AEC4'],
  ['Blue', '#3478C6'], ['Indigo', '#5854AD'], ['Purple', '#8956AE'],
  ['Magenta', '#B54B91'], ['Red', '#C44E52'], ['Orange', '#DD8438'],
  ['Amber', '#D8A33C'], ['Yellow', '#E6D05A'], ['Olive', '#858B42'],
  ['Fern', '#426B55'], ['Lagoon', '#34766F'], ['Glacier', '#9DC8D3'],
  ['Denim', '#486D9B'], ['Dusk', '#969AC6'], ['Iris', '#B9A2CC'],
  ['Rosewood', '#CB9CAF'], ['Clay', '#D99787'], ['Terracotta', '#BD7B52'],
  ['Ochre', '#C7AD7C'], ['Butter', '#E9DDA6'], ['Moss', '#A5B58A']
];
const managedKeys = ['statusBar.background', 'statusBar.foreground', 'statusBarItem.hoverBackground'];

function requireWorkspace(): void {
  if (!vscode.workspace.workspaceFile && !vscode.workspace.workspaceFolders?.length) {
    throw new Error('Open a folder or workspace before using this command.');
  }
}

function currentColor(): string | undefined {
  // Read only the workspace layer: never adopt a global project identity.
  const value = vscode.workspace.getConfiguration('livery').inspect<unknown>('baseColor')?.workspaceValue;
  return value === undefined || value === '' ? undefined : normalizeHex(value);
}

function workspaceColors(): Record<string, unknown> | undefined {
  const existing = vscode.workspace.getConfiguration('workbench').inspect<unknown>('colorCustomizations')?.workspaceValue;
  if (existing !== undefined && (existing === null || typeof existing !== 'object' || Array.isArray(existing))) {
    throw new Error('Workspace workbench.colorCustomizations must be a JSON object. Fix it before applying or resetting colors.');
  }
  return existing as Record<string, unknown> | undefined;
}

async function writeManagedColors(colors: Record<string, unknown>, preserveEmpty = false): Promise<void> {
  requireWorkspace();
  const config = vscode.workspace.getConfiguration('workbench');
  const existing = workspaceColors();
  const merged = { ...existing };
  for (const key of managedKeys) {
    if (Object.prototype.hasOwnProperty.call(colors, key)) { merged[key] = colors[key]; }
    else { delete merged[key]; }
  }
  const value = Object.keys(merged).length || preserveEmpty ? merged : undefined;
  if (JSON.stringify(existing) !== JSON.stringify(value)) {
    await config.update('colorCustomizations', value, vscode.ConfigurationTarget.Workspace);
  }
}

async function updateColors(base?: string): Promise<void> {
  await writeManagedColors(base ? deriveColors(base) : {});
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let livePicker: LivePicker | undefined;
  // Serialize writes so command and settings-change updates cannot overwrite each other.
  let pending: Promise<void> = Promise.resolve();
  const enqueue = (action: () => Promise<void>): Promise<void> => {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  };
  const report = (error: unknown) => {
    void vscode.window.showErrorMessage(`Livery: ${error instanceof Error ? error.message : String(error)}`);
  };
  const apply = (input: string) => enqueue(async () => {
    requireWorkspace();
    const color = normalizeHex(input);
    // Validate/update the object before storing the base so malformed settings are preserved.
    await updateColors(color);
    await vscode.workspace.getConfiguration('livery').update('baseColor', color, vscode.ConfigurationTarget.Workspace);
  });
  const register = (name: string, action: () => Promise<void>) => {
    context.subscriptions.push(vscode.commands.registerCommand(`livery.${name}`, async () => {
      try { requireWorkspace(); await action(); } catch (error) { report(error); }
    }));
  };
  register('chooseColor', async () => {
    await livePicker?.cancel();
    let current: string | undefined;
    try { current = currentColor(); } catch (error) { report(error); }
    const items: (vscode.QuickPickItem & { hex?: string })[] = palette.map(([name, hex]) => ({
      label: name, description: `${hex}${current === hex ? ' · Current' : ''}`, hex,
      iconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'palette', `${hex.slice(1)}.svg`)
    }));
    items.push({ label: 'Custom Color...', description: current && !palette.some(([, hex]) => hex === current)
      ? `${current}` : '' });
    let custom = false;
    await enqueue(async () => {
      const original = workspaceColors();
      const snapshot = { ...original };
      let previews: Promise<void> = Promise.resolve();
      let revision = 0, closed = false, committed = false;
      try {
        const selected = await vscode.window.showQuickPick(items, {
          title: 'Livery: Choose Color',
          placeHolder: `${current ? `Current color: ${current} · ` : ''}Arrow keys preview · Enter applies · Escape cancels`,
          matchOnDescription: true,
          onDidSelectItem: item => {
            const hex = items.find(candidate => candidate === item)?.hex;
            const requested = ++revision;
            previews = previews.then(async () => {
              if (closed || requested !== revision) { return; }
              if (hex) { await updateColors(hex); }
              else { await writeManagedColors(snapshot, original !== undefined); }
            }).catch(report);
          }
        });
        closed = true;
        await previews;
        if (selected?.hex) {
          await updateColors(selected.hex);
          await vscode.workspace.getConfiguration('livery').update('baseColor', selected.hex, vscode.ConfigurationTarget.Workspace);
          committed = true;
        } else { custom = selected !== undefined; }
      } finally {
        closed = true;
        await previews;
        if (!committed) { await writeManagedColors(snapshot, original !== undefined); }
      }
    });
    if (custom) {
      if (!livePicker) { livePicker = new LivePicker(report); context.subscriptions.push(livePicker); }
      const original = workspaceColors();
      const snapshot = { ...original };
      await livePicker.open(current ?? '#34845B',
        hex => enqueue(() => updateColors(hex)), apply,
        () => enqueue(() => writeManagedColors(snapshot, original !== undefined)));
    }
  });
  register('randomColor', async () => {
    await livePicker?.cancel();
    let current: string | undefined;
    try { current = currentColor(); } catch { /* Random also repairs an invalid base setting. */ }
    await apply(randomColor(current));
  });
  register('reset', async () => {
    await livePicker?.cancel();
    await enqueue(async () => {
    await updateColors();
    await vscode.workspace.getConfiguration('livery').update('baseColor', undefined, vscode.ConfigurationTarget.Workspace);
    });
  });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('livery.baseColor')) {
      void (async () => {
        await livePicker?.cancel();
        await enqueue(async () => {
        if (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) { await updateColors(currentColor()); }
        });
      })().catch(report);
    }
  }));
  try {
    if (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) {
      const base = currentColor();
      if (base) { await enqueue(() => updateColors(base)); }
    }
  } catch (error) { report(error); }
}
