export default class MarkdownToPDF {
	private readonly _image_import: string;
	private readonly _image_dir: string;
	private readonly _style: string;
	private readonly _template: string;
	private readonly _table_of_contents: boolean;
	
	constructor(options: Options);
	
	
	start(): void;
	
	/**
	 * @async
	 */
	convert(data: string, title?: string): Promise<Result>;
	
	close(): void;
}

export interface Options {
	image_import: string;
	image_dir: string;
	
	style: string;
	template: string;
	
	table_of_contents?: boolean;
}

export interface Result {
	html: string;
	pdf: Uint8Array;
	
	
	writeHTML(file: string): void;
	
	writePDF(file: string): void;
}

export function nullCoalescing<T>(value: T, fallback: T): T;

export function getFileContent(file: string, encoding?: string): string;
