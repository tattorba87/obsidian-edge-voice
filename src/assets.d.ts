/** Files bundled into main.js as text by esbuild's text loader. */
declare module "*.py" {
	const source: string;
	export default source;
}
