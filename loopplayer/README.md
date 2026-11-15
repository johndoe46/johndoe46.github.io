# Loopplayer / 3030 Music Loop Lab

A local WAV loop player copied from <https://acasa.bontards.com/loopplayer/>
and restyled with the same Atari-style monochrome theme as the site index.

Changes from the original copy:

- Vendored Bootstrap 5.3.3 under `lib/` so the page does not depend on a CDN.
- Forced the dark monochrome theme and added the `theme.css` skin with the
  site menu bar, window chrome, CRT scanlines, slot title bars, and monochrome
  sliders/controls.
- Made the detected-BPM and loop-beats labels visible.
- Switched the slot canvas empty-state text to the monospace UI font.

All audio processing stays in the browser. No file is uploaded.
