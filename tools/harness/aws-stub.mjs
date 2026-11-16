// Node module-resolution hook: stands in for @aws-sdk/* when they are not
// installed (the harness runs without `npm install` in guild-cloud-server).
// Every S3 call rejects, like a server with no R2 keys, unless a test gives
// it a bucket (below). Dev only.
//
// RF_HARNESS_R2_FILE=<json file> gives a bucket a test can change while the
// server runs (the file is read on every call and rewritten on every delete):
//   { "a.mp4": { "size": 1234, "lastModified": "2026-01-01T00:00:00Z" } }
// A top-level "failDeletes": ["a.mp4"] makes bulk deletes of those keys fail
// (answered in DeleteObjects' `Errors` shape) and leaves the objects in place.
// `lastModified` is optional (now). Takes the place of RF_HARNESS_R2_KEYS.
import { register } from 'node:module';

export const installAwsStub = () => {
  // With RF_HARNESS_R2_KEYS (comma-separated) the bucket holds those objects,
  // 1000 bytes each, and deleting removes them; otherwise every call rejects.
  const source = `
    import fs from 'node:fs';
    const file = process.env.RF_HARNESS_R2_FILE || '';
    const keys = process.env.RF_HARNESS_R2_KEYS
      ? new Set(process.env.RF_HARNESS_R2_KEYS.split(','))
      : null;
    const readFile = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    const writeFile = (objects) => fs.writeFileSync(file, JSON.stringify(objects));
    const lastModified = (o) => (o.lastModified ? new Date(o.lastModified) : new Date());
    const cmd = (kind) => class { constructor(input) { this.input = input; this.kind = kind; } };
    export const PutObjectCommand = cmd('put');
    export const HeadObjectCommand = cmd('head');
    export const DeleteObjectCommand = cmd('delete');
    export const DeleteObjectsCommand = cmd('deleteMany');
    export const ListObjectsV2Command = cmd('list');
    const sendToFile = (command) => {
      const { failDeletes = [], ...objects } = readFile();
      const save = () => writeFile({ ...objects, failDeletes });
      const { Key } = command.input;
      switch (command.kind) {
        case 'head':
          if (!objects[Key]) throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
          return { ContentLength: objects[Key].size, LastModified: lastModified(objects[Key]) };
        case 'delete':
          delete objects[Key];
          save();
          return {};
        case 'deleteMany':
          const refused = command.input.Delete.Objects.filter((o) => failDeletes.includes(o.Key));
          command.input.Delete.Objects.forEach((o) => { if (!failDeletes.includes(o.Key)) delete objects[o.Key]; });
          save();
          return { Errors: refused.map((o) => ({ Key: o.Key, Code: 'AccessDenied', Message: 'stub: delete refused' })) };
        case 'list':
          return {
            Contents: Object.entries(objects).map(([k, o]) => ({ Key: k, Size: o.size, LastModified: lastModified(o) })),
          };
        default:
          throw new Error('not stubbed');
      }
    };
    export class S3Client {
      send(command) {
        if (file) {
          try { return Promise.resolve(sendToFile(command)); } catch (error) { return Promise.reject(error); }
        }
        if (!keys) return Promise.reject(new Error('R2 is not configured (harness)'));
        const { Key } = command.input;
        switch (command.kind) {
          case 'head':
            return keys.has(Key)
              ? Promise.resolve({ ContentLength: 1000 })
              : Promise.reject(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
          case 'delete':
            keys.delete(Key);
            return Promise.resolve({});
          case 'deleteMany':
            command.input.Delete.Objects.forEach((o) => keys.delete(o.Key));
            return Promise.resolve({});
          case 'list':
            return Promise.resolve({
              Contents: [...keys].map((k) => ({ Key: k, Size: 1000, LastModified: new Date() })),
            });
          default:
            return Promise.reject(new Error('not stubbed'));
        }
      }
    }
    export const getSignedUrl = (client, command) =>
      keys || file ? Promise.resolve('https://r2.test/' + command.input.Key) : Promise.reject(new Error('R2 is not configured (harness)'));
  `;
  const url = `data:text/javascript,${encodeURIComponent(source)}`;
  const hooks = `
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith('@aws-sdk/')) {
        try { return await next(specifier, context); }
        catch { return { url: ${JSON.stringify(url)}, shortCircuit: true }; }
      }
      return next(specifier, context);
    }
  `;
  register(`data:text/javascript,${encodeURIComponent(hooks)}`);
};

// `node --import ./aws-stub.mjs server.mjs`
if (process.env.RF_HARNESS_AWS_STUB === '1') installAwsStub();
