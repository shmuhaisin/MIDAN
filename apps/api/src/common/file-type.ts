/** A document's type from its own first bytes, not from what the upload claims. PDF, PNG and JPEG only. */
export function documentType(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { extension: 'pdf', mime: 'application/pdf' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: 'png', mime: 'image/png' };
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { extension: 'jpg', mime: 'image/jpeg' };
  return null;
}
