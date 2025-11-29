# Change Log

## [0.0.3] - 2025-11-29
- **Bug fixes**:
  - Fixed audio context resume issues when re-enabling extension
  - Fixed spurious sound restarts during disable/enable operations
  - Fixed diffactive sound looping endlessly when tabs close
  - Fixed diffclose sound not playing when last diff tab closes
  - Improved state management for extension enable/disable
  - Fixed race conditions in config change handling
- **Volume adjustments**: Optimized default sound volumes (Add/Remove: 50%, Diff sounds: 100%)
- **Publishing fixes**: Removed SVG images from README for marketplace compatibility

## [0.0.1] - 2025-11-23
- Initial release of Diff Sounds (Cline) extension
- Basic diff detection with configurable sounds
- Attribution modes: any, live-only, git-only
- Debounced sound playback
