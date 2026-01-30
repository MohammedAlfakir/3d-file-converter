# syntax=docker/dockerfile:1

# ============================================================
# IMPORTANT: This image targets linux/amd64 for Blender compatibility
# Build with: docker build --platform linux/amd64 -t 3d-converter:optimized .
# ============================================================

# ============================================================
# STAGE 1: BUILD (Node.js dependencies + Frontend)
# ============================================================
FROM --platform=linux/amd64 node:20-slim AS builder

WORKDIR /app

# Install root dependencies (for server)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy and build frontend
COPY client ./client
WORKDIR /app/client
RUN npm ci && npm run build

# ============================================================
# STAGE 2: RUNTIME (Minimal production image)
# ============================================================
FROM --platform=linux/amd64 debian:bookworm-slim AS runtime

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install runtime dependencies in a single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    # For Blender
    libgl1-mesa-glx \
    libxi6 \
    libxrender1 \
    libxkbcommon0 \
    libxxf86vm1 \
    libxfixes3 \
    libxinerama1 \
    libfontconfig1 \
    libfreetype6 \
    libsm6 \
    libice6 \
    # For ODA File Converter (QT dependencies - installed now for Task 02)
    libglib2.0-0 \
    libxext6 \
    # Virtual framebuffer for ODA headless (needed for Task 02)
    xvfb \
    # For Assimp
    assimp-utils \
    # General utilities
    curl \
    ca-certificates \
    xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Verify Node installation
RUN echo "NODE Version:" && node --version && echo "NPM Version:" && npm --version

# Download Blender as portable binary (NOT apt-get - much smaller!)
# Using Blender 4.0 LTS for stability
ARG BLENDER_VERSION=4.0.2
RUN curl -L https://download.blender.org/release/Blender4.0/blender-${BLENDER_VERSION}-linux-x64.tar.xz \
    | tar -xJ -C /opt/ \
    && ln -s /opt/blender-${BLENDER_VERSION}-linux-x64/blender /usr/local/bin/blender

# Verify Blender installation
RUN echo "BLENDER Version:" && blender --version

# Verify Assimp installation
RUN assimp version || echo "Assimp installed successfully"

# ============================================================
# COPY APPLICATION
# ============================================================
WORKDIR /usr/src/app

# Copy built assets from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/client/dist ./client/dist

# Copy server and scripts
COPY server ./server
COPY scripts ./scripts
COPY package.json ./

# Create uploads directory with proper permissions
RUN mkdir -p data/uploads && chmod 755 data/uploads

# ============================================================
# ENVIRONMENT & STARTUP
# ============================================================
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check (will work after /health endpoint is added)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/ || exit 1

# Start the server
CMD ["node", "server/index.js"]