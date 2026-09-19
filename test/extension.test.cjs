const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { deriveColors } = require('../out/color');

async function host(kind, initial = {}, global = {}) {
  const values = structuredClone(initial), commands = {}, listeners = [], writes = [], errors = [];
  const documentListeners = [], tabListeners = [], providers = {};
  const tabs = [];
  let previewDocument;
  class Disposable { constructor(fn = () => {}) {this.dispose = fn;} }
  class EventEmitter { event = () => new Disposable(); fire() {} dispose() {} }
  class Range { constructor(...args) {this.args = args;} }
  class TabInputText { constructor(uri) {this.uri = uri;} }
  let picked;
  const api = {
    Disposable, EventEmitter, Range, TabInputText,
    FileType: {File: 1}, FileChangeType: {Changed: 1},
    Uri: { parse: value => ({toString: () => value}), joinPath: (base, ...parts) => require('node:path').join(base, ...parts) },
    languages: {
      registerColorProvider: (_, provider) => {providers.color = provider; return new Disposable();},
      registerCodeLensProvider: (_, provider) => {providers.lens = provider; return new Disposable();}
    },
    Color: class {constructor(red, green, blue, alpha) {Object.assign(this, {red, green, blue, alpha});}},
    ColorInformation: class {constructor(range, color) {Object.assign(this, {range, color});}},
    ColorPresentation: class {constructor(label) {this.label = label;}},
    TextEdit: {replace: (range, newText) => ({range, newText})},
    ConfigurationTarget: { Workspace: 2 },
    workspace: {
      registerFileSystemProvider: (_, provider) => {providers.fs = provider; return new Disposable();},
      onDidChangeTextDocument: listener => {documentListeners.push(listener); return new Disposable();},
      openTextDocument: async uri => {
        let text = new TextDecoder().decode(providers.fs.readFile(uri));
        previewDocument = {uri, getText: () => text, positionAt: offset => offset,
          save: async () => {providers.fs.writeFile(uri, new TextEncoder().encode(text)); return true;},
          change: value => {text = value; for (const listener of documentListeners) listener({document: previewDocument, contentChanges: [{}]});}
        };
        return previewDocument;
      },
      workspaceFolders: kind === 'none' ? undefined : [{name:'one'}, ...(kind === 'multi' ? [{name:'two'}] : [])],
      workspaceFile: kind === 'multi' ? {path:'/sample.code-workspace'} : undefined,
      getConfiguration: section => ({
        inspect: key => ({workspaceValue: values[`${section}.${key}`], globalValue: global[`${section}.${key}`]}),
        update: async (key, value, target) => {
          assert.equal(target, 2); const full = `${section}.${key}`;
          values[full] = value; writes.push(full);
          for (const listener of listeners) listener({affectsConfiguration: name => name === full});
        }
      }),
      onDidChangeConfiguration: listener => {listeners.push(listener); return {dispose(){}};}
    },
    commands: {registerCommand: (name, action) => {commands[name] = action; return {dispose(){}};}},
    window: {
      tabGroups: {all: [{tabs}], onDidChangeTabs: listener => {tabListeners.push(listener); return new Disposable();},
        close: async () => {tabs.length = 0; tabListeners.forEach(listener => listener()); return true;}},
      showTextDocument: async document => {tabs.push({input: new TabInputText(document.uri)});},
      showErrorMessage: message => errors.push(message), showInformationMessage: () => {},
      showQuickPick: async items => { picked = items; return items.find(item => item.hex === '#34845B'); }
    }
  };
  const oldLoad = Module._load;
  Module._load = function(name, ...args) { return name === 'vscode' ? api : oldLoad.call(this, name, ...args); };
  delete require.cache[require.resolve('../out/extension')];
  delete require.cache[require.resolve('../out/livePicker')];
  let extension;
  try { extension = require('../out/extension'); } finally { Module._load = oldLoad; }
  await extension.activate({subscriptions: [], extensionUri: require('node:path').resolve(__dirname, '..')});
  const flush = async () => { for(let i=0;i<5;i++) await new Promise(resolve => setImmediate(resolve)); };
  return {values, writes, errors, api, flush, providers, get document(){return previewDocument;},
    run: async name => {await commands[`livery.${name}`](); await flush();},
    get picked(){return picked;}};
}

