import type { Ref } from 'vue';
import { onUnmounted, ref } from 'vue';

// Camera QR scanning through the platform's BarcodeDetector (engineering.md § Dependencies:
// no qrcode library). Browsers without it, or without a camera, report `supported` false and
// the pair screen falls back to a pasted link.

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

export const useScanner = (onValue: (value: string) => void): Scanner => {
  const Detector = detectorClass();
  const video = ref<HTMLVideoElement | null>(null);
  const active = ref(false);
  let stream: MediaStream | null = null;
  let frame = 0;

  const stop = (): void => {
    cancelAnimationFrame(frame);
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    active.value = false;
  };

  const start = async (): Promise<void> => {
    const element = video.value;
    if (Detector === null || element === null) return;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    element.srcObject = stream;
    await element.play();
    active.value = true;
    const detector = new Detector({ formats: ['qr_code'] });
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

  onUnmounted(stop);
  return { supported: Detector !== null, active, video, start, stop };
};
