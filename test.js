const fs = require('fs');

async function test() {
  const envFile = fs.readFileSync('.env.local', 'utf8');
  const apiKey = envFile.split('GEMINI_API_KEY=')[1].split('\n')[0].trim();
  if (!apiKey) {
    console.error("No API key");
    return;
  }

  // Create a minimal 1x1 white pixel base64
  const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
  
  const payload = {
    contents: [{
      parts: [
        { text: "Translate this to Thai. Return valid JSON." },
        {
          inlineData: {
            mimeType: "image/png",
            data: imageBase64
          }
        }
      ]
    }]
  };

  const MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-flash-lite-latest",
    "gemini-1.5-flash"
  ];

  for (const model of MODELS) {
    console.log(`Testing model: ${model}`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      console.log(`Status ${res.status}:`, data.error ? data.error.message : "Success");
    } catch (e) {
      console.error("Fetch error:", e);
    }
  }
}
test();
