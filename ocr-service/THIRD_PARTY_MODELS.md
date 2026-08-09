# Third-party model notices

The local cleaning service does not call a paid API. Model files are downloaded
explicitly and are excluded from Git.

## Comic Text Detector and AOT inpainting

- Source: `lemondouble/lemon-manga-translator`
- Revision: `e8c08f38f188db684fdc32c4cf88627c7df92096`
- License: GPL-3.0-only
- CTD SHA-256:
  `eea9f9ccad2364fcb15bdfeca25268be273fea80b111ba6a6f4c03f556c24c26`
- AOT SHA-256:
  `e0d8f438ca9567eccc9d358963427601b6f64a650cbe6189ec82fc43830a0390`

The baseline service includes GPL-licensed model dependencies. Distribution
must preserve the corresponding notices and comply with GPL-3.0.

## AnimeLaMa

- Source: `df1412/anime-big-lama`
- Revision: upstream `main` file pinned by the checksum below
- License stated by the model card: MIT
- SHA-256:
  `479d3afdcb7ed2fd944ed4ebcc39ca45b33491f0f2e43eb1000bd623cfb41823`

AnimeLaMa is optional and must not become the default until the benchmark and
license record gates pass.
