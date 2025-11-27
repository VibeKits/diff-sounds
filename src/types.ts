// Legacy config for backward compatibility
export interface LegacyDiffSoundsConfig {
  enabled: boolean;
  attributionMode: 'any' | 'live-only' | 'git-only';
  authorName: string;
  addSoundPath: string;
  removeSoundPath: string;
  volume: number;
  debounceMs: number;
}

// New config with sounds folder and individual sound status
export interface SoundEntry {
  enabled: boolean;
  filename?: string; // Optional filename, will be auto-detected
  isDefault?: boolean; // True if this sound is from the defaults folder
  volume?: number; // Individual volume for this sound (0-100, optional, defaults to global volume)
}

export interface DiffSoundsConfig {
  enabled: boolean;
  attributionMode: 'any' | 'live-only' | 'git-only';
  authorName: string;
  addSound: SoundEntry;
  removeSound: SoundEntry;
  diffOpenSound: SoundEntry;
  diffActiveSound: SoundEntry;
  diffCloseSound: SoundEntry;
  volume: number;
  debounceMs: number;
  // Sounds folder relative to extension directory
  soundsFolder: 'sounds';
}

export type AttributionMode = DiffSoundsConfig['attributionMode'];

// Utility type for detected sound files
export interface DetectedSoundFile {
  filename: string;
  filepath: string;
  exists: boolean;
  type: 'add' | 'remove' | 'diffopen' | 'diffactive' | 'diffclose';
  format: string; // wav, mp3, etc.
  isUserSound?: boolean; // true if from user's sounds folder
  isDefaultSound?: boolean; // true if from defaults folder
}
