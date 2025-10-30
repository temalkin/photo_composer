FROM node:20-bullseye-slim AS base

# Add free fonts for SVG text rendering
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./

# Development image with nodemon (dev deps installed)
FROM base AS dev
RUN npm install
COPY . .
RUN mkdir -p /usr/local/share/fonts/custom \
  && cp -r assets/fonts/. /usr/local/share/fonts/custom/ 2>/dev/null || true \
  && fc-cache -f -v
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Production image (no dev deps)
FROM base AS prod
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /usr/local/share/fonts/custom \
  && cp -r assets/fonts/. /usr/local/share/fonts/custom/ 2>/dev/null || true \
  && fc-cache -f -v
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]


