# Test Fixtures

This directory stores reusable local fixtures for test scripts.

- `sample-input-image.png.base64`: base64-encoded 256x256 PNG.

Both `scripts/test-image-ivi.ts` and `scripts/test-video-flf.ts` will auto-generate:

- `sample-input-image.png`

from the base64 file when the PNG does not exist.

Current fixture image size is 256x256.
