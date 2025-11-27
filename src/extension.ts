import * as vscode from 'vscode';
import * as path from 'path';
import { DiffSoundPlayer } from './DiffSoundPlayer';
import { AttributionService } from './AttributionService';
import { SoundDetector } from './SoundDetector';
import { DiffSoundsConfig, LegacyDiffSoundsConfig } from './types';

let soundPlayer: DiffSoundPlayer;
let attributionService: AttributionService;
let soundDetector: SoundDetector;
let timeout: NodeJS.Timeout | undefined;
let currentConfig: DiffSoundsConfig | undefined;
let lastConfigChangeTime = 0; // Track config changes to suppress spurious text document events
let isDuringConfigChange = false; // Global flag to disable sounds during UI config changes
let openDiffTabCount = 0; // Track number of open diff tabs for diffactive loop management
let wasDiffActivePlaying = false; // Track if diffactive was playing when disabled
let isDisabled = false; // Global flag to immediately disable sounds

// Unified suppression timeout to prevent spurious sounds during UI changes
const UI_INTERACTION_SUPPRESSION_MS = 2000; // 2 seconds

function isDocumentInDiffEditor(documentUri: vscode.Uri): boolean {
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (tab.input && typeof tab.input === 'object' && 'original' in tab.input && 'modified' in tab.input) {
        const diffInput = tab.input as vscode.TabInputTextDiff;
        const originalUri = 'uri' in diffInput.original ? (diffInput.original as any).uri : diffInput.original;
        const modifiedUri = 'uri' in diffInput.modified ? (diffInput.modified as any).uri : diffInput.modified;
        if (originalUri.toString() === documentUri.toString() ||
            modifiedUri.toString() === documentUri.toString()) {
          return true;
        }
      }
    }
  }
  return false;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Diff Sounds extension activated');

  attributionService = new AttributionService();
  extensionPath = context.extensionPath;

  console.log('Diff Sounds: Created services, registering provider...');

  // Create sound detector
  soundDetector = new SoundDetector(extensionPath);

  // Create sound player with extension URI
  soundPlayer = new DiffSoundPlayer(vscode.Uri.file(extensionPath));

  // Set sound detector reference in sound player
  soundPlayer.setSoundDetector(soundDetector);

  // Load initial config and preload sounds
  currentConfig = loadConfig();
  console.log('Diff Sounds: Initial config loaded:', currentConfig);
  if (currentConfig) {
    soundPlayer.preloadSounds(currentConfig, soundDetector);
  } else {
    console.error('Diff Sounds: Failed to load configuration, sounds will not work');
  }

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('diffSounds')) {
        console.log(`Diff Sounds: Config change detected - disabling ALL sounds for ${UI_INTERACTION_SUPPRESSION_MS/1000} seconds`);
        lastConfigChangeTime = Date.now(); // Suppress text document events for UI interaction period
        isDuringConfigChange = true; // Disable ALL sound playing during UI changes

        const newConfig = getConfig();
        soundPlayer.preloadSounds(newConfig, soundDetector);

        // Re-enable sound playing after config propagation (unified UI interaction suppression period)
        setTimeout(() => {
          isDuringConfigChange = false;
          console.log('Diff Sounds: Config change cooldown ended - sounds re-enabled');
        }, UI_INTERACTION_SUPPRESSION_MS);
      }
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('diff-sounds.enable', () => {
      console.log('Diff Sounds: Enable command triggered');
      // Clear disabled flag immediately
      isDisabled = false;

      // Stop any currently playing sounds when enabling (cleanup)
      soundPlayer.stopAudio('diffactive');
      soundPlayer.stopAudio('add');
      soundPlayer.stopAudio('remove');
      soundPlayer.stopAudio('diffopen');
      soundPlayer.stopAudio('diffclose');

      // Update config
      vscode.workspace.getConfiguration('diffSounds').update('enabled', true);

      // Immediately update UI
      const newConfig = getVSCodeConfig();
      newConfig.enabled = true;
      soundPlayer.setWebviewConfig(newConfig);
    }),
    vscode.commands.registerCommand('diff-sounds.disable', () => {
      console.log('Diff Sounds: Disable command triggered');
      // Set disabled flag immediately to prevent new sounds
      isDisabled = true;

      // Stop all currently playing sounds
      soundPlayer.stopAudio('diffactive');
      soundPlayer.stopAudio('add');
      soundPlayer.stopAudio('remove');
      soundPlayer.stopAudio('diffopen');
      soundPlayer.stopAudio('diffclose');

      // Track if diffactive was playing
      wasDiffActivePlaying = openDiffTabCount > 0;

      // Update config
      vscode.workspace.getConfiguration('diffSounds').update('enabled', false);

      // Immediately update UI
      const newConfig = getVSCodeConfig();
      newConfig.enabled = false;
      soundPlayer.setWebviewConfig(newConfig);
    }),
    vscode.commands.registerCommand('diff-sounds.reloadSounds', () => {
      console.log('Extension: Manual reload sounds command triggered');
      const config = getConfig();
      soundPlayer.preloadSounds(config, soundDetector);
    })
  );

  // Register webview view provider for settings panel
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('diffSoundsView', new DiffSoundsViewProvider())
  );

  // Listen for config changes and preload sounds
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('diffSounds')) {
        lastConfigChangeTime = Date.now(); // Suppress text document events for UI interaction period
        const newConfig = getConfig();
        soundPlayer.preloadSounds(newConfig, soundDetector);
      }
    })
  );

  // Listen for text changes (debounced sound play)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async e => {
      // Check global disabled flag first
      if (isDisabled) {
        console.log('Diff Sounds: Skipping text change processing - extension disabled');
        return;
      }

      // Suppress spurious text document events triggered by config changes
      if (Date.now() - lastConfigChangeTime < UI_INTERACTION_SUPPRESSION_MS) {
        console.log(`Diff Sounds: Ignoring spurious text document event after config change (suppressing for ${UI_INTERACTION_SUPPRESSION_MS/1000} seconds)`);
        return;
      }

      const config = getVSCodeConfig(); // Use fresh config, not cached
      const shouldPlay = await attributionService.shouldPlaySound(config, e.document.uri);
      if (!shouldPlay) return;

      // Only play sounds when editing in a diff editor
      if (!isDocumentInDiffEditor(e.document.uri)) return;

      const debouncedPlay = (action: 'add' | 'remove') => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (isDuringConfigChange) {
            console.log('Diff Sounds: Skipping debounced sound play - config change in progress');
            return;
          }
          if (action === 'add' && config.addSound.enabled) soundPlayer.playAdd(config);
          else if (action === 'remove' && config.removeSound.enabled) soundPlayer.playRemove(config);
        }, config.debounceMs);
      };

      for (const change of e.contentChanges) {
        if (change.rangeLength === 0 && change.text.length > 0) {
          debouncedPlay('add');
        } else if (change.rangeLength > 0 && change.text.length === 0) {
          debouncedPlay('remove');
        } else if (change.rangeLength > 0 && change.text.length > 0) {
          // Replacement: count as add if net positive
          if (change.text.length > change.rangeLength) debouncedPlay('add');
          else if (change.text.length < change.rangeLength) debouncedPlay('remove');
        }
      }
    })
  );

  // Listen for tab changes (diff open/close sounds and active loop)
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(e => {
      // Check global disabled flag first
      if (isDisabled) {
        console.log('Diff Sounds: Skipping tab change processing - extension disabled');
        return;
      }

      const config = getVSCodeConfig(); // Use fresh config to respect slider changes

      // Check global enabled flag
      if (!config.enabled) {
        console.log('Diff Sounds: Skipping tab change processing - extension not enabled');
        return;
      }

      for (const tabChange of e.closed) {
        if (tabChange.input && typeof tabChange.input === 'object' && 'original' in tabChange.input && 'modified' in tabChange.input) {
          if (isDuringConfigChange) {
            console.log('Diff Sounds: Skipping diff close processing - config change in progress');
            continue;
          }

          openDiffTabCount--;
          console.log(`Diff Sounds: Diff tab closed, count now: ${openDiffTabCount}`);

          if (openDiffTabCount === 0 && config.diffCloseSound.enabled) {
            // Last diff tab closed - stop active loop and play close sound
            console.log('Diff Sounds: Last diff tab closed, playing diff close sound');
            soundPlayer.playDiffClose(config);
          }
        }
      }

      for (const tabChange of e.opened) {
        if (tabChange.input && typeof tabChange.input === 'object' && 'original' in tabChange.input && 'modified' in tabChange.input) {
          if (isDuringConfigChange) {
            console.log('Diff Sounds: Skipping diff open processing - config change in progress');
            continue;
          }

          openDiffTabCount++;
          const wasEmpty = openDiffTabCount === 1;
          console.log(`Diff Sounds: Diff tab opened, count now: ${openDiffTabCount}, was empty: ${wasEmpty}`);

          if (config.diffOpenSound.enabled) {
            // Register completion callback to start diffactive when diffopen finishes
            soundPlayer.onSoundCompleted('diffopen', () => {
              if (openDiffTabCount > 0 && config.diffActiveSound.enabled && !isDisabled && config.enabled) {
                console.log('Diff Sounds: diffopen completed, starting diffactive loop');
                soundPlayer.playDiffActive(config);
              }
            });

            soundPlayer.playDiffOpen(config);
            console.log('Diff Sounds: Playing diffopen, diffactive will start when it completes');
          } else if (config.diffActiveSound.enabled) {
            // No diffopen sound, start active immediately
            soundPlayer.playDiffActive(config);
          }
        }
      }
    })
  );
}

