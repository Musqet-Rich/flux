import { qrMatrix } from './qr-matrix.ts';
import { renderQr } from './render-qr.ts';

// The one call the CLI makes to show a pairing QR: a URL to the printable half-block block.
// Composing the encode (`qrMatrix`) and the render (`renderQr`) here keeps index.ts from importing
// both steps, which also keeps it inside its per-file dependency budget.
export const pairingQr = (url: string, invert: boolean): string => renderQr(qrMatrix(url), invert);
