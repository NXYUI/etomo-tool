const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  selectProjectFolder: () => ipcRenderer.invoke('project:select-folder'),
  exportProjectBackup: (payload) => ipcRenderer.invoke('backup:export-project', payload),
  exportWorkspaceBackup: (payload) => ipcRenderer.invoke('backup:export-workspace', payload),
  importProjectBackup: () => ipcRenderer.invoke('backup:import-project'),
  saveProjectState: (projectPath, state) =>
    ipcRenderer.invoke('project:save-state', { projectPath, state }),
  ensureCharacterFolder: (projectPath, characterCode) =>
    ipcRenderer.invoke('project:ensure-character-folder', { projectPath, characterCode }),
  syncCharacterFolders: (projectPath, characterCodes) =>
    ipcRenderer.invoke('project:sync-character-folders', { projectPath, characterCodes }),
  renameCharacterFolder: (projectPath, previousCharacterCode, nextCharacterCode) =>
    ipcRenderer.invoke('project:rename-character-folder', {
      projectPath,
      previousCharacterCode,
      nextCharacterCode,
    }),
  deleteCharacterFolder: (projectPath, characterCode) =>
    ipcRenderer.invoke('project:delete-character-folder', { projectPath, characterCode }),
  saveImageFile: (payload) => ipcRenderer.invoke('project:save-image-file', payload),
  deleteImageFile: (projectPath, relativePath) =>
    ipcRenderer.invoke('project:delete-image-file', { projectPath, relativePath }),
  readImageAsDataUrl: (projectPath, relativePath) =>
    ipcRenderer.invoke('project:read-image-as-data-url', { projectPath, relativePath }),
})
