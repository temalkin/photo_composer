FROM node:20-bullseye-slim AS base

# Add free fonts for SVG text rendering
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    fonts-liberation \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./

# Development image with nodemon (dev deps installed)
FROM base AS dev
RUN npm install
COPY . .
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Production image (no dev deps)
FROM base AS prod
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]


