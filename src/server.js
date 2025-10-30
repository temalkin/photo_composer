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
const FONT_FAMILY = process.env.FONT_FAMILY || 'Helvetica';
const JPEG_QUALITY = process.env.JPEG_QUALITY ? Number(process.env.JPEG_QUALITY) : 90;
const TEXT_COLOR = process.env.TEXT_COLOR || '#000000';
const TEXT_BG_COLOR = process.env.TEXT_BG_COLOR || '#ffffff';
const TEXT_BG_OPACITY = process.env.TEXT_BG_OPACITY ? Number(process.env.TEXT_BG_OPACITY) : 0.85; // 0..1

// Default layout and template
// Adjust these values to match your actual template image
const DEFAULT_TEMPLATE_NAME = process.env.TEMPLATE_NAME || 'default';
const TEMPLATE_PATH = process.env.TEMPLATE_PATH || path.join(__dirname, '..', 'assets', 'templates', `${DEFAULT_TEMPLATE_NAME}.png`);

// Coordinates in pixels for placing the cropped photo and text fields
// Example assumes a ~1200x1800 template; tweak for your actual template
const LAYOUT = {
  canvasWidth: 1200,
  canvasHeight: 1800,
  photoBox: { x: 1250, y: 770, width: 846, height: 1057 }, // 4:5 aspect
  text: {
    name: { x: 250, y: 830, fontSize: 65 },
    agentNumber: { x: 930, y: 1100, fontSize: 40 },
    city: { x: 450, y: 1219, fontSize: 48 },
    eyeColor: { x: 550, y: 1330, fontSize: 48 },
    cover: { x: 600, y: 1463, fontSize: 48 },
    recruitmentDate: { x: 700, y: 1587, fontSize: 48 }
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
 * Render text to raster buffer with transparent background and trim to content bounds.
 */
async function renderTextBitmap(text, options) {
  const { fontSize, fill = TEXT_COLOR, fontFamily = FONT_FAMILY } = options;
  const safeText = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const width = 4096; // large canvas to avoid clipping; will be trimmed
  const height = Math.max(64, Math.ceil(fontSize * 2));
  const y = Math.ceil(height * 0.5); // mid baseline to keep ascenders/descenders before trim
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <style>
    text { font-family: ${fontFamily}; font-size: ${fontSize}px; font-weight: 700; fill: ${fill}; dominant-baseline: middle; alignment-baseline: middle; }
  </style>
  <text x="0" y="${y}">${safeText}</text>
</svg>`;
  const svgBuffer = Buffer.from(svg);
  const { data, info } = await sharp(svgBuffer)
    .png()
    .trim() // trim transparent
    .toBuffer({ resolveWithObject: true });
  return { image: data, width: info.width, height: info.height };
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
 *  - overlay texts in uppercase at configured coordinates, with auto-sized background panels
 */
async function composeImage(photoBuffer, fields) {
  ensureTemplateExists();

  const template = sharp(TEMPLATE_PATH);
  const { photoBox, text } = LAYOUT;

  const processedPhoto = await processPhotoToBox(photoBuffer, photoBox.width, photoBox.height);

  // Prepare text overlays positioned with left/top
  const overlays = [];

  async function addTextOverlay(key, value) {
    const cfg = text[key];
    if (!cfg) return;
    const content = toUppercaseLocale(value);
    if (!content) return;
    const padding = Math.ceil(cfg.fontSize * 0.6);
    const rendered = await renderTextBitmap(content, { fontSize: cfg.fontSize });
    const panelW = rendered.width + padding * 2;
    const panelH = rendered.height + padding * 2;
    // Background rectangle as SVG
    const panelSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${panelW}" height="${panelH}">
  <rect x="0" y="0" width="${panelW}" height="${panelH}" fill="${TEXT_BG_COLOR}" fill-opacity="${TEXT_BG_OPACITY}" rx="6" ry="6"/>
</svg>`;
    overlays.push({ input: Buffer.from(panelSvg), left: cfg.x, top: cfg.y });
    const textLeft = cfg.x + Math.floor((panelW - rendered.width) / 2);
    const textTop = cfg.y + Math.floor((panelH - rendered.height) / 2);
    overlays.push({ input: rendered.image, left: textLeft, top: textTop });
  }

  await addTextOverlay('name', fields.name);
  await addTextOverlay('agentNumber', fields.agentNumber);
  await addTextOverlay('city', fields.city);
  await addTextOverlay('eyeColor', fields.eyeColor);
  await addTextOverlay('cover', fields.cover);
  await addTextOverlay('recruitmentDate', fields.recruitmentDate);

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


