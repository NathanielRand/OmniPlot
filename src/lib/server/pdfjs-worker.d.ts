// pdfjs-dist ships pdf.worker.mjs as a plain build artifact with no
// accompanying .d.ts. We import it statically (see pdf.ts) to register it on
// globalThis.pdfjsWorker, sidestepping pdfjs's runtime dynamic import() of
// the same file — which Vercel's serverless bundler can't trace.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
	export const WorkerMessageHandler: unknown;
}
