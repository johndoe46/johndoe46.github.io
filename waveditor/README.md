# Waveditor

A local audio waveform editor copied from <https://acasa.bontards.com/waveditor/>
and restyled with the same Atari-style monochrome theme as the site index.

Changes from the original copy:

- Vendored Bootstrap 5.3.8 and Bootstrap Icons 1.11.3 under `lib/` so the page
  does not depend on a CDN.
- Added the site menu bar, window chrome, CRT scanlines, and the `theme.css`
  monochrome skin.
- Renamed the browser title from the original internal name to Waveditor.
- Switched the canvas channel labels to the monospace UI font.

All audio processing stays in the browser. No file is uploaded.
