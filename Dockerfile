# Start from the Debian-based Python slim image
FROM python:3.10-slim

# Set the working directory
WORKDIR /app

# 1. Install all system dependencies first
# We need python tools, nodejs, and native libraries for canvas rendering (Cairo, Pango, etc.)
# Using apt-get because the base image is Debian
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Node.js and npm for the renderer
    nodejs \
    npm \
    # Native dependencies for node-canvas (used by fabric.js in node)
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    # Other utilities from your original file
    ca-certificates \
    curl \
    dos2unix \
    git \
    python3-dev \
    # Clean up apt-get cache to keep the image small
    && rm -rf /var/lib/apt/lists/*

# 2. Install Node.js dependencies
# Copy only the package files first to leverage Docker cache
COPY package*.json ./
# Now that npm is installed, this command will work
RUN npm install && npm rebuild canvas --build-from-source

# 3. Install Python dependencies
# Copy only the requirements file first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. Copy the rest of the application code
COPY . .

# Create defaults directory and backup assets for volume initialization
RUN mkdir -p /defaults && \
    if [ -d "overlays" ]; then cp -r overlays /defaults/; fi && \
    if [ -d "textures" ]; then cp -r textures /defaults/; fi && \
    if [ -d "fonts" ]; then cp -r fonts /defaults/; fi && \
    if [ -d "custom_icons" ]; then cp -r custom_icons /defaults/; fi

# Setup entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN dos2unix /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]

# Expose the port
EXPOSE 5000

# Run the application
CMD ["python", "gui_editor.py"]
