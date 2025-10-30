'use strict';

const path = require('path');
const fs = require('fs');
const Fastify = require('fastify');
const multipart = require('@fastify/multipart');
const sharp = require('sharp');
require('dotenv').config();

// Configuration
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '0.0.0.0';
const FONT_FAMILY = process.env.FONT_FAMILY || 'Helvetica, "Liberation Sans", Arial, sans-serif';
const JPEG_QUALITY = process.env.JPEG_QUALITY ? Number(process.env.JPEG_QUALITY) : 90;

// Default layout and template
// Adjust these values to match your actual template image
const DEFAULT_TEMPLATE_NAME = process.env.TEMPLATE_NAME || 'default';
const TEMPLATE_PATH = process.env.TEMPLATE_PATH || path.join(__dirname, '..', 'assets', 'templates', `${DEFAULT_TEMPLATE_NAME}.png`);

// Coordinates in pixels for placing the cropped photo and text fields
// Example assumes a ~1200x1800 template; tweak for your actual template
const LAYOUT = {
  canvasWidth: 1200,
  canvasHeight: 1800,
  photoBox: { x: 1250, y: 770, width: 844, height: 1055 }, // 4:5 aspect
  text: {
    name: { x: 820, y: 300, fontSize: 100 },
    agentNumber: { x: 820, y: 360, fontSize: 36 },
    city: { x: 820, y: 420, fontSize: 36 },
    eyeColor: { x: 820, y: 480, fontSize: 36 },
    cover: { x: 820, y: 540, fontSize: 36 },
    recruitmentDate: { x: 820, y: 600, fontSize: 36 }
  }
};

function ensureTemplateExists() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    const hint = `Template not found at ${TEMPLATE_PATH}. Place your template image there or set TEMPLATE_PATH.`;
    const error = new Error(hint);
    error.statusCode = 500;
    throw error;
  }
}

/**
 * Read a stream fully into a Buffer
 */
async function readStreamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Uppercase with reasonable locale defaults for Cyrillic/Latin
 */
function toUppercaseLocale(value) {
  if (typeof value !== 'string') return '';
  return value.toLocaleUpperCase('ru-RU');
}

/**
 * Create an SVG buffer with single-line text.
 */
function createTextSVG(text, options) {
  const { fontSize, width, height, fill = '#000000', fontFamily = FONT_FAMILY } = options;
  const safeText = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <style>
    text { font-family: ${fontFamily}; font-size: ${fontSize}px; fill: ${fill}; dominant-baseline: hanging; }
  </style>
  <text x="0" y="0">${safeText}</text>
</svg>`;
  return Buffer.from(svg);
}

/**
 * Process photo: crop to 4:5 and resize to target box using cover fit.
 */
async function processPhotoToBox(inputBuffer, targetWidth, targetHeight) {
  // Use fit: cover with target box and a 4:5 aspect preserved by the target box itself
  return await sharp(inputBuffer)
    .rotate()
    .resize({ width: targetWidth, height: targetHeight, fit: 'cover', position: 'attention' })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

/**
 * Compose final image:
 *  - place cropped photo into template at photoBox
 *  - overlay texts in uppercase at configured coordinates
 */
async function composeImage(photoBuffer, fields) {
  ensureTemplateExists();

  const template = sharp(TEMPLATE_PATH);
  const { photoBox, text } = LAYOUT;

  const processedPhoto = await processPhotoToBox(photoBuffer, photoBox.width, photoBox.height);

  // Prepare text overlays as small SVGs positioned with left/top
  const overlays = [];

  function addTextOverlay(key, value) {
    const cfg = text[key];
    if (!cfg) return;
    const content = toUppercaseLocale(value);
    // Create a compact svg box; width heuristic: ~0.6em per character
    const approxWidth = Math.max(200, Math.ceil(content.length * (cfg.fontSize * 0.6)));
    const svg = createTextSVG(content, { width: approxWidth, height: Math.ceil(cfg.fontSize * 1.6), fontSize: cfg.fontSize });
    overlays.push({ input: svg, left: cfg.x, top: cfg.y });
  }

  addTextOverlay('name', fields.name);
  addTextOverlay('agentNumber', fields.agentNumber);
  addTextOverlay('city', fields.city);
  addTextOverlay('eyeColor', fields.eyeColor);
  addTextOverlay('cover', fields.cover);
  addTextOverlay('recruitmentDate', fields.recruitmentDate);

  const result = await template
    .composite([
      { input: processedPhoto, left: photoBox.x, top: photoBox.y },
      ...overlays
    ])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  return result;
}

const fastify = Fastify({ logger: true });

fastify.register(multipart, {
  attachFieldsToBody: false,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
    files: 1
  }
});

fastify.get('/healthz', async (req, reply) => {
  return { status: 'ok' };
});

// Expected multipart/form-data fields:
// - name, agentNumber, city, eyeColor, cover, recruitmentDate (strings)
// - photo (file)
fastify.post('/compose', async (req, reply) => {
  const parts = req.parts();
  let photoBuffer = null;
  const fields = { name: '', agentNumber: '', city: '', eyeColor: '', cover: '', recruitmentDate: '' };

  for await (const part of parts) {
    if (part.type === 'file') {
      if (part.fieldname === 'photo') {
        photoBuffer = await readStreamToBuffer(part.file);
      } else {
        // drain unexpected files
        // eslint-disable-next-line no-empty
        for await (const _ of part.file) {}
      }
    } else {
      const value = typeof part.value === 'string' ? part.value : String(part.value ?? '');
      if (part.fieldname in fields) {
        fields[part.fieldname] = value;
      }
    }
  }

  if (!photoBuffer) {
    reply.code(400).send({ error: 'Missing file field "photo"' });
    return;
  }

  try {
    const output = await composeImage(photoBuffer, fields);
    reply.header('Content-Type', 'image/jpeg');
    reply.header('Content-Disposition', 'inline; filename="composed.jpg"');
    reply.send(output);
  } catch (err) {
    req.log.error({ err }, 'compose failed');
    const status = err.statusCode || 500;
    reply.code(status).send({ error: err.message || 'Internal Server Error' });
  }
});

if (require.main === module) {
  fastify.listen({ port: PORT, host: HOST })
    .then(address => {
      fastify.log.info(`listening at ${address}`);
    })
    .catch(err => {
      fastify.log.error(err);
      process.exit(1);
    });
}


