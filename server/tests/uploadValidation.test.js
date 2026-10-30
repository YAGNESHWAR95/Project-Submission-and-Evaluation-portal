const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const CFB = require('cfb');
const { validateUploadContent } = require('../src/services/uploadValidationService');

const createPdf = (text) => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >>${text ? ' /Contents 5 0 R' : ''} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  if (text) {
    const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
};

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createZip = (entries) => {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  entries.forEach(({ name, content }) => {
    const filename = Buffer.from(name);
    const data = Buffer.from(content);
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(filename.length, 26);
    localParts.push(localHeader, filename, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(filename.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, filename);
    localOffset += localHeader.length + filename.length + data.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
};

const withTempFile = async (filename, content, run) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'evalportal-upload-'));
  const filePath = path.join(directory, filename);
  await fs.writeFile(filePath, content);
  try {
    await run(filePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

test('valid PDF content is parsed and scanned PDFs are flagged for OCR', async () => {
  await withTempFile('report.pdf', createPdf('Proposal evidence text'), async (filePath) => {
    const result = await validateUploadContent({ filePath, originalName: 'report.pdf', mimeType: 'application/pdf', purpose: 'report' });
    assert.match(result.reportText, /Proposal evidence text/);
    assert.equal(result.reportTextStatus, 'available');
    assert.equal(result.reportPageCount, 1);
  });

  await withTempFile('scan.pdf', createPdf(''), async (filePath) => {
    const result = await validateUploadContent({ filePath, originalName: 'scan.pdf', mimeType: 'application/pdf', purpose: 'report' });
    assert.equal(result.reportTextStatus, 'needs_ocr');
  });
});

test('renamed, malformed, or MIME-mismatched documents are rejected', async () => {
  await withTempFile('fake.pdf', Buffer.from('not a PDF'), async (filePath) => {
    await assert.rejects(
      validateUploadContent({ filePath, originalName: 'fake.pdf', mimeType: 'application/pdf', purpose: 'report' }),
      /complete PDF/,
    );
  });

  await withTempFile('fake.pptx', Buffer.from('PK\x03\x04broken'), async (filePath) => {
    await assert.rejects(
      validateUploadContent({ filePath, originalName: 'fake.pptx', mimeType: 'application/zip', purpose: 'presentation' }),
      /valid or readable ZIP/,
    );
  });

  await withTempFile('valid.pdf', createPdf('Text'), async (filePath) => {
    await assert.rejects(
      validateUploadContent({ filePath, originalName: 'valid.pdf', mimeType: 'application/zip', purpose: 'report' }),
      /MIME type/,
    );
  });
});

test('ZIP source and PPTX packages must contain readable archive structures', async () => {
  const compoundFile = CFB.utils.cfb_new();
  CFB.utils.cfb_add(compoundFile, 'PowerPoint Document', Buffer.from('PowerPoint stream content'));
  const legacyPresentation = CFB.write(compoundFile, { type: 'buffer', fileType: 'ppt' });
  await withTempFile('slides.ppt', legacyPresentation, async (filePath) => {
    await assert.doesNotReject(validateUploadContent({
      filePath,
      originalName: 'slides.ppt',
      mimeType: 'application/vnd.ms-powerpoint',
      purpose: 'presentation',
    }));
  });

  const sourceZip = createZip([{ name: 'src/main.js', content: 'console.log("project")' }]);
  await withTempFile('source.zip', sourceZip, async (filePath) => {
    await assert.doesNotReject(validateUploadContent({ filePath, originalName: 'source.zip', mimeType: 'application/zip', purpose: 'source' }));
  });
  const corruptZip = Buffer.from(sourceZip);
  corruptZip[30 + Buffer.byteLength('src/main.js')] ^= 1;
  await withTempFile('corrupt.zip', corruptZip, async (filePath) => {
    await assert.rejects(
      validateUploadContent({ filePath, originalName: 'corrupt.zip', mimeType: 'application/zip', purpose: 'source' }),
      /valid or readable ZIP/,
    );
  });

  const pptx = createZip([
    { name: '[Content_Types].xml', content: '<Types><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>' },
    { name: 'ppt/presentation.xml', content: '<p:presentation/>' },
  ]);
  await withTempFile('slides.pptx', pptx, async (filePath) => {
    await assert.doesNotReject(validateUploadContent({
      filePath,
      originalName: 'slides.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      purpose: 'presentation',
    }));
  });

  await withTempFile('bad.zip', createZip([{ name: 'notes.txt', content: 'not a presentation' }]), async (filePath) => {
    await assert.rejects(
      validateUploadContent({ filePath, originalName: 'bad.pptx', mimeType: 'application/zip', purpose: 'presentation' }),
      /valid PPTX/,
    );
  });
});