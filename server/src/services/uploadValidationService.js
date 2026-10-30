const fs = require('node:fs/promises');
const path = require('node:path');
const CFB = require('cfb');
const yauzl = require('yauzl');
const CRC32 = require('crc-32');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { PDFParse } = require('pdf-parse');
const AppError = require('../utils/AppError');

const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20000;
const MAX_PDF_PAGES = 100;
const MAX_EXTRACTED_TEXT_CHARS = 250000;
const MIME_TYPES = {
  pdf: new Set(['application/pdf']),
  ppt: new Set(['application/vnd.ms-powerpoint', 'application/mspowerpoint', 'application/x-mspowerpoint']),
  pptx: new Set([
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/x-zip-compressed',
  ]),
  zip: new Set(['application/zip', 'application/x-zip-compressed']),
};

const getExtension = (filename) => path.extname(filename || '').toLowerCase().slice(1);

const readZipEntries = (buffer) => new Promise((resolve, reject) => {
  yauzl.fromBuffer(buffer, {
    lazyEntries: true,
    validateEntrySizes: true,
    strictFileNames: true,
  }, (openError, zipFile) => {
    if (openError) return reject(openError);

    const names = new Set();
    const capturedParts = new Map();
    let entryCount = 0;
    let uncompressedBytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on('error', fail);
    zipFile.on('end', () => {
      if (settled) return;
      settled = true;
      resolve({ names, capturedParts, entryCount });
    });
    zipFile.on('entry', (entry) => {
      entryCount += 1;
      if (entryCount > MAX_ARCHIVE_ENTRIES) {
        fail(new Error('Archive contains too many entries.'));
        return;
      }
      if (entry.fileName.endsWith('/')) {
        zipFile.readEntry();
        return;
      }
      if (names.has(entry.fileName)) {
        fail(new Error('Archive contains duplicate entry names.'));
        return;
      }
      names.add(entry.fileName);
      uncompressedBytes += entry.uncompressedSize;
      if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
        fail(new Error('Archive expands beyond the supported size.'));
        return;
      }

      zipFile.openReadStream(entry, (streamError, stream) => {
        if (streamError) {
          fail(streamError);
          return;
        }
        const shouldCapture = entry.fileName === '[Content_Types].xml'
          || entry.fileName === 'ppt/presentation.xml';
        const chunks = [];
        let capturedBytes = 0;
        let checksum = 0;
        let entryBytes = 0;
        stream.on('data', (chunk) => {
          checksum = CRC32.buf(chunk, checksum);
          entryBytes += chunk.length;
          if (!shouldCapture) return;
          capturedBytes += chunk.length;
          if (capturedBytes > 1024 * 1024) {
            stream.destroy(new Error('Presentation package metadata is too large.'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('error', fail);
        stream.on('end', () => {
          if (entryBytes !== entry.uncompressedSize || (checksum >>> 0) !== entry.crc32) {
            fail(new Error('Archive entry checksum or size is invalid.'));
            return;
          }
          if (shouldCapture) capturedParts.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
          zipFile.readEntry();
        });
        stream.resume();
      });
    });
    zipFile.readEntry();
  });
});

const extractPdfText = async (buffer) => {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const pageCount = Number(info.total) || 0;
    const pagesToParse = Array.from({ length: Math.min(pageCount, MAX_PDF_PAGES) }, (_, index) => index + 1);
    const result = pagesToParse.length ? await parser.getText({ partial: pagesToParse }) : { text: '' };
    return {
      text: String(result.text || '')
        .replace(/--\s+\d+\s+of\s+\d+\s+--/g, '\f')
        .replace(/[\t\r ]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_EXTRACTED_TEXT_CHARS),
      pageCount,
      pagesAnalyzed: pagesToParse.length,
    };
  } catch {
    throw new AppError('The PDF is malformed, password-protected, or unreadable.', 400);
  } finally {
    await parser.destroy().catch(() => {});
  }
};

const validateUploadContent = async ({ filePath, originalName, mimeType, purpose }) => {
  const extension = getExtension(originalName);
  const allowedExtensions = {
    report: ['pdf'],
    presentation: ['ppt', 'pptx'],
    source: ['zip'],
  }[purpose];
  if (!allowedExtensions || !allowedExtensions.includes(extension)) {
    throw new AppError(`Invalid file type for purpose "${purpose}".`, 400);
  }
  if (!MIME_TYPES[extension]?.has(String(mimeType || '').toLowerCase())) {
    throw new AppError(`The uploaded file MIME type does not match .${extension}.`, 400);
  }

  const buffer = await fs.readFile(filePath);
  if (extension === 'pdf') {
    const header = buffer.subarray(0, 1024).toString('latin1');
    const trailer = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1');
    if (!header.includes('%PDF-') || !trailer.includes('%%EOF')) {
      throw new AppError('The uploaded file is not a complete PDF document.', 400);
    }
    const extracted = await extractPdfText(buffer);
    return {
      reportText: extracted.text,
      reportTextStatus: extracted.text ? 'available' : 'needs_ocr',
      reportPageCount: extracted.pageCount,
      reportPagesAnalyzed: extracted.pagesAnalyzed,
    };
  }

  if (extension === 'ppt') {
    const compoundSignature = Buffer.from('D0CF11E0A1B11AE1', 'hex');
    if (!buffer.subarray(0, compoundSignature.length).equals(compoundSignature)) {
      throw new AppError('The uploaded file is not a valid PowerPoint presentation.', 400);
    }
    try {
      const compoundFile = CFB.read(buffer, { type: 'buffer' });
      const hasPresentationStream = compoundFile.FileIndex.some((entry) => (
        /(?:^|\/)PowerPoint Document$/i.test(entry.name || '')
      ));
      if (!hasPresentationStream) throw new Error('PowerPoint stream is missing.');
    } catch {
      throw new AppError('The uploaded file is not a valid PowerPoint presentation.', 400);
    }
    return {};
  }

  if (buffer.length < 4 || !buffer.subarray(0, 2).equals(Buffer.from('PK'))) {
    throw new AppError('The uploaded file is not a valid ZIP archive.', 400);
  }
  let archive;
  try {
    archive = await readZipEntries(buffer);
  } catch {
    throw new AppError('The uploaded file is not a valid or readable ZIP archive.', 400);
  }
  if (archive.entryCount === 0) {
    throw new AppError('The uploaded ZIP archive is empty.', 400);
  }

  if (extension === 'pptx') {
    const contentTypes = archive.capturedParts.get('[Content_Types].xml') || '';
    const presentation = archive.capturedParts.get('ppt/presentation.xml') || '';
    let hasPresentationParts = false;
    if (XMLValidator.validate(contentTypes) === true && XMLValidator.validate(presentation) === true) {
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
      const contentTypesDocument = parser.parse(contentTypes);
      const overrides = [].concat(contentTypesDocument.Types?.Override || []);
      const hasPresentationContentType = overrides.some((entry) => (
        entry['@_PartName'] === '/ppt/presentation.xml'
        && entry['@_ContentType'] === 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
      ));
      const presentationDocument = parser.parse(presentation);
      const hasPresentationRoot = Object.keys(presentationDocument).some((name) => name.split(':').pop() === 'presentation');
      hasPresentationParts = hasPresentationContentType && hasPresentationRoot;
    }
    if (!hasPresentationParts) {
      throw new AppError('The ZIP archive is not a valid PPTX presentation package.', 400);
    }
  }
  return {};
};

module.exports = { validateUploadContent, extractPdfText };