import json
import os

transcript_path = r"C:\Users\PC\.gemini\antigravity-ide\brain\ba38ae32-92ec-4628-9dd1-a715b01ad279\.system_generated\logs\transcript_full.jsonl"

with open(transcript_path, "r", encoding="utf-8") as f:
    for line in f:
        if "build_lama_large" in line and "def build_lama_large" in line:
            idx = line.find("def build_lama_large")
            print(line[max(0, idx - 200):idx + 300])
            print("=" * 40)