for (const kind of ['folder', 'multi']) test(`${kind}: apply, manual changes and reset preserve unrelated workspace settings`, async () => {
  const unrelated = {'editor.background':'#112233', 'activityBar.background':'#445566', '[Dark+]': {'titleBar.activeBackground':'#123456'}};
  const h = await host(kind, {'workbench.colorCustomizations': unrelated});
  await h.run('chooseColor');
  assert.equal(h.values['livery.baseColor'], '#34845B');
  assert.deepEqual(h.values['workbench.colorCustomizations'], {...unrelated, ...deriveColors('#34845B')});
  await h.api.workspace.getConfiguration('livery').update('baseColor', '#FFFF00', 2);
  await h.flush();
  assert.equal(h.values['workbench.colorCustomizations']['statusBar.background'], '#FFFF00');
  await h.run('reset');
  assert.deepEqual(h.values['workbench.colorCustomizations'], unrelated);
  assert.equal(h.values['livery.baseColor'], undefined);
  assert.equal(h.errors.length, 0);
  assert.ok(h.writes.length < 12, 'no configuration update loop');
});

test('QuickPick presets use SVG swatches with their exact HEX fill', async () => {
  const h = await host('folder', {'livery.baseColor': '#34845B'});
  await h.run('chooseColor');
  const presets = h.picked.filter(item => item.hex);
  assert.equal(presets.length, 24);
  for (const item of presets) {
    assert.ok(!item.label.includes('●'));
    const svg = require('node:fs').readFileSync(item.iconPath, 'utf8');
    assert.ok(svg.includes(`fill="${item.hex}"`));
  }
  assert.match(presets.find(item => item.hex === '#34845B').description, /Current/);
  assert.equal(h.picked.at(-1).label, 'Custom Color...');
});

test('startup sync, no global copying, and empty reset', async () => {
  const h = await host('folder', {'livery.baseColor':'#123456'}, {'workbench.colorCustomizations':{'editor.background':'#111111'}});
  assert.deepEqual(h.values['workbench.colorCustomizations'], deriveColors('#123456'));
  await h.run('reset');
  assert.equal(h.values['workbench.colorCustomizations'], undefined);
  const globalOnly = await host('folder', {}, {'livery.baseColor':'#FF0000'});
  assert.equal(globalOnly.writes.length, 0);
});

test('no workspace never writes settings', async () => {
  const h = await host('none');
  for (const command of ['chooseColor','randomColor','reset']) await h.run(command);
  assert.equal(h.writes.length, 0);
  assert.equal(h.errors.length, 3);
});