export function deactivate() {
  if (soundPlayer) soundPlayer.dispose();
}

function isInDiffView(): boolean {
  // Heuristic: multiple visible editors or specific schemes
  const visibleEditors = vscode.window.visibleTextEditors;
  if (visibleEditors.length > 1) return true;

  // Check if any visible editor has a diff-like scheme (e.g., git, compare)
  return visibleEditors.some(editor =>
    editor.document.uri.scheme === 'git' ||
    editor.document.uri.scheme.startsWith('diff') ||
    editor.document.uri.scheme === 'file' && visibleEditors.length > 1
  );
}

function loadConfig(): DiffSoundsConfig | undefined {
  try {
    // Try to read from JSON config file first (primary source for development)
    const configUri = vscode.Uri.joinPath(vscode.Uri.file(extensionPath), 'diffsounds-config.json');
    const configData = require(configUri.fsPath);
    console.log('Diff Sounds: Loaded config from JSON file:', configUri.fsPath);

    // Check if this is legacy format (has addSoundPath/removeSoundPath) and migrate
    const rawConfig = configData as any;
    if (rawConfig.addSoundPath !== undefined || rawConfig.removeSoundPath !== undefined) {
      console.log('Diff Sounds: Detected legacy config format, migrating...');
      return migrateLegacyConfig(rawConfig);
    }

    return configData as DiffSoundsConfig;
  } catch (error) {
    console.log('Diff Sounds: Config file not found, falling back to VS Code settings:', error);
    // Fall back to VS Code settings if JSON file not available
    return getVSCodeConfig();
  }
}

function migrateLegacyConfig(legacyConfig: LegacyDiffSoundsConfig): DiffSoundsConfig {
  return {
    enabled: legacyConfig.enabled,
    attributionMode: legacyConfig.attributionMode,
    authorName: legacyConfig.authorName,
    addSound: {
      enabled: true // Enable by default for migrated configs
    },
    removeSound: {
      enabled: true
    },
    diffOpenSound: {
      enabled: true
    },
    diffActiveSound: {
      enabled: true
    },
    diffCloseSound: {
      enabled: true
    },
    volume: legacyConfig.volume,
    debounceMs: legacyConfig.debounceMs,
    soundsFolder: 'sounds'
  };
}

