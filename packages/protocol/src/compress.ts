import type { Bytes } from './bytes.ts';

// Raw deflate via the platform streams (protocol.md § 3, Compression). Blob and Response are the
// shortest platform route from bytes to a stream and back; both exist in browsers and Node 24.

// Structural rather than the lib's GenericTransformStream so the same source type-checks under
// both the DOM lib (pwa) and @types/node (daemon, relay).
interface ByteTransform {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<ArrayBufferView | ArrayBuffer>;
}

const through = async (data: Bytes, stream: ByteTransform): Promise<Bytes> =>
  new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());

const deflate = (data: Bytes): Promise<Bytes> =>
  through(data, new CompressionStream('deflate-raw'));

const inflate = (data: Bytes): Promise<Bytes> =>
  through(data, new DecompressionStream('deflate-raw'));

export const compress: { deflate: typeof deflate; inflate: typeof inflate } = {
  deflate,
  inflate,
};
