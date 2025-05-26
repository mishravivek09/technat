const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  generatePdf: (htmlContent) => ipcRenderer.invoke('generate-pdf', htmlContent)
});
