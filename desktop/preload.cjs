// The few things the app may ask the desktop shell to do. Nothing else from
// Node or Electron is reachable from the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("burrowDesktop", {
  load: () => ipcRenderer.invoke("vault:load"),
  save: (changed) => ipcRenderer.invoke("vault:save", changed),
  folder: () => ipcRenderer.invoke("vault:folder"),
  showFolder: () => ipcRenderer.invoke("vault:show"),
  chooseFolder: () => ipcRenderer.invoke("vault:choose"),
  mirror: (files) => ipcRenderer.invoke("vault:mirror", files),
  putFile: (name, bytes) => ipcRenderer.invoke("files:put", name, bytes),
  getFile: (id) => ipcRenderer.invoke("files:get", id),
  fileKeys: () => ipcRenderer.invoke("files:keys"),
  deleteFile: (id) => ipcRenderer.invoke("files:delete", id),
  preview: (url) => ipcRenderer.invoke("web:preview", url),
  readData: (name) => ipcRenderer.invoke("data:read", name),
  writeData: (name, value) => ipcRenderer.invoke("data:write", name, value),
  listPlugins: () => ipcRenderer.invoke("plugins:list"),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke("plugins:enable", id, enabled),
  showPluginsFolder: () => ipcRenderer.invoke("plugins:show"),
  onSaveFailed: (listener) => ipcRenderer.on("vault:save-failed", (_event, message) => listener(message)),
});
