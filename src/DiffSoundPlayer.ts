import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DiffSoundsConfig } from './types';

export class DiffSoundPlayer {
  private soundDetector: import('./SoundDetector').SoundDetector | undefined;
  private settingsWebviewView: vscode.WebviewView | undefined;
  private audioWebviewPanel: vscode.WebviewPanel | undefined;
  private addSoundPath: string = '';
  private removeSoundPath: string = '';
  private diffOpenSoundPath: string = '';
  private diffActiveSoundPath: string = '';
  private diffCloseSoundPath: string = '';
  private audioBuffers: Map<string, ArrayBuffer> = new Map();
  private soundDurations: Map<string, number> = new Map(); // Sound ID -> Duration in seconds
  private soundCompletionCallbacks: Map<string, (() => void)[]> = new Map(); // Sound ID -> Array of completion callbacks
  private extensionUri: vscode.Uri;
  private currentConfig: import('./types').DiffSoundsConfig | undefined;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  private async initializeAudioWebview() {
    // Create a hidden webview panel for audio playback using Web Audio API
    this.audioWebviewPanel = vscode.window.createWebviewPanel(
      'diffSoundsAudioPlayer',
      'Diff Sounds Audio Player',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [this.extensionUri],
        retainContextWhenHidden: true
      }
    );

    // DO NOT reveal the panel - it exists hidden for audio playback
    // this.audioWebviewPanel.reveal(vscode.ViewColumn.One, false);

    // Set up the webview content with Web Audio API
    this.audioWebviewPanel.webview.html = await this.getAudioWebviewContent();

