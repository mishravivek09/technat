const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('generate-pdf', async (_event, htmlContent) => {
  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // ---- PAGE 1: Full content (desktop) ----
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`, {
      waitUntil: 'networkidle0'
    });
    await page.evaluateHandle('document.fonts.ready');

    const fullHeight = await page.evaluate(() => document.body.scrollHeight);
    const page1Buffer = await page.pdf({
      width: '110mm',
      height: `${fullHeight}px`,
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
    });

    // ---- PAGE 2: Mobile screenshot ----
    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`, {
      waitUntil: 'networkidle0'
    });
    const imageBuffer = await page.screenshot({ fullPage: true });

    // Create a new page to embed image into PDF
    const imagePage = await browser.newPage();
    await imagePage.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <html><body style="margin:0;padding:0;">
        <img src="data:image/png;base64,${imageBuffer.toString('base64')}" style="width:100%;" />
      </body></html>
    `)}`, {
      waitUntil: 'networkidle0'
    });

    const imageHeight = await imagePage.evaluate(() => document.documentElement.scrollHeight);
    const page2Buffer = await imagePage.pdf({
      width: '210mm',
      height: `${imageHeight}px`,
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
    });

    // ---- PAGE 3: Skeleton with alt texts only ----
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`, {
      waitUntil: 'networkidle0'
    });

    // Replace all images with alt texts
    await page.evaluate(() => {
      document.querySelectorAll('img').forEach(img => {
        const alt = img.alt || '[Image]';
        const div = document.createElement('div');
        div.innerText = alt;
        div.style.maxWidth = '100%';
        div.style.textWrap = 'break-all';
        div.style.padding = '4px';
        div.style.textDecoration='underline';
        div.style.fontStyle='italic';
        img.replaceWith(div);
      });
    });

    const skeletonHeight = await page.evaluate(() => document.body.scrollHeight);
    const page3Buffer = await page.pdf({
      width: '210mm',
      height: `${skeletonHeight}px`,
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
    });

    await browser.close();

    // Combine the 3 buffers into one PDF file using pdf-lib
    const mergedPdf = await PDFDocument.create();

    for (const buf of [page1Buffer, page2Buffer, page3Buffer]) {
      const pdf = await PDFDocument.load(buf);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
    }

    const finalPdfBytes = await mergedPdf.save();

    // Use timestamped filename to avoid overwrite
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(app.getPath('desktop'), `output-${timestamp}.pdf`);

    fs.writeFileSync(filePath, finalPdfBytes);

    return filePath;
  } catch (error) {
    console.error('PDF generation failed:', error);
    throw new Error('PDF generation failed.');
  }
});
