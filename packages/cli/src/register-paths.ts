import Module from "module";
import path from "path";
import fs from "fs";

const originalResolveFilename = (Module as any)._resolveFilename;

(Module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
  if (request.startsWith("@/")) {
    const relativePath = request.slice(2);
    // __dirname is packages/cli/src/
    const resolvedPath = path.resolve(__dirname, relativePath);
    
    // Check if .ts file exists for ts-node
    const tsPath = resolvedPath.replace(/\.js$/, ".ts");
    if (fs.existsSync(tsPath)) {
      return originalResolveFilename(tsPath, parent, isMain, options);
    }
    return originalResolveFilename(resolvedPath, parent, isMain, options);
  }
  return originalResolveFilename(request, parent, isMain, options);
};
