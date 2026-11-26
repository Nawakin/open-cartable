let detector;

function localDetector() {
  detector ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/face-detector/human.js';
    script.onload = () => {
      try {
        const disabled = { enabled: false };
        resolve(new globalThis.Human.Human({
          backend: 'cpu', cacheModels: false, modelBasePath: '/face-detector/',
          filter: disabled, gesture: disabled, body: disabled, hand: disabled, object: disabled, segmentation: disabled,
          face: {
            enabled: true, detector: { maxDetected: 20, scale: 1, minConfidence: 0.35 },
            mesh: disabled, attention: disabled, iris: disabled, emotion: disabled,
            description: disabled, antispoof: disabled, liveness: disabled,
          },
        }));
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = reject;
    document.head.append(script);
  }).catch((error) => { detector = null; throw error; });
  return detector;
}

export async function detectFaceBoxes(image) {
  if (typeof globalThis.FaceDetector === 'function') {
    try {
      const native = new globalThis.FaceDetector({ maxDetectedFaces: 20, fastMode: false });
      return (await native.detect(image)).map(({ boundingBox }) => boundingBox);
    } catch {
      // L'interface du navigateur peut exister alors que le système ne fournit aucun détecteur.
    }
  }
  const engine = await localDetector();
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = await engine.detect(canvas);
  return result.face.map(({ boxRaw: [x, y, width, height] }) => ({
    x: x * image.naturalWidth, y: y * image.naturalHeight,
    width: width * image.naturalWidth, height: height * image.naturalHeight,
  }));
}
