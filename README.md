# Diff Sounds

A VS Code extension that provides audio feedback when editing in diff/compare views. Features immersive tech sounds perfect for developers who enjoy cinematic programming audio during code reviews.

## Features

- **Real-time Audio Feedback**: Plays sounds when editing in VS Code diff/compare views
- **Individual Volume Controls**: Separate volume settings for add/remove sounds and master volume
- **Customizable Sounds**: Easy access to sound files for customization
- **Enable/Disable Toggle**: Quick commands to turn sounds on/off
- **Test Functions**: Built-in sound testing from the settings panel
- **Cross-platform Support**: Works on Windows, macOS, and Linux

## Current Status

This extension currently provides audio feedback for **all diff/compare view editing** in VS Code. Future updates may include advanced attribution features for specific author filtering.

## Future Plans

Advanced attribution features are planned for future releases:
- **Author-specific filtering**: Play sounds only for edits by specific users
- **Live Share integration**: Enhanced collaborative editing support
- **Git author matching**: Filter by git commit authors
- **Custom attribution rules**: Flexible sound triggering conditions

These features are currently under development and not yet functional.

## Installation & Setup

1. Clone or download this extension repository
2. Run `npm install` to install dependencies
3. Compile with `npm run compile` (TypeScript)
4. Open in VS Code Extension Development Host:
   - Press F5 or use Command Palette: "Debug: Start Debugging"
   - Select "Run Extension"
5. Test in the new window

### Packaging to VSIX
- Install `vsce` globally: `npm install -g vsce`
- Run `vsce package` to create `.vsix` file
- Install via VS Code: Extensions > Install from VSIX...

## Usage

1. **Install** the extension from VS Code marketplace
2. **Enable Sounds**: Extension works automatically in diff views
3. **Adjust Settings**: Use Command Palette → "Preferences: Open Settings (UI)" → search "Diff Sounds"
4. **Customize Volume**: Set master volume and individual sound volumes
5. **Test Sounds**: Use the settings panel to test your audio setup

### What are Diff Views?

Diff views include:
- Git compare editors (side-by-side file comparison)
- Commit diff views
- Branch comparison views
- Any VS Code compare/diff window

### Settings

- **Enabled**: Enable/disable the entire feature (default: true)
- **Master Volume**: Overall volume level (0-100, default: 100)
- **Add Sound Enabled**: Toggle add sound on/off (default: true)
- **Add Sound Volume**: Volume for addition sounds (0-100, default: 50)
- **Remove Sound Enabled**: Toggle remove sound on/off (default: true)
- **Remove Sound Volume**: Volume for deletion sounds (0-100, default: 50)
- **Debounce Delay**: Milliseconds to prevent sound spam (default: 1ms)

### Commands
- **Diff Sounds: Enable**: Enable sounds
- **Diff Sounds: Disable**: Disable sounds
- **Diff Sounds: Test Add Sound**: Play add sound
- **Diff Sounds: Test Remove Sound**: Play remove sound

## Custom Sounds

To use your own audio files instead of the defaults:

1. Click "Open Sounds Folder" in the extension settings
2. **Important**: Modify files in the main `sounds/` folder (not `sounds/Defaults/`)
3. **Important**: Keep the exact same filenames so the extension can recognize your sounds
4. Replace these files with your WAV/MP3 files:
   - `sounds/add.wav` - Sound for additions
   - `sounds/remove.wav` - Sound for deletions
   - `sounds/diffopen.wav` - Sound when opening diff
   - `sounds/diffactive.wav` - Background sound during editing
   - `sounds/diffclose.wav` - Sound when closing diff
5. Click "Reload Sounds" to apply your changes

**Note**: The `sounds/Defaults/` folder contains backup files - do not modify them directly.

## Audio Credits

Default sound effects are modified versions from [Mixkit](https://mixkit.co/free-sound-effects/), licensed for free personal and commercial use with attribution.

## Contributing

Found a bug or want to suggest a feature? Visit our [GitHub repository](https://github.com/VibeKits/diff-sounds) to:
- Report issues
- Request features
- Contribute code
- View the source

## Requirements

- VS Code 1.74.0+
- No additional dependencies required

## License

MIT License - see LICENSE file.