    // Handle messages from the audio webview
    this.audioWebviewPanel.webview.onDidReceiveMessage(message => {
      if (message.type === 'audioLoaded') {
        console.log(`Diff Sounds: Audio buffer loaded for ${message.sound} (${message.duration?.toFixed(2)}s)`);
        // Store the sound duration if provided
        if (message.duration !== undefined) {
          this.soundDurations.set(message.sound, message.duration);
        }
      } else if (message.type === 'audioEnded') {
        console.log(`Diff Sounds: Audio ended for ${message.sound}`);
        // Call completion callbacks for this sound
        const callbacks = this.soundCompletionCallbacks.get(message.sound);
        if (callbacks) {
          callbacks.forEach(callback => callback());
          // Clear callbacks after calling them
          this.soundCompletionCallbacks.delete(message.sound);
        }
      } else if (message.type === 'audioPlayError') {
        console.error(`Diff Sounds: Audio play error for ${message.sound}:`, message.error);
      } else if (message.type === 'requestReload') {
        console.log('Diff Sounds: Audio activation requested, reloading sounds...');
        if (this.currentConfig && this.soundDetector) {
          this.preloadSounds(this.currentConfig, this.soundDetector);
        } else {
          console.error('Diff Sounds: Cannot reload sounds - missing config or sound detector');
        }
      }
    });
  }

  private async getAudioWebviewContent(): Promise<string> {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Diff Sounds Audio Player</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 24px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            max-width: 500px;
            margin: 0 auto;
          }

          .container {
            display: flex;
            flex-direction: column;
            gap: 20px;
          }

          .activation-section {
            background: var(--vscode-panel-background, rgba(255,255,255,0.05));
            border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
            border-radius: 6px;
            padding: 16px;
            display: flex;
            justify-content: center;
            align-items: flex-end;
            min-height: 40px;
          }

          .activation-text {
            font-size: 16px;
            font-weight: 500;
            line-height: 1.4;
            margin-top: auto;
            padding-bottom: 10px;
          }

          .activation-link {
            color: var(--vscode-textLink-foreground, #3794ff);
            cursor: pointer;
            text-decoration: underline;
            font-weight: 600;
          }

          .activation-link:hover {
            color: var(--vscode-textLink-activeForeground, #0e70c0);
          }

          .activated {
            color: var(--vscode-descriptionForeground);
            cursor: default;
            text-decoration: none;
            opacity: 0.7;
            font-weight: 400;
          }

          .instructions {
            text-align: left;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.5;
          }

          .instructions p {
            margin: 0 0 12px 0;
          }

          .instructions p:last-child {
            margin-bottom: 0;
            color: var(--vscode-errorForeground, #f48771);
            font-weight: 500;
          }

          .instructions .note {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            font-weight: normal;
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
            <rect class="cls-2" x="84.86" y="41.44" width="9.22" height="89.05" rx="4.61" ry="4.61"/>
            <rect class="cls-2" x="99.08" y="70.29" width="9.22" height="31.35" rx="4.61" ry="4.61"/>
            <rect class="cls-2" x="113.29" y="57.77" width="9.22" height="56.39" rx="4.61" ry="4.61"/>
            <rect class="cls-2" x="127.51" y="79.1" width="9.22" height="13.74" rx="4.61" ry="4.61"/>
            <rect class="cls-2" x="70.64" y="70.29" width="9.22" height="31.35" rx="4.61" ry="4.61" transform="translate(150.5 171.94) rotate(-180)"/>
            <rect class="cls-2" x="56.43" y="57.77" width="9.22" height="56.39" rx="4.61" ry="4.61" transform="translate(122.07 171.94) rotate(-180)"/>
            <rect class="cls-2" x="42.21" y="79.1" width="9.22" height="13.74" rx="4.61" ry="4.61" transform="translate(93.63 171.94) rotate(180)"/>
            <text class="cls-1" transform="translate(158.33 101.91)"><tspan x="0" y="0">Diff Sounds</tspan></text>
          </svg>
        </div>

        <div class="container">
          <div class="activation-section">
            <div class="activation-text">
              Click <span id="activateLink" class="activation-link" onclick="activateAudio()">here</span> to activate audio.
            </div>
          </div>
          <div class="instructions">
            <p>You can move this tab to another window and minimize it to reduce clutter. Just make sure to click 'here' to activate audio before minimizing the tab.</p>
            <p class="note">To prevent this tab from opening on startup, disable the Diff Sounds extension via Command Palette ('Diff Sounds: Disable') or through the extension's settings panel.</p>
            <p>Important: Do not close this tab, as closing it will disable all extension functionality.</p>
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          let audioContext = null;
          let audioBuffers = {};
          let playingSources = {}; // Map soundId to array of sources
          let isActivated = false;

          function activateAudio() {
            const link = document.getElementById('activateLink');
            link.textContent = 'Audio activated!';
            link.className = 'activated';
            link.onclick = null;
            isActivated = true;

            // Send reload request immediately after activation
            vscode.postMessage({ type: 'requestReload' });

            // Resume audio context if suspended (provides user gesture)
            if (audioContext && audioContext.state === 'suspended') {
              audioContext.resume().then(() => {
                vscode.postMessage({ type: 'audioContextActivated' });
                // Start diffactive if there are open diff tabs
                if (currentConfig && currentConfig.openDiffTabCount > 0 && currentConfig.diffActiveSound && currentConfig.diffActiveSound.enabled) {
                  vscode.postMessage({ type: 'playDiffActive' });
                }
              });
            } else {
              vscode.postMessage({ type: 'audioContextActivated' });
              // Start diffactive if there are open diff tabs
              if (currentConfig && currentConfig.openDiffTabCount > 0 && currentConfig.diffActiveSound && currentConfig.diffActiveSound.enabled) {
                vscode.postMessage({ type: 'playDiffActive' });
              }
            }
          }

          try {
            // Initialize Web Audio API
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            vscode.postMessage({ type: 'audioContextReady' });
          } catch (e) {
            vscode.postMessage({ type: 'audioContextError', error: e.message });
            document.querySelector('.activation-text').textContent = 'Audio initialization failed.';
          }

          window.addEventListener('message', event => {
            const message = event.data;

            if (message.type === 'loadAudio') {
              loadAudioBuffer(message.sound, message.data);
            } else if (message.type === 'playAudio') {
              playAudio(message.sound, message.volume, message.options);
            } else if (message.type === 'stopAudio') {
              stopAudio(message.sound);
            }
          });

          async function loadAudioBuffer(soundId, arrayBuffer) {
            try {
              if (!audioContext) return;

              const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
              audioBuffers[soundId] = audioBuffer;
              vscode.postMessage({ type: 'audioLoaded', sound: soundId, duration: audioBuffer.duration });
            } catch (error) {
              vscode.postMessage({ type: 'audioLoadError', sound: soundId, error: error.message });
            }
          }

          function playAudio(soundId, volume = 1.0, options) {
            if (!audioContext || !audioBuffers[soundId]) {
              vscode.postMessage({ type: 'audioPlayError', sound: soundId, error: 'No audio buffer loaded' });
              return;
            }

            if (audioContext.state === 'suspended') {
              audioContext.resume().then(() => {
                playSound(soundId, volume, options);
              }).catch(error => {
                vscode.postMessage({ type: 'audioPlayError', sound: soundId, error: error.message });
              });
            } else {
              playSound(soundId, volume, options);
            }
          }

          function playSound(soundId, volume, options) {
            try {
              const source = audioContext.createBufferSource();
              const gainNode = audioContext.createGain();

              source.buffer = audioBuffers[soundId];
              source.connect(gainNode);
              gainNode.connect(audioContext.destination);

              gainNode.gain.setValueAtTime(volume, audioContext.currentTime);

              // Set looping if specified
              if (options && options.loop) {
                source.loop = true;
              }

              // Track playing sources
              if (!playingSources[soundId]) {
                playingSources[soundId] = [];
              }
              playingSources[soundId].push(source);

              // Remove from list when ended (only for non-looping)
              if (!source.loop) {
                source.addEventListener('ended', () => {
                  const idx = playingSources[soundId].indexOf(source);
                  if (idx > -1) {
                    playingSources[soundId].splice(idx, 1);
                  }
                  // Notify extension that this sound has ended
                  vscode.postMessage({ type: 'audioEnded', sound: soundId });
                });
              }

              source.start(0);
            } catch (error) {
              vscode.postMessage({ type: 'audioPlayError', sound: soundId, error: error.message });
            }
          }

          function stopAudio(soundId) {
            if (playingSources[soundId]) {
              playingSources[soundId].forEach(source => {
                try {
                  source.stop(0);
                } catch (e) {
                  // Source might already be stopped
                }
              });
              playingSources[soundId] = [];
            }
          }
        </script>
      </body>
      </html>
    `;
  }

  private async loadAudioBuffer(soundId: string, filePath: string): Promise<void> {
    try {
      if (!fs.existsSync(filePath)) {
        console.error(`Diff Sounds: Audio file not found: ${filePath}`);
        return;
      }

      const fileBuffer = await fs.promises.readFile(filePath);
      const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer;
      this.audioBuffers.set(soundId, arrayBuffer);

      // Send to audio webview for decoding and caching
      if (this.audioWebviewPanel) {
        this.audioWebviewPanel.webview.postMessage({
          type: 'loadAudio',
          sound: soundId,
          data: arrayBuffer
        });
      }

      console.log(`Diff Sounds: Loaded audio buffer for ${soundId}`);
    } catch (error) {
      console.error(`Diff Sounds: Failed to load audio buffer for ${soundId}:`, error);
    }
  }

  playAudio(soundId: string, volume: number = 1.0, options?: { loop?: boolean }): void {
    if (this.audioWebviewPanel) {
      this.audioWebviewPanel.webview.postMessage({
        type: 'playAudio',
        sound: soundId,
        volume: volume,
        options: options
      });
    } else {
      console.error('Diff Sounds: Audio webview not available for audio playback');
    }
  }

  stopAudio(soundId: string): void {
    if (this.audioWebviewPanel) {
      this.audioWebviewPanel.webview.postMessage({
        type: 'stopAudio',
        sound: soundId
      });
    } else {
      console.error('Diff Sounds: Audio webview not available for audio playback');
    }
  }

  // Get the duration of a sound in seconds
  getSoundDuration(soundId: string): number {
    return this.soundDurations.get(soundId) || 0;
  }

  // Register a completion callback for a sound
  onSoundCompleted(soundId: string, callback: () => void): void {
    if (!this.soundCompletionCallbacks.has(soundId)) {
      this.soundCompletionCallbacks.set(soundId, []);
    }
    this.soundCompletionCallbacks.get(soundId)!.push(callback);
  }

  // Remove completion callbacks for a sound
  clearSoundCompletionCallbacks(soundId: string): void {
    this.soundCompletionCallbacks.delete(soundId);
  }

  // Called by the extension to set the sound detector reference
  setSoundDetector(soundDetector: import('./SoundDetector').SoundDetector) {
    this.soundDetector = soundDetector;
  }

  // Called by the DiffSoundsViewProvider to set the webview reference (for settings UI only)
  setWebviewView(webviewView: vscode.WebviewView) {
    // Clean up previous webview reference if it exists
    if (this.settingsWebviewView) {
      // Note: webview disposal is handled by VS Code automatically
    }

    this.settingsWebviewView = webviewView;
  }

  // Called by commands to immediately update webview config
  setWebviewConfig(config: DiffSoundsConfig) {
    if (this.settingsWebviewView) {
      this.settingsWebviewView.webview.postMessage({ type: 'updateConfig', config });
    }
  }

  async preloadSounds(config: DiffSoundsConfig, soundDetector: import('./SoundDetector').SoundDetector) {
    console.log('Diff Sounds: Preloading sound file paths');

    // Handle audio webview panel based on enabled state
    if (config.enabled) {
      if (!this.audioWebviewPanel) {
        console.log('Diff Sounds: Creating audio webview panel (extension enabled)');
        await this.initializeAudioWebview();
      }
    } else {
      if (this.audioWebviewPanel) {
        console.log('Diff Sounds: Disposing audio webview panel (extension disabled)');
        this.audioWebviewPanel.dispose();
        this.audioWebviewPanel = undefined;
      }
    }

    // Store current config for potential reloads
    this.currentConfig = { ...config };

    // Update config with detected sound files
    await soundDetector.updateConfigWithDetectedFiles(config);

    // Get sound file paths using detected files (automatic detection system)
    this.addSoundPath = '';
    this.removeSoundPath = '';
    this.diffOpenSoundPath = '';
    this.diffActiveSoundPath = '';
    this.diffCloseSoundPath = '';

    if (config.addSound.enabled) {
      this.addSoundPath = soundDetector.getSoundFilePath(config.addSound);
      console.log('Diff Sounds: Add sound path:', this.addSoundPath);
    }

    if (config.removeSound.enabled) {
      this.removeSoundPath = soundDetector.getSoundFilePath(config.removeSound);
      console.log('Diff Sounds: Remove sound path:', this.removeSoundPath);
    }

    if (config.diffOpenSound.enabled) {
      this.diffOpenSoundPath = soundDetector.getSoundFilePath(config.diffOpenSound);
      console.log('Diff Sounds: Diffopen sound path:', this.diffOpenSoundPath);
    }

    if (config.diffActiveSound.enabled) {
      this.diffActiveSoundPath = soundDetector.getSoundFilePath(config.diffActiveSound);
      console.log('Diff Sounds: Diffactive sound path:', this.diffActiveSoundPath);
    }

    if (config.diffCloseSound.enabled) {
      this.diffCloseSoundPath = soundDetector.getSoundFilePath(config.diffCloseSound);
      console.log('Diff Sounds: Diffclose sound path:', this.diffCloseSoundPath);
    }

    console.log('Diff Sounds: Sound paths resolved - add:', this.addSoundPath, 'remove:', this.removeSoundPath, 'diffopen:', this.diffOpenSoundPath);

    // Load audio buffers into memory for Web Audio API
    if (this.addSoundPath) {
      await this.loadAudioBuffer('add', this.addSoundPath);
    }
    if (this.removeSoundPath) {
      await this.loadAudioBuffer('remove', this.removeSoundPath);
    }
    if (this.diffOpenSoundPath) {
      await this.loadAudioBuffer('diffopen', this.diffOpenSoundPath);
    }
    if (this.diffActiveSoundPath) {
      await this.loadAudioBuffer('diffactive', this.diffActiveSoundPath);
    }
    if (this.diffCloseSoundPath) {
      await this.loadAudioBuffer('diffclose', this.diffCloseSoundPath);
    }

    console.log('Diff Sounds: Audio buffers preloaded');
  }

  async playAdd(config?: DiffSoundsConfig) {
    console.log('Diff Sounds: Play add sound requested');

    if (!config) {
      console.error('Diff Sounds: No config provided for playAdd');
      return;
    }

    // Ensure we have the sound path and it's enabled
    if (!this.addSoundPath || !config.addSound.enabled) {
      console.log('Diff Sounds: Add sound not enabled or path not available');
      return;
    }

    // Calculate volume (combine global and per-sound volume)
    const individualVol = (config.addSound.volume || 50) / 100;
    const masterVol = (config.volume || 100) / 100;
    const volume = individualVol * masterVol;

    console.log(`Diff Sounds: Playing add sound with volume ${volume.toFixed(2)}`);
    this.playAudio('add', volume); // Already in 0-1 range
  }

  async playRemove(config?: DiffSoundsConfig) {
    console.log('Diff Sounds: Play remove sound requested');

    if (!config) {
      console.error('Diff Sounds: No config provided for playRemove');
      return;
    }

    // Ensure we have the sound path and it's enabled
    if (!this.removeSoundPath || !config.removeSound.enabled) {
      console.log('Diff Sounds: Remove sound not enabled or path not available');
      return;
    }

    // Calculate volume (combine global and per-sound volume)
    const individualVol = (config.removeSound.volume || 50) / 100;
    const masterVol = (config.volume || 100) / 100;
    const volume = individualVol * masterVol;

    console.log(`Diff Sounds: Playing remove sound with volume ${volume.toFixed(2)}`);
    this.playAudio('remove', volume); // Already in 0-1 range
  }

  async playDiffOpen(config?: DiffSoundsConfig) {
    console.log('Diff Sounds: Play diffopen sound requested');

    if (!config) {
      console.error('Diff Sounds: No config provided for playDiffOpen');
      return;
    }

    // Ensure we have the sound path and it's enabled
    if (!this.diffOpenSoundPath || !config.diffOpenSound.enabled) {
      console.log('Diff Sounds: Diffopen sound not enabled or path not available');
      return;
    }

    // Calculate volume (combine global and per-sound volume)
    const individualVol = (config.diffOpenSound.volume || 50) / 100;
    const masterVol = (config.volume || 100) / 100;
    const volume = individualVol * masterVol;

    console.log(`Diff Sounds: Playing diffopen sound with volume ${volume.toFixed(2)}`);
    this.playAudio('diffopen', volume); // Already in 0-1 range
  }

  async playDiffActive(config?: DiffSoundsConfig) {
    console.log('Diff Sounds: Play diffactive sound requested (looped)');

    if (!config) {
      console.error('Diff Sounds: No config provided for playDiffActive');
      return;
    }

    // Ensure we have the sound path and it's enabled
    if (!this.diffActiveSoundPath || !config.diffActiveSound.enabled) {
      console.log('Diff Sounds: Diffactive sound not enabled or path not available');
      return;
    }

    // Calculate volume (combine global and per-sound volume)
    const individualVol = (config.diffActiveSound.volume || 100) / 100;
    const masterVol = (config.volume || 100) / 100;
    const volume = individualVol * masterVol;

    console.log(`Diff Sounds: Starting looped diffactive sound with volume ${volume.toFixed(2)}`);
    this.playAudio('diffactive', volume, { loop: true }); // Looped audio
  }

  async playDiffClose(config?: DiffSoundsConfig) {
    console.log('Diff Sounds: Play diffclose sound requested');

    if (!config) {
      console.error('Diff Sounds: No config provided for playDiffClose');
      return;
    }

    // Ensure we have the sound path and it's enabled
    if (!this.diffCloseSoundPath || !config.diffCloseSound.enabled) {
      console.log('Diff Sounds: Diffclose sound not enabled or path not available');
      return;
    }

    // Stop the looped diffactive sound first
    console.log('Diff Sounds: Stopping diffactive loop');
    this.stopAudio('diffactive');

    // Calculate volume (combine global and per-sound volume)
    const individualVol = (config.diffCloseSound.volume || 100) / 100;
    const masterVol = (config.volume || 100) / 100;
    const volume = individualVol * masterVol;

    console.log(`Diff Sounds: Playing diffclose sound with volume ${volume.toFixed(2)}`);
    this.playAudio('diffclose', volume); // Already in 0-1 range
  }

  // Test methods that play sounds once (for UI test buttons)
  async testDiffActive(config?: DiffSoundsConfig) {
    console.log('Diff Sounds: Test diffactive sound requested (single play)');

    if (!config) {
      console.error('Diff Sounds: No config provided for testDiffActive');
      return;
    }

    // Ensure we have the sound path and it's enabled
    if (!this.diffActiveSoundPath || !config.diffActiveSound.enabled) {
      console.log('Diff Sounds: Diffactive sound not enabled or path not available');
      return;
    }

    // Calculate volume (combine global and per-sound volume)
    const individualVol = (config.diffActiveSound.volume || 100) / 100;
    const masterVol = (config.volume || 100) / 100;
    const volume = individualVol * masterVol;

    console.log(`Diff Sounds: Testing diffactive sound with volume ${volume.toFixed(2)}`);
    this.playAudio('diffactive', volume); // Play once, no loop
  }

  async testDiffClose(config?: DiffSoundsConfig) {
    console.log('Diff Sounds: Test diffclose sound requested (single play)');

    if (!config) {
      console.error('Diff Sounds: No config provided for testDiffClose');
      return;
    }

    // Ensure we have the sound path and it's enabled
    if (!this.diffCloseSoundPath || !config.diffCloseSound.enabled) {
      console.log('Diff Sounds: Diffclose sound not enabled or path not available');
      return;
    }

    // Calculate volume (combine global and per-sound volume)
    const individualVol = (config.diffCloseSound.volume || 100) / 100;
    const masterVol = (config.volume || 100) / 100;
    const volume = individualVol * masterVol;

    console.log(`Diff Sounds: Testing diffclose sound with volume ${volume.toFixed(2)}`);
    this.playAudio('diffclose', volume); // Play once, no loop
  }

  dispose() {
    // Clean up resources if needed
  }
}
