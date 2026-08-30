FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (needed for OpenCV and generic image processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.in ./

# Install dependencies directly from requirements.in to resolve platform markers for Linux
RUN pip install --no-cache-dir -r requirements.in

# Copy application code
COPY . .

EXPOSE 8765

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765"]
