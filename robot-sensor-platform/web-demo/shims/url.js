// node:url
export const fileURLToPath = (u) => decodeURIComponent(new URL(String(u ?? 'file:///app/server/app.js')).pathname);
export const pathToFileURL = (p) => new URL(`file://${p}`);
export default { fileURLToPath, pathToFileURL };
