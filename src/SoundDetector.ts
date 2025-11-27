import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DiffSoundsConfig, DetectedSoundFile, SoundEntry } from './types';

export class SoundDetector {
  private extensionPath: string;
  private soundsFolder: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
    this.soundsFolder = 'sounds';
  }

  /**
   * Scans the sounds folder and Defaults subfolder for available audio files
   */
  async scanSoundFiles(): Promise<DetectedSoundFile[]> {
    const soundsPath = path.join(this.extensionPath, this.soundsFolder);
    const defaultsPath = path.join(soundsPath, 'Defaults');
    const detected: DetectedSoundFile[] = [];

    try {
      // Create sounds directory and Defaults subdirectory if they don't exist
      if (!fs.existsSync(soundsPath)) {
        fs.mkdirSync(soundsPath, { recursive: true });
        console.log('Diff Sounds: Created sounds directory');
      }

      if (!fs.existsSync(defaultsPath)) {
        fs.mkdirSync(defaultsPath, { recursive: true });
        console.log('Diff Sounds: Created sounds/Defaults subdirectory');
      }

      // Scan main sounds folder (user customizations)
      let files = fs.readdirSync(soundsPath);
      console.log(`Diff Sounds: Scanning ${files.length} files in sounds folder`);

      for (const file of files) {
        // Skip directories (we'll scan Defaults separately)
        if (fs.statSync(path.join(soundsPath, file)).isDirectory()) {
          if (file === 'Defaults') continue;
          continue;
        }

        const ext = path.extname(file).toLowerCase();
        const baseName = path.basename(file, ext);

        // Check for audio extensions
        if (['.wav', '.mp3', '.ogg', '.m4a', '.aac', '.flac'].includes(ext)) {
          const type = this.guessSoundType(baseName);
          if (type) {
            const filePath = path.join(soundsPath, file);
            detected.push({
              filename: file,
              filepath: filePath,
              exists: fs.existsSync(filePath),
              type: type,
              format: ext.substring(1), // remove the dot
              isUserSound: true
            });
          }
        }
      }

      // Scan Defaults folder (fallback sounds)
      console.log('Diff Sounds: Scanning Defaults folder');
      files = fs.readdirSync(defaultsPath);

      for (const file of files) {
        // Skip directories
        if (fs.statSync(path.join(defaultsPath, file)).isDirectory()) {
          continue;
        }

        const ext = path.extname(file).toLowerCase();
        const baseName = path.basename(file, ext);

        // Check for audio extensions
        if (['.wav', '.mp3', '.ogg', '.m4a', '.aac', '.flac'].includes(ext)) {
          const type = this.guessSoundType(baseName);
          if (type) {
            // Check if we already have this sound type from user folder
            const userHasThisSound = detected.some(d => d.type === type && d.isUserSound);
            if (!userHasThisSound) {
              const filePath = path.join(defaultsPath, file);
              detected.push({
                filename: file,
                filepath: filePath,
                exists: fs.existsSync(filePath),
                type: type,
                format: ext.substring(1), // remove the dot
                isDefaultSound: true
              });
            }
          }
        }
      }

      console.log(`Diff Sounds: Detected ${detected.length} valid sound files (${detected.filter(d => d.isUserSound).length} user, ${detected.filter(d => d.isDefaultSound).length} default)`);
      return detected;
    } catch (error) {
      console.error('Diff Sounds: Error scanning sounds folder:', error);
      return detected;
    }
  }

  /**
   * Guesses sound type from filename (case insensitive, flexible matching)
   */
  private guessSoundType(filename: string): 'add' | 'remove' | 'diffopen' | 'diffactive' | 'diffclose' | null {
    const lowerFilename = filename.toLowerCase();

    // Check for 'diffopen' keywords
    if (lowerFilename.includes('diffopen') || lowerFilename.includes('diff-open') || lowerFilename.includes('diff_open') || lowerFilename === 'diffopen') {
      return 'diffopen';
    }

    // Check for 'diffactive' keywords
    if (lowerFilename.includes('diffactive') || lowerFilename.includes('diff-active') || lowerFilename.includes('diff_active') || lowerFilename === 'diffactive') {
      return 'diffactive';
    }

    // Check for 'diffclose' keywords
    if (lowerFilename.includes('diffclose') || lowerFilename.includes('diff-close') || lowerFilename.includes('diff_close') || lowerFilename === 'diffclose') {
      return 'diffclose';
    }

    // Check for 'add' keywords
    if (lowerFilename.includes('add') || lowerFilename.includes('insert') || lowerFilename.includes('create') || lowerFilename === 'plus') {
      return 'add';
    }

    // Check for 'remove' keywords
    if (lowerFilename.includes('remove') || lowerFilename.includes('delete') || lowerFilename.includes('cut') || lowerFilename === 'minus') {
      return 'remove';
    }

    return null;
  }

  /**
   * Finds the best matching file for a sound type
   */
  findBestMatch(detectedFiles: DetectedSoundFile[], soundType: 'add' | 'remove' | 'diffopen' | 'diffactive' | 'diffclose'): DetectedSoundFile | null {
    // First, look for exact filename matches
    let exactMatch = detectedFiles.find(f =>
      f.type === soundType &&
      path.basename(f.filename, path.extname(f.filename)).toLowerCase() === soundType
    );

    if (exactMatch) {
      return exactMatch;
    }

    // Then look for any file with the correct type
    const typeMatches = detectedFiles.filter(f => f.type === soundType);
    if (typeMatches.length > 0) {
      // Prefer WAV files, then MP3, then others
      return typeMatches.find(f => f.format === 'wav') ||
             typeMatches.find(f => f.format === 'mp3') ||
             typeMatches[0];
    }

    return null;
  }

  /**
   * Updates config with detected sound information
   */
  async updateConfigWithDetectedFiles(config: DiffSoundsConfig): Promise<DiffSoundsConfig> {
    const detectedFiles = await this.scanSoundFiles();

    // Update add sound
    const addMatch = this.findBestMatch(detectedFiles, 'add');
    if (addMatch) {
      config.addSound.filename = addMatch.filename;
      config.addSound.isDefault = addMatch.isDefaultSound || false;
      const source = addMatch.isUserSound ? 'user' : addMatch.isDefaultSound ? 'defaults' : 'unknown';
      console.log(`Diff Sounds: Found add sound: ${addMatch.filename} (from ${source})`);
    } else {
      console.log('Diff Sounds: No add sound files detected');
    }

    // Update remove sound
    const removeMatch = this.findBestMatch(detectedFiles, 'remove');
    if (removeMatch) {
      config.removeSound.filename = removeMatch.filename;
      config.removeSound.isDefault = removeMatch.isDefaultSound || false;
      const source = removeMatch.isUserSound ? 'user' : removeMatch.isDefaultSound ? 'defaults' : 'unknown';
      console.log(`Diff Sounds: Found remove sound: ${removeMatch.filename} (from ${source})`);
    } else {
      console.log('Diff Sounds: No remove sound files detected');
    }

    // Update diffopen sound
    const diffOpenMatch = this.findBestMatch(detectedFiles, 'diffopen');
    if (diffOpenMatch) {
      config.diffOpenSound.filename = diffOpenMatch.filename;
      config.diffOpenSound.isDefault = diffOpenMatch.isDefaultSound || false;
      const source = diffOpenMatch.isUserSound ? 'user' : diffOpenMatch.isDefaultSound ? 'defaults' : 'unknown';
      console.log(`Diff Sounds: Found diffopen sound: ${diffOpenMatch.filename} (from ${source})`);
    } else {
      console.log('Diff Sounds: No diffopen sound files detected');
    }

    // Update diffactive sound
    const diffActiveMatch = this.findBestMatch(detectedFiles, 'diffactive');
    if (diffActiveMatch) {
      config.diffActiveSound.filename = diffActiveMatch.filename;
      config.diffActiveSound.isDefault = diffActiveMatch.isDefaultSound || false;
      const source = diffActiveMatch.isUserSound ? 'user' : diffActiveMatch.isDefaultSound ? 'defaults' : 'unknown';
      console.log(`Diff Sounds: Found diffactive sound: ${diffActiveMatch.filename} (from ${source})`);
    } else {
      console.log('Diff Sounds: No diffactive sound files detected');
    }

    // Update diffclose sound
    const diffCloseMatch = this.findBestMatch(detectedFiles, 'diffclose');
    if (diffCloseMatch) {
      config.diffCloseSound.filename = diffCloseMatch.filename;
      config.diffCloseSound.isDefault = diffCloseMatch.isDefaultSound || false;
      const source = diffCloseMatch.isUserSound ? 'user' : diffCloseMatch.isDefaultSound ? 'defaults' : 'unknown';
      console.log(`Diff Sounds: Found diffclose sound: ${diffCloseMatch.filename} (from ${source})`);
    } else {
      console.log('Diff Sounds: No diffclose sound files detected');
    }

    return config;
  }

  /**
   * Gets the full file path for a sound entry
   */
  getSoundFilePath(soundEntry: SoundEntry): string {
    if (soundEntry.filename) {
      // Use Defaults subfolder if it's a default sound, otherwise use main sounds folder
      const subfolder = soundEntry.isDefault ? 'Defaults' : '';
      return path.join(this.extensionPath, this.soundsFolder, subfolder, soundEntry.filename);
    }
    return '';
  }

  /**
   * Validates if a sound file exists
   */
  soundFileExists(soundEntry: SoundEntry): boolean {
    const filePath = this.getSoundFilePath(soundEntry);
    if (!filePath) return false;
    return fs.existsSync(filePath);
  }

  /**
   * Restores default sound files to the user sounds folder
   */
  async restoreDefaults(): Promise<void> {
    const userSoundsPath = path.join(this.extensionPath, this.soundsFolder);
    const defaultsPath = path.join(userSoundsPath, 'Defaults');

    console.log('SoundDetector: Restoring default sounds from', defaultsPath, 'to', userSoundsPath);

    try {
      // Ensure both directories exist
      if (!fs.existsSync(userSoundsPath)) {
        fs.mkdirSync(userSoundsPath, { recursive: true });
      }
      if (!fs.existsSync(defaultsPath)) {
        throw new Error('Defaults folder not found');
      }

      // Copy default files to user sounds folder
      const defaultFiles = fs.readdirSync(defaultsPath);

      for (const file of defaultFiles) {
        // Skip README file
        if (file === 'README.txt') continue;

        const sourcePath = path.join(defaultsPath, file);
        const targetPath = path.join(userSoundsPath, file);

        // Copy the file
        fs.copyFileSync(sourcePath, targetPath);
        console.log('SoundDetector: Restored', file, 'to user sounds folder');
      }

    } catch (error) {
      console.error('SoundDetector: Error restoring defaults:', error);
      throw error;
    }
  }
}
