// Node module-resolution hook: stands in for @aws-sdk/* when they are not
// installed (the harness runs without `npm install` in guild-cloud-server).
// Every S3 call rejects, like a server with no R2 keys. Dev only.
import { register } from 'node:module';

export const installAwsStub = () => {
  const source = `
    export class S3Client { send() { return Promise.reject(new Error('R2 is not configured (harness)')); } }
    export const PutObjectCommand = class {};
    export const HeadObjectCommand = class {};
    export const DeleteObjectCommand = class {};
    export const DeleteObjectsCommand = class {};
    export const ListObjectsV2Command = class {};
    export const getSignedUrl = () => Promise.reject(new Error('R2 is not configured (harness)'));
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