function getVSCodeConfig(): DiffSoundsConfig {
  const c = vscode.workspace.getConfiguration('diffSounds');

  // Load current settings (legacy settings are ignored)
  const config: DiffSoundsConfig = {
    enabled: c.get<boolean>('enabled', true),
    attributionMode: c.get<'any' | 'live-only' | 'git-only'>('attributionMode', 'any'),
    authorName: c.get<string>('authorName', 'Cline'),
    addSound: {
      enabled: c.get<boolean>('addSound.enabled', true), // Default to enabled
      volume: c.get<number>('addSound.volume', 50)  // Explicit default
    },
    removeSound: {
      enabled: c.get<boolean>('addSound.enabled', true), // Default to enabled
      volume: c.get<number>('removeSound.volume', 50)  // Explicit default
    },
    diffOpenSound: {
      enabled: c.get<boolean>('diffOpenSound.enabled', true), // Default to enabled
      volume: c.get<number>('diffOpenSound.volume', 100)  // Explicit default
    },
    diffActiveSound: {
      enabled: c.get<boolean>('diffActiveSound.enabled', true), // Default to enabled
      volume: c.get<number>('diffActiveSound.volume', 100)  // Explicit default
    },
    diffCloseSound: {
      enabled: c.get<boolean>('diffCloseSound.enabled', true), // Default to enabled
      volume: c.get<number>('diffCloseSound.volume', 100)  // Explicit default
    },
    volume: c.get<number>('volume', 100),
    debounceMs: c.get<number>('debounceMs', 1),
    soundsFolder: 'sounds'
  };

  console.log('Diff Sounds: Loaded config from VS Code global settings:', JSON.stringify(config, null, 2));

  return config;
}

function getConfig(): DiffSoundsConfig {
  // Use currentConfig if available, otherwise fallback to VS Code settings
  if (currentConfig) {
    return currentConfig;
  }
  return getVSCodeConfig();
}

let extensionPath: string;

class DiffSoundsViewProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView) {
    console.log('Extension: Diff Sounds: Resolving webview view...');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file(''),
        vscode.Uri.file(extensionPath)  // Allow access to extension directory for audio files
      ]
    };

    // Set the webview reference in the audio player
    soundPlayer.setWebviewView(webviewView);

    webviewView.webview.html = this.getWebviewContent();

    const config = getConfig();
    webviewView.webview.postMessage({ type: 'initConfig', config });

    webviewView.webview.onDidReceiveMessage(async message => {
      console.log('Extension: Received message from webview:', message);
      if (message.type === 'updateSetting') {
        // Handle all setting updates with persistence
        await vscode.workspace.getConfiguration('diffSounds').update(message.key, message.value, vscode.ConfigurationTarget.Global);
        // Config changes will be handled by the onDidChangeConfiguration listener
      } else if (message.type === 'testSound') {
        console.log('Extension: Executing test command for', message.sound, 'with volume', message.volume);
        // Create a custom config with the current volume for testing
        const testConfig = getVSCodeConfig();
        if (message.volume !== undefined) {
          if (message.sound === 'add') {
            if (testConfig.addSound) testConfig.addSound.volume = message.volume;
          } else if (message.sound === 'remove') {
            if (testConfig.removeSound) testConfig.removeSound.volume = message.volume;
          } else if (message.sound === 'diffopen') {
            if (testConfig.diffOpenSound) testConfig.diffOpenSound.volume = message.volume;
          } else if (message.sound === 'diffactive') {
            if (testConfig.diffActiveSound) testConfig.diffActiveSound.volume = message.volume;
          } else if (message.sound === 'diffclose') {
            if (testConfig.diffCloseSound) testConfig.diffCloseSound.volume = message.volume;
          }
        }

        // Set enabled for testing
        if (message.sound === 'add' && testConfig.addSound) testConfig.addSound.enabled = true;
        else if (message.sound === 'remove' && testConfig.removeSound) testConfig.removeSound.enabled = true;
        else if (message.sound === 'diffopen' && testConfig.diffOpenSound) testConfig.diffOpenSound.enabled = true;
        else if (message.sound === 'diffactive' && testConfig.diffActiveSound) testConfig.diffActiveSound.enabled = true;
        else if (message.sound === 'diffclose' && testConfig.diffCloseSound) testConfig.diffCloseSound.enabled = true;

        // Execute with custom config
        if (message.sound === 'add') {
          soundPlayer.playAdd(testConfig);
        } else if (message.sound === 'remove') {
          soundPlayer.playRemove(testConfig);
        } else if (message.sound === 'diffopen') {
          soundPlayer.playDiffOpen(testConfig);
        } else if (message.sound === 'diffactive') {
          soundPlayer.testDiffActive(testConfig);
        } else if (message.sound === 'diffclose') {
          soundPlayer.testDiffClose(testConfig);
        }
      } else if (message.type === 'openSoundsFolder') {
        console.log('Extension: Opening sounds folder');
        const soundsUri = vscode.Uri.file(path.join(extensionPath, 'sounds'));
        vscode.commands.executeCommand('revealFileInOS', soundsUri);
      } else if (message.type === 'restoreDefaults') {
        console.log('Extension: Restoring default sounds');
        try {
          await soundDetector.restoreDefaults();
          const config = getConfig();
          soundPlayer.preloadSounds(config, soundDetector);
          webviewView.webview.postMessage({
            type: 'updateStatus',
            status: 'Defaults restored!'
          });
          setTimeout(() => {
            webviewView.webview.postMessage({ type: 'updateStatus', status: 'Ready' });
          }, 2000);
        } catch (error) {
          console.error('Extension: Failed to restore defaults:', error);
          webviewView.webview.postMessage({
            type: 'updateStatus',
            status: 'Failed to restore defaults'
          });
        }
      } else if (message.type === 'reloadSounds') {
        console.log('Extension: Webview requested sound reload');
        vscode.commands.executeCommand('diff-sounds.reloadSounds');
        setTimeout(() => {
          webviewView.webview.postMessage({ type: 'updateStatus', status: 'Ready' });
        }, 1000);
      } else if (message.type === 'diagnostic') {
        console.log('Extension: Webview diagnostic requested');
        webviewView.webview.postMessage({
          type: 'diagnosticResult',
          info: `Extension Path: ${extensionPath}\nUsing Web Audio API for zero-latency playback\nWeb Audio context for streaming`
        });
      }
    });

    // Update panel when config changes
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('diffSounds')) {
        const config = getVSCodeConfig(); // Use fresh config to prevent UI glitches
        webviewView.webview.postMessage({ type: 'updateConfig', config });
      }
    });

    // Handle webview visibility changes - ensure config is resent and audio is reloaded when panel becomes visible
    const visibilityHandler = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        console.log('Extension: Webview became visible, resending config and reloading audio');
        const config = getVSCodeConfig(); // Use fresh config to prevent UI glitches
        webviewView.webview.postMessage({ type: 'updateConfig', config });
        // Reload audio sources when panel becomes visible
        soundPlayer.preloadSounds(config, soundDetector);
      }
    });

    // Clean up visibility handler when webview is disposed
    webviewView.onDidDispose(() => {
      console.log('Extension: Webview disposed, cleaning up visibility handler');
      visibilityHandler.dispose();
    });
  }

  private getWebviewContent(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Diff Sounds Settings</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            padding: 15px;
            line-height: 1.5;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-groupHeader-tabsBackground);
          }

          .panel {
            background: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            padding: 15px;
            margin-bottom: 15px;
          }

          .panel-title {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 12px;
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
          }

          .panel-content {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .setting {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
          }

          .setting-inline {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
          }

          .setting-stacked {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 12px;
          }

          .setting-inline label {
            flex: 1;
            margin: 0;
            font-size: 12px;
            color: var(--vscode-foreground);
          }

          .setting-stacked label {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin: 0;
          }

          input[type="text"], input[type="number"], select {
            padding: 4px 6px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 12px;
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
          }

          input[type="range"] {
            width: 100%;
            height: 6px;
            border-radius: 3px;
            background: linear-gradient(to right, var(--progress-color, var(--vscode-progressBar-background)) 0%, var(--progress-color, var(--vscode-progressBar-background)) calc(var(--value, 50) * 1%), var(--track-color, var(--vscode-input-border)) calc(var(--value, 50) * 1%) 100%);
            outline: none;
            -webkit-appearance: none;
          }

          input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: var(--vscode-progressBar-background);
            cursor: pointer;
          }

          input[type="range"]::-moz-range-thumb {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: var(--vscode-progressBar-background);
            cursor: pointer;
          }

          button {
            padding: 6px 10px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 2px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.1s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
          }

          button:hover {
            background: var(--vscode-button-hoverBackground);
          }

          button:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 2px;
          }

          .btn-primary {
            background: var(--vscode-button-background);
            border-color: var(--vscode-focusBorder);
            color: var(--vscode-button-foreground);
          }

          .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
            border-color: var(--vscode-focusBorder);
          }

          .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            border-color: var(--vscode-button-border);
            color: var(--vscode-button-secondaryForeground);
          }

          .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }

          .buttons-row {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
          }

          .volume-control {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .volume-value {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            min-width: 24px;
            text-align: center;
          }

          .checkbox-control {
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .checkbox-control input[type="checkbox"] {
            width: auto;
            margin: 0;
            accent-color: var(--vscode-progressBar-background);
          }

          .status-text {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
          }

          .hidden { display: none; }

          .audio-debug {
            font-size: 11px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-editor-font-family);
            background: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-textBlockQuote-border);
            padding: 8px;
            border-radius: 3px;
            margin-top: 8px;
            max-height: 120px;
            overflow-y: auto;
            white-space: pre-wrap;
          }

          /* VS Code theme-aware link/accent colors */
          .sound-section-title {
            color: var(--vscode-foreground);
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 2px;
          }

          /* Make management section buttons normal weight */
          .sound-management button {
            font-weight: 400;
          }

          /* Make diagnostics buttons normal weight */
          .diagnostic-section button {
            font-weight: 400;
          }

          /* Compact sound control layout */
          .sound-control-compact {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
          }

          h3 {
            color: var(--vscode-foreground);
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <!-- Header SVG -->
        <div style="text-align: center; padding: 20px;">
          <svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 464.87 166.7" style="max-width: 100%; height: auto;">
            <defs>
              <style>
                .cls-1 {
                  font-family: ArialMT, Arial;
                  font-size: 49.14px;
                }

                .cls-1, .cls-2 {
                  fill: #fff;
                }
              </style>
            </defs>
            <rect class="cls-2" x="90.45" y="38.82" width="9.22" height="89.05" rx="4.61" ry="4.61"/>
            <rect class="cls-2" x="104.66" y="67.67" width="9.22" height="31.35" rx="4.61" ry="4.61"/>
            <rect class="cls-2" x="118.88" y="55.15" width="9.22" height="56.39" rx="4.61" ry="4.61"/>
            <rect class="cls-2" x="133.1" y="76.48" width="9.22" height="13.74" rx="4.61" ry="4.61"/>
            <rect class="cls-2" x="76.23" y="67.67" width="9.22" height="31.35" rx="4.61" ry="4.61" transform="translate(161.68 166.7) rotate(180)"/>
            <rect class="cls-2" x="62.01" y="55.15" width="9.22" height="56.39" rx="4.61" ry="4.61" transform="translate(133.24 166.7) rotate(180)"/>
            <rect class="cls-2" x="47.79" y="76.48" width="9.22" height="13.74" rx="4.61" ry="4.61" transform="translate(104.81 166.7) rotate(-180)"/>
            <text class="cls-1" transform="translate(163.91 99.29)"><tspan x="0" y="0">Diff Sounds</tspan></text>
          </svg>
        </div>

        <!-- Hidden audio elements -->
        <div class="hidden">
          <audio id="addAudio" preload="auto"></audio>
          <audio id="removeAudio" preload="auto"></audio>
        </div>

        <!-- General Settings -->
        <div class="panel">
        <div class="panel-title">General Settings</div>
        <div class="panel-content">
            <div class="setting-inline">
              <input type="checkbox" id="enabled">
              <label for="enabled">Enable Diff Sounds Extension</label>
            </div>

            <div class="setting-stacked">
              <label for="attributionMode">Attribution Mode:</label>
              <select id="attributionMode">
                <option value="any">Any (recommended)</option>
                <option value="live-only">Live Share Only</option>
                <option value="git-only">Git Only</option>
              </select>
            </div>

            <div class="setting-stacked">
              <label for="authorName">Author Name:</label>
              <input type="text" id="authorName">
            </div>

            <div class="setting-stacked">
              <label for="debounceMs">Debounce Delay (ms):</label>
              <input type="number" id="debounceMs" min="0">
            </div>
          </div>
        </div>

        <!-- Volume Controls -->
        <div class="panel">
          <div class="panel-title">Volume Controls</div>
          <div class="panel-content">
            <!-- Master Volume -->
            <h5 class="sound-section-title">Master Volume</h5>
            <div class="volume-control">
              <span>🔈</span>
              <input type="range" id="masterVolume" min="0" max="100" value="100">
              <span class="volume-value" id="masterVolumeValue">100%</span>
              <span>🔊</span>
            </div>

            <!-- Add Sound Controls -->
            <h5 class="sound-section-title">Add Sound</h5>
            <div class="sound-control-compact">
              <div class="checkbox-control">
                <input type="checkbox" id="addSoundEnabled">
                <label for="addSoundEnabled">Enable
              </div>
              <span style="font-size: 12px;">🔉</span>
              <input type="range" id="addVolume" min="0" max="100" value="100">
              <span class="volume-value" id="addVolumeValue">100%</span>
              <button id="testAdd" class="btn-secondary">Test</button>
            </div>

            <!-- Remove Sound Controls -->
            <h5 class="sound-section-title">Remove Sound</h5>
            <div class="sound-control-compact">
              <div class="checkbox-control">
                <input type="checkbox" id="removeSoundEnabled">
                <label for="removeSoundEnabled">Enable</label>
              </div>
              <span style="font-size: 12px;">🔉</span>
              <input type="range" id="removeVolume" min="0" max="100" value="100">
              <span class="volume-value" id="removeVolumeValue">100%</span>
              <button id="testRemove" class="btn-secondary">Test</button>
            </div>

            <!-- Diff Open Sound Controls -->
            <h5 class="sound-section-title">Diff Open Sound</h5>
            <div class="sound-control-compact">
              <div class="checkbox-control">
                <input type="checkbox" id="diffOpenSoundEnabled">
                <label for="diffOpenSoundEnabled">Enable</label>
              </div>
              <span style="font-size: 12px;">🔉</span>
              <input type="range" id="diffOpenVolume" min="0" max="100" value="100">
              <span class="volume-value" id="diffOpenVolumeValue">100%</span>
              <button id="testDiffOpen" class="btn-secondary">Test</button>
            </div>

            <!-- Diff Active Sound Controls -->
            <h5 class="sound-section-title">Diff Active Sound</h5>
            <div class="sound-control-compact">
              <div class="checkbox-control">
                <input type="checkbox" id="diffActiveSoundEnabled">
                <label for="diffActiveSoundEnabled">Enable</label>
              </div>
              <span style="font-size: 12px;">🔉</span>
              <input type="range" id="diffActiveVolume" min="0" max="100" value="100">
              <span class="volume-value" id="diffActiveVolumeValue">100%</span>
              <button id="testDiffActive" class="btn-secondary">Test</button>
            </div>

            <!-- Diff Close Sound Controls -->
            <h5 class="sound-section-title">Diff Close Sound</h5>
            <div class="sound-control-compact">
              <div class="checkbox-control">
                <input type="checkbox" id="diffCloseSoundEnabled">
                <label for="diffCloseSoundEnabled">Enable</label>
              </div>
              <span style="font-size: 12px;">🔉</span>
              <input type="range" id="diffCloseVolume" min="0" max="100" value="100">
              <span class="volume-value" id="diffCloseVolumeValue">100%</span>
              <button id="testDiffClose" class="btn-secondary">Test</button>
            </div>
          </div>
        </div>

        <!-- Sound Management -->
        <div class="panel sound-management">
          <div class="panel-title">Sound Management</div>
          <div class="panel-content">
            <div class="buttons-row">
              <button id="openSoundsFolder">Open Sounds Folder</button>
              <button id="restoreDefaults" class="btn-primary">Restore Defaults</button>
              <button id="reloadSounds" class="btn-success">Reload Sounds</button>
            </div>
            <div class="setting">
              <label>Sound Status:</label>
              <div id="soundStatus" class="status-text">Initializing...</div>
            </div>
          </div>
        </div>

        <!-- Status and Debug -->
        <div class="panel diagnostic-section">
          <div class="panel-title">Status & Diagnostics</div>
          <div class="panel-content">
            <div class="setting">
              <label>Current Status:</label>
              <div id="status" class="status-text">Ready</div>
            </div>
            <div class="setting">
              <button id="diagnostic" style="width: auto;">Run Diagnostics</button>
            </div>
            <label>Debug Log:</label>
            <div id="audioDebug" class="audio-debug"></div>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          let currentConfig = vscode.getState() || {};
          const addAudio = document.getElementById('addAudio');
          const removeAudio = document.getElementById('removeAudio');
          const audioStatus = { add: 'unloaded', remove: 'unloaded' };
          const debugLog = document.getElementById('audioDebug');

          // Prevent UI updates during slider interactions to avoid conflicts
          let slidersInteracting = false;

          function addDebug(message) {
            console.log(message);
            const time = new Date().toLocaleTimeString();
            debugLog.textContent += \`\${time} \${message}\n\`;
            debugLog.scrollTop = debugLog.scrollHeight;
          }

          // Setup audio element event handlers for fallback audio
          function setupAudioElement(audio, name) {
            audio.addEventListener('error', (e) => {
              const errorMsg = \`\${name} audio load error: \${e.type} code: \${audio.error?.code} message: \${audio.error?.message}\`;
              addDebug(errorMsg);
              audioStatus[name.toLowerCase()] = 'error';
              vscode.postMessage({ type: 'audioDebug', message: errorMsg });
            });
            audio.addEventListener('abort', () => {
              addDebug(\`\${name} audio load aborted\`);
              audioStatus[name.toLowerCase()] = 'aborted';
            });
            audio.addEventListener('loadstart', () => {
              addDebug(\`\${name} audio load started\`);
              audioStatus[name.toLowerCase()] = 'loading';
            });
            audio.addEventListener('loadeddata', () => {
              addDebug(\`\${name} audio loaded data\`);
            });
            audio.addEventListener('loadedmetadata', () => {
              addDebug(\`\${name} audio loaded metadata - duration: \${audio.duration}s\`);
            });
            audio.addEventListener('canplay', () => {
              addDebug(\`\${name} audio can play (readyState: \${audio.readyState})\`);
              audioStatus[name.toLowerCase()] = 'canplay';
            });
            audio.addEventListener('canplaythrough', () => {
              addDebug(\`\${name} audio can play through - ready!\`);
              audioStatus[name.toLowerCase()] = 'ready';
              vscode.postMessage({ type: 'audioLoaded', sound: name.toLowerCase() });
            });
            audio.addEventListener('waiting', () => {
              addDebug(\`\${name} audio waiting for data\`);
            });
            audio.addEventListener('stalled', () => {
              addDebug(\`\${name} audio stalled\`);
              audioStatus[name.toLowerCase()] = 'stalled';
            });
            audio.addEventListener('suspend', () => {
              addDebug(\`\${name} audio loading suspended\`);
            });
            audio.addEventListener('emptied', () => {
              addDebug(\`\${name} audio emptied\`);
            });
          }

          setupAudioElement(addAudio, 'Add');
          setupAudioElement(removeAudio, 'Remove');

          window.addEventListener('message', event => {
            const message = event.data;
            const messageType = message.type || message.command || 'unknown';
            addDebug(\`Received: \${messageType}\`);

            if (message.type === 'initConfig' || message.type === 'updateConfig') {
              currentConfig = message.config;
              // Persist config in webview state
              vscode.setState(currentConfig);
              updateUI();
            } else if (message.type === 'updateStatus') {
              document.getElementById('status').textContent = message.status;
            } else if (message.command === 'loadAudio') {
              addDebug(\`Loading Web Audio buffer for \${message.sound}\`);
              loadAudioBuffer(message.sound, message.data);
            } else if (message.command === 'playAudio') {
              const soundId = message.sound;
              addDebug(\`Attempting to play \${soundId.toUpperCase()} sound with Web Audio API\`);
              playAudio(soundId, message.volume || 0.5);
            } else if (message.command === 'loadSounds') {
              addDebug(\`Loading sounds - add: \${message.addUri} remove: \${message.removeUri} volume: \${message.volume}\`);
              if (message.addUri) addAudio.src = message.addUri;
              if (message.removeUri) removeAudio.src = message.removeUri;
              const addVal = parseInt(document.getElementById('addVolume').value);
              const addSliderValue = isNaN(addVal) ? 50 : addVal;
              const removeVal = parseInt(document.getElementById('removeVolume').value);
              const removeSliderValue = isNaN(removeVal) ? 50 : removeVal;
              addAudio.volume = addSliderValue / 100;
              removeAudio.volume = removeSliderValue / 100;
              addAudio.load();
              removeAudio.load();
            } else if (message.command === 'reloadAudio') {
              addDebug('Reloading audio elements');
              addAudio.load();
              removeAudio.load();
            } else if (message.command === 'checkStatus') {
              addDebug('Audio status check requested');
              vscode.postMessage({
                type: 'audioStatus',
                status: {
                  add: audioStatus.add,
                  remove: audioStatus.remove,
                  addVolume: addAudio.volume,
                  removeVolume: removeAudio.volume,
                  addMuted: addAudio.muted,
                  removeMuted: removeAudio.muted
                }
              });
            }
          });

          function getAudioState(audio) {
            return {
              src: audio.src,
              readyState: audio.readyState,
              volume: audio.volume,
              muted: audio.muted,
              duration: audio.duration,
              currentTime: audio.currentTime
            };
          }

          function updateUI() {
            if (slidersInteracting) {
              console.log('Skipping UI update - sliders are currently being interacted with');
              return; // Prevent slider position resets during user interaction
            }

            console.log('Updating UI with config:', currentConfig);

            // General settings
            if (currentConfig.enabled !== undefined) {
              const enabledCheckbox = document.getElementById('enabled');
              enabledCheckbox.checked = currentConfig.enabled === true;
              console.log('Set enabled checkbox to:', currentConfig.enabled);
            }

            if (currentConfig.attributionMode) {
              document.getElementById('attributionMode').value = currentConfig.attributionMode;
            }

            if (currentConfig.authorName) {
              const authorInput = document.getElementById('authorName');
              authorInput.value = currentConfig.authorName;
              console.log('Set author name to:', currentConfig.authorName);
            }

            if (currentConfig.debounceMs !== undefined) {
              const debounceInput = document.getElementById('debounceMs');
              debounceInput.value = currentConfig.debounceMs;
              console.log('Set debounce to:', currentConfig.debounceMs);
            }

            // Master volume
            if (currentConfig.volume !== undefined) {
              document.getElementById('masterVolume').value = currentConfig.volume;
              document.getElementById('masterVolumeValue').textContent = currentConfig.volume;
              document.getElementById('masterVolume').style.setProperty('--value', currentConfig.volume);
            }

            // Add sound settings
            if (currentConfig.addSound) {
              const addEnabledCheckbox = document.getElementById('addSoundEnabled');
              addEnabledCheckbox.checked = currentConfig.addSound.enabled !== false; // Default to enabled unless explicitly false
              console.log('Set add sound enabled to:', currentConfig.addSound.enabled);

              const addVolume = currentConfig.addSound.volume !== undefined ? currentConfig.addSound.volume : (currentConfig.volume !== undefined ? currentConfig.volume : 50);
              document.getElementById('addVolume').value = addVolume;
              document.getElementById('addVolumeValue').textContent = \`\${addVolume}%\`;
              document.getElementById('addVolume').style.setProperty('--value', addVolume);
            }

            // Remove sound settings
            if (currentConfig.removeSound) {
              const removeEnabledCheckbox = document.getElementById('removeSoundEnabled');
              removeEnabledCheckbox.checked = currentConfig.removeSound.enabled !== false; // Default to enabled unless explicitly false
              console.log('Set remove sound enabled to:', currentConfig.removeSound.enabled);

              const removeVolume = currentConfig.removeSound.volume !== undefined ? currentConfig.removeSound.volume : (currentConfig.volume !== undefined ? currentConfig.volume : 50);
              document.getElementById('removeVolume').value = removeVolume;
              document.getElementById('removeVolumeValue').textContent = \`\${removeVolume}%\`;
              document.getElementById('removeVolume').style.setProperty('--value', removeVolume);
            }

            // Diff open sound settings
            if (currentConfig.diffOpenSound) {
              const diffOpenEnabledCheckbox = document.getElementById('diffOpenSoundEnabled');
              diffOpenEnabledCheckbox.checked = currentConfig.diffOpenSound.enabled !== false; // Default to enabled unless explicitly false
              console.log('Set diff open sound enabled to:', currentConfig.diffOpenSound.enabled);

              const diffOpenVolume = currentConfig.diffOpenSound.volume !== undefined ? currentConfig.diffOpenSound.volume : currentConfig.volume || 100;
              document.getElementById('diffOpenVolume').value = diffOpenVolume;
              document.getElementById('diffOpenVolumeValue').textContent = \`\${diffOpenVolume}%\`;
              document.getElementById('diffOpenVolume').style.setProperty('--value', diffOpenVolume);
            }

            // Diff active sound settings
            if (currentConfig.diffActiveSound) {
              const diffActiveEnabledCheckbox = document.getElementById('diffActiveSoundEnabled');
              diffActiveEnabledCheckbox.checked = currentConfig.diffActiveSound.enabled !== false; // Default to enabled unless explicitly false
              console.log('Set diff active sound enabled to:', currentConfig.diffActiveSound.enabled);

              const diffActiveVolume = currentConfig.diffActiveSound.volume !== undefined ? currentConfig.diffActiveSound.volume : currentConfig.volume || 100;
              document.getElementById('diffActiveVolume').value = diffActiveVolume;
              document.getElementById('diffActiveVolumeValue').textContent = \`\${diffActiveVolume}%\`;
              document.getElementById('diffActiveVolume').style.setProperty('--value', diffActiveVolume);
            }

            // Diff close sound settings
            if (currentConfig.diffCloseSound) {
              const diffCloseEnabledCheckbox = document.getElementById('diffCloseSoundEnabled');
              diffCloseEnabledCheckbox.checked = currentConfig.diffCloseSound.enabled !== false; // Default to enabled unless explicitly false
              console.log('Set diff close sound enabled to:', currentConfig.diffCloseSound.enabled);

              const diffCloseVolume = currentConfig.diffCloseSound.volume !== undefined ? currentConfig.diffCloseSound.volume : currentConfig.volume || 100;
              document.getElementById('diffCloseVolume').value = diffCloseVolume;
              document.getElementById('diffCloseVolumeValue').textContent = \`\${diffCloseVolume}%\`;
              document.getElementById('diffCloseVolume').style.setProperty('--value', diffCloseVolume);
            }

            // Sound status
            const hasSounds = (currentConfig.addSound?.filename || currentConfig.removeSound?.filename || currentConfig.diffOpenSound?.filename || currentConfig.diffActiveSound?.filename || currentConfig.diffCloseSound?.filename);
            document.getElementById('soundStatus').textContent = hasSounds ?
              'Automatically detected sound files available' : 'No sound files detected - use defaults';
            console.log('Has sounds:', hasSounds);
          }

          function updateSetting(key, value) {
            vscode.postMessage({ type: 'updateSetting', key, value });
          }

          // General settings
          document.getElementById('enabled').addEventListener('change', e => updateSetting('enabled', e.target.checked));
          document.getElementById('attributionMode').addEventListener('change', e => updateSetting('attributionMode', e.target.value));
          document.getElementById('authorName').addEventListener('input', e => updateSetting('authorName', e.target.value));
          document.getElementById('debounceMs').addEventListener('change', e => updateSetting('debounceMs', parseInt(e.target.value) || 1));

          // Master volume - responsive UI updates + save on release
          document.getElementById('masterVolume').addEventListener('input', e => {
            document.getElementById('masterVolumeValue').textContent = e.target.value;
            e.target.style.setProperty('--value', e.target.value);
          });
          document.getElementById('masterVolume').addEventListener('change', e => {
            slidersInteracting = true; // Block UI updates during save
            updateSetting('volume', parseInt(e.target.value));
            setTimeout(() => slidersInteracting = false, 500); // Allow updates after save completes
          });

          // Individual volume controls - responsive UI updates + save on release
          document.getElementById('addVolume').addEventListener('input', e => {
            document.getElementById('addVolumeValue').textContent = \`\${e.target.value}%\`;
            e.target.style.setProperty('--value', e.target.value);
          });
          document.getElementById('addVolume').addEventListener('change', e => {
            slidersInteracting = true; // Block UI updates during save
            updateSetting('addSound.volume', parseInt(e.target.value));
            setTimeout(() => slidersInteracting = false, 500); // Allow updates after save completes
          });

          document.getElementById('removeVolume').addEventListener('input', e => {
            document.getElementById('removeVolumeValue').textContent = \`\${e.target.value}%\`;
            e.target.style.setProperty('--value', e.target.value);
          });
          document.getElementById('removeVolume').addEventListener('change', e => {
            slidersInteracting = true; // Block UI updates during save
            updateSetting('removeSound.volume', parseInt(e.target.value));
            setTimeout(() => slidersInteracting = false, 500); // Allow updates after save completes
          });

          document.getElementById('diffOpenVolume').addEventListener('input', e => {
            document.getElementById('diffOpenVolumeValue').textContent = \`\${e.target.value}%\`;
            e.target.style.setProperty('--value', e.target.value);
          });
          document.getElementById('diffOpenVolume').addEventListener('change', e => {
            slidersInteracting = true; // Block UI updates during save
            updateSetting('diffOpenSound.volume', parseInt(e.target.value));
            setTimeout(() => slidersInteracting = false, 500); // Allow updates after save completes
          });

          document.getElementById('diffActiveVolume').addEventListener('input', e => {
            document.getElementById('diffActiveVolumeValue').textContent = \`\${e.target.value}%\`;
            e.target.style.setProperty('--value', e.target.value);
          });
          document.getElementById('diffActiveVolume').addEventListener('change', e => {
            slidersInteracting = true; // Block UI updates during save
            updateSetting('diffActiveSound.volume', parseInt(e.target.value));
            setTimeout(() => slidersInteracting = false, 500); // Allow updates after save completes
          });

          document.getElementById('diffCloseVolume').addEventListener('input', e => {
            document.getElementById('diffCloseVolumeValue').textContent = \`\${e.target.value}%\`;
            e.target.style.setProperty('--value', e.target.value);
          });
          document.getElementById('diffCloseVolume').addEventListener('change', e => {
            slidersInteracting = true; // Block UI updates during save
            updateSetting('diffCloseSound.volume', parseInt(e.target.value));
            setTimeout(() => slidersInteracting = false, 500); // Allow updates after save completes
          });

          // Sound enabled toggles
          document.getElementById('addSoundEnabled').addEventListener('change', e => updateSetting('addSound.enabled', e.target.checked));
          document.getElementById('removeSoundEnabled').addEventListener('change', e => updateSetting('removeSound.enabled', e.target.checked));
          document.getElementById('diffOpenSoundEnabled').addEventListener('change', e => updateSetting('diffOpenSound.enabled', e.target.checked));
          document.getElementById('diffActiveSoundEnabled').addEventListener('change', e => updateSetting('diffActiveSound.enabled', e.target.checked));
          document.getElementById('diffCloseSoundEnabled').addEventListener('change', e => updateSetting('diffCloseSound.enabled', e.target.checked));

          // Test sounds
          document.getElementById('testAdd').addEventListener('click', () => vscode.postMessage({ type: 'testSound', sound: 'add', volume: parseInt(document.getElementById('addVolume').value) }));
          document.getElementById('testRemove').addEventListener('click', () => vscode.postMessage({ type: 'testSound', sound: 'remove', volume: parseInt(document.getElementById('removeVolume').value) }));
          document.getElementById('testDiffOpen').addEventListener('click', () => vscode.postMessage({ type: 'testSound', sound: 'diffopen', volume: parseInt(document.getElementById('diffOpenVolume').value) }));
          document.getElementById('testDiffActive').addEventListener('click', () => vscode.postMessage({ type: 'testSound', sound: 'diffactive', volume: parseInt(document.getElementById('diffActiveVolume').value) }));
          document.getElementById('testDiffClose').addEventListener('click', () => vscode.postMessage({ type: 'testSound', sound: 'diffclose', volume: parseInt(document.getElementById('diffCloseVolume').value) }));

          // Management buttons
          document.getElementById('openSoundsFolder').addEventListener('click', () => vscode.postMessage({ type: 'openSoundsFolder' }));
          document.getElementById('restoreDefaults').addEventListener('click', () => vscode.postMessage({ type: 'restoreDefaults' }));
          document.getElementById('reloadSounds').addEventListener('click', () => {
            document.getElementById('status').textContent = 'Reloading sounds...';
            vscode.postMessage({ type: 'reloadSounds' });
          });
          document.getElementById('diagnostic').addEventListener('click', () => {
            audioStatus.add = 'unloaded';
            audioStatus.remove = 'unloaded';
            debugLog.textContent = '';
            vscode.postMessage({ type: 'diagnostic' });
          });

          // Check for missing audio sources and request reload if needed
          function checkAndRequestAudioReload() {
            const addSrcMissing = !addAudio.src || addAudio.src === '';
            const removeSrcMissing = !removeAudio.src || removeAudio.src === '';
            if (addSrcMissing || removeSrcMissing) {
              addDebug(\`Audio sources missing - add: \${addSrcMissing} remove: \${removeSrcMissing} - requesting reload\`);
              vscode.postMessage({ type: 'requestAudioReload' });
              return true;
            }
            return false;
          }

          // Check for audio sources when attempting to play
          function ensureAudioSources() {
            if (checkAndRequestAudioReload()) {
              // Sources were missing and reload was requested
              return false;
            }
            return true;
          }

          // Listen for visibility changes to check audio sources
          document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
              addDebug('Document became visible, checking audio sources');
              checkAndRequestAudioReload();
            }
          });

          // Listen for window focus to check audio sources
          window.addEventListener('focus', () => {
            addDebug('Window gained focus, checking audio sources');
            checkAndRequestAudioReload();
          });

          // Also check immediately after initialization
          setTimeout(() => {
            addDebug('Initial audio source check after webview setup');
            checkAndRequestAudioReload();
          }, 100);

          // Notify extension that webview is ready
          vscode.postMessage({ type: 'webviewReady' });
          addDebug('Webview initialized and ready for sounds');
        </script>
      </body>
      </html>
    `;
  }
}
