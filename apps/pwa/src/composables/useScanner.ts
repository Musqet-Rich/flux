import type { Ref } from 'vue';
import { onUnmounted, ref } from 'vue';

// Camera QR scanning through the platform's BarcodeDetector (engineering.md § Dependencies:
// no qrcode library). Browsers without it, or without a camera, report `supported` false and
// the pair screen falls back to a pasted link; a refused camera lands in `error`.

interface Detected {
  rawValue: string;
}

interface Detector {
  detect: (source: HTMLVideoElement) => Promise<Detected[]>;
}

interface DetectorClass {
  new (options: { formats: string[] }): Detector;
}

export interface Scanner {
  supported: boolean;
  active: Ref<boolean>;
  error: Ref<string | null>;
  video: Ref<HTMLVideoElement | null>;
  start: () => Promise<void>;
  stop: () => void;
}

// The DOM lib has no BarcodeDetector types yet; a constructor under that name is taken as it.
const isDetectorClass = (value: unknown): value is DetectorClass => typeof value === 'function';

const detectorClass = (): DetectorClass | null => {
  const candidate: unknown = Reflect.get(globalThis, 'BarcodeDetector');
  return isDetectorClass(candidate) ? candidate : null;
};

const openCamera = async (element: HTMLVideoElement): Promise<MediaStream> => {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
  });
  element.srcObject = stream;
  await element.play();
  return stream;
};

export const useScanner = (onValue: (value: string) => void): Scanner => {
  const Detector = detectorClass();
  const video = ref<HTMLVideoElement | null>(null);
  const active = ref(false);
  const error = ref<string | null>(null);
  let stream: MediaStream | null = null;
  let frame = 0;

  const stop = (): void => {
    cancelAnimationFrame(frame);
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    active.value = false;
  };

  const scan = (element: HTMLVideoElement, detector: Detector): void => {
    const tick = async (): Promise<void> => {
      if (!active.value) return;
      const [code] = await detector.detect(element).catch((): Detected[] => []);
      if (code !== undefined) {
        stop();
        onValue(code.rawValue);
        return;
      }
      frame = requestAnimationFrame(() => {
        void tick();
      });
    };
    void tick();
  };

  const start = async (): Promise<void> => {
    const element = video.value;
    if (Detector === null || element === null) return;
    error.value = null;
    try {
      stream = await openCamera(element);
    } catch {
      stop();
      error.value = 'Camera unavailable; paste the link instead.';
      return;
    }
    active.value = true;
    scan(element, new Detector({ formats: ['qr_code'] }));
  };

  onUnmounted(stop);
  return { supported: Detector !== null, active, error, video, start, stop };
};
