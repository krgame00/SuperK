# Text Color Extraction Experiment

The user approved trying the recommended mask/Lab approach. First deliver a local comparison, without switching production extraction or adding controls.

Compare the existing TypeScript extractor on original pixels with OpenCV clustering in RGB and float CIELAB. Use synthetic red/yellow text over artwork, white outlined text, thin text, and mixed backgrounds. Separate glyph interior from outline using bounded distance-transform support. Known synthetic glyph masks are an upper-bound experiment, not a claim that cleaning masks provide the same accuracy.

Record exact expected colors, extracted colors, perceptual Lab distance (Delta E 76 for this first experiment), mask assumptions, and failure cases. Generate a standalone visual report. Keep original source pixels; no paid API calls, new dependencies, production restart, or auto commit/push. Only propose production integration if results justify it. A later stage must validate real labeled crops and a glyph segmentation source distinct from expanded removal masks. Eyedropper controls and Delta E 2000 are deferred from this experiment.
