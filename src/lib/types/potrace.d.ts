declare module 'potrace' {
	interface TraceOptions {
		turdSize?: number;
		turnPolicy?: 'black' | 'white' | 'left' | 'right' | 'minority' | 'majority';
		alphaMax?: number;
		optCurve?: boolean;
		optTolerance?: number;
		threshold?: number;
		blackOnWhite?: boolean;
		color?: string;
		background?: string;
	}
	export function trace(
		file: Buffer | string,
		options: TraceOptions,
		callback: (err: Error | null, svg: string) => void
	): void;
	export function trace(
		file: Buffer | string,
		callback: (err: Error | null, svg: string) => void
	): void;
}
