/**
 * Stage 05 — PDF rasterizer unit tests.
 *
 * Mocks `pdf-img-convert` so the test doesn't pull the real native
 * canvas binding (which may fail to build in CI). Verifies:
 *   1. Successful rasterize returns one RasterizedPage per page with
 *      PNG bytes and dimensions parsed from the IHDR.
 *   2. maxPages is enforced (clamp).
 *   3. A throw from `convert()` is caught and returns [] (triple-
 *      defensive — never aborts ingest).
 *   4. A missing module returns [] and never throws.
 */

import { PdfRasterizerService } from './pdf-rasterizer.service';

// Build a minimal valid 32-bit PNG header + IHDR chunk so the
// dimension reader returns predictable values. We don't need the
// full PNG to be decodable — the rasterizer only inspects bytes 0-23.
function fakePng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(64);
  // PNG signature
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  // IHDR length (4 bytes) + 'IHDR' + width + height + ...
  buf.writeUInt32BE(13, 8); // IHDR length
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe('PdfRasterizerService', () => {
  let convertMock: jest.Mock;

  beforeEach(() => {
    convertMock = jest.fn();
    // Inject our mock as the require()'d `pdf-img-convert` module.
    jest.resetModules();
    jest.doMock('pdf-img-convert', () => ({ convert: convertMock }), {
      virtual: true,
    });
  });

  afterEach(() => {
    jest.dontMock('pdf-img-convert');
  });

  it('returns one RasterizedPage per page with pixel dims read from PNG header', async () => {
    const png1 = fakePng(800, 600);
    const png2 = fakePng(1024, 768);
    convertMock.mockResolvedValueOnce([new Uint8Array(png1), new Uint8Array(png2)]);

    const svc = new PdfRasterizerService();
    const pages = await svc.rasterizePdf(Buffer.from('fake-pdf'), { dpi: 150 });

    expect(pages).toHaveLength(2);
    expect(pages[0]!.pageNumber).toBe(1);
    expect(pages[0]!.width).toBe(800);
    expect(pages[0]!.height).toBe(600);
    expect(pages[0]!.pngBuffer.length).toBe(png1.length);
    expect(pages[1]!.pageNumber).toBe(2);
    expect(pages[1]!.width).toBe(1024);
    expect(pages[1]!.height).toBe(768);
    // scale should be derived from dpi=150 / 72 base.
    expect(convertMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ scale: 150 / 72, base64: false }),
    );
  });

  it('clamps to maxPages and logs the cap', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => new Uint8Array(fakePng(10, 10)));
    convertMock.mockResolvedValueOnce(pages);

    const svc = new PdfRasterizerService();
    const out = await svc.rasterizePdf(Buffer.from('fake-pdf'), { maxPages: 2 });

    expect(out).toHaveLength(2);
    expect(out[0]!.pageNumber).toBe(1);
    expect(out[1]!.pageNumber).toBe(2);
  });

  it('returns [] when convert() throws (triple-defensive)', async () => {
    convertMock.mockRejectedValueOnce(new Error('malformed PDF'));
    const svc = new PdfRasterizerService();
    const out = await svc.rasterizePdf(Buffer.from('bad'));
    expect(out).toEqual([]);
  });

  it('returns [] when convert() returns no pages', async () => {
    convertMock.mockResolvedValueOnce([]);
    const svc = new PdfRasterizerService();
    const out = await svc.rasterizePdf(Buffer.from('empty'));
    expect(out).toEqual([]);
  });

  it('returns [] when the pdf-img-convert module is missing', async () => {
    // Undo the require-time mock — simulate dep not installed.
    jest.resetModules();
    jest.doMock(
      'pdf-img-convert',
      () => {
        throw new Error("Cannot find module 'pdf-img-convert'");
      },
      { virtual: true },
    );
    // Re-import after re-mocking.
    const { PdfRasterizerService: Svc } = await import('./pdf-rasterizer.service');
    const svc = new Svc();
    const out = await svc.rasterizePdf(Buffer.from('whatever'));
    expect(out).toEqual([]);
  });
});