test('malformed customizations are preserved and invalid base can be repaired', async () => {
  const h = await host('folder', {'workbench.colorCustomizations': 'broken'});
  await h.run('chooseColor'); await h.run('reset');
  assert.equal(h.values['workbench.colorCustomizations'], 'broken');
  assert.equal(h.writes.length, 0);
  assert.equal(h.errors.length, 2);
  const invalid = await host('folder', {'livery.baseColor':'invalid'});
  assert.equal(invalid.errors.length, 1);
  await invalid.run('randomColor');
  assert.match(invalid.values['livery.baseColor'], /^#[A-F0-9]{6}$/);
});

for (const initial of [undefined, {}, {'statusBar.background':'#112233', 'statusBar.inactiveBackground':'#334455', 'editor.background':'#222222'}]) {
  test(`preview cancellation restores original token presence (${JSON.stringify(initial)})`, async () => {
    const h = await host('folder', {'workbench.colorCustomizations':initial});
    h.api.window.showQuickPick = async (items, options) => {
      options.onDidSelectItem(items[0]);
      await h.flush();
      assert.equal(h.values['workbench.colorCustomizations']['statusBar.background'], '#34845B');
      assert.equal(h.values['livery.baseColor'], undefined);
      options.onDidSelectItem(items[3]);
      await h.flush();
      assert.equal(h.values['workbench.colorCustomizations']['statusBar.background'], '#3478C6');
      return undefined;
    };
    await h.run('chooseColor');
    assert.deepEqual(h.values['workbench.colorCustomizations'], initial);
    assert.equal(h.values['livery.baseColor'], undefined);
    assert.equal(h.errors.length, 0);
  });
}

test('preview rollback preserves unrelated edits and focusing Custom restores original colors', async () => {
  const h = await host('multi', {'livery.baseColor':'#344D42'});
  h.api.window.showQuickPick = async (items, options) => {
    options.onDidSelectItem(items[0]);
    await h.flush();
    const config = h.api.workspace.getConfiguration('workbench');
    await config.update('colorCustomizations', {...h.values['workbench.colorCustomizations'], 'editor.background':'#123456'}, 2);
    options.onDidSelectItem(items.at(-1));
    await h.flush();
    assert.deepEqual(h.values['workbench.colorCustomizations'], {...deriveColors('#344D42'), 'editor.background':'#123456'});
    return undefined;
  };
  await h.run('chooseColor');
  assert.equal(h.values['livery.baseColor'], '#344D42');
  assert.equal(h.values['workbench.colorCustomizations']['editor.background'], '#123456');
});

test('rapid preview followed by accept cannot overwrite the confirmed color', async () => {
  const h = await host('folder');
  h.api.window.showQuickPick = async (items, options) => {
    options.onDidSelectItem(items[0]);
    options.onDidSelectItem(items[1]);
    options.onDidSelectItem(items[2]);
    return items[3];
  };
  await h.run('chooseColor');
  assert.equal(h.values['livery.baseColor'], '#3478C6');
  assert.deepEqual(h.values['workbench.colorCustomizations'], deriveColors('#3478C6'));
  assert.equal(h.errors.length, 0);
});

test('setting schema enables native JSON colors while retaining empty and opaque HEX validation', () => {
  const schema = require('../package.json').contributes.configuration.properties['livery.baseColor'];
  assert.ok(schema.anyOf.some(branch => branch.format === 'color-hex'));
  assert.ok(schema.anyOf.some(branch => branch.enum?.includes('')));
  const pattern = new RegExp(schema.pattern);
  for (const value of ['', '#ABC', '#123456']) assert.ok(pattern.test(value));
  for (const value of ['#12345678', '#ABCD', 'red']) assert.ok(!pattern.test(value));
});

for (const kind of ['folder', 'multi']) test(`${kind}: live document previews before saving the base, then Apply commits`, async () => {
  const h = await host(kind, {'livery.baseColor': '#123456'});
  h.api.window.showQuickPick = async items => items.at(-1);
  await h.run('chooseColor');
  assert.ok(h.document.getText().startsWith('#123456\n'));
  assert.ok(h.document.getText().includes('// Click Apply above the color'));
  const colors = h.providers.color.provideDocumentColors(h.document);
  assert.equal(colors.length, 1);
  assert.deepEqual(colors[0].range.args, [0, 7]);
  const presentation = h.providers.color.provideColorPresentations({red: 1, green: 1, blue: 0, alpha: .4}, {range: colors[0].range});
  assert.equal(presentation[0].textEdit.newText, '#FFFF00');
  h.document.change(h.document.getText().replace('#123456', '#FFFF00'));
  await h.flush();
  assert.equal(h.values['workbench.colorCustomizations']['statusBar.background'], '#FFFF00');
  assert.equal(h.values['livery.baseColor'], '#123456');
  h.document.change('#invalid');
  await h.flush();
  assert.equal(h.values['workbench.colorCustomizations']['statusBar.background'], '#FFFF00');
  assert.equal(h.providers.color.provideDocumentColors(h.document).length, 0);
  h.document.change('#ABC');
  await h.run('applyPreview');
  assert.equal(h.values['livery.baseColor'], '#AABBCC');
  assert.equal(h.api.window.tabGroups.all[0].tabs.length, 0);
  assert.equal(h.errors.length, 0);
});

for (const close of [false, true]) test(`live preview rollback on ${close ? 'tab close' : 'Cancel'} preserves unrelated edits`, async () => {
  const h = await host('folder');
  h.api.window.showQuickPick = async items => items.at(-1);
  await h.run('chooseColor');
  assert.equal(h.values['livery.baseColor'], undefined);
  h.document.change('#FF0000');
  await h.flush();
  h.values['workbench.colorCustomizations']['editor.background'] = '#123456';
  if (close) { await h.api.window.tabGroups.close(); await h.flush(); }
  else { await h.run('cancelPreview'); }
  assert.deepEqual(h.values['workbench.colorCustomizations'], {'editor.background': '#123456'});
  assert.equal(h.values['livery.baseColor'], undefined);
  assert.equal(h.errors.length, 0);
});

test('Reset cancels live preview before clearing the base', async () => {
  const h = await host('folder', {'livery.baseColor': '#123456'});
  h.api.window.showQuickPick = async items => items.at(-1);
  await h.run('chooseColor');
  h.document.change('#FF0000');
  await h.run('reset');
  assert.equal(h.values['workbench.colorCustomizations'], undefined);
  assert.equal(h.values['livery.baseColor'], undefined);
  assert.equal(h.errors.length, 0);
});
