self.importScripts('https://docs.opencv.org/4.5.4/opencv.js');

self.addEventListener('message', async (e) => {
  const { srcData, maskData, sw, sh, rois } = e.data;
  
  try {
    if (!self.cv || typeof self.cv.Mat !== 'function') {
      const waitForCv = () => new Promise(resolve => {
         const interval = setInterval(() => {
            if (self.cv && typeof self.cv.Mat === 'function') {
               clearInterval(interval);
               resolve();
            }
         }, 100);
      });
      await waitForCv();
    }

    const cv = self.cv;

    let srcMatRaw = cv.matFromImageData(srcData);
    let srcMat = new cv.Mat();
    cv.cvtColor(srcMatRaw, srcMat, cv.COLOR_RGBA2RGB, 0); // cv.inpaint requires 3-channel
    
    let maskMat = cv.matFromImageData(maskData);
    cv.cvtColor(maskMat, maskMat, cv.COLOR_RGBA2GRAY, 0);

    for (let i = 0; i < rois.length; i++) {
       const roi = rois[i];
       const extraPad = 5;
       const x = Math.max(0, Math.floor(roi.x - extraPad));
       const y = Math.max(0, Math.floor(roi.y - extraPad));
       const w = Math.min(sw - x, Math.ceil(roi.w + extraPad * 2));
       const h = Math.min(sh - y, Math.ceil(roi.h + extraPad * 2));

       if (w <= 0 || h <= 0) continue;

       const rect = new cv.Rect(x, y, w, h);
       const roiSrc = srcMat.roi(rect);
       
       // Dynamically generate a mask for text strokes
       const gray = new cv.Mat();
       cv.cvtColor(roiSrc, gray, cv.COLOR_RGB2GRAY, 0);
       
       const meanScalar = cv.mean(gray);
       const isLightBackground = meanScalar[0] > 127;
       
       const textMask = new cv.Mat();
       if (isLightBackground) {
           // Text is dark, background is light.
           // Anything darker than 140 becomes mask (white)
           cv.threshold(gray, textMask, 140, 255, cv.THRESH_BINARY_INV);
       } else {
           // Text is light, background is dark.
           // Anything lighter than 115 becomes mask (white)
           cv.threshold(gray, textMask, 115, 255, cv.THRESH_BINARY);
       }
       
       // Expand mask slightly using a small elliptical kernel to cover antialiased edges
       const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
       cv.dilate(textMask, textMask, kernel, new cv.Point(-1, -1), 2, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
       kernel.delete();
       gray.delete();
       
       // Restrict mask to the original text bounding box (prevent erasing bubble edges in padding area)
       const innerX = roi.x - x;
       const innerY = roi.y - y;
       const bboxMask = cv.Mat.zeros(textMask.rows, textMask.cols, cv.CV_8U);
       const p1 = new cv.Point(Math.max(0, Math.floor(innerX - 2)), Math.max(0, Math.floor(innerY - 2)));
       const p2 = new cv.Point(Math.min(textMask.cols, Math.ceil(innerX + roi.w + 2)), Math.min(textMask.rows, Math.ceil(innerY + roi.h + 2)));
       cv.rectangle(bboxMask, p1, p2, new cv.Scalar(255), -1);
       
       cv.bitwise_and(textMask, bboxMask, textMask);
       bboxMask.delete();
       
       const roiDst = new cv.Mat();
       // Use radius 3 for smoother inpainting
       cv.inpaint(roiSrc, textMask, roiDst, 3, cv.INPAINT_TELEA);
       roiDst.copyTo(roiSrc);
       
       roiSrc.delete();
       textMask.delete();
       roiDst.delete();
    }

    // Convert back to RGBA to put in ImageData
    let outMat = new cv.Mat();
    cv.cvtColor(srcMat, outMat, cv.COLOR_RGB2RGBA, 0);

    const outBuffer = new Uint8ClampedArray(outMat.data);
    
    self.postMessage({ success: true, outData: outBuffer }, [outBuffer.buffer]);

    srcMatRaw.delete();
    srcMat.delete();
    outMat.delete();
    maskMat.delete();
  } catch (err) {
    self.postMessage({ success: false, error: err.toString() });
  }
});
