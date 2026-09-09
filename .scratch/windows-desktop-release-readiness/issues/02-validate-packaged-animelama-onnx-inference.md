# 02: Validate Packaged AnimeLaMa ONNX Inference

**What to build:** A Windows reviewer can prove that the staged production runtime really executes AnimeLaMa on a real image and mask before the release is accepted, using DirectML when supported or the production CPU fallback when DirectML cannot run the model.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] The staged Windows runtime contains ONNX Runtime, the required AnimeLaMa model assets, and all native dependencies required by the production cleaner path.
- [x] Release validation invokes the same AnimeLaMa cleaner path used by a packaged cleaning job rather than a source-only or import-only path.
- [x] A deterministic image-plus-mask inference produces a valid output image with the expected dimensions and no runtime exception.
- [x] DirectML is attempted as the preferred execution provider when it is available and compatible.
- [x] CPU execution is accepted as the supported fallback when DirectML cannot execute the model.
- [x] Validation fails when neither supported provider can execute AnimeLaMa, when the model is missing, or when the production cleaner path cannot load.
- [x] The acceptance path cannot silently substitute AOT, Flat, or another cleaner and still report AnimeLaMa validation success.
- [x] PyTorch importability is not required for the Windows production AnimeLaMa release path.
- [x] The validation result is suitable for use as a release gate and returns an unambiguous failure when the staged runtime is not shippable.
