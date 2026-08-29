import type { Bytes } from './bytes.ts';

// Raw deflate via the platform streams (protocol.md § 3, Compression). Blob and Response are the
// shortest platform route from bytes to a stream and back; both exist in browsers and Node 24.

const through = async (data: Bytes, stream: GenericTransformStream): Promise<Bytes> =>
  new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());

const deflate = (data: Bytes): Promise<Bytes> =>
  through(data, new CompressionStream('deflate-raw'));

const inflate = (data: Bytes): Promise<Bytes> =>
  through(data, new DecompressionStream('deflate-raw'));

export const compress: { deflate: typeof deflate; inflate: typeof inflate } = {
  deflate,
  inflate,
};
